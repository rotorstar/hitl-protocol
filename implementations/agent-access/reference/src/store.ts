import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { z } from 'zod'
import {
  AgentFactsSchema, BrowserIdentitySchema, OfferSnapshotSchema, OperationStatusSchema,
  OperationResponseSchema, evaluatePolicy, prepareFingerprint, snapshotDigest,
  type AgentFacts, type BrowserIdentity, type PrepareInput, type EnrollmentInput,
  type CommitInput, type PersistentProofStore, type NonceRecord, type NonceLookup, type ReplayRecord,
} from '@hitl-protocol/agent-access'
import { validateHitlObject, validatePollResponse } from '@hitl-protocol/schemas/v0.9'
import type { Config } from './config.js'

export class DomainError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503, readonly code: string,
    readonly headers: Record<string, string> = {}) { super(code) }
}
export const opaqueToken = (): string => randomBytes(32).toString('base64url')
export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex')
const Timestamp = z.union([z.date(), z.iso.datetime({offset:true})]).transform((value) => new Date(value).toISOString())
const PrincipalSchema = z.object({ id:z.string(), namespace:z.string(), issuer:z.string(),subject:z.string(),client_id:z.string(),jkt:z.string(),display_name:z.string(),active:z.boolean(),version:z.int(),last_used_at:Timestamp.nullable() })
const GrantSchema = z.object({ id:z.string(),principal_id:z.string(),max_total_cents:z.int(),scopes:z.array(z.string()),active:z.boolean(),version:z.int() })
const ConnectedAgentSchema = PrincipalSchema.extend({grants:z.array(GrantSchema)})
const OfferSchema = z.object({ id:z.string(),version:z.int(),title:z.string(),unit_price_cents:z.int(),fee_cents:z.int(),currency:z.literal('EUR'),refundable:z.boolean(),terms:z.string(),stock:z.int() })
const OperationSchema = z.object({ id:z.string(),namespace:z.string(),principal_id:z.string(),grant_id:z.string(),offer_id:z.string(),version:z.int(),snapshot:OfferSnapshotSchema,snapshot_digest:z.string(),status:OperationStatusSchema,result:z.record(z.string(),z.unknown()).nullable(),created_at:Timestamp,expires_at:Timestamp })
const ReviewSchema = z.object({ id:z.string(),operation_id:z.string(),status:z.enum(['pending','opened','in_progress','completed','expired','cancelled']),version:z.int(),result:z.object({action:z.enum(['confirm','cancel'])}).nullable(),reviewer:BrowserIdentitySchema.nullable(),created_at:Timestamp,expires_at:Timestamp,completed_at:Timestamp.nullable(),cancelled_at:Timestamp.nullable() })
const EnrollmentSchema = z.object({id:z.string(),namespace:z.string(),issuer:z.string(),subject:z.string(),client_id:z.string(),jkt:z.string(),display_name:z.string(),max_total_cents:z.int(),scopes:z.array(z.string()),status:z.enum(['pending','confirmed','expired']),principal_id:z.string().nullable(),grant_id:z.string().nullable(),created_at:Timestamp,expires_at:Timestamp})
const SessionSchema = z.object({token_hash:z.string(),identity:BrowserIdentitySchema.nullable(),csrf_hash:z.string(),review_ids:z.array(z.string()),expires_at:Timestamp})
const OwnedSnapshotSchema = z.object({principal:PrincipalSchema,grant:GrantSchema.nullable(),operation:OperationSchema.nullable(),review:ReviewSchema.nullable(),observed_at:Timestamp})
const BrowserReviewSnapshotSchema = z.object({principal:PrincipalSchema,operation:OperationSchema,review:ReviewSchema})
type Principal = z.infer<typeof PrincipalSchema>
type Grant = z.infer<typeof GrantSchema>
export type Operation = z.infer<typeof OperationSchema>
export type Review = z.infer<typeof ReviewSchema>
export type Enrollment = z.infer<typeof EnrollmentSchema>
export type BrowserSession = z.infer<typeof SessionSchema>
type Db = Pool | PoolClient
async function records<S extends z.ZodType>(db:Db,schema:S,sql:string,values:unknown[]=[]):Promise<z.output<S>[]> {
  const result=await db.query<Record<string,unknown>>(sql,values)
  return result.rows.map((row)=>schema.parse(row))
}
async function first<S extends z.ZodType>(db:Db,schema:S,sql:string,values:unknown[]=[]):Promise<z.output<S>|undefined> {
  return (await records(db,schema,sql,values))[0]
}
const IdempotencySchema=z.object({fingerprint:z.string(),operation_id:z.string()})
const CountSchema=z.object({count:z.coerce.number().int()})
const sameUser=(identity:BrowserIdentity,owner:{issuer:string;subject:string})=>identity.iss===owner.issuer&&identity.sub===owner.subject

