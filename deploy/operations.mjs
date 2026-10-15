import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {validateBackup} from '../lib/restore.ts';
import {validateAsset,statusValue,categoryValue,importDictionaries} from '../lib/assets.ts';
import {allAttachments,initAttachments,validateAttachments} from './attachments.mjs';
import {pruneBackups} from './backup-retention.mjs';

export function initOperations(db){
 initAttachments(db);
 db.exec(`CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,wecomUserId TEXT NOT NULL DEFAULT '',department TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,loginUserId TEXT NOT NULL DEFAULT '',legacy INTEGER NOT NULL DEFAULT 0);
 CREATE UNIQUE INDEX IF NOT EXISTS employee_wecom ON employees(wecomUserId) WHERE wecomUserId<>'';
 CREATE UNIQUE INDEX IF NOT EXISTS employee_login ON employees(loginUserId) WHERE loginUserId<>'';
 CREATE TABLE IF NOT EXISTS asset_history(id TEXT PRIMARY KEY,assetId TEXT NOT NULL,time TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,beforeData TEXT,afterData TEXT,detail TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operation_records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS integration_admins(wecomUserId TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS integration_keys(key TEXT PRIMARY KEY,employeeId TEXT NOT NULL,response TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notification_reads(userId TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(userId,id));
 CREATE TABLE IF NOT EXISTS sync_outbox(id TEXT PRIMARY KEY,data TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,nextAttempt TEXT NOT NULL,lastError TEXT NOT NULL DEFAULT '');`);
 for(const u of db.prepare('SELECT id,name FROM users').all())db.prepare('INSERT OR IGNORE INTO employees(id,name,loginUserId,legacy) VALUES (?,?,?,1)').run(u.id,u.name,u.id);
 const state=JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),previous=new Map();
 for(const e of state.events){db.prepare('INSERT OR IGNORE INTO asset_history VALUES (?,?,?,?,?,?,?,?)').run(e.id,e.assetId,e.time,'历史数据','legacy',previous.has(e.assetId)?JSON.stringify(previous.get(e.assetId)):null,JSON.stringify(e.payload),'升级前资产快照，旧事件未记录操作者');previous.set(e.assetId,e.payload)}
}
export const employeeList=db=>db.prepare('SELECT * FROM employees ORDER BY name,id').all().map(e=>({...e,active:!!e.active}));
export function syncIdentity(db,profile){
 const wecomUserId=String(profile.wecomUserId||'').trim(),name=String(profile.name||'').trim();if(!wecomUserId||!name)throw new Error('可信身份需包含姓名和企业微信 UserID');
 const old=db.prepare('SELECT * FROM employees WHERE wecomUserId=?').get(wecomUserId);
 if(old&&!old.active&&profile.active===undefined)throw new Error('身份已停用，需由通讯录同步确认在职状态');
 const id=employeeCommand(db,{id:old?.id,name,wecomUserId,department:profile.department??old?.department??'',loginUserId:old?.loginUserId||'',active:profile.active??true});return db.prepare('SELECT * FROM employees WHERE id=?').get(id);
}
export function employeeCommand(db,c){
 const name=String(c.name||'').trim(),wecom=String(c.wecomUserId||'').trim(),department=String(c.department||'').trim(),login=String(c.loginUserId||'');
 if(!name||name.length>80||department.length>100||wecom.length>100||wecom&&!/^[\w.@-]+$/.test(wecom))throw new Error('员工姓名、部门或企业微信 UserID 格式无效');
 if(login&&!db.prepare('SELECT id FROM users WHERE id=?').get(login))throw new Error('关联登录账号不存在');
 const old=c.id&&db.prepare('SELECT * FROM employees WHERE id=?').get(c.id);if(c.id&&!old)throw new Error('员工不存在');
 const id=old?.id||randomUUID();
 if(db.prepare("SELECT id FROM employees WHERE id<>? AND ((wecomUserId<>'' AND wecomUserId=?) OR (loginUserId<>'' AND loginUserId=?))").get(id,wecom,login))throw new Error('企业微信 UserID 或登录账号已关联其他员工');
 db.prepare('INSERT INTO employees VALUES (?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,wecomUserId=excluded.wecomUserId,department=excluded.department,active=excluded.active,loginUserId=excluded.loginUserId,legacy=0').run(id,name,wecom,department,c.active===false?0:1,login);
 return id;
}
export function historyList(db,assetId){return db.prepare('SELECT * FROM asset_history WHERE assetId=? ORDER BY time DESC,rowid DESC').all(assetId).map(h=>({...h,before:h.beforeData?JSON.parse(h.beforeData):null,after:h.afterData?JSON.parse(h.afterData):null,beforeData:undefined,afterData:undefined}))}
export function recordHistory(db,before,after,actor,action,detail='',notify=false){
 for(const a of before.assets.filter(a=>!after.assets.some(x=>x.id===a.id))){const id=randomUUID(),time=new Date().toISOString();db.prepare('INSERT INTO asset_history VALUES (?,?,?,?,?,?,?,?)').run(id,a.id,time,actor,action,JSON.stringify(a),null,'资产从台账删除，原始数据已归档');if(notify)db.prepare('INSERT INTO sync_outbox(id,data,nextAttempt) VALUES (?,?,?)').run(id,JSON.stringify({id,time,type:'asset.deleted',assetId:a.id,before:a,after:null}),time)}

 for(const a of after.assets){const old=before.assets.find(x=>x.id===a.id);if(JSON.stringify(old)===JSON.stringify(a))continue;
 const id=randomUUID(),time=new Date().toISOString();db.prepare('INSERT INTO asset_history VALUES (?,?,?,?,?,?,?,?)').run(id,a.id,time,actor,action,old?JSON.stringify(old):null,JSON.stringify(a),detail);
 const event={id,time,type:'asset.updated',assetId:a.id,before:old||null,after:a};if(notify)db.prepare('INSERT INTO sync_outbox(id,data,nextAttempt) VALUES (?,?,?)').run(id,JSON.stringify(event),time);
 }
 for(const r of after.requests){const old=before.requests.find(x=>x.id===r.id);if(JSON.stringify(old)===JSON.stringify(r))continue;const a=after.assets.find(a=>a.id===r.assetId);if(!a)continue;const id=randomUUID(),time=new Date().toISOString(),description=`${r.kind}：${r.from||'资产库'} → ${r.to||'资产库'}；${old?.status||'新申请'} → ${r.status}`;
 db.prepare('INSERT INTO asset_history VALUES (?,?,?,?,?,?,?,?)').run(id,a.id,time,actor,action,JSON.stringify(a),JSON.stringify(a),description);
 if(notify)db.prepare('INSERT INTO sync_outbox(id,data,nextAttempt) VALUES (?,?,?)').run(id,JSON.stringify({id,time,type:'flow.updated',assetId:a.id,before:old||null,after:r}),time);
 }
}
export function importPreview(db,state,rows,resolve){
 if(!Array.isArray(rows)||!rows.length||rows.length>2000)throw new Error('一次导入 1–2000 条资产');
 const numbers=new Set(state.assets.map(a=>a.number));let seen=new Set();
 return rows.map((raw,i)=>{const errors=[];let asset;try{asset=validateAsset(resolve(raw),importDictionaries(state,[raw]))}catch(e){errors.push(e.message)}const number=String(raw.number||'').trim();if(numbers.has(number)||seen.has(number))errors.push('资产编号重复：'+number);seen.add(number);return {row:i+2,name:String(raw.name||''),number,holder:asset?.holder||String(raw.holder||''),errors,asset}});
}
export function fullBackup(db){return {format:'asset-hub-backup',version:1,exportedAt:new Date().toISOString(),state:JSON.parse(db.prepare("SELECT data FROM asset_state WHERE id='company'").get().data),extensions:{employees:employeeList(db),history:db.prepare('SELECT * FROM asset_history').all(),operations:db.prepare('SELECT * FROM operation_records').all(),outbox:db.prepare('SELECT * FROM sync_outbox').all(),attachments:allAttachments(db)}}}
export function validateFullBackup(raw){
 validateBackup(raw);if(!raw.extensions)return true;const x=raw.extensions;
 for(const k of ['employees','history','operations','outbox'])if(!Array.isArray(x[k])||x[k].length>200000)throw new Error('备份扩展数据无效');
 const ids=new Set(),wecomIds=new Set(),loginIds=new Set();for(const e of x.employees){if(typeof e.id!=='string'||!e.id||e.id.length>100||ids.has(e.id)||typeof e.name!=='string'||!e.name||e.name.length>80||typeof e.active!=='boolean'||typeof e.wecomUserId!=='string'||e.wecomUserId.length>100||e.wecomUserId&&!/^[\w.@-]+$/.test(e.wecomUserId)||typeof e.department!=='string'||e.department.length>100||typeof e.loginUserId!=='string'||e.loginUserId.length>100||e.wecomUserId&&wecomIds.has(e.wecomUserId)||e.loginUserId&&loginIds.has(e.loginUserId))throw new Error('员工备份无效');ids.add(e.id);if(e.wecomUserId)wecomIds.add(e.wecomUserId);if(e.loginUserId)loginIds.add(e.loginUserId)}
 for(const h of x.history){if(typeof h.id!=='string'||typeof h.assetId!=='string'||!Number.isFinite(Date.parse(h.time))||typeof h.actor!=='string'||typeof h.action!=='string'||typeof h.detail!=='string')throw new Error('历史备份无效');for(const v of [h.beforeData,h.afterData])if(v&&(!JSON.parse(v)||typeof JSON.parse(v)!=='object'))throw new Error('历史快照无效')}
 for(const o of x.operations)if(typeof o.id!=='string'||!['inventory','inventoryConfirmation','repair','stock'].includes(o.kind)||typeof o.data!=='string'||!JSON.parse(o.data))throw new Error('业务备份无效');
 for(const o of x.outbox)if(typeof o.id!=='string'||typeof o.data!=='string'||!JSON.parse(o.data)||!['pending','sent','failed','cancelled','processed'].includes(o.status)||!Number.isInteger(o.attempts)||o.attempts<0||!Number.isFinite(Date.parse(o.nextAttempt)))throw new Error('同步备份无效');
 validateAttachments(x.attachments,new Set([...raw.state.assets,...(raw.state.deletedAssets||[])].map(a=>a.id)));
 return true;
}
export function restoreExtensions(db,raw){
 if(!raw.extensions){db.exec('DELETE FROM asset_attachments');return}validateFullBackup(raw);const x=raw.extensions;
 db.exec('DELETE FROM asset_attachments');for(const a of validateAttachments(x.attachments,new Set([...raw.state.assets,...(raw.state.deletedAssets||[])].map(a=>a.id))))db.prepare('INSERT INTO asset_attachments VALUES (?,?,?,?,?,?,?,?,?)').run(a.id,a.assetId,a.name,a.kind,a.mime,a.size,a.created,a.actor,a.data);
 for(const e of x.employees){const loginUserId=e.loginUserId&&db.prepare('SELECT id FROM users WHERE id=?').get(e.loginUserId)?e.loginUserId:'';db.prepare('INSERT INTO employees VALUES (?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,wecomUserId=excluded.wecomUserId,department=excluded.department,active=excluded.active,loginUserId=excluded.loginUserId,legacy=0').run(e.id,e.name,e.wecomUserId,e.department,e.active?1:0,loginUserId)}
 // 生命周期历史只追加，恢复旧备份也不删除已经发生的历史。
 for(const h of x.history)db.prepare('INSERT OR IGNORE INTO asset_history VALUES (?,?,?,?,?,?,?,?)').run(h.id,h.assetId,h.time,h.actor,h.action,h.beforeData,h.afterData,h.detail);
 db.exec('DELETE FROM operation_records');for(const o of x.operations)db.prepare('INSERT INTO operation_records VALUES (?,?,?)').run(o.id,o.kind,o.data);
 for(const o of x.outbox)db.prepare('INSERT OR IGNORE INTO sync_outbox VALUES (?,?,?,?,?,?)').run(o.id,o.data,o.status,o.attempts,o.nextAttempt,o.lastError||'');
}
export function backupManager(db,dir){
 const folder=join(dir,'automatic-backups');mkdirSync(folder,{recursive:true});
 const filenamePattern=/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.json$/;
 function verify(raw){validateFullBackup(raw);const restored=validateBackup(raw),test=new DatabaseSync(':memory:');try{test.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE asset_state(id TEXT PRIMARY KEY,revision INTEGER,data TEXT);');for(const u of db.prepare('SELECT id,name FROM users').all())test.prepare('INSERT INTO users VALUES (?,?)').run(u.id,u.name);test.prepare('INSERT INTO asset_state VALUES (?,0,?)').run('company',JSON.stringify(restored));initOperations(test);for(const e of employeeList(db))test.prepare('INSERT OR REPLACE INTO employees VALUES (?,?,?,?,?,?,?)').run(e.id,e.name,e.wecomUserId,e.department,e.active?1:0,e.loginUserId,e.legacy||0);test.exec('BEGIN');restoreExtensions(test,raw);const people=new Set(employeeList(test).map(e=>e.id));for(const a of restored.assets)if(a.holderEmployeeId&&!people.has(a.holderEmployeeId))throw new Error('资产关联员工缺失');test.exec('COMMIT');if(JSON.parse(test.prepare("SELECT data FROM asset_state WHERE id='company'").get().data).assets.length!==restored.assets.length)throw new Error('恢复演练数量不符');return {verified:true,restoreTest:true,assets:restored.assets.length,employees:employeeList(test).length}}finally{test.close()}}
 function create(){const data=JSON.stringify(fullBackup(db));verify(JSON.parse(data));const filename=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.json';const path=join(folder,filename);writeFileSync(path+'.tmp',data,{mode:0o600});renameSync(path+'.tmp',path);pruneBackups(folder,filenamePattern);return {filename,verified:true,restoreTest:true,sha256:createHash('sha256').update(data).digest('hex')}}
 function list(){return readdirSync(folder).filter(f=>filenamePattern.test(f)).sort().reverse().map(filename=>({filename}))}
 function read(filename){if(!list().some(f=>f.filename===filename))throw new Error('备份不存在');return JSON.parse(readFileSync(join(folder,filename),'utf8'))}
 function daily(){if(!list().some(f=>f.filename.startsWith(new Date().toISOString().slice(0,10))))create();else pruneBackups(folder,filenamePattern)}
 return {create,list,read,daily,verify};
}
export function businessCommand(db,state,c,actor){
 const now=new Date().toISOString(),id=randomUUID();
 if(c.action==='inventoryTaskCreate'){
  const title=String(c.title||'').trim(),startDate=String(c.startDate||'');if(!title||title.length>100)throw new Error('请输入盘点任务名称');if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isFinite(Date.parse(startDate))||new Date(startDate).toISOString().slice(0,10)!==startDate)throw new Error('开始日期无效');if(!state.assets.length)throw new Error('暂无可盘点资产');const task={id,title,startDate,created:now,actor,inventoryVersion:2,status:'未开始',savedAt:now,endedAt:'',items:state.assets.map(a=>({assetId:a.id,number:a.number,serial:a.serial,name:a.name,ownership:a.ownership,status:a.status,holder:a.holder,result:'',actor:'',checkedAt:''}))};db.prepare('INSERT INTO operation_records VALUES (?,?,?)').run(id,'inventory',JSON.stringify(task));return '新建盘点任务 '+title;
 }
 if(['inventoryTaskScan','inventoryTaskSave','inventoryTaskEnd'].includes(c.action)){
  const row=db.prepare("SELECT data FROM operation_records WHERE id=? AND kind='inventory'").get(c.id);if(!row)throw new Error('盘点任务不存在');const task=JSON.parse(row.data);if(task.inventoryVersion!==2)throw new Error('请新建新版盘点任务');if(task.status==='已完成')throw new Error('已完成任务不能修改');
  if(c.action==='inventoryTaskScan'){if(task.status!=='进行中')throw new Error('请先开始盘点');const query=String(c.query||'').trim();if(!query||query.length>100)throw new Error('请输入资产编号或序列号');const matches=task.items.filter(i=>i.number===query||i.serial&&i.serial===query);if(!matches.length)throw new Error('您输入的资产编号不存在，请核对后重新输入！');if(matches.length>1)throw new Error('匹配多台资产，请输入唯一资产编号');const item=matches[0];if(item.result==='确认')throw new Error('该资产已确认，无需重复确认。');if(!state.assets.some(a=>a.id===item.assetId))throw new Error('该资产已删除，无法盘点');item.result='确认';item.actor=actor;item.checkedAt=now;task.lastCheckedAt=now;task.lastActor=actor;
  }else if(c.action==='inventoryTaskEnd'){if(task.status!=='进行中')throw new Error('请先开始盘点');task.endedAt=now;task.status=task.items.every(i=>i.result==='确认')?'已完成':'已结束';task.lastActor=actor;
  }else if(c.start){task.status='进行中';task.startedAt=task.startedAt||now;task.endedAt='';task.lastActor=actor}
  task.savedAt=now;db.prepare('UPDATE operation_records SET data=? WHERE id=?').run(JSON.stringify(task),task.id);return '保存盘点任务 '+task.title+' · '+task.status;
 }
 if(c.action==='inventoryScan'){
  const query=String(c.query||'').trim();if(!query||query.length>100)throw new Error('请输入有效资产编号或序列号');const matches=state.assets.filter(a=>a.number===query||a.serial&&a.serial===query);if(!matches.length)throw new Error('未找到对应资产，请核对编号或序列号');if(matches.length>1)throw new Error('匹配到多台设备，请使用唯一资产编号');const a=matches[0];const key='inventory-confirm:'+a.id;const item={id:key,assetId:a.id,number:a.number,serial:a.serial,result:'确认',actor,checkedAt:now,created:now};db.prepare('INSERT INTO operation_records VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(key,'inventoryConfirmation',JSON.stringify(item));return '盘点确认 '+a.number+' · '+a.name;
 }
 if(c.action==='inventoryCreate'){
  const title=String(c.title||'').trim();if(!title||title.length>100)throw new Error('请输入盘点任务名称');
  const people=new Map(employeeList(db).map(e=>[e.id,e]));
  const selected=state.assets.filter(a=>(!c.ownership||a.ownership===c.ownership)&&(!c.department||people.get(a.holderEmployeeId||a.holderUserId)?.department===c.department)&&(!c.employeeId||(a.holderEmployeeId||a.holderUserId)===c.employeeId));
  if(!selected.length)throw new Error('筛选范围内没有资产');
  const task={id,title,created:now,actor,status:'进行中',items:selected.map(a=>({assetId:a.id,number:a.number,name:a.name,holder:a.holder,ownership:a.ownership,result:'待盘点',note:''}))};db.prepare('INSERT INTO operation_records VALUES (?,?,?)').run(id,'inventory',JSON.stringify(task));return '创建盘点任务 '+title;
 }
 if(c.action==='inventoryUpdate'){
  const row=db.prepare("SELECT data FROM operation_records WHERE id=? AND kind='inventory'").get(c.id);if(!row)throw new Error('盘点任务不存在');const task=JSON.parse(row.data);if(task.status==='已完成')throw new Error('已完成盘点不可修改');
  if(c.finish){if(task.items.some(i=>i.result==='待盘点'))throw new Error('还有未盘点资产');task.status='已完成';task.completed=now}else{const item=task.items.find(i=>i.assetId===c.assetId);if(!item||!['正常','缺失','损坏','归属不符'].includes(c.result))throw new Error('盘点结果无效');item.result=c.result;item.note=String(c.note||'').slice(0,2000);item.checkedAt=now;item.actor=actor}
  db.prepare('UPDATE operation_records SET data=? WHERE id=?').run(JSON.stringify(task),task.id);return '更新盘点 '+task.title;
 }
 if(c.action==='repair'){
  const a=state.assets.find(a=>a.id===c.assetId);if(!a||a.status===statusValue(state,'retired'))throw new Error('维修资产不存在或已报废');const issue=String(c.issue||'').trim(),technician=String(c.technician||'').trim(),result=String(c.result||'').trim(),cost=Number(c.cost||0);
  if(!issue||issue.length>2000||technician.length>100||result.length>2000||!Number.isFinite(cost)||cost<0||cost>1e12)throw new Error('维修内容或费用无效');
  const record={id,assetId:a.id,created:now,actor,issue,technician,result,cost};db.prepare('INSERT INTO operation_records VALUES (?,?,?)').run(id,'repair',JSON.stringify(record));
  db.prepare('INSERT INTO asset_history VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),a.id,now,actor,'repair',JSON.stringify(a),JSON.stringify(a),`${issue}；维修人：${technician||'未填写'}；费用：${cost}；结果：${result||'待处理'}`);return '记录维修 '+a.number;
 }
 if(c.action==='stock'){
  const a=state.assets.find(a=>a.id===c.assetId);const quantity=Number(c.quantity),direction=c.direction;if(!a||a.category!==categoryValue(state,'consumable')||!['入库','出库'].includes(direction)||!Number.isInteger(quantity)||quantity<=0)throw new Error('库存操作无效');const old=Number(a.quantity??1),next=old+(direction==='入库'?quantity:-quantity);if(next<0)throw new Error('库存不足');a.quantity=next;
  db.prepare('INSERT INTO operation_records VALUES (?,?,?)').run(id,'stock',JSON.stringify({id,assetId:a.id,created:now,actor,direction,quantity,before:old,after:next,reason:String(c.reason||'').slice(0,2000)}));return `${a.number} ${direction} ${quantity}`;
 }
 throw new Error('业务操作无效');
}
