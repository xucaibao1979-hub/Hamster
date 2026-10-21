import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';

async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port}

test('企业微信免登票据只使用一次，并以已登记 UserID 建立受限会话',async()=>{
 const data=mkdtempSync(join(tmpdir(),'asset-hub-sso-')),port=await freePort(),base=`http://127.0.0.1:${port}`,service='test-service-token-0123456789-abcdef';
 const child=spawn(process.execPath,['deploy/server.mjs'],{cwd:resolve('.'),env:{...process.env,DATA_DIR:data,HOST:'127.0.0.1',PORT:String(port),ADMIN_PASSWORD:'test-admin-password-123',IT_SERVICE_TOKEN:service,APP_ORIGIN:'https://zchub.saybot.net'},stdio:'ignore'});
 try{
  let ready=false;for(let i=0;i<80;i++){if(child.exitCode!==null)break;try{const r=await fetch(base+'/api/session');if(r.status===401){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'服务应启动');
  const headers={Authorization:`Bearer ${service}`,'X-WeCom-UserId':'A0264','X-WeCom-Name':encodeURIComponent('徐才宝'),'Content-Type':'application/json'};
  let r=await fetch(base+'/api/sso/ticket',{method:'POST',headers:{...headers,Authorization:'Bearer bad'},body:'{}'});assert.equal(r.status,401);
  r=await fetch(base+'/api/sso/ticket',{method:'POST',headers,body:'{}'});assert.equal(r.status,403,'未同步员工不能免登');
  r=await fetch(base+'/api/integration/directory',{method:'POST',headers,body:JSON.stringify({people:[{wecomUserId:'A0264',name:'徐才宝',department:'326',active:true}]})});assert.equal(r.status,200);
  r=await fetch(base+'/api/sso/ticket',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);const issued=await r.json();assert.equal(issued.expiresIn,60);assert.equal(new URL(issued.loginUrl).origin,'https://zchub.saybot.net');assert.ok(!issued.loginUrl.includes(service));
  const ticket=new URL(issued.loginUrl).searchParams.get('ticket');r=await fetch(base+'/sso/consume?ticket='+encodeURIComponent(ticket),{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');const cookie=r.headers.get('set-cookie');assert.match(cookie,/Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);
  r=await fetch(base+'/api/session',{headers:{cookie:cookie.split(';')[0]}});assert.equal(r.status,200);const user=await r.json();assert.equal(user.role,'viewer');assert.equal(user.employeeId?.length>0,true);assert.equal(user.sso,true);
  r=await fetch(base+'/api/assets',{method:'POST',headers:{cookie:cookie.split(';')[0],Origin:'https://zchub.saybot.net','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
  r=await fetch(base+'/sso/consume?ticket='+encodeURIComponent(ticket),{redirect:'manual'});assert.equal(r.status,400,'票据不能重放');
  r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://zchub.saybot.net','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'test-admin-password-123'})});assert.equal(r.status,200);const adminCookie=r.headers.get('set-cookie').split(';')[0];
  r=await fetch(base+'/api/integration-admins',{method:'POST',headers:{cookie:adminCookie,Origin:'https://zchub.saybot.net','Content-Type':'application/json'},body:JSON.stringify({wecomUserId:'A0264',name:'徐才宝'})});assert.equal(r.status,200);
  r=await fetch(base+'/api/session',{headers:{cookie:cookie.split(';')[0]}});assert.equal((await r.json()).role,'admin','授权后已有免登会话获得管理员权限');
  r=await fetch(base+'/api/users',{headers:{cookie:cookie.split(';')[0]}});assert.equal(r.status,200,'免登管理员可使用资盒管理接口');
  r=await fetch(base+'/api/integration-admins',{method:'POST',headers:{cookie:adminCookie,Origin:'https://zchub.saybot.net','Content-Type':'application/json'},body:JSON.stringify({wecomUserId:'A0264',remove:true})});assert.equal(r.status,200);
  r=await fetch(base+'/api/session',{headers:{cookie:cookie.split(';')[0]}});assert.equal((await r.json()).role,'viewer','撤销后已有免登会话立即失去管理员权限');
  r=await fetch(base+'/api/users',{headers:{cookie:cookie.split(';')[0]}});assert.equal(r.status,403,'撤销后管理接口立即拒绝访问');
  r=await fetch(base+'/api/integration/directory',{method:'POST',headers,body:JSON.stringify({people:[{wecomUserId:'A0264',name:'徐才宝',department:'326',active:false}]})});assert.equal(r.status,200);
  r=await fetch(base+'/api/session',{headers:{cookie:cookie.split(';')[0]}});assert.equal(r.status,401,'员工停用后已有免登会话应失效');
  r=await fetch(base+'/api/sso/ticket',{method:'POST',headers,body:'{}'});assert.equal(r.status,403,'停用员工不能再换票');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));rmSync(data,{recursive:true,force:true})}
});
