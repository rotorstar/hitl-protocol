import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import { SafeDirectoryResolver,directoryUrl,type DirectoryResolver,type ResolvedDirectory } from '@hitl-protocol/agent-access'
import { Store } from './store.js'

/** Cross-worker cache and expiring leases. No DB transaction/lock is held during HTTPS fetches. */
export class PersistentDirectories implements DirectoryResolver {
  /** Injected resolvers must express expiresAt in the same persistence clock domain. */
  constructor(private readonly store:Store,private readonly upstream:DirectoryResolver=new SafeDirectoryResolver({now:()=>store.now()})){}
  private async cached(identifier:string,refresh=false):Promise<ResolvedDirectory|undefined>{
    const result=await this.store.pool.query<Record<string,unknown>>('SELECT * FROM directory_cache WHERE identifier=$1',[identifier])
    const row=result.rows[0]
    if(!row)return undefined
    const expires=new Date(z.union([z.date(),z.string()]).parse(row.expires_at))
    const refreshed=new Date(z.union([z.date(),z.string()]).parse(row.refreshed_at))
    const now=await this.store.now()
    if(expires<=now||refresh&&now.getTime()-refreshed.getTime()>=30_000)return undefined
    if(row.failed)throw new Error('Directory temporarily unavailable')
    const keys=z.array(z.object({kty:z.literal('OKP'),crv:z.literal('Ed25519'),x:z.string(),kid:z.string(),nbf:z.int().optional(),exp:z.int().optional()}).passthrough()).max(32).parse(row.payload)
    return{identifier,keys,expiresAt:expires}
  }
  async resolve(origin:string,options?:{refresh?:boolean}):Promise<ResolvedDirectory>{
    const identifier=directoryUrl(origin).href
    const deadline=performance.now()+2500
    while(performance.now()<deadline){
      const cached=await this.cached(identifier,options?.refresh)
      if(cached)return cached
      const owner=randomUUID()
      const lease=await this.store.pool.query(`INSERT INTO directory_leases(identifier,owner,expires_at) VALUES($1,$2,clock_timestamp()+interval '30 seconds')
        ON CONFLICT(identifier) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE directory_leases.expires_at<=clock_timestamp() RETURNING owner`,[identifier,owner])
      if(lease.rowCount===1){
        try{
          // The previous owner may have published between our read and lease acquisition.
          const published=await this.cached(identifier,options?.refresh)
          if(published)return published
          await this.store.quota('directory-fetch:global',100)
          // A slow database operation may outlive a lease. Recheck before HTTPS, then fence publication.
          const renewed=await this.store.pool.query(`UPDATE directory_leases SET expires_at=clock_timestamp()+interval '30 seconds'
            WHERE identifier=$1 AND owner=$2 AND expires_at>clock_timestamp() RETURNING owner`,[identifier,owner])
          if(renewed.rowCount!==1)throw new Error('Directory lease expired')
          const result=await this.upstream.resolve(origin,{refresh:true})
          const saved=await this.store.pool.query(`WITH owned_lease AS (
            SELECT identifier FROM directory_leases WHERE identifier=$1 AND owner=$4 AND expires_at>clock_timestamp() FOR UPDATE
          ) INSERT INTO directory_cache(identifier,payload,failed,expires_at)
            SELECT identifier,$2,false,$3 FROM owned_lease
            ON CONFLICT(identifier) DO UPDATE SET payload=excluded.payload,failed=false,expires_at=excluded.expires_at,refreshed_at=clock_timestamp()
            RETURNING identifier`,[identifier,JSON.stringify(result.keys),result.expiresAt,owner])
          if(saved.rowCount!==1){
            const replacement=await this.cached(identifier)
            if(replacement)return replacement
            throw new Error('Directory lease expired')
          }
          return result
        }catch(error){
          await this.store.pool.query(`WITH owned_lease AS (
            SELECT identifier FROM directory_leases WHERE identifier=$1 AND owner=$2 AND expires_at>clock_timestamp() FOR UPDATE
          ) INSERT INTO directory_cache(identifier,failed,expires_at)
            SELECT identifier,true,clock_timestamp()+interval '30 seconds' FROM owned_lease
            ON CONFLICT(identifier) DO UPDATE SET payload=NULL,failed=true,expires_at=excluded.expires_at,refreshed_at=clock_timestamp()`,[identifier,owner])
          throw error
        }finally{await this.store.pool.query('DELETE FROM directory_leases WHERE identifier=$1 AND owner=$2',[identifier,owner])}
      }
      await setTimeout(10)
    }
    throw new Error('Directory discovery timed out')
  }
}
