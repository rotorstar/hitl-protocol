import { describe,it,expect } from 'vitest'
import { readConfig } from './config.js'
describe('deployment trust boundary',()=>{
 const credentials={OIDC_BROWSER_CLIENT_SECRET:'test',OIDC_INTROSPECTION_CLIENT_SECRET:'test'}
 it('requires explicit development exception and configured credentials',()=>{
  expect(()=>readConfig(credentials)).toThrow('require HTTPS')
  expect(()=>readConfig({ALLOW_INSECURE_LOCALHOST:'true'})).toThrow()
  expect(readConfig({...credentials,ALLOW_INSECURE_LOCALHOST:'true'}).PUBLIC_BASE_URL).toBe('http://127.0.0.1:8789')
 })
 it('never extends the loopback exception to a public origin or path',()=>{
  expect(()=>readConfig({...credentials,ALLOW_INSECURE_LOCALHOST:'true',PUBLIC_BASE_URL:'http://example.com'})).toThrow('require HTTPS')
  expect(()=>readConfig({...credentials,ALLOW_INSECURE_LOCALHOST:'true',PUBLIC_BASE_URL:'http://127.0.0.1/path'})).toThrow('must be an origin')
 })
 it.each(['ftp://localhost','file://localhost/','http://user:password@localhost','https://user:password@example.com'])('rejects unsafe public origins even in local mode: %s',(PUBLIC_BASE_URL)=>{
  expect(()=>readConfig({...credentials,ALLOW_INSECURE_LOCALHOST:'true',PUBLIC_BASE_URL})).toThrow()
 })
 it.each(['ftp://localhost/realm','https://id.example/realm?issuer=other','https://id.example/realm/'])('rejects ambiguous issuer configuration: %s',(OIDC_ISSUER)=>{
  expect(()=>readConfig({...credentials,ALLOW_INSECURE_LOCALHOST:'true',OIDC_ISSUER})).toThrow()
 })
})
