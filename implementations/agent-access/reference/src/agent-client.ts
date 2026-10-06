import { createServer } from 'node:http'
import { createAuthorizationRequest,exchangeAuthorizationCode,generateDPoPKey,authenticatedAgentFetch,
  refreshDPoPTokens,OperationResponseSchema,EnrollmentResponseSchema } from '@hitl-protocol/agent-access'
import { z } from 'zod'
import { setTimeout } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'

const base=new URL(process.env.HITL_SERVICE_URL??'http://127.0.0.1:8789').origin
const discovery=await fetch(`${base}/.well-known/hitl.json`).then(response=>response.json())
const service=z.object({hitl_protocol:z.object({authentication:z.object({profiles:z.array(z.string()),well_known:z.url()})})}).parse(discovery)
if(!service.hitl_protocol.authentication.profiles.includes('hitl-agent-access-delegated-api/0.1'))throw new Error('Required delegated API binding is unavailable')
const resource=z.object({resource:z.literal(base),authorization_servers:z.array(z.url()).min(1),dpop_bound_access_tokens_required:z.literal(true)}).parse(await fetch(service.hitl_protocol.authentication.well_known).then(response=>response.json()))
const issuer=resource.authorization_servers[0]!
const oauthConfig={issuer,clientId:'hitl-agent',redirectUri:'http://127.0.0.1:8899/callback',allowInsecureLocalhost:process.env.ALLOW_INSECURE_LOCALHOST==='true'}
const key=await generateDPoPKey()
const attempt=await createAuthorizationRequest(oauthConfig,{scopes:['hitl:agent:enroll','hitl:reviews:read','bookings:read','bookings:prepare','bookings:commit'],dpopKey:key})
const callback=new Promise<string>((resolve,reject)=>{
  const server=createServer((request,response)=>{
    const url=new URL(request.url??'/',oauthConfig.redirectUri)
    if(request.method!=='GET'||url.pathname!=='/callback'||url.searchParams.get('state')!==attempt.state||!url.searchParams.has('code')){response.writeHead(400).end();return}
    response.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).end('Authorization received. Return to the terminal.')
    resolve(url.href);server.close()
  })
  server.on('error',reject);server.listen(8899,'127.0.0.1')
  const deadline=globalThis.setTimeout(()=>{server.close();reject(new Error('Authorization timed out'))},300_000);deadline.unref()
})
console.log(`Authorize the reference agent in your browser:\n${attempt.authorizationUrl}`)
let tokens=await exchangeAuthorizationCode(oauthConfig,{callbackUrl:await callback,state:attempt.state,nonce:attempt.nonce,codeVerifier:attempt.codeVerifier},key)
let issuedAt=Date.now()
async function request(path:string,method='GET',body?:unknown,headers?:HeadersInit):Promise<Response>{
  if(Date.now()-issuedAt>(Number(tokens.expires_in??300)-30)*1000){
    if(!tokens.refresh_token)throw new Error('Authorization expired; rerun the client')
    tokens=await refreshDPoPTokens(oauthConfig,{refreshToken:tokens.refresh_token,key});issuedAt=Date.now()
  }
  return authenticatedAgentFetch(new URL(path,base).href,{accessToken:tokens.access_token,key,method,...(body?{body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',...Object.fromEntries(new Headers(headers))}})
}
const enrolled=await request('/v1/agent-enrollments','POST',{display_name:'Reference CLI agent',max_total_cents:50000})
if(!enrolled.ok)throw new Error(`Enrollment failed: HTTP ${enrolled.status}`)
let enrollment=EnrollmentResponseSchema.parse(await enrolled.json())
console.log(`Connect this agent in your browser:\n${enrollment.verification_url}`)
while(enrollment.status==='pending'){await setTimeout(2000);enrollment=EnrollmentResponseSchema.parse(await(await request(`/v1/agent-enrollments/${enrollment.id}`)).json())}
if(enrollment.status!=='confirmed'||!enrollment.grant_id)throw new Error('Enrollment was not confirmed')
const offerId=process.env.HITL_OFFER_ID??'review-10001'
const catalogue=z.object({offers:z.array(z.object({id:z.string(),version:z.int()}))}).parse(await fetch(`${base}/v1/catalog`).then(response=>response.json()))
const offer=catalogue.offers.find(item=>item.id===offerId);if(!offer)throw new Error('Offer not found')
const prepare=await request('/v1/bookings/prepare','POST',{grant_id:enrollment.grant_id,offer_id:offer.id,offer_version:offer.version,quantity:1},{'Idempotency-Key':randomUUID()})
let operationId:string
if(prepare.status===202){
  const envelope=z.object({hitl:z.object({review_url:z.url(),poll_url:z.url(),context:z.object({'x-hitl-agent-access':z.object({operation_id:z.string()})})})}).parse(await prepare.json())
  operationId=envelope.hitl.context['x-hitl-agent-access'].operation_id
  console.log(`Review this proposal in your browser:\n${envelope.hitl.review_url}`)
  while(true){await setTimeout(2000);const operation=OperationResponseSchema.parse(await(await request(`/v1/operations/${operationId}`)).json());if(operation.status==='awaiting_approval')continue;if(operation.status!=='ready')throw new Error(`Proposal is ${operation.status}`);break}
}else{if(!prepare.ok)throw new Error(`Prepare failed: HTTP ${prepare.status}`);operationId=OperationResponseSchema.parse(await prepare.json()).operation_id}
const operation=OperationResponseSchema.parse(await(await request(`/v1/operations/${operationId}`)).json())
const committed=await request(`/v1/operations/${operationId}/commit`,'POST',{expected_version:operation.operation_version,snapshot_digest:operation.snapshot_digest})
if(!committed.ok)throw new Error(`Commit failed: HTTP ${committed.status}`)
console.log(JSON.stringify(OperationResponseSchema.parse(await committed.json()).result,null,2))
