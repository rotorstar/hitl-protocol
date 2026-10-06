import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie,setCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import { getConnInfo } from '@hono/node-server/conninfo'
import { z } from 'zod'
import { AgentAccessError,KeycloakAuthenticator,PublicWebVerifier,agentAccessDiscovery,protectedResourceMetadata,
  PrepareInputSchema,EnrollmentInputSchema,CommitInputSchema,ReviewActionSchema,createAuthorizationRequest,completeBrowserLogin,
  canonicalDigest,type DirectoryResolver } from '@hitl-protocol/agent-access'
import { validateDiscoveryResponse } from '@hitl-protocol/schemas/v0.9'
import type { Config } from './config.js'
import { Store,DomainError,hashToken,opaqueToken,type BrowserSession } from './store.js'
import { PersistentDirectories } from './directories.js'
import { Home,EnrollmentView,ReviewView,AgentsView,ErrorView,STYLE } from './views.js'

type Env={Variables:{session:BrowserSession;csrf:string}}
type C=Context<Env>
export interface AppOptions {directories?:DirectoryResolver;authenticator?:Pick<KeycloakAuthenticator,'authenticate'>}
export function createApp(config:Config,store:Store,options:AppOptions={}){
  const app=new Hono<Env>()
  const authenticator=options.authenticator??new KeycloakAuthenticator({issuer:config.OIDC_ISSUER,audience:config.OIDC_AUDIENCE,introspectionClientId:config.OIDC_INTROSPECTION_CLIENT_ID,introspectionClientSecret:config.OIDC_INTROSPECTION_CLIENT_SECRET,allowInsecureLocalhost:config.ALLOW_INSECURE_LOCALHOST==='true'},store)
  const publicVerifier=new PublicWebVerifier(options.directories??new PersistentDirectories(store),store)
  const secure=new URL(config.PUBLIC_BASE_URL).protocol==='https:'
  const sessionCookie=secure?'__Host-hitl-session':'hitl-session'
  const csrfCookie=secure?'__Host-hitl-csrf':'hitl-csrf'
  const oauthConfig={issuer:config.OIDC_ISSUER,clientId:config.OIDC_BROWSER_CLIENT_ID,clientSecret:config.OIDC_BROWSER_CLIENT_SECRET,redirectUri:`${config.PUBLIC_BASE_URL}/auth/callback`,allowInsecureLocalhost:config.ALLOW_INSECURE_LOCALHOST==='true'}
  app.use('*',async(c,next)=>{
    c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');c.header('X-Content-Type-Options','nosniff')
    c.header('Content-Security-Policy',"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    await next()
  })
  function peer(c:C){
    try{return getConnInfo(c).remote.address??'unknown'}catch{return 'unknown'}
  }
  app.use('*',async(c,next)=>{
    const path=c.req.path
    if((path.startsWith('/v1/')&&path!=='/v1/catalog')||path.startsWith('/review/')
      ||path.startsWith('/connect/')||path.startsWith('/account/')||path==='/auth/callback'){
      // Bound nonce challenges, introspection, anonymous sessions and OIDC work
      // before any authentication, body parsing or browser-session allocation.
      await store.quota(`admission:${config.SERVICE_NAMESPACE}:ip:${peer(c)}`,240)
      await store.quota(`admission:${config.SERVICE_NAMESPACE}:global`,2400)
    }
    await next()
  })
  app.use('*',bodyLimit({maxSize:32768,onError:(c)=>c.json({error:'invalid_request'},400)}))
  app.onError((error,c)=>{
    const known=error instanceof DomainError||error instanceof AgentAccessError
    const status=known?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:503
    // Provider/package diagnostics are not additional public wire error variants.
    const code=error instanceof AgentAccessError
      ? status===503?'temporarily_unavailable':error.code==='use_dpop_nonce'?'use_dpop_nonce'
        :error.code==='unauthorized'||error.code==='invalid_token'?'invalid_token':'invalid_dpop_proof'
      :error instanceof DomainError?error.code:status===400?'invalid_request':'temporarily_unavailable'
    if(known)for(const [key,value] of Object.entries(error.headers))c.header(key,value)
    if(status===401&&!c.res.headers.has('WWW-Authenticate'))c.header('WWW-Authenticate',`DPoP error="${code==='invalid_token'?'invalid_token':'invalid_dpop_proof'}"`)
    if(c.req.path.startsWith('/v1/')||c.req.path.startsWith('/.well-known/'))return c.json({error:code},status)
    return c.html(<ErrorView code={code} status={status}/>,status)
  })
  const canonicalRequest=(request:Request)=>new Request(`${config.PUBLIC_BASE_URL}${new URL(request.url).pathname}${new URL(request.url).search}`,{method:request.method,headers:request.headers})
  async function agent(c:C){
    const facts=await authenticator.authenticate(canonicalRequest(c.req.raw))
    await store.quota(`agent:${config.SERVICE_NAMESPACE}:${facts.iss}:${facts.sub}:${facts.client_id}:${facts.jkt}`,60)
    await store.quota(`account:${config.SERVICE_NAMESPACE}:${facts.iss}:${facts.sub}`,120)
    return facts
  }
  async function browserSession(c:C,create=true){
    const cached=c.get('session');if(cached)return cached
    const found=await store.session(getCookie(c,sessionCookie));const csrf=getCookie(c,csrfCookie)
    if(found){
      if(csrf&&hashToken(csrf)===found.csrf_hash){c.set('session',found);c.set('csrf',csrf);return found}
      // Strict cookies can be absent throughout a cross-site redirect chain, even after the callback.
      // Recover only the CSRF challenge; never discard an authenticated Lax session or its case bindings.
      const challenge=opaqueToken()
      await store.pool.query('UPDATE browser_sessions SET csrf_hash=$2 WHERE token_hash=$1',[found.token_hash,hashToken(challenge)])
      setCookie(c,csrfCookie,challenge,{httpOnly:true,secure,sameSite:'Strict',path:'/',maxAge:900})
      const session={...found,csrf_hash:hashToken(challenge)}
      c.set('session',session);c.set('csrf',challenge);return session
    }
    if(!create)throw new DomainError(401,'reauthentication_required')
    const freshCsrf=opaqueToken();const {token,session}=await store.createSession(freshCsrf)
    setCookie(c,sessionCookie,token,{httpOnly:true,secure,sameSite:'Lax',path:'/',maxAge:900})
    setCookie(c,csrfCookie,freshCsrf,{httpOnly:true,secure,sameSite:'Strict',path:'/',maxAge:900})
    c.set('session',session);c.set('csrf',freshCsrf);return session
  }
  async function beginLogin(c:C,session:BrowserSession,path:string){
    if(!/^\/(?:account\/agents|connect\/enroll_[a-f0-9-]+|review\/review_[a-f0-9-]+)$/.test(path))throw new DomainError(400,'invalid_request')
    const attempt=await createAuthorizationRequest(oauthConfig,{freshLogin:Boolean(session.identity)})
    await store.saveOidcState(session,attempt.state,attempt.codeVerifier,attempt.nonce,path)
    return c.redirect(attempt.authorizationUrl,303)
  }
  async function identity(c:C,session:BrowserSession,path:string){
    if(!session.identity)return beginLogin(c,session,path)
    try{store.assertFreshBrowser(session.identity,await store.now())}catch(error){if(error instanceof DomainError&&error.status===401)return beginLogin(c,session,path);throw error}
    return session.identity
  }
  async function csrf(c:C,session:BrowserSession,body:Record<string,unknown>){
    const value=body.csrf
    if(c.req.header('Origin')!==config.PUBLIC_BASE_URL||typeof value!=='string'||value.length>256||!getCookie(c,csrfCookie))throw new DomainError(403,'invalid_request')
    const left=Buffer.from(hashToken(value),'hex'),right=Buffer.from(session.csrf_hash,'hex')
    if(!timingSafeEqual(left,right)||getCookie(c,csrfCookie)!==value)throw new DomainError(403,'invalid_request')
  }
  app.get('/',(c)=>c.html(<Home/>))
  app.get('/assets/style.css',(c)=>{c.header('Content-Type','text/css; charset=utf-8');return c.body(STYLE)})
  app.get('/health',async(c)=>{await store.now();return c.json({status:'ok'})})
  app.get('/.well-known/hitl.json',(c)=>{const result=agentAccessDiscovery(config.PUBLIC_BASE_URL,config.OIDC_ISSUER);if(!validateDiscoveryResponse(result))throw new Error('Discovery violates v0.9');return c.json(result)})
  app.get('/.well-known/oauth-protected-resource',(c)=>c.json(protectedResourceMetadata(config.PUBLIC_BASE_URL,config.OIDC_ISSUER)))
  app.get('/openapi.json',async(c)=>c.json(JSON.parse(await readFile(new URL('../../../../profiles/agent-access/v0.1/openapi.json',import.meta.url),'utf8')) as Record<string,unknown>))
  app.get('/docs/agent-access',async(c)=>{c.header('Content-Type','text/plain; charset=utf-8');return c.body(await readFile(new URL('../../../../profiles/agent-access/v0.1/README.md',import.meta.url),'utf8'))})
  app.get('/v1/catalog',async(c)=>{
    const ip=peer(c)
    await store.quota(`public:ip:${ip}`,600)
    await store.quota('public:global',6000)
    const result=await publicVerifier.verify(canonicalRequest(c.req.raw))
    if(result.status==='invalid')throw new DomainError(result.reason==='proof_replayed'?429:400,result.reason==='proof_replayed'?'rate_limited':'invalid_request',result.reason==='proof_replayed'?{'Retry-After':'1'}:{'Accept-Signature':'sig1=("@authority" "@method" "@target-uri" "signature-agent";key="sig1");tag="web-bot-auth"'})
    if(result.status==='unverified')throw new DomainError(503,'temporarily_unavailable')
    if(result.status==='anonymous')await store.quota(`public:anonymous-ip:${ip}`,60)
    if(result.status==='verified')await store.quota(`public:identity:${result.identifier}`,300)
    return c.json({offers:await store.catalog(),agent:result})
  })
  app.post('/v1/agent-enrollments',async(c)=>{
    const input=EnrollmentInputSchema.parse(await c.req.json());const facts=await agent(c)
    return c.json(store.enrollmentView(await store.createEnrollment(facts,input),await store.now()),201)
  })
  app.get('/v1/agent-enrollments/:id',async(c)=>c.json(await store.readEnrollment(c.req.param('id'),await agent(c))))
  app.post('/v1/bookings/prepare',async(c)=>{
    const input=PrepareInputSchema.parse(await c.req.json());const facts=await agent(c)
    const prepared=await store.prepare(facts,input,c.req.header('Idempotency-Key')??'')
    if('hitl' in prepared)return c.json({status:'human_input_required',hitl:prepared.hitl},202)
    return c.json(prepared.operation)
  })
  async function conditional(c:C,value:unknown){
    const etag=`"${canonicalDigest(value)}"`;c.header('ETag',etag)
    if(c.req.header('If-None-Match')===etag)return c.body(null,304)
    return c.json(value)
  }
  app.get('/v1/reviews/:id',async(c)=>conditional(c,await store.readReview(c.req.param('id'),await agent(c))))
  app.get('/v1/operations/:id',async(c)=>conditional(c,await store.readOperation(c.req.param('id'),await agent(c))))
  app.post('/v1/operations/:id/commit',async(c)=>{
    const input=CommitInputSchema.parse(await c.req.json());return c.json(await store.commit(c.req.param('id'),await agent(c),input))
  })
  app.get('/auth/callback',async(c)=>{
    // A cross-site OIDC redirect carries the Lax session, but deliberately not the Strict CSRF cookie.
    const session=await store.session(getCookie(c,sessionCookie));const state=c.req.query('state')
    if(!session)throw new DomainError(400,'invalid_request')
    if(!state||state.length>256)throw new DomainError(400,'invalid_request')
    const attempt=await store.consumeOidcState(state,session);if(!attempt)throw new DomainError(400,'invalid_request')
    const verified=await completeBrowserLogin(oauthConfig,{callbackUrl:`${config.PUBLIC_BASE_URL}${new URL(c.req.url).pathname}${new URL(c.req.url).search}`,state,nonce:attempt.nonce,codeVerifier:attempt.verifier})
    const rotated=await store.authenticateSession(session,verified)
    setCookie(c,sessionCookie,rotated.token,{httpOnly:true,secure,sameSite:'Lax',path:'/',maxAge:900})
    setCookie(c,csrfCookie,rotated.csrf,{httpOnly:true,secure,sameSite:'Strict',path:'/',maxAge:900})
    return c.redirect(attempt.return_path,303)
  })
  app.get('/connect/:id',async(c)=>{
    const session=await browserSession(c);const who=await identity(c,session,c.req.path);if(who instanceof Response)return who
    const enrollment=await store.browserEnrollment(c.req.param('id'),who)
    c.header('Referrer-Policy','same-origin')
    return c.html(<EnrollmentView enrollment={enrollment} csrf={c.get('csrf')} expired={Date.now()>=Date.parse(enrollment.expires_at)}/>)
  })
  app.post('/connect/:id',async(c)=>{
    const session=await browserSession(c,false);if(!session.identity)throw new DomainError(401,'reauthentication_required')
    const body=await c.req.parseBody();await csrf(c,session,body)
    await store.confirmEnrollment(c.req.param('id'),session.identity);return c.redirect(c.req.path,303)
  })
  app.get('/review/:id',async(c)=>{
    const id=c.req.param('id'),token=c.req.query('token')
    if(token!==undefined)await store.validateCapability(id,token)
    if(token===undefined){
      const existing=await store.session(getCookie(c,sessionCookie))
      if(!existing?.review_ids.includes(id))throw new DomainError(404,'not_found')
    }
    const session=await browserSession(c,token!==undefined)
    if(token!==undefined){await store.addCapability(session,id);return c.redirect(`/review/${encodeURIComponent(id)}`,303)}
    const who=await identity(c,session,c.req.path);if(who instanceof Response)return who
    const {review,operation,principal}=await store.browserReview(id,who,session.review_ids)
    c.header('Referrer-Policy','same-origin')
    return c.html(<ReviewView operation={operation} review={review} agentName={principal.display_name} csrf={c.get('csrf')}/>)
  })
  app.post('/review/:id/respond',async(c)=>{
    const session=await browserSession(c,false);if(!session.identity)throw new DomainError(401,'reauthentication_required')
    const body=await c.req.parseBody();await csrf(c,session,body);const action=ReviewActionSchema.parse(body.action)
    await store.decide(c.req.param('id'),session.identity,session.review_ids,action)
    return c.redirect(`/review/${encodeURIComponent(c.req.param('id'))}`,303)
  })
  app.get('/account/agents',async(c)=>{
    const session=await browserSession(c);const who=await identity(c,session,c.req.path);if(who instanceof Response)return who
    c.header('Referrer-Policy','same-origin')
    return c.html(<AgentsView agents={await store.listAgents(who)} csrf={c.get('csrf')} identity={who}/>)
  })
  app.post('/account/agents/:id/revoke',async(c)=>{
    const session=await browserSession(c,false);if(!session.identity)throw new DomainError(401,'reauthentication_required')
    const body=await c.req.parseBody();await csrf(c,session,body);await store.revoke(c.req.param('id'),session.identity)
    return c.redirect('/account/agents',303)
  })
  return app
}
