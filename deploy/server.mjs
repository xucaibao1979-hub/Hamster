import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {initUsers,verifyPassword,publicUser,userList,userCommand} from './users.mjs';
import {initPreferences,readDisplay,saveDisplay,directory,hydrate,scopedState,ownAssets,resolveCommand} from './access.mjs';
import {initial,command,statusValue,claimBlockReason,effectiveHolder} from '../lib/assets.ts';
import {initOperations,employeeList,employeeCommand,syncIdentity,historyList,recordHistory,importPreview,fullBackup,validateFullBackup,restoreExtensions,backupManager,businessCommand} from './operations.mjs';
import {attachmentList,addAttachment} from './attachments.mjs';
import {undoCandidate,undoApprovedFlow} from './flow-undo.mjs';
import {agingStats} from '../lib/aging.ts';
const password=process.env.ADMIN_PASSWORD||'';
const email=process.env.ADMIN_EMAIL||'admin@company.local';
const dir=resolve(process.env.DATA_DIR||'data');mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(join(dir,'assets.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS asset_state (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);');
db.prepare('INSERT OR IGNORE INTO asset_state (id,revision,data) VALUES (?,0,?)').run('company',JSON.stringify(initial()));
initUsers(db,password,email,process.env.ADMIN_USERNAME||'admin');
initPreferences(db);initOperations(db);db.prepare("UPDATE sync_outbox SET status='cancelled' WHERE status IN ('pending','failed') AND json_extract(data,'$.type')<>'it.task'").run();const backups=backupManager(db,dir);backups.daily();setInterval(()=>{try{backups.daily()}catch(e){console.error('每日备份失败：'+e.message)}},3600_000).unref();
function retainLogs(state){const cutoff=new Date();cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);state.logs=state.logs.filter(l=>new Date(l.time)>=cutoff);return state}
function expireLogs(){const row=db.prepare('SELECT data,revision FROM asset_state WHERE id=?').get('company');const state=JSON.parse(row.data);const count=state.logs.length;retainLogs(state);if(count!==state.logs.length)db.prepare('UPDATE asset_state SET data=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(state),'company',row.revision)}
expireLogs();setInterval(expireLogs,3600_000).unref();
const sessions=new Map(),attempts=new Map();const sessionTTL=8*3600_000;
const files={ '/': ['index.html','text/html;charset=utf-8'], '/app.js':['app.js','text/javascript;charset=utf-8'], '/app.css':['app.css','text/css;charset=utf-8'], '/brand.png':['brand.png','image/png'], '/concierge.png':['concierge.png','image/png'] };
const staticDir=resolve('internal-dist');
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
async function body(req,maxBytes=32_000_000){let text='';for await(const c of req){text+=c;if(Buffer.byteLength(text)>maxBytes)throw new Error('请求超过允许大小')}return JSON.parse(text)}
function auth(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('asset_session='))?.slice(14);const session=token&&sessions.get(token);if(!session||session.expires<Date.now()){if(token)sessions.delete(token);return null}const account=db.prepare('SELECT * FROM users WHERE id=? AND enabled=1').get(session.id);if(!account){sessions.delete(token);return null}const employee=db.prepare('SELECT id FROM employees WHERE loginUserId=? AND active=1').get(account.id);return {token,...publicUser(account),employeeId:employee?.id}}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
 const url=new URL(req.url,'http://localhost');const path=url.pathname;
 try{
  if(req.method==='POST'){
   const origin=req.headers.origin;const allowed=process.env.APP_ORIGIN;let originHost='';try{originHost=new URL(origin).host}catch{}
   if(!path.startsWith('/api/integration/')&&(!origin||(allowed?origin!==allowed:originHost!==req.headers.host)))return json(res,403,{error:'请求来源无效'});
  }
  if(path==='/api/login'&&req.method==='POST'){
   const ip=req.socket.remoteAddress||'unknown';const now=Date.now();let a=attempts.get(ip);if(!a||a.start+15*60_000<now)a={count:0,start:now};if(a.count>=10)return json(res,429,{error:'登录尝试过多，请 15 分钟后重试'});a.count++;attempts.set(ip,a);
   const input=await body(req);const account=db.prepare('SELECT * FROM users WHERE username=? AND enabled=1').get(String(input.username||process.env.ADMIN_USERNAME||'admin').trim().toLowerCase());if(!verifyPassword(account,input.password))return json(res,401,{error:'账号或密码错误'});attempts.delete(ip);
   const token=randomBytes(32).toString('hex');sessions.set(token,{id:account.id,expires:now+sessionTTL});res.setHeader('Set-Cookie',`asset_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);return json(res,200,{...publicUser(account),employeeId:db.prepare('SELECT id FROM employees WHERE loginUserId=? AND active=1').get(account.id)?.id});
  }
  let user=auth(req);
  if(path.startsWith('/api/integration/')){
   const expected=process.env.IT_SERVICE_TOKEN||'',provided=(req.headers.authorization||'').replace(/^Bearer /,'');
   if(expected.length<32||provided.length!==expected.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))return json(res,401,{error:'服务鉴权失败'});
   if(path==='/api/integration/directory'&&req.method==='POST'){const c=await body(req);if(!Array.isArray(c.people)||!c.people.length||c.people.length>2000)throw new Error('每次同步 1–2000 个通讯录身份');db.exec('BEGIN');try{for(const p of c.people)syncIdentity(db,p);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return json(res,200,{synced:c.people.length})}
   const identity=String(req.headers['x-wecom-userid']||'');let employee=db.prepare('SELECT * FROM employees WHERE wecomUserId=? AND active=1').get(identity);
   if(!identity)return json(res,403,{error:'缺少企业微信 UserID'});const encodedName=req.headers['x-wecom-name'];if(!employee&&encodedName)employee=syncIdentity(db,{wecomUserId:identity,name:decodeURIComponent(String(encodedName)),department:decodeURIComponent(String(req.headers['x-wecom-department']||''))});if(!employee)return json(res,403,{error:'首次访问需由可信后端提供姓名，或先同步通讯录'});
   user={id:'wecom:'+employee.id,employeeId:employee.id,name:employee.name,username:employee.wecomUserId,role:'viewer',integrationAdmin:!!db.prepare('SELECT 1 FROM integration_admins WHERE wecomUserId=?').get(identity)};
  }
  if(path==='/api/session'&&req.method==='GET')return json(res,user?200:401,user?{...user,token:undefined}:{error:'请登录'});
  if(path==='/api/logout'&&req.method==='POST'){if(user)sessions.delete(user.token);res.setHeader('Set-Cookie','asset_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true})}
  if(path.startsWith('/api/')){
   if(!user)return json(res,401,{error:'登录已过期，请刷新重新登录'});
   if(path==='/api/user-directory'&&req.method==='GET')return json(res,200,{users:directory(db).filter(u=>user.role==='admin'||u.id===user.employeeId)});
   if(path==='/api/attachments'&&req.method==='GET'){
    if(user.role!=='admin')return json(res,403,{error:'仅管理员可查看资产附件'});
    const assetId=url.searchParams.get('assetId')||'',state=JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data);
    if(!state.assets.some(a=>a.id===assetId))return json(res,404,{error:'资产不存在'});
    return json(res,200,{attachments:attachmentList(db,assetId)});
   }
   if(path.startsWith('/api/attachments/')&&req.method==='GET'){
    if(user.role!=='admin')return json(res,403,{error:'仅管理员可下载资产附件'});
    const attachment=db.prepare('SELECT * FROM asset_attachments WHERE id=?').get(decodeURIComponent(path.slice('/api/attachments/'.length)));
    if(!attachment)return json(res,404,{error:'附件不存在'});
    res.writeHead(200,{'Content-Type':attachment.mime,'Content-Length':attachment.size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(attachment.data);
   }
   if(path==='/api/attachments'&&req.method==='POST'){
    if(user.role!=='admin')return json(res,403,{error:'仅管理员可管理资产附件'});
    const input=await body(req),state=JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),asset=state.assets.find(a=>a.id===input.assetId);
    if(!asset)return json(res,404,{error:'资产不存在'});
    db.exec('BEGIN IMMEDIATE');try{
     let detail;if(input.action==='delete'){const old=db.prepare('SELECT name FROM asset_attachments WHERE id=? AND assetId=?').get(input.id,asset.id);if(!old)throw new Error('附件不存在');db.prepare('DELETE FROM asset_attachments WHERE id=?').run(input.id);detail='删除附件：'+old.name}
     else if(input.action==='add'){addAttachment(db,asset.id,input,user.username);detail='上传附件：'+input.name}else throw new Error('附件操作无效');
     const time=new Date().toISOString();db.prepare('INSERT INTO asset_history VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),asset.id,time,user.username,'attachment',JSON.stringify(asset),JSON.stringify(asset),detail);state.logs.unshift({id:randomUUID(),time,actor:user.username,action:'attachment',detail:asset.number+' · '+detail});db.prepare("UPDATE asset_state SET data=?,revision=revision+1 WHERE id='company'").run(JSON.stringify(state));db.exec('COMMIT');return json(res,200,{attachments:attachmentList(db,asset.id)})
    }catch(e){db.exec('ROLLBACK');throw e}
   }
   if(path==='/api/display-settings'){
    const state=JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data);
    if(req.method==='GET')return json(res,200,readDisplay(db,user.id,state));
    if(req.method==='POST')return json(res,200,saveDisplay(db,user.id,await body(req),state));
    return json(res,405,{error:'不支持的请求方法'});
   }
   if((path==='/api/me/assets'||path.startsWith('/api/assets/'))&&req.method==='GET'){
    const requested=new URL(req.url,'http://localhost').searchParams.get('username');if(user.role!=='admin'&&requested&&requested!==user.username)return json(res,403,{error:'只能查询本人名下资产'});
    const state=hydrate(JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),directory(db));
    if(path==='/api/me/assets')return json(res,200,{user:{username:user.username,name:user.name},assets:ownAssets(state,user)});
    const asset=state.assets.find(a=>a.id===decodeURIComponent(path.slice('/api/assets/'.length))&&(user.role==='admin'||ownAssets(state,user).some(x=>x.id===a.id)));return json(res,asset?200:404,asset?{asset}:{error:'资产不存在或无权查看'});
   }
   if(path==='/api/users'||path==='/api/account/password'){
    if(path==='/api/users'&&user.role!=='admin')return json(res,403,{error:'仅管理员可管理用户'});
    if(req.method==='GET'&&path==='/api/users')return json(res,200,{users:userList(db)});
    if(req.method!=='POST')return json(res,405,{error:'不支持的请求方法'});
    const input=await body(req);if(path==='/api/account/password')input.action='changePassword';
    db.exec('BEGIN IMMEDIATE');let result;
    try{result=userCommand(db,input,user);if(input.action==='add'){const account=db.prepare('SELECT id,name FROM users WHERE id=?').get(result.targetId);db.prepare('INSERT INTO employees(id,name,loginUserId,legacy) VALUES (?,?,?,1)').run(account.id,account.name,account.id)}if(input.action==='update')db.prepare('UPDATE employees SET name=? WHERE loginUserId=? AND legacy=1').run(input.name,result.targetId);const row=db.prepare('SELECT data FROM asset_state WHERE id=?').get('company');const state=JSON.parse(row.data);state.logs.unshift({id:randomUUID(),time:new Date().toISOString(),actor:user.username,action:'user',detail:result.detail});db.prepare('UPDATE asset_state SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(state),'company');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
    for(const [token,session]of sessions)if(session.id===result.targetId&&!(result.keepCurrent&&token===user.token))sessions.delete(token);
    return json(res,200,{users:user.role==='admin'?userList(db):[],loggedOut:!sessions.has(user.token)});
   }
   if(path==='/api/identity/link'&&req.method==='POST'){if(user.role!=='admin')return json(res,403,{error:'仅管理员可处理身份关联'});const c=await body(req);const known=db.prepare('SELECT * FROM employees WHERE wecomUserId=?').get(String(c.wecomUserId||''));if(known&&known.name!==String(c.name||'').trim())throw new Error('UserID 对应姓名不一致，请核对身份');const person=known||syncIdentity(db,c);return json(res,200,{id:person.id,users:directory(db)})}
   if(path==='/api/employees'){
    if(user.role!=='admin')return json(res,403,{error:'仅管理员可管理员工'});
    if(req.method==='GET')return json(res,200,{employees:employeeList(db)});
    if(req.method!=='POST')return json(res,405,{error:'不支持的请求方法'});
    const c=await body(req);db.exec('BEGIN IMMEDIATE');try{const id=employeeCommand(db,c);const row=db.prepare("SELECT data FROM asset_state WHERE id='company'").get();const before=JSON.parse(row.data),after=hydrate(before,directory(db));recordHistory(db,before,after,user.username,'employee','员工资料变更');after.logs.unshift({id:randomUUID(),time:new Date().toISOString(),actor:user.username,action:'employee',detail:'维护员工 '+c.name});db.prepare("UPDATE asset_state SET data=?,revision=revision+1 WHERE id='company'").run(JSON.stringify(after));db.exec('COMMIT');return json(res,200,{id,employees:employeeList(db)})}catch(e){db.exec('ROLLBACK');throw e}
   }
   if(path==='/api/backups'){
    if(user.role!=='admin')return json(res,403,{error:'仅管理员可管理备份'});
    const filename=new URL(req.url,'http://localhost').searchParams.get('file');
    if(req.method==='GET')return json(res,200,filename?backups.read(filename):{backups:backups.list()});
    const c=await body(req);if(c.action==='create')return json(res,200,backups.create());if(c.action==='verify'){return json(res,200,{...backups.verify(backups.read(c.filename)),filename:c.filename})}throw new Error('备份操作无效');
   }
   if(path==='/api/backup/export'&&req.method==='GET'){if(user.role!=='admin')return json(res,403,{error:'仅管理员可导出备份'});return json(res,200,fullBackup(db))}
   if(path==='/api/import/preview'){
    if(user.role!=='admin')return json(res,403,{error:'仅管理员可导入'});const c=await body(req),state=JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data);
    const rows=importPreview(db,state,c.assets,raw=>{if(raw.holder&&!raw.holderEmployeeId&&!raw.holderUserId&&!raw.holderUsername&&!raw.wecomUserId){const matches=directory(db).filter(e=>e.enabled&&e.name===raw.holder);if(matches.length>1)throw new Error(matches.length?'领用人同名，请填写企业微信 UserID':'领用人尚未同步，可先按姓名记录资产');if(matches.length===1)raw={...raw,holderEmployeeId:matches[0].id}}return resolveCommand(db,state,{action:'save',asset:raw}).asset});const additions=Object.fromEntries(['category','ownership','type','status'].map(k=>[k,[...new Set(rows.filter(r=>r.asset).map(r=>r.asset[k]).filter(v=>v&&!state.dictionaries[k].includes(v)))]]));return json(res,200,{rows,additions,valid:rows.every(r=>!r.errors.length)});
   }
   if(path.startsWith('/api/history/')&&req.method==='GET'){
    const id=decodeURIComponent(path.slice('/api/history/'.length)),raw=JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),state=hydrate(raw,directory(db));if(user.role!=='admin'&&!ownAssets(state,user).some(a=>a.id===id))return json(res,404,{error:'资产不存在或无权查看'});return json(res,200,{history:historyList(db,id),undoable:user.role==='admin'?undoCandidate(db,raw,id)?.historyId||'':''});
   }
   if(path==='/api/flow-undo'&&req.method==='POST'){
    if(user.role!=='admin')return json(res,403,{error:'仅管理员可撤销流转'});
    const input=await body(req),row=db.prepare("SELECT revision,data FROM asset_state WHERE id='company'").get();if(input.revision!==row.revision)return json(res,409,{error:'数据已更新，请刷新后重试'});
    if(input.confirm!=='撤销')throw new Error('请输入撤销确认');db.exec('BEGIN IMMEDIATE');try{const state=undoApprovedFlow(db,JSON.parse(row.data),String(input.assetId||''),String(input.historyId||''),user.username);const result=db.prepare("UPDATE asset_state SET data=?,revision=revision+1 WHERE id='company' AND revision=?").run(JSON.stringify(state),row.revision);if(!result.changes)throw new Error('数据已更新，请刷新后重试');db.exec('COMMIT');return json(res,200,{ok:true,revision:row.revision+1})}catch(e){db.exec('ROLLBACK');throw e}
   }
   if(path==='/api/notifications'){
    const state=scopedState(hydrate(JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),directory(db)),user),read=new Set(db.prepare('SELECT id FROM notification_reads WHERE userId=?').all(user.id).map(r=>r.id));
    const aging=agingStats(state);const items=[...state.requests.filter(r=>['待审批','待接收确认'].includes(r.status)).map(r=>({id:r.id,time:r.created,title:r.kind+'申请 · '+r.status,kind:'flow'})),...state.assets.filter(a=>a.status===statusValue(state,'damaged')).map(a=>({id:'damaged:'+a.id,time:'',title:a.name+' · 损坏',kind:'asset',assetId:a.id})),...state.assets.filter(a=>a.expires&&a.expires<=new Date(Date.now()+30*86400000).toISOString().slice(0,10)).map(a=>({id:'expiry:'+a.id+':'+a.expires,time:a.expires,title:a.name+' · 授权到期 '+a.expires,kind:'asset',assetId:a.id})),...aging.idle.slice(0,10).map(({asset,days,since})=>({id:'idle-aging:'+asset.id+':'+since,time:since,title:asset.name+' · 闲置 '+days+' 天',kind:'asset',assetId:asset.id})),...aging.assigned.slice(0,10).map(({asset,days,since})=>({id:'assigned-aging:'+asset.id+':'+since,time:since,title:asset.name+' · 已领用 '+days+' 天',kind:'asset',assetId:asset.id}))].map(i=>({...i,read:read.has(i.id)}));
    if(req.method==='POST'){const c=await body(req);if(!items.some(i=>i.id===c.id))throw new Error('通知不存在');db.prepare('INSERT OR IGNORE INTO notification_reads VALUES (?,?)').run(user.id,c.id)}return json(res,200,{items});
   }
   if(path==='/api/business'&&req.method==='GET'){if(user.role!=='admin')return json(res,403,{error:'仅管理员可查看业务记录'});return json(res,200,{records:db.prepare('SELECT * FROM operation_records').all().map(o=>({...JSON.parse(o.data),kind:o.kind}))})}
   if(path==='/api/sync'&&user.role==='admin'&&req.method==='POST'){
    const c=await body(req);if(['cancelAll','deleteAll'].includes(c.action)){if(c.confirm!==(c.action==='cancelAll'?'全部取消':'全部删除'))throw new Error('请确认批量操作');const result=c.action==='cancelAll'?db.prepare("UPDATE sync_outbox SET status='cancelled' WHERE status IN ('pending','failed')").run():db.prepare('DELETE FROM sync_outbox').run();return json(res,200,{ok:true,count:result.changes})}if(!['cancel','delete'].includes(c.action))throw new Error('同步操作无效');const row=db.prepare('SELECT status FROM sync_outbox WHERE id=?').get(c.id);if(!row)throw new Error('同步事件不存在');if(c.action==='delete'){if(c.confirm!=='删除')throw new Error('请确认删除同步事件');db.prepare('DELETE FROM sync_outbox WHERE id=?').run(c.id)}else if(c.action==='cancel'){if(!['pending','failed'].includes(row.status))throw new Error('仅待投递或失败事件可取消');db.prepare("UPDATE sync_outbox SET status='cancelled' WHERE id=?").run(c.id)}else{if(!['failed','cancelled'].includes(row.status))throw new Error('仅失败或已取消事件可重新排队');db.prepare("UPDATE sync_outbox SET status='pending',nextAttempt=? WHERE id=?").run(new Date().toISOString(),c.id)}return json(res,200,{ok:true});
   }
   if(path==='/api/sync'&&user.role==='admin'&&req.method==='GET'){const total=db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get().n,page=Math.min(Math.max(1,Number(url.searchParams.get('page'))||1),Math.max(1,Math.ceil(total/10)));return json(res,200,{items:db.prepare('SELECT id,status,attempts,nextAttempt,lastError FROM sync_outbox ORDER BY rowid DESC LIMIT 10 OFFSET ?').all((Math.floor(page)-1)*10),total,cancellable:db.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE status IN ('pending','failed')").get().n,page:Math.floor(page),pageSize:10,configured:false,direction:'inbound'})}
   if(path==='/api/integration-admins'){
    if(user.role!=='admin')return json(res,403,{error:'仅系统管理员可配置授权'});
    if(req.method==='POST'){const c=await body(req),id=String(c.wecomUserId||'').trim();if(!id||id.length>100)throw new Error('请输入有效 UserID');if(c.remove)db.prepare('DELETE FROM integration_admins WHERE wecomUserId=?').run(id);else{const name=String(c.name||'').trim();if(!name||name.length>100)throw new Error('请输入管理员姓名');db.prepare('INSERT INTO integration_admins VALUES (?,?) ON CONFLICT(wecomUserId) DO UPDATE SET name=excluded.name').run(id,name)}const row=db.prepare("SELECT data FROM asset_state WHERE id='company'").get(),state=JSON.parse(row.data);state.logs.unshift({id:randomUUID(),time:new Date().toISOString(),actor:user.username,action:'integrationAdmin',detail:(c.remove?'撤销':'授权')+'企业微信管理员 '+id});db.prepare("UPDATE asset_state SET data=?,revision=revision+1 WHERE id='company'").run(JSON.stringify(state));}
    return json(res,200,{admins:db.prepare('SELECT * FROM integration_admins').all()});
   }
   if(path==='/api/integration/identity'&&req.method==='GET')return json(res,200,{userId:user.username,employeeId:user.employeeId,name:user.name,permissions:{myAssets:true,claim:true,approve:!!user.integrationAdmin}});
   if(path==='/api/integration/lookup'&&req.method==='GET'){
    const number=url.searchParams.get('number')?.trim(),serial=url.searchParams.get('serial')?.trim();if((!number&&!serial)||(number&&serial))throw new Error('请提供资产编号 number 或序列号 serial 中的一项');if((number||serial).length>100)throw new Error('查询内容过长');const people=directory(db),state=hydrate(JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),people);const matches=state.assets.filter(a=>number?a.number===number:a.serial===serial);return json(res,200,{assets:matches.map(a=>{const owner=people.find(e=>e.id===a.holderEmployeeId);const ownerName=effectiveHolder(a);const claimBlockedReason=claimBlockReason(state,a);return {id:a.id,name:a.name,number:a.number,serial:a.serial,category:a.category,type:a.type,status:a.status,ownerName,ownerWecomUserId:owner?.wecomUserId||'',claimable:!claimBlockedReason,claimBlockedReason}}),ambiguous:matches.length>1});
   }
   if(path==='/api/integration/admin/requests'&&req.method==='GET'){
    if(!user.integrationAdmin)return json(res,403,{error:'没有企业微信审批权限'});const state=hydrate(JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),directory(db));return json(res,200,{requests:state.requests.filter(r=>['待审批','待接收确认'].includes(r.status)).map(r=>({...r,canApprove:r.status==='待审批',asset:state.assets.find(a=>a.id===r.assetId)}))});
   }
   if(path==='/api/integration/catalog'&&req.method==='GET'){const state=JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data);return json(res,200,{assets:state.assets.filter(a=>!claimBlockReason(state,a)).map(a=>({id:a.id,name:a.name,number:a.number,type:a.type,category:a.category}))})}
   if(path==='/api/integration/requests'&&req.method==='GET'){const state=JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data);const assetsById=new Map([...(state.deletedAssets||[]),...state.assets].map(a=>[a.id,{id:a.id,name:a.name,number:a.number,serial:a.serial}]));return json(res,200,{requests:state.requests.filter(r=>r.fromEmployeeId===user.employeeId||r.toEmployeeId===user.employeeId).map(r=>({...r,asset:assetsById.get(r.assetId)}))})}
   if(path==='/api/integration/me'&&req.method==='GET'){const people=directory(db),state=hydrate(JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),people);return json(res,200,{employee:employeeList(db).find(e=>e.id===user.employeeId),assets:ownAssets(state,user,people).map(a=>({...a,receiveDate:a.received||'',ownerName:a.holder||'',ownerWecomUserId:a.holderEmployeeId?people.find(e=>e.id===a.holderEmployeeId)?.wecomUserId||'':'',claimable:false}))})}
   if(['/api/integration/request','/api/integration/admin/decision'].includes(path)&&req.method==='POST'){
    const c=await body(req),decision=path==='/api/integration/admin/decision';if(decision&&!user.integrationAdmin)return json(res,403,{error:'没有企业微信审批权限'});if(decision&&!['approve','reject'].includes(c.action))throw new Error('审批操作无效');const key=String(req.headers['idempotency-key']||'');if(!/^[\w-]{8,100}$/.test(key))throw new Error('请提供 8–100 位 Idempotency-Key');const existing=db.prepare('SELECT * FROM integration_keys WHERE key=?').get(key);if(existing){if(existing.employeeId!==user.employeeId)return json(res,403,{error:'请求标识归属不符'});return json(res,200,JSON.parse(existing.response))}const row=db.prepare("SELECT data,revision FROM asset_state WHERE id='company'").get(),state=hydrate(JSON.parse(row.data),directory(db));
    if(decision){if(!state.requests.some(r=>r.id===c.id))throw new Error('申请不存在')}else if(['confirmTransfer','rejectTransfer'].includes(c.action)){c.employeeId=user.employeeId}else{const a=c.kind==='领用'?state.assets.find(a=>a.id===c.assetId):ownAssets(state,user,directory(db)).find(a=>a.id===c.assetId);if(!a||!['领用','归还','转让'].includes(c.kind))return json(res,403,{error:c.kind==='领用'?'资产不存在':'仅可归还或转让本人资产'});if(c.kind==='领用'){const blocked=claimBlockReason(state,a);if(blocked)return json(res,400,{error:blocked});c.toEmployeeId=user.employeeId;c.toUserId='';c.toUsername=''}if(c.kind==='转让'&&c.toWecomUserId){const recipient=directory(db).find(e=>e.enabled&&e.wecomUserId===c.toWecomUserId);if(!recipient)throw new Error('请先同步接收人的企业微信身份');c.toEmployeeId=recipient.id}c.action='request'}
    const before=structuredClone(state),next=command(state,resolveCommand(db,state,c),user.username);const result={ok:true};if(c.action==='request')result.requestId=next.requests.at(-1)?.id;db.exec('BEGIN IMMEDIATE');try{recordHistory(db,before,next,user.username,c.action);const taskId=randomUUID(),taskTime=new Date().toISOString();db.prepare("INSERT INTO sync_outbox(id,data,status,nextAttempt) VALUES (?,?,'processed',?)").run(taskId,JSON.stringify({id:taskId,type:'it.task',source:'IT小爱',userId:user.username,action:c.action,kind:c.kind||'',assetId:c.assetId||'',requestId:c.id||'',time:taskTime,result:'已写入系统'}),taskTime);db.prepare('INSERT INTO integration_keys VALUES (?,?,?)').run(key,user.employeeId,JSON.stringify(result));db.prepare("UPDATE asset_state SET data=?,revision=revision+1 WHERE id='company' AND revision=?").run(JSON.stringify(next),row.revision);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return json(res,200,result);
   }
   if(path!=='/api/assets')return json(res,404,{error:'接口不存在'});
   const row=db.prepare('SELECT revision,data FROM asset_state WHERE id=?').get('company');
   if(req.method==='GET'){
    const requested=new URL(req.url,'http://localhost').searchParams.get('username');if(user.role!=='admin'&&requested&&requested!==user.username)return json(res,403,{error:'只能查询本人名下资产'});
    let state=hydrate(JSON.parse(row.data),directory(db));
    if(requested&&user.role==='admin'){const target=db.prepare('SELECT id FROM users WHERE username=?').get(requested.toLowerCase());state={...state,assets:target?state.assets.filter(a=>a.holderUserId===target.id):[],requests:[],logs:[],events:[]}}
    return json(res,200,{revision:row.revision,state:scopedState(state,user)});
   }
   if(req.method==='POST'){const input=await body(req,user.role==='admin'?128_000_000:32_000_000);if(user.role!=='admin'&&input.action!=='confirmTransfer')return json(res,403,{error:'普通用户仅可确认本人接收申请'});if(input.revision!==row.revision)return json(res,409,{error:'数据已更新，请刷新后重试'});const original=JSON.parse(row.data);let state=structuredClone(original);
    if(input.action==='restore')validateFullBackup(input.backup);
    if(input.action==='confirmTransfer')input.employeeId=user.employeeId;
    const business=['inventoryTaskCreate','inventoryTaskScan','inventoryTaskSave','inventoryTaskEnd','inventoryCreate','inventoryUpdate','inventoryScan','repair','stock'].includes(input.action);
    if(!business){if(input.action==='bulk'){if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>200)throw new Error('每次批量处理 1–200 条');if(!['ownership','status'].includes(input.key)||!state.dictionaries[input.key].includes(input.value))throw new Error('批量字段或字典值无效');for(const id of new Set(input.ids)){const a=state.assets.find(a=>a.id===id);if(!a)throw new Error('资产不存在');if(input.key==='status'&&![statusValue(state,'idle'),statusValue(state,'damaged')].includes(input.value))throw new Error('领用和报废必须走审批');state=command(state,{action:'save',asset:{...a,[input.key]:input.value}},user.username)}}else state=command(state,resolveCommand(db,state,input),user.username)}
    state=retainLogs(state);db.exec('BEGIN IMMEDIATE');try{if(business){const detail=businessCommand(db,state,input,user.username);if(!['inventoryTaskScan','inventoryTaskSave','inventoryScan','inventoryUpdate'].includes(input.action))state.logs.unshift({id:randomUUID(),time:new Date().toISOString(),actor:user.username,action:input.action,detail})}if(input.action==='restore'||input.action==='clearLogs'){const snapshotDir=join(dir,'restore-backups');mkdirSync(snapshotDir,{recursive:true});writeFileSync(join(snapshotDir,Date.now()+'-'+randomUUID()+'.json'),JSON.stringify(fullBackup(db)),{mode:0o600})}if(input.action==='restore')restoreExtensions(db,input.backup);recordHistory(db,original,state,user.username,input.action);const result=db.prepare('UPDATE asset_state SET data=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(state),'company',row.revision);if(!result.changes){db.exec('ROLLBACK');return json(res,409,{error:'并发冲突，请刷新后重试'})}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return json(res,200,{state:scopedState(hydrate(state,directory(db)),user),revision:row.revision+1})}
   return json(res,405,{error:'不支持的请求方法'});
  }
  if(req.method!=='GET'||!files[path])return json(res,404,{error:'页面不存在'});
  const [file,type]=files[path];res.setHeader('Content-Type',type);res.setHeader('Cache-Control',path==='/'?'no-store':'no-cache');res.end(readFileSync(join(staticDir,file)));
 }catch(e){json(res,400,{error:e instanceof Error?e.message:'操作失败'})}
});
const port=Number(process.env.PORT||3000);server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`AssetHub listening at http://localhost:${port}`));
const cleanup=setInterval(()=>{const now=Date.now();for(const [k,v]of sessions)if(v.expires<now)sessions.delete(k);for(const [k,v]of attempts)if(v.start+15*60_000<now)attempts.delete(k)},60_000);cleanup.unref();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{db.close();process.exit(0)})});



