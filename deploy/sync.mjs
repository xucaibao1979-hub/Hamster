export function startSync(db){
 let running=false;
 async function tick(){
  if(running||!process.env.IT_SYNC_URL||!process.env.IT_SYNC_TOKEN)return;
  running=true;
  try{
   const url=new URL(process.env.IT_SYNC_URL);if(!['https:','http:'].includes(url.protocol))throw new Error('同步地址必须为 HTTP 或 HTTPS');
   const rows=db.prepare("SELECT * FROM sync_outbox WHERE status IN ('pending','failed') AND nextAttempt<=? ORDER BY rowid LIMIT 20").all(new Date().toISOString());
   for(const row of rows){if(!db.prepare("SELECT 1 FROM sync_outbox WHERE id=? AND status IN ('pending','failed')").get(row.id))continue;try{const r=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.IT_SYNC_TOKEN,'Idempotency-Key':row.id},body:row.data});if(!r.ok)throw new Error('HTTP '+r.status);db.prepare("UPDATE sync_outbox SET status='sent',attempts=attempts+1,lastError='' WHERE id=? AND status IN ('pending','failed')").run(row.id)}catch(e){const delay=Math.min(86400000,30000*2**Math.min(row.attempts,12));db.prepare("UPDATE sync_outbox SET status='failed',attempts=attempts+1,nextAttempt=?,lastError=? WHERE id=? AND status IN ('pending','failed')").run(new Date(Date.now()+delay).toISOString(),String(e.message).slice(0,200),row.id)}}
  }catch(e){console.error('同步任务配置错误：'+e.message)}finally{running=false}
 }
 setInterval(tick,30000).unref();return {tick};
}
