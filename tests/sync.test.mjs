import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {startSync} from '../deploy/sync.mjs';
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE sync_outbox(id TEXT PRIMARY KEY,data TEXT,status TEXT,attempts INTEGER,nextAttempt TEXT,lastError TEXT)");
db.prepare('INSERT INTO sync_outbox VALUES (?,?,?,?,?,?)').run('unique-event',JSON.stringify({id:'unique-event',assetId:'asset-1'}),'pending',0,new Date().toISOString(),'');let calls=0;
const receiver=createServer(async(req,res)=>{calls++;assert.equal(req.headers['idempotency-key'],'unique-event');assert.equal(req.headers.authorization,'Bearer test-local-token');let body='';for await(const c of req)body+=c;assert.equal(JSON.parse(body).id,'unique-event');res.writeHead(calls===1?503:200);res.end('{}')});await new Promise(ok=>receiver.listen(0,'127.0.0.1',ok));
process.env.IT_SYNC_URL=`http://127.0.0.1:${receiver.address().port}`;process.env.IT_SYNC_TOKEN='test-local-token';
try{const sync=startSync(db);await sync.tick();let item=db.prepare('SELECT * FROM sync_outbox').get();assert.equal(item.status,'failed');assert.equal(item.attempts,1);assert.ok(Date.parse(item.nextAttempt)>Date.now());assert.equal(item.lastError,'HTTP 503');db.prepare('UPDATE sync_outbox SET nextAttempt=?').run(new Date(0).toISOString());await sync.tick();item=db.prepare('SELECT * FROM sync_outbox').get();assert.equal(item.status,'sent');assert.equal(item.attempts,2);await sync.tick();assert.equal(calls,2);console.log('Sync checks passed: authenticated local delivery, stable event deduplication key, failure backoff, successful retry and no redelivery of sent events.')}finally{await new Promise(ok=>receiver.close(ok));db.close()}
