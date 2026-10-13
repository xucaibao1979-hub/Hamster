import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
mkdirSync('outputs',{recursive:true});const dir=mkdtempSync(resolve('outputs/api-test-'));
let password=randomBytes(24).toString('hex');const port=3100+Math.floor(Math.random()*400);const base=`http://127.0.0.1:${port}`;
let child;
async function start(){child=spawn(process.execPath,['deploy/server.mjs'],{env:{...process.env,ADMIN_PASSWORD:password,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});await new Promise((done,fail)=>{child.stdout.on('data',d=>{if(String(d).includes('listening'))done()});child.once('error',fail);child.once('exit',c=>fail(new Error('Server exited '+c)))})}
async function stop(){await new Promise(done=>{child.once('exit',done);child.kill()})}
await start();try{
 const anonymous=await fetch(base+'/api/assets');assert.equal(anonymous.status,401);
 assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})})).status,403);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(login.status,200);let cookie=login.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
 const read=await (await fetch(base+'/api/assets',{headers})).json();assert.equal(read.state.assets.length,0);
 const asset={name:'接口验证设备',number:'TEST-001',category:'固定资产',type:'电脑',status:'未使用',price:100};
 async function post(data){return fetch(base+'/api/assets',{method:'POST',headers,body:JSON.stringify(data)})}
 assert.equal((await post({action:'import',revision:0,assets:[asset,asset]})).status,400);
 assert.equal((await (await fetch(base+'/api/assets',{headers})).json()).state.assets.length,0);
 const saved=await post({action:'save',revision:0,asset});assert.equal(saved.status,200);const savedData=await saved.json();assert.equal(savedData.revision,1);
 assert.equal((await post({action:'save',revision:0,asset:{...asset,number:'TEST-002'}})).status,409);
 const list=await (await fetch(base+'/api/users',{headers})).json();assert.equal(list.users.length,1);assert.ok(!('hash'in list.users[0])&&!('salt'in list.users[0]));const admin=list.users[0];
 async function userPost(input,path='/api/users'){return fetch(base+path,{method:'POST',headers,body:JSON.stringify(input)})}
 const viewerPassword=randomBytes(20).toString('hex');const added=await userPost({action:'add',username:'viewer',name:'张三',email:'viewer@example.com',role:'viewer',password:viewerPassword});assert.equal(added.status,200,added.ok?undefined:await added.clone().text());const viewer=(await added.json()).users.find(u=>u.username==='viewer');
 const viewerLogin=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'viewer',password:viewerPassword})});assert.equal(viewerLogin.status,200);const viewerCookie=viewerLogin.headers.get('set-cookie').split(';')[0];const viewerHeaders={...headers,Cookie:viewerCookie};
 assert.equal((await fetch(base+'/api/assets',{headers:viewerHeaders})).status,200);assert.equal((await fetch(base+'/api/users',{headers:viewerHeaders})).status,403);assert.equal((await fetch(base+'/api/assets',{method:'POST',headers:viewerHeaders,body:JSON.stringify({action:'save',asset,revision:2})})).status,403);
 assert.equal((await userPost({...admin,action:'update',role:'viewer'})).status,400);
 assert.equal((await userPost({...admin,action:'update',username:'renamed-admin'})).status,200);
 const renamedLogin=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'renamed-admin',password})});assert.equal(renamedLogin.status,200);
 assert.equal((await userPost({...admin,action:'update',username:'admin'})).status,200);
 assert.equal((await userPost({currentPassword:'wrong',password:randomBytes(20).toString('hex')},'/api/account/password')).status,400);
 const oldPassword=password;password=randomBytes(24).toString('hex');assert.equal((await userPost({currentPassword:oldPassword,password},'/api/account/password')).status,200);
 assert.equal((await userPost({action:'resetPassword',id:viewer.id,password:randomBytes(20).toString('hex')})).status,200);assert.equal((await fetch(base+'/api/assets',{headers:viewerHeaders})).status,401);
 const beforeRestore=await (await fetch(base+'/api/assets',{headers})).json();assert.equal((await post({action:'restore',revision:beforeRestore.revision,confirm:'恢复',backup:{...savedData.state,assets:[asset,asset]}})).status,400);
 assert.equal((await post({action:'restore',revision:beforeRestore.revision,confirm:'恢复',backup:savedData.state})).status,200);
 assert.equal((await (await fetch(base+'/api/users',{headers})).json()).users.length,2);
 const snapshots=readdirSync(dir+'/restore-backups');assert.equal(snapshots.length,1);assert.equal(JSON.parse(readFileSync(dir+'/restore-backups/'+snapshots[0])).state.assets.length,1);
 const expectedRevision=(await (await fetch(base+'/api/assets',{headers})).json()).revision;
 await stop();await start();
 const relogin=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password})});cookie=relogin.headers.get('set-cookie').split(';')[0];
 const persisted=await (await fetch(base+'/api/assets',{headers:{Cookie:cookie}})).json();assert.equal(persisted.state.assets.length,1);assert.equal(persisted.revision,expectedRevision);
 assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:oldPassword})})).status,401);
 const logout=await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:base}});assert.equal(logout.status,200);assert.equal((await fetch(base+'/api/assets',{headers:{Cookie:cookie}})).status,401);
 console.log('API checks passed: authentication, CSRF, import, revisions, users, RBAC, password persistence and revocation, last-admin guard, restore and automatic snapshots, restart persistence, logout.');
}finally{await stop()}

