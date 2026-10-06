import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Store } from './store.js'
import { readConfig } from './config.js'
export async function initializeDatabase(store:Store){
  await store.transaction(async(client)=>{
    await client.query('SELECT pg_advisory_xact_lock(9432109)')
    const existing=await client.query<{present:boolean}>("SELECT to_regclass('schema_versions') IS NOT NULL AS present")
    if(!existing.rows[0]?.present){
      for(const name of ['001-initial.sql','002-demo-offers.sql']){
        await client.query(await readFile(new URL(`../sql/${name}`,import.meta.url),'utf8'))
      }
    }else{
      const versions=await client.query<{version:number}>('SELECT version FROM schema_versions')
      if(versions.rows.length!==1||versions.rows[0]?.version!==1)throw new Error('Unsupported Agent Access database schema')
    }
  })
  // Startup never downgrades a policy promoted by another worker. Promotion waits for in-flight writes.
  await store.promotePolicy()
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const store=new Store(readConfig());try{await initializeDatabase(store);console.log('Agent Access database initialized')}finally{await store.close()}}
