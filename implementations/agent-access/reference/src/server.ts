import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { readConfig } from './config.js'
import { Store } from './store.js'
import { initializeDatabase } from './db-init.js'
const config=readConfig()
const store=new Store(config)
await initializeDatabase(store)
const app=createApp(config,store)
const server=serve({fetch:app.fetch,port:config.PORT,hostname:config.HOST})
console.log(`HITL Agent Access reference listening on ${config.HOST}:${config.PORT}`)
const cleanup=setInterval(()=>{store.cleanup().catch(()=>console.error('Security-state cleanup temporarily unavailable'))},60_000)
cleanup.unref()
async function stop(){clearInterval(cleanup);server.close();await store.close()}
process.once('SIGINT',()=>{void stop()});process.once('SIGTERM',()=>{void stop()})
