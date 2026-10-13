import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
mkdirSync('outputs',{recursive:true});const dir=mkdtempSync(resolve('outputs/access-test-'));const password=randomBytes(24).toString('hex'),port=3600+Math.floor(Math.random()*300),base=`http://127.0.0.1:${port}`;let child;
async function start(){child=spawn(process.execPath,['deploy/server.mjs'],{env:{...process.env,ADMIN_PASSWORD:password,ADMIN_USERNAME:'admin',DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});await new Promise((done,fail)=>{child.stdout.on('data',d=>{if(String(d).includes('listening'))done()});child.once('error',fail);child.once('exit',c=>fail(new Error('Server exited '+c)))})}
async function stop(){await new Promise(done=>{child.once('exit',done);child.kill()})}
async function login(username){const r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
async function call(cookie,path,body){return fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})}
await start();try{
 let admin=await login('admin');
 async function command(data){const {revision}=await (await call(admin,'/api/assets')).json();const r=await call(admin,'/api/assets',{...data,revision});assert.equal(r.status,200,r.ok?undefined:await r.clone().text());return r.json()}
 async function add(username){const r=await call(admin,'/api/users',{action:'add',username,name:'同名员工',email:username+'@example.com',role:'viewer',password});assert.equal(r.status,200);return (await r.json()).users.find(u=>u.username===username)}
 const a=await add('employee-a'),b=await add('employee-b');let cookieA=await login(a.username),cookieB=await login(b.username);
 const asset={name:'本人电脑',number:'OWN-A',category:'固定资产',type:'电脑',status:'使用中',holderUsername:a.username,price:100};
 const first=await command({action:'save',asset});const id=first.state.assets.find(a=>a.number==='OWN-A').id;
 await command({action:'save',asset:{...asset,name:'他人服务器',number:'SECRET-B',holderUsername:b.username,price:5000}});
 await command({action:'save',asset:{...asset,name:'历史未关联资产',number:'UNBOUND',holderUsername:'',holder:'未同步员工'}});
 const mine=await (await call(cookieA,'/api/assets')).json();assert.equal(mine.state.assets.length,1);assert.equal(mine.state.assets[0].holderUserId,a.id);assert.equal(mine.state.assets[0].holderUsername,a.username);assert.equal(mine.state.logs.length,0);assert.equal(mine.state.events.length,0);assert.ok(!JSON.stringify(mine).includes('SECRET-B')&&!JSON.stringify(mine).includes('UNBOUND'));
 const directory=await (await call(cookieA,'/api/user-directory')).json();assert.deepEqual(directory.users.map(u=>u.id),[a.id]);
 assert.equal((await call(cookieA,'/api/assets?username=employee-b')).status,403);assert.equal((await call(cookieA,'/api/me/assets?username=employee-b')).status,403);
 const otherId=(await (await call(admin,'/api/assets')).json()).state.assets.find(a=>a.number==='SECRET-B').id;assert.equal((await call(cookieA,'/api/assets/'+otherId)).status,404);assert.equal((await call(cookieA,'/api/assets/'+id)).status,200);
 const byUsername=await (await call(admin,'/api/assets?username=employee-a')).json();assert.equal(byUsername.state.assets.length,1);
 const prefs={columns:['serial','name'],details:['name','serial']};assert.equal((await call(cookieA,'/api/display-settings',{...prefs,userId:admin.id})).status,200);assert.deepEqual(await (await call(cookieA,'/api/display-settings')).json(),prefs);assert.ok((await (await call(admin,'/api/display-settings')).json()).columns.includes('price'));
 assert.equal((await call(cookieA,'/api/display-settings',{columns:['invalid'],details:['name']})).status,400);
 const request=await command({action:'request',assetId:id,kind:'转让',toUsername:b.username});const pending=request.state.requests.find(r=>r.assetId===id&&r.status==='待接收确认');assert.equal((await call(cookieA,'/api/assets',{action:'confirmTransfer',id:pending.id,revision:request.revision})).status,400);const confirmed=await call(cookieB,'/api/assets',{action:'confirmTransfer',id:pending.id,revision:request.revision});assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).state.assets.length,1);await command({action:'approve',id:pending.id});assert.equal((await (await call(cookieA,'/api/me/assets')).json()).assets.length,0);assert.equal((await (await call(cookieB,'/api/me/assets')).json()).assets.length,2);
 const reverse=await command({action:'request',assetId:id,kind:'转让',toUsername:a.username});const reverseId=reverse.state.requests.find(r=>r.assetId===id&&r.status==='待接收确认').id;assert.equal((await call(cookieA,'/api/assets',{action:'confirmTransfer',id:reverseId,revision:reverse.revision})).status,200);await command({action:'approve',id:reverseId});
 assert.equal((await call(admin,'/api/users',{...a,action:'update',username:'employee-renamed',name:'改名员工'})).status,200);cookieA=await login('employee-renamed');const renamed=await (await call(cookieA,'/api/me/assets')).json();assert.equal(renamed.assets.length,1);assert.equal(renamed.assets[0].holder,'改名员工');assert.equal(renamed.assets[0].holderUsername,'employee-renamed');
 await stop();await start();cookieA=await login('employee-renamed');assert.deepEqual(await (await call(cookieA,'/api/display-settings')).json(),prefs);assert.equal((await (await call(cookieA,'/api/me/assets')).json()).assets.length,1);
 console.log('Access checks passed: ID-based ownership, duplicate names, no cross-user data/log/event leaks, spoofed username rejection, detail authorization, transfers, username changes, per-user display settings and restart persistence.');
}finally{await stop()}