export class Store implements PersistentProofStore {
  readonly pool:Pool
  constructor(readonly config:Config,pool?:Pool){this.pool=pool??new Pool({connectionString:config.DATABASE_URL,max:30,connectionTimeoutMillis:2000,statement_timeout:5000})}
  async close(){await this.pool.end()}
  async transaction<T>(command:(client:PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect()
    try{await client.query('BEGIN');const result=await command(client);await client.query('COMMIT');return result}
    catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async now(db:Db=this.pool):Promise<Date>{const row=await first(db,z.object({now:Timestamp}),'SELECT clock_timestamp() AS now');if(!row)throw new Error('DB clock missing');return new Date(row.now)}
  async promotePolicy(){await this.pool.query(`INSERT INTO service_policies(namespace,current_version) VALUES($1,$2)
    ON CONFLICT(namespace) DO UPDATE SET current_version=GREATEST(service_policies.current_version,excluded.current_version)`,[this.config.SERVICE_NAMESPACE,this.config.POLICY_VERSION])}
  async lockPolicy(db:PoolClient){
    // Shared lock precedes the business lock order and linearizes policy promotion with local writes.
    const policy=await first(db,z.object({current_version:z.int().positive()}),'SELECT current_version FROM service_policies WHERE namespace=$1 FOR SHARE',[this.config.SERVICE_NAMESPACE])
    if(!policy||policy.current_version!==this.config.POLICY_VERSION)throw new DomainError(503,'temporarily_unavailable')
  }
  async saveNonce(record:NonceRecord){await this.pool.query('INSERT INTO nonces(jkt,nonce_hash,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[record.jkt,hashToken(record.nonce),record.expiresAt])}
  async hasNonce(record:NonceLookup){return Boolean(await first(this.pool,z.object({ok:z.boolean()}),'SELECT true AS ok FROM nonces WHERE jkt=$1 AND nonce_hash=$2 AND expires_at>$3',[record.jkt,hashToken(record.nonce),record.now]))}
  async consumeReplay(record:ReplayRecord){const row=await this.pool.query('INSERT INTO replays(namespace,key,id,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[record.namespace,record.key,record.id,record.expiresAt]);return row.rowCount===1}
  async quota(key:string,limit:number,db:Db=this.pool):Promise<void>{
    const row=await first(db,CountSchema,`INSERT INTO quotas(key,window_start,count) VALUES($1,date_trunc('minute',clock_timestamp()),1)
      ON CONFLICT(key,window_start) DO UPDATE SET count=quotas.count+1 RETURNING count`,[key])
    if(!row||row.count>limit)throw new DomainError(429,'rate_limited',{'Retry-After':'60'})
  }
  async cleanup(){await this.pool.query(`DELETE FROM replays WHERE expires_at<=clock_timestamp(); DELETE FROM nonces WHERE expires_at<=clock_timestamp();
    DELETE FROM quotas WHERE window_start<clock_timestamp()-interval '5 minutes'; DELETE FROM oidc_states WHERE expires_at<=clock_timestamp();
    DELETE FROM browser_sessions WHERE expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM oidc_states WHERE session_hash=browser_sessions.token_hash);
    DELETE FROM review_capabilities WHERE review_id IN (SELECT id FROM reviews WHERE expires_at<=clock_timestamp() OR status IN ('completed','expired','cancelled'));
    DELETE FROM directory_cache WHERE expires_at<clock_timestamp()-interval '5 minutes'; DELETE FROM directory_leases WHERE expires_at<=clock_timestamp()`)}
  requireScope(facts:AgentFacts,scope:string){if(!facts.scopes.includes(scope))throw new DomainError(403,'insufficient_scope',{'WWW-Authenticate':`DPoP error="insufficient_scope", scope="${scope}"`})}
  async principal(facts:AgentFacts,db:Db=this.pool,lock=false):Promise<Principal>{
    AgentFactsSchema.parse(facts)
    const row=await first(db,PrincipalSchema,`SELECT * FROM principals WHERE namespace=$1 AND issuer=$2 AND subject=$3 AND client_id=$4 AND jkt=$5${lock?' FOR UPDATE':''}`,[this.config.SERVICE_NAMESPACE,facts.iss,facts.sub,facts.client_id,facts.jkt])
    if(!row||!row.active)throw new DomainError(403,'insufficient_scope')
    return row
  }
  async grant(id:string,principal:Principal,db:Db,scope:string,lock=true):Promise<Grant>{
    const row=await first(db,GrantSchema,`SELECT * FROM grants WHERE id=$1 AND principal_id=$2${lock?' FOR UPDATE':''}`,[id,principal.id])
    if(!row)throw new DomainError(404,'not_found')
    if(!row.active||!row.scopes.includes(scope))throw new DomainError(403,'insufficient_scope')
    return row
  }
  async catalog(){return records(this.pool,OfferSchema,'SELECT * FROM offers ORDER BY id')}
  async createEnrollment(facts:AgentFacts,input:EnrollmentInput):Promise<Enrollment>{
    this.requireScope(facts,'hitl:agent:enroll')
    await this.quota(`enrollment:${this.config.SERVICE_NAMESPACE}:${facts.iss}:${facts.sub}`,5)
    const row=await first(this.pool,EnrollmentSchema,`INSERT INTO enrollments(id,namespace,issuer,subject,client_id,jkt,display_name,max_total_cents,scopes,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '10 minutes') RETURNING *`,
      [`enroll_${randomUUID()}`,this.config.SERVICE_NAMESPACE,facts.iss,facts.sub,facts.client_id,facts.jkt,input.display_name??facts.client_id,input.max_total_cents,facts.scopes])
    if(!row)throw new Error('Enrollment missing');return row
  }
  async readEnrollment(id:string,facts:AgentFacts){
    this.requireScope(facts,'hitl:agent:enroll')
    const row=await first(this.pool,EnrollmentSchema,'SELECT * FROM enrollments WHERE id=$1 AND namespace=$2 AND issuer=$3 AND subject=$4 AND client_id=$5 AND jkt=$6',[id,this.config.SERVICE_NAMESPACE,facts.iss,facts.sub,facts.client_id,facts.jkt])
    if(!row)throw new DomainError(404,'not_found')
    return this.enrollmentView(row,await this.now())
  }
  enrollmentView(row:Enrollment,now:Date){return{id:row.id,verification_url:`${this.config.PUBLIC_BASE_URL}/connect/${encodeURIComponent(row.id)}`,expires_at:row.expires_at,status:row.status==='pending'&&now>=new Date(row.expires_at)?'expired':row.status,...(row.principal_id?{principal_id:row.principal_id}:{}),...(row.grant_id?{grant_id:row.grant_id}:{})}}
  async browserEnrollment(id:string,identity:BrowserIdentity){
    const row=await first(this.pool,EnrollmentSchema,'SELECT * FROM enrollments WHERE id=$1 AND namespace=$2',[id,this.config.SERVICE_NAMESPACE])
    if(!row||!sameUser(identity,row))throw new DomainError(404,'not_found')
    return row
  }
  async confirmEnrollment(id:string,identity:BrowserIdentity){
    const result=await this.transaction(async(db)=>{
      const enrollment=await first(db,EnrollmentSchema,'SELECT * FROM enrollments WHERE id=$1 AND namespace=$2 FOR UPDATE',[id,this.config.SERVICE_NAMESPACE])
      if(!enrollment||!sameUser(identity,enrollment))throw new DomainError(404,'not_found')
      const now=await this.now(db);this.assertFreshBrowser(identity,now)
      if(enrollment.status==='confirmed')return this.enrollmentView(enrollment,now)
      if(now>=new Date(enrollment.expires_at)){await db.query("UPDATE enrollments SET status='expired' WHERE id=$1",[id]);return new DomainError(410,'expired')}
      const principal=await first(db,PrincipalSchema,`INSERT INTO principals(id,namespace,issuer,subject,client_id,jkt,display_name)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(namespace,issuer,subject,client_id,jkt) DO UPDATE SET active=true,version=principals.version+1,display_name=excluded.display_name RETURNING *`,
        [`agent_${randomUUID()}`,enrollment.namespace,enrollment.issuer,enrollment.subject,enrollment.client_id,enrollment.jkt,enrollment.display_name])
      if(!principal)throw new Error('Principal missing')
      const confirmedAt=await this.now(db);this.assertFreshBrowser(identity,confirmedAt)
      if(confirmedAt>=new Date(enrollment.expires_at))throw new DomainError(410,'expired')
      const grantId=`grant_${randomUUID()}`
      await db.query('INSERT INTO grants(id,principal_id,max_total_cents,scopes) VALUES($1,$2,$3,$4)',[grantId,principal.id,enrollment.max_total_cents,enrollment.scopes])
      const confirmed=await first(db,EnrollmentSchema,"UPDATE enrollments SET status='confirmed',principal_id=$2,grant_id=$3 WHERE id=$1 AND expires_at>clock_timestamp() AND clock_timestamp()<=to_timestamp($4+300) RETURNING *",[id,principal.id,grantId,identity.auth_time])
      if(!confirmed){
        const rejectedAt=await this.now(db);this.assertFreshBrowser(identity,rejectedAt)
        if(rejectedAt>=new Date(enrollment.expires_at))throw new DomainError(410,'expired')
        throw new DomainError(503,'temporarily_unavailable')
      }
      await db.query("INSERT INTO audit_events(event,principal_id) VALUES('enrollment.confirmed',$1)",[principal.id])
      return this.enrollmentView(confirmed,confirmedAt)
    });if(result instanceof DomainError)throw result;return result
  }
  assertFreshBrowser(identity:BrowserIdentity,now:Date){BrowserIdentitySchema.parse(identity);const age=now.getTime()/1000-identity.auth_time;if(age< -30||age>300)throw new DomainError(401,'reauthentication_required')}
  async prepare(facts:AgentFacts,input:PrepareInput,key:string){
    this.requireScope(facts,'bookings:prepare')
    if(!/^[A-Za-z0-9._:-]{1,128}$/.test(key))throw new DomainError(400,'invalid_request')
    return this.transaction(async(db)=>{
      await this.lockPolicy(db)
      const principal=await this.principal(facts,db,true)
      const old=await first(db,IdempotencySchema,'SELECT * FROM idempotency WHERE namespace=$1 AND principal_id=$2 AND endpoint=$3 AND key=$4',[principal.namespace,principal.id,'bookings:prepare',key])
      const fingerprint=prepareFingerprint(input)
      if(old&&old.fingerprint!==fingerprint)throw new DomainError(409,'idempotency_conflict')
      const grant=await this.grant(input.grant_id,principal,db,'bookings:prepare')
      let operation:Operation
      if(old){const row=await first(db,OperationSchema,'SELECT * FROM operations WHERE id=$1 FOR UPDATE',[old.operation_id]);if(!row)throw new Error('Idempotency operation missing');operation=row}
      else{
        const offer=await first(db,OfferSchema,'SELECT * FROM offers WHERE id=$1',[input.offer_id]);if(!offer)throw new DomainError(404,'not_found')
        if(offer.version!==input.offer_version)throw new DomainError(409,'version_conflict')
        const snapshot=OfferSnapshotSchema.parse({offer_id:offer.id,offer_version:offer.version,title:offer.title,unit_price_cents:offer.unit_price_cents,fee_cents:offer.fee_cents,quantity:input.quantity,total_cents:offer.unit_price_cents*input.quantity+offer.fee_cents,currency:offer.currency,refundable:offer.refundable,terms:offer.terms,policy_version:this.config.POLICY_VERSION,grant_version:grant.version})
        const policy=evaluatePolicy(snapshot,{max_total_cents:grant.max_total_cents})
        if(policy==='deny')throw new DomainError(403,'limit_exceeded')
        const active=await first(db,CountSchema,"SELECT count(*) AS count FROM operations WHERE principal_id=$1 AND status IN ('awaiting_approval','ready') AND expires_at>clock_timestamp()",[principal.id])
        if((active?.count??0)>=10)throw new DomainError(429,'rate_limited',{'Retry-After':'60'})
        const row=await first(db,OperationSchema,`INSERT INTO operations(id,namespace,principal_id,grant_id,offer_id,snapshot,snapshot_digest,status,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '15 minutes') RETURNING *`,[`op_${randomUUID()}`,principal.namespace,principal.id,grant.id,offer.id,JSON.stringify(snapshot),snapshotDigest(snapshot),policy==='review'?'awaiting_approval':'ready'])
        if(!row)throw new Error('Operation missing');operation=row
        await db.query('INSERT INTO idempotency(namespace,principal_id,endpoint,key,fingerprint,operation_id) VALUES($1,$2,$3,$4,$5,$6)',[principal.namespace,principal.id,'bookings:prepare',key,fingerprint,operation.id])
        if(policy==='review')await db.query('INSERT INTO reviews(id,operation_id,expires_at) VALUES($1,$2,$3)',[`review_${randomUUID()}`,operation.id,operation.expires_at])
        await this.audit(db,'operation.prepared',operation)
      }
      const review=await first(db,ReviewSchema,'SELECT * FROM reviews WHERE operation_id=$1',[operation.id])
      const now=await this.now(db)
      const response=this.operationView(operation,review,now)
      if(review&&response.status==='awaiting_approval'&&!['completed','cancelled','expired'].includes(review.status)){
        await this.quota(`review-links:${review.id}`,5,db)
        const token=opaqueToken()
        await db.query('INSERT INTO review_capabilities(token_hash,review_id) VALUES($1,$2)',[hashToken(token),review.id])
        return {operation:response,hitl:this.hitl(operation,review,token)}
      }
      return {operation:response}
    })
  }
  operationView(operation:Operation,review:Review|undefined,now:Date){
    const status=['awaiting_approval','ready'].includes(operation.status)&&now>=new Date(operation.expires_at)?'expired':operation.status
    return OperationResponseSchema.parse({operation_id:operation.id,operation_version:operation.version,snapshot_digest:operation.snapshot_digest,status,created_at:operation.created_at,expires_at:operation.expires_at,snapshot:operation.snapshot,...(review?{review_case_id:review.id}:{}),...(operation.result?{result:operation.result}:{})})
  }
  hitl(operation:Operation,review:Review,token:string){
    const result={spec_version:'0.9',case_id:review.id,review_url:`${this.config.PUBLIC_BASE_URL}/review/${encodeURIComponent(review.id)}?token=${token}`,poll_url:`${this.config.PUBLIC_BASE_URL}/v1/reviews/${encodeURIComponent(review.id)}`,type:'confirmation',prompt:'Confirm this booking proposal. Confirmation does not execute the booking.',timeout:'PT15M',default_action:'abort',created_at:review.created_at,expires_at:review.expires_at,context:{'x-hitl-agent-access':{profile:'hitl-agent-access/0.1',binding:'delegated-api',operation_id:operation.id,operation_version:operation.version,snapshot_digest:operation.snapshot_digest,execution_mode:'explicit_commit'}},verification_policy:{mode:'required',required_for:['browser_submit'],requirements:{any_of:[{all_of:[{proof_type:'x-hitl-agent-access-reviewer',provider:'reference-oidc',presentation_formats:['x-service-session']}]}]},binding:{case_id:true,action:true,freshness_seconds:300,single_use:true},fallback:{on_missing:'reject',on_invalid:'reject'}}}
    if(!validateHitlObject(result))throw new Error('Generated HITL object violates v0.9')
    return result
  }
  async ownedOperation(id:string,facts:AgentFacts,scope='bookings:read'){
    return this.ownedSnapshot(id,facts,scope,'operation')
  }
  async ownedSnapshot(id:string,facts:AgentFacts,scope:string,resource:'operation'|'review'){
    this.requireScope(facts,scope);AgentFactsSchema.parse(facts)
    // One MVCC statement owns authorization, state and deadline projection. A later clock read
    // could expire an old row after another transaction has already completed it successfully.
    const row=await first(this.pool,OwnedSnapshotSchema,`SELECT to_jsonb(p) AS principal,to_jsonb(g) AS "grant",
      to_jsonb(o) AS operation,to_jsonb(r) AS review,statement_timestamp() AS observed_at
      FROM principals p
      LEFT JOIN operations o ON o.principal_id=p.id AND ${resource==='operation'?'o.id=$6':'o.id=(SELECT operation_id FROM reviews WHERE id=$6)'}
      LEFT JOIN grants g ON g.id=o.grant_id AND g.principal_id=p.id
      LEFT JOIN reviews r ON r.operation_id=o.id
      WHERE p.namespace=$1 AND p.issuer=$2 AND p.subject=$3 AND p.client_id=$4 AND p.jkt=$5`,
    [this.config.SERVICE_NAMESPACE,facts.iss,facts.sub,facts.client_id,facts.jkt,id])
    if(!row||!row.principal.active)throw new DomainError(403,'insufficient_scope')
    if(!row.operation||(resource==='review'&&!row.review))throw new DomainError(404,'not_found')
    if(!row.grant)throw new DomainError(404,'not_found')
    if(!row.grant.active||!row.grant.scopes.includes(scope))throw new DomainError(403,'insufficient_scope')
    return {principal:row.principal,operation:row.operation,review:row.review??undefined,now:new Date(row.observed_at)}
  }
  async readOperation(id:string,facts:AgentFacts){const {operation,review,now}=await this.ownedOperation(id,facts);return this.operationView(operation,review,now)}
  async readReview(id:string,facts:AgentFacts){
    const {review,now}=await this.ownedSnapshot(id,facts,'hitl:reviews:read','review')
    if(!review)throw new DomainError(404,'not_found')
    return this.pollView(review,now)
  }
  pollView(review:Review,now:Date){
    const expired=!['completed','cancelled','expired'].includes(review.status)&&now>=new Date(review.expires_at)
    const status=expired?'expired':review.status
    const result={status,case_id:review.id,created_at:review.created_at,expires_at:review.expires_at,...(status==='expired'?{expired_at:review.expires_at,default_action:'abort'}:{}),...(status==='cancelled'?{cancelled_at:review.cancelled_at??review.expires_at}:{}),...(status==='completed'?{completed_at:review.completed_at,result:review.result,submission_context:{mode:'browser_submit',verification_result:{satisfied:true,verified_evidence:[{proof_type:'x-hitl-agent-access-reviewer',provider:'reference-oidc',bound_to_case:true,bound_to_action:true,fresh:true,single_use_enforced:true,verified_at:review.completed_at}]}},...(review.reviewer?.display_name||review.reviewer?.verified_email?{responded_by:{...(review.reviewer?.display_name?{name:review.reviewer.display_name}:{}),...(review.reviewer?.verified_email?{email:review.reviewer.verified_email}:{})}}:{})}:{})}
    if(!validatePollResponse(result))throw new Error('Poll projection violates v0.9');return result
  }
  async validateCapability(id:string,token:string){
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new DomainError(404,'not_found')
    const review=await first(this.pool,ReviewSchema,'SELECT r.* FROM reviews r JOIN review_capabilities c ON c.review_id=r.id JOIN operations o ON o.id=r.operation_id WHERE r.id=$1 AND c.token_hash=$2 AND c.purpose=$3 AND o.namespace=$4',[id,hashToken(token),'review',this.config.SERVICE_NAMESPACE])
    if(!review)throw new DomainError(404,'not_found')
    if(await this.now()>=new Date(review.expires_at))throw new DomainError(410,'expired')
    return review.id
  }
  async browserReview(id:string,identity:BrowserIdentity,allowed:string[]){
    if(!allowed.includes(id))throw new DomainError(404,'not_found')
    const row=await first(this.pool,BrowserReviewSnapshotSchema,`SELECT to_jsonb(r) AS review,to_jsonb(o) AS operation,to_jsonb(p) AS principal
      FROM reviews r JOIN operations o ON o.id=r.operation_id JOIN principals p ON p.id=o.principal_id
      WHERE r.id=$1 AND o.namespace=$2 AND p.namespace=$2 AND p.issuer=$3 AND p.subject=$4`,
    [id,this.config.SERVICE_NAMESPACE,identity.iss,identity.sub])
    if(!row)throw new DomainError(404,'not_found')
    return row
  }
  async decide(id:string,identity:BrowserIdentity,allowed:string[],action:'confirm'|'cancel'){
    const located=await this.browserReview(id,identity,allowed)
    const outcome=await this.transaction(async(db)=>{
      await this.lockPolicy(db)
      const principal=await first(db,PrincipalSchema,'SELECT * FROM principals WHERE id=$1 AND namespace=$2 FOR UPDATE',[located.principal.id,this.config.SERVICE_NAMESPACE]);if(!principal||!sameUser(identity,principal))throw new DomainError(404,'not_found')
      const grant=await first(db,GrantSchema,'SELECT * FROM grants WHERE id=$1 FOR UPDATE',[located.operation.grant_id])
      const operation=await first(db,OperationSchema,'SELECT * FROM operations WHERE id=$1 FOR UPDATE',[located.operation.id])
      const review=await first(db,ReviewSchema,'SELECT * FROM reviews WHERE id=$1 FOR UPDATE',[id])
      if(!grant||!operation||!review)throw new DomainError(404,'not_found')
      const now=await this.now(db);this.assertFreshBrowser(identity,now)
      if(['completed','cancelled','expired'].includes(review.status))throw new DomainError(409,'state_conflict')
      if(now>=new Date(review.expires_at)){await this.invalidate(db,operation,'expired');return new DomainError(410,'expired')}
      const offer=await first(db,OfferSchema,'SELECT * FROM offers WHERE id=$1 FOR UPDATE',[operation.offer_id])
      if(!principal.active||!grant.active){await this.invalidate(db,operation,'cancelled');return new DomainError(409,'state_conflict')}
      if(!offer||!this.versionsCurrent(operation,grant,offer)){await this.invalidate(db,operation,'superseded');return new DomainError(409,'version_conflict')}
      if(operation.status!=='awaiting_approval')throw new DomainError(409,'state_conflict')
      const decisionNow=await this.now(db);this.assertFreshBrowser(identity,decisionNow)
      if(decisionNow>=new Date(review.expires_at)){await this.invalidate(db,operation,'expired');return new DomainError(410,'expired')}
      const changed=await db.query("UPDATE reviews SET status='completed',result=$2,reviewer=$3,completed_at=clock_timestamp(),version=version+1 WHERE id=$1 AND expires_at>clock_timestamp() AND clock_timestamp()<=to_timestamp($4+300)",[id,JSON.stringify({action}),JSON.stringify(identity),identity.auth_time])
      if(changed.rowCount!==1){
        const rejectedAt=await this.now(db);this.assertFreshBrowser(identity,rejectedAt)
        if(rejectedAt>=new Date(review.expires_at)){await this.invalidate(db,operation,'expired');return new DomainError(410,'expired')}
        throw new DomainError(503,'temporarily_unavailable')
      }
      await db.query('UPDATE operations SET status=$2 WHERE id=$1',[operation.id,action==='confirm'?'ready':'cancelled'])
      await this.audit(db,'review.completed',operation,{action})
      return {action,status:'completed' as const}
    });if(outcome instanceof DomainError)throw outcome;return outcome
  }
  versionsCurrent(operation:Operation,grant:Grant,offer:z.infer<typeof OfferSchema>){return operation.snapshot.grant_version===grant.version&&operation.snapshot.offer_version===offer.version&&operation.snapshot.policy_version===this.config.POLICY_VERSION&&snapshotDigest(operation.snapshot)===operation.snapshot_digest}
  async invalidate(db:PoolClient,operation:Operation,status:'expired'|'cancelled'|'superseded'){
    await db.query('UPDATE operations SET status=$2 WHERE id=$1',[operation.id,status])
    await db.query("UPDATE reviews SET status=$2,cancelled_at=CASE WHEN $2='cancelled' THEN clock_timestamp() ELSE NULL END,version=version+1 WHERE operation_id=$1 AND status IN ('pending','opened','in_progress')",[operation.id,status==='expired'?'expired':'cancelled'])
    await this.audit(db,`operation.${status}`,operation)
  }
  async commit(id:string,facts:AgentFacts,input:CommitInput){
    this.requireScope(facts,'bookings:commit')
    const located=await this.ownedOperation(id,facts,'bookings:commit')
    const outcome=await this.transaction(async(db)=>{
      await this.lockPolicy(db)
      const principal=await this.principal(facts,db,true)
      const grant=await this.grant(located.operation.grant_id,principal,db,'bookings:commit')
      const operation=await first(db,OperationSchema,'SELECT * FROM operations WHERE id=$1 AND principal_id=$2 FOR UPDATE',[id,principal.id]);if(!operation)throw new DomainError(404,'not_found')
      const review=await first(db,ReviewSchema,'SELECT * FROM reviews WHERE operation_id=$1 FOR UPDATE',[id])
      const now=await this.now(db)
      if(facts.exp<=now.getTime()/1000)throw new DomainError(401,'invalid_token')
      if(now.getTime()-Date.parse(facts.observed_at)>2000||Date.parse(facts.observed_at)>now.getTime())throw new DomainError(503,'temporarily_unavailable')
      if(input.expected_version!==operation.version||input.snapshot_digest!==operation.snapshot_digest)throw new DomainError(409,'version_conflict')
      if(operation.status==='succeeded')return this.operationView(operation,review,now)
      if(!['awaiting_approval','ready'].includes(operation.status))throw new DomainError(409,'state_conflict')
      if(now>=new Date(operation.expires_at)){await this.invalidate(db,operation,'expired');return new DomainError(410,'expired')}
      if(operation.status!=='ready')throw new DomainError(409,'state_conflict')
      const offer=await first(db,OfferSchema,'SELECT * FROM offers WHERE id=$1 FOR UPDATE',[operation.offer_id]);if(!offer)throw new DomainError(404,'not_found')
      if(!this.versionsCurrent(operation,grant,offer)){await this.invalidate(db,operation,'superseded');return new DomainError(409,'version_conflict')}
      const policy=evaluatePolicy(operation.snapshot,{max_total_cents:grant.max_total_cents})
      if(policy==='deny')throw new DomainError(403,'limit_exceeded')
      if(policy==='review'&&(!review||review.status!=='completed'||review.result?.action!=='confirm'))throw new DomainError(409,'state_conflict')
      if(offer.stock<operation.snapshot.quantity){await db.query("UPDATE operations SET status='failed',result=$2 WHERE id=$1",[id,JSON.stringify({error:'out_of_stock'})]);await this.audit(db,'operation.failed',operation,{error:'out_of_stock'});return new DomainError(409,'out_of_stock')}
      // Re-read the actual DB clock at the write boundary after every lock/query.
      const commitNow=await this.now(db)
      if(commitNow>=new Date(operation.expires_at))throw new DomainError(410,'expired')
      if(facts.exp<=commitNow.getTime()/1000)throw new DomainError(401,'invalid_token')
      if(commitNow.getTime()-Date.parse(facts.observed_at)>2000||Date.parse(facts.observed_at)>commitNow.getTime())throw new DomainError(503,'temporarily_unavailable')
      const bookingId=`booking_${randomUUID()}`
      const result={booking_id:bookingId,offer_id:offer.id,quantity:operation.snapshot.quantity,total_cents:operation.snapshot.total_cents,currency:'EUR' as const}
      const inserted=await db.query(`INSERT INTO bookings(id,operation_id,offer_id,quantity,total_cents,currency)
        SELECT $1,id,$3,$4,$5,$6 FROM operations WHERE id=$2 AND expires_at>clock_timestamp()
        AND to_timestamp($7)>clock_timestamp() AND $8::timestamptz>=clock_timestamp()-interval '2 seconds'
        AND $8::timestamptz<=clock_timestamp() RETURNING id`,
        [bookingId,id,offer.id,result.quantity,result.total_cents,result.currency,facts.exp,facts.observed_at])
      if(inserted.rowCount!==1){
        const rejectedAt=await this.now(db)
        if(rejectedAt>=new Date(operation.expires_at))throw new DomainError(410,'expired')
        if(facts.exp<=rejectedAt.getTime()/1000)throw new DomainError(401,'invalid_token')
        throw new DomainError(503,'temporarily_unavailable')
      }
      await db.query('UPDATE offers SET stock=stock-$2 WHERE id=$1',[offer.id,result.quantity])
      const completed=await first(db,OperationSchema,"UPDATE operations SET status='succeeded',result=$2 WHERE id=$1 RETURNING *",[id,JSON.stringify(result)])
      await db.query('UPDATE principals SET last_used_at=$2 WHERE id=$1',[principal.id,commitNow])
      await this.audit(db,'operation.succeeded',operation,{booking_id:bookingId})
      if(!completed)throw new Error('Completed operation missing');return this.operationView(completed,review,commitNow)
    });if(outcome instanceof DomainError)throw outcome;return outcome
  }
  async audit(db:PoolClient,event:string,operation:Operation,details:Record<string,unknown>={}){await db.query('INSERT INTO audit_events(event,principal_id,operation_id,details) VALUES($1,$2,$3,$4)',[event,operation.principal_id,operation.id,JSON.stringify(details)])}
  async listAgents(identity:BrowserIdentity){return records(this.pool,ConnectedAgentSchema,`SELECT p.*,COALESCE(jsonb_agg(to_jsonb(g)) FILTER(WHERE g.id IS NOT NULL),'[]'::jsonb) AS grants
    FROM principals p LEFT JOIN grants g ON g.principal_id=p.id WHERE p.namespace=$1 AND p.issuer=$2 AND p.subject=$3 GROUP BY p.id ORDER BY p.created_at`,[this.config.SERVICE_NAMESPACE,identity.iss,identity.sub])}
  async revoke(id:string,identity:BrowserIdentity){await this.transaction(async(db)=>{
    const principal=await first(db,PrincipalSchema,'SELECT * FROM principals WHERE id=$1 AND namespace=$2 FOR UPDATE',[id,this.config.SERVICE_NAMESPACE]);if(!principal||!sameUser(identity,principal))throw new DomainError(404,'not_found')
    this.assertFreshBrowser(identity,await this.now(db))
    if(!principal.active)return
    await db.query('SELECT id FROM grants WHERE principal_id=$1 ORDER BY id FOR UPDATE',[id])
    const operations=await records(db,OperationSchema,"SELECT * FROM operations WHERE principal_id=$1 AND status IN ('awaiting_approval','ready') ORDER BY id FOR UPDATE",[id])
    this.assertFreshBrowser(identity,await this.now(db))
    const changed=await db.query('UPDATE principals SET active=false,version=version+1 WHERE id=$1 AND clock_timestamp()<=to_timestamp($2+300)',[id,identity.auth_time])
    if(changed.rowCount!==1){this.assertFreshBrowser(identity,await this.now(db));throw new DomainError(503,'temporarily_unavailable')}
    await db.query('UPDATE grants SET active=false,version=version+1 WHERE principal_id=$1',[id])
    for(const operation of operations)await this.invalidate(db,operation,'cancelled')
    await db.query("INSERT INTO audit_events(event,principal_id) VALUES('principal.revoked',$1)",[id])
  })}
  async createSession(csrf:string){const token=opaqueToken();const session=await first(this.pool,SessionSchema,"INSERT INTO browser_sessions(token_hash,csrf_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '15 minutes') RETURNING *",[hashToken(token),hashToken(csrf)]);if(!session)throw new Error('Session missing');return {token,session}}
  async session(token:string|undefined){if(!token)return undefined;return first(this.pool,SessionSchema,'SELECT * FROM browser_sessions WHERE token_hash=$1 AND expires_at>clock_timestamp()',[hashToken(token)])}
  async addCapability(session:BrowserSession,reviewId:string){await this.pool.query('UPDATE browser_sessions SET review_ids=array_append(review_ids,$2) WHERE token_hash=$1 AND NOT($2=ANY(review_ids)) AND cardinality(review_ids)<32',[session.token_hash,reviewId])}
  async saveOidcState(session:BrowserSession,state:string,verifier:string,nonce:string,path:string){await this.pool.query("INSERT INTO oidc_states(state_hash,session_hash,verifier,nonce,return_path,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')",[hashToken(state),session.token_hash,verifier,nonce,path])}
  async consumeOidcState(state:string,session:BrowserSession){return first(this.pool,z.object({verifier:z.string(),nonce:z.string(),return_path:z.string()}),'DELETE FROM oidc_states WHERE state_hash=$1 AND session_hash=$2 AND expires_at>clock_timestamp() RETURNING verifier,nonce,return_path',[hashToken(state),session.token_hash])}
  async authenticateSession(session:BrowserSession,identity:BrowserIdentity){
    return this.transaction(async(db)=>{
      const previous=await first(db,SessionSchema,'SELECT * FROM browser_sessions WHERE token_hash=$1 AND expires_at>clock_timestamp() FOR UPDATE',[session.token_hash])
      if(!previous)throw new DomainError(401,'reauthentication_required')
      const now=await this.now(db);this.assertFreshBrowser(identity,now)
      if(now>=new Date(previous.expires_at))throw new DomainError(401,'reauthentication_required')
      const reviewIds=!previous.identity||(previous.identity.iss===identity.iss&&previous.identity.sub===identity.sub)?previous.review_ids:[]
      const token=opaqueToken(),csrf=opaqueToken()
      await db.query('DELETE FROM oidc_states WHERE session_hash=$1',[previous.token_hash])
      await db.query('DELETE FROM browser_sessions WHERE token_hash=$1',[previous.token_hash])
      const rotated=await first(db,SessionSchema,`INSERT INTO browser_sessions(token_hash,identity,csrf_hash,review_ids,expires_at)
        SELECT $1,$2,$3,$4,clock_timestamp()+interval '15 minutes'
        WHERE $5::timestamptz>clock_timestamp() AND clock_timestamp()<=to_timestamp($6+300) RETURNING *`,
      [hashToken(token),JSON.stringify(identity),hashToken(csrf),reviewIds,previous.expires_at,identity.auth_time])
      if(!rotated){this.assertFreshBrowser(identity,await this.now(db));throw new DomainError(401,'reauthentication_required')}
      return {token,csrf,session:rotated}
    })
  }
}
