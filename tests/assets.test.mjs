import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,command,approvalDate,claimBlockReason} from '../lib/assets.ts';
import {validateBackup} from '../lib/restore.ts';
import {parseCSV,csvCell} from '../lib/csv.ts';
import {DatabaseSync} from 'node:sqlite';
import {initPreferences,readDisplay} from '../deploy/access.mjs';
import {initOperations,restoreExtensions,validateFullBackup,fullBackup,recordHistory} from '../deploy/operations.mjs';
import {addAttachment,attachmentList} from '../deploy/attachments.mjs';
import {undoCandidate,undoApprovedFlow} from '../deploy/flow-undo.mjs';
import {agingStats} from '../lib/aging.ts';
const actor='admin@example.com';
const asset=()=>({name:'测试电脑',number:'IT-001',category:'固定资产',ownership:'',type:'电脑',status:'未使用',holder:'',purchased:'2026-10-10',price:8000});
test('自定义字段按数字、日期和单选规则校验，旧文本字段保持兼容',()=>{
 const s=initial();command(s,{action:'field',value:'采购日期',fieldType:'date'},actor);command(s,{action:'field',value:'设备等级',fieldType:'select',options:'高,中,低'},actor);
 assert.throws(()=>command(s,{action:'save',asset:{...asset(),extras:{采购日期:'2026-02-30',设备等级:'高'}}},actor),/有效日期/);
 assert.throws(()=>command(s,{action:'save',asset:{...asset(),extras:{采购日期:'2026-02-28',设备等级:'未知'}}},actor),/可选项/);
 command(s,{action:'save',asset:{...asset(),extras:{采购日期:'2026-02-28',设备等级:'高'}}},actor);
 assert.throws(()=>command(structuredClone(s),{action:'field',key:'extra:设备等级',value:'设备等级',fieldType:'number'},actor),/数字/);
 assert.equal(validateBackup(s).assets[0].extras['设备等级'],'高');
});
test('长期闲置和领用提醒按资产状态与日期计算',()=>{
 const s=initial();command(s,{action:'save',asset:{...asset(),purchased:'2026-01-01'}},actor);s.events[0].time='2026-01-01T00:00:00Z';
 const result=agingStats(s,new Date('2026-10-15T04:00:00Z'));assert.equal(result.idle.length,1);
 s.assets[0].status='使用中';s.assets[0].holder='张三';s.assets[0].received='2026-01-01';assert.equal(agingStats(s,new Date('2026-10-15T04:00:00Z')).assigned.length,1);
});
test('附件写入完整备份并可恢复，拒绝伪造图片',()=>{
 const make=()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE asset_state(id TEXT PRIMARY KEY,revision INTEGER,data TEXT)');db.prepare('INSERT INTO users VALUES (?,?)').run('admin','管理员');const s=initial();command(s,{action:'save',asset:asset()},actor);db.prepare('INSERT INTO asset_state VALUES (?,?,?)').run('company',0,JSON.stringify(s));initOperations(db);return {db,s}};
 const first=make(),second=make();try{const id=first.s.assets[0].id,png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');addAttachment(first.db,id,{name:'设备.png',kind:'photo',mime:'image/png',data:png},actor);
  assert.throws(()=>addAttachment(first.db,id,{name:'伪造.png',kind:'photo',mime:'image/png',data:Buffer.from('bad').toString('base64')},actor),/格式或内容/);
  const backup=fullBackup(first.db);assert.equal(validateFullBackup(backup),true);restoreExtensions(second.db,backup);assert.equal(attachmentList(second.db,id).length,1);
 }finally{first.db.close();second.db.close()}
});
test('撤销最近一次本地审批恢复资产并留下历史，重复撤销被拒绝',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,username TEXT,role TEXT);CREATE TABLE asset_state(id TEXT PRIMARY KEY,revision INTEGER,data TEXT)');db.prepare('INSERT INTO users VALUES (?,?,?,?)').run('admin','管理员','admin','admin');const s=initial();command(s,{action:'save',asset:asset()},'admin');db.prepare('INSERT INTO asset_state VALUES (?,?,?)').run('company',0,JSON.stringify(s));initOperations(db);command(s,{action:'request',assetId:s.assets[0].id,kind:'领用',to:'张三'},'admin');const before=structuredClone(s);command(s,{action:'approve',id:s.requests[0].id},'admin');recordHistory(db,before,s,'admin','approve');const candidate=undoCandidate(db,s,s.assets[0].id);assert.ok(candidate);undoApprovedFlow(db,s,candidate.assetId,candidate.historyId,'admin');assert.equal(s.assets[0].status,'未使用');assert.equal(s.requests[0].status,'已撤销');assert.equal(undoCandidate(db,s,candidate.assetId),null);assert.equal(validateBackup(s).requests[0].status,'已撤销')
 }finally{db.close()}
});
test('跨环境恢复保留员工身份并解除不存在的本地登录关联',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE asset_state(id TEXT PRIMARY KEY,revision INTEGER,data TEXT)');
  db.prepare('INSERT INTO users VALUES (?,?)').run('local-admin','管理员');
  db.prepare('INSERT INTO asset_state VALUES (?,?,?)').run('company',0,JSON.stringify(initial()));
  initOperations(db);
  const source=initial();source.assets.push({...asset(),id:'legacy-1',holder:'张三'});
  const backup={format:'asset-hub-backup',version:1,state:source,extensions:{employees:[{id:'remote-employee',name:'张三',wecomUserId:'A001',department:'IT',active:true,loginUserId:'remote-admin'}],history:[],operations:[],outbox:[]}};
  assert.equal(validateFullBackup(backup),true);restoreExtensions(db,backup);
  assert.deepEqual({...db.prepare('SELECT name,wecomUserId,loginUserId FROM employees WHERE id=?').get('remote-employee')},{name:'张三',wecomUserId:'A001',loginUserId:''});
 }finally{db.close()}
});
test('必填项、编号重复、无效字典和负价格被拒绝',()=>{
 const s=initial();assert.throws(()=>command(s,{action:'save',asset:{...asset(),name:''}},actor),/必填/);
 command(s,{action:'save',asset:asset()},actor);assert.throws(()=>command(s,{action:'save',asset:asset()},actor),/重复/);
 assert.throws(()=>command(initial(),{action:'save',asset:{...asset(),price:-1}},actor),/非负/);
 assert.throws(()=>command(initial(),{action:'save',asset:{...asset(),type:'无效类型'}},actor),/字典/);
});
test('领用、转让、归还在批准后更新台账，产生日志和事件',()=>{
 const s=initial();command(s,{action:'save',asset:asset()},actor);const a=s.assets[0];
 command(s,{action:'request',assetId:a.id,kind:'领用',to:'alice@example.com'},actor);assert.equal(a.holder,'');
 command(s,{action:'approve',id:s.requests[0].id},actor);assert.equal(a.holder,'alice@example.com');assert.equal(a.status,'使用中');assert.equal(s.requests[0].approver,actor);
 command(s,{action:'request',assetId:a.id,kind:'转让',to:'bob@example.com'},actor);command(s,{action:'approve',id:s.requests[1].id},actor);assert.equal(a.holder,'bob@example.com');
 command(s,{action:'request',assetId:a.id,kind:'归还'},actor);command(s,{action:'approve',id:s.requests[2].id},actor);assert.equal(a.status,'未使用');assert.equal(a.holder,'');assert.equal(s.events.length,4);assert.equal(s.logs.length,7);
 assert.throws(()=>command(s,{action:'approve',id:s.requests[0].id},actor),/已处理/);
});
test('已有申请阻止资产编辑，员工不能转让他人的设备',()=>{
 const s=initial();command(s,{action:'save',asset:asset()},actor);const a=s.assets[0];command(s,{action:'request',assetId:a.id,kind:'领用',to:'alice@example.com'},actor);
 assert.throws(()=>command(s,{action:'save',asset:a},actor),/待审批/);command(s,{action:'approve',id:s.requests[0].id},actor);
 assert.throws(()=>command(s,{action:'request',assetId:a.id,kind:'转让',to:'bob@example.com'},'mallory@example.com',true),/本人/);
 assert.throws(()=>command(s,{action:'save',asset:a},'alice@example.com',true),/只允许/);
});
test('仅转让接收人可拒绝，拒绝后申请结束且资产归属不变',()=>{
 const s=initial();command(s,{action:'save',asset:asset()},actor);const a=s.assets[0];
 a.holder='转让人';a.status='使用中';a.holderEmployeeId='employee-from';
 s.requests.push({id:'transfer-1',assetId:a.id,kind:'转让',status:'待接收确认',fromEmployeeId:'employee-from',toEmployeeId:'employee-to',created:'2026-10-13T08:00:00Z'});
 assert.throws(()=>command(s,{action:'rejectTransfer',id:'transfer-1',employeeId:'employee-from'},actor),/仅接收员工/);
 command(s,{action:'rejectTransfer',id:'transfer-1',employeeId:'employee-to'},actor);
 assert.equal(s.requests[0].status,'已拒绝');assert.equal(a.holder,'转让人');
 assert.throws(()=>command(s,{action:'rejectTransfer',id:'transfer-1',employeeId:'employee-to'},actor),/申请不能确认/);
});
test('重复批量导入整批不追加资产，引用字典不可删除',()=>{
 const s=initial();assert.throws(()=>command(s,{action:'import',assets:[asset(),asset()]},actor),/重复/);assert.equal(s.assets.length,0);
 command(s,{action:'save',asset:asset()},actor);assert.throws(()=>command(s,{action:'dictionary',key:'category',value:'固定资产',remove:true},actor),/使用/);
});
test('CSV 支持 BOM、逗号、换行、转义引号，导出防公式注入',()=>{
 assert.deepEqual(parseCSV('\uFEFF名称,备注\r\n"电脑,一","说明\n第二行"\r\n"a""b",c'),[['名称','备注'],['电脑,一','说明\n第二行'],['a"b','c']]);assert.throws(()=>parseCSV('"abc'),/闭合/);assert.equal(csvCell('=1+1'),'"\'=1+1"');
});
test('字典改名同步现有资产，核心状态改名后审批仍正常',()=>{
 const s=initial();command(s,{action:'save',asset:asset()},actor);const a=s.assets[0];
 command(s,{action:'dictionary',key:'category',oldValue:'固定资产',value:'办公固定资产'},actor);assert.equal(a.category,'办公固定资产');
 command(s,{action:'dictionary',key:'status',oldValue:'未使用',value:'闲置'},actor);assert.equal(a.status,'闲置');
 command(s,{action:'dictionary',key:'status',oldValue:'使用中',value:'已领用'},actor);
 command(s,{action:'request',assetId:a.id,kind:'领用',to:'张三'},actor);command(s,{action:'approve',id:s.requests[0].id},actor);assert.equal(a.holder,'张三');assert.equal(a.status,'已领用');
 command(s,{action:'dictionary',key:'status',value:'闲置',remove:true},actor);assert.ok(!s.dictionaries.status.includes('闲置'));
 assert.equal(validateBackup(s).assets[0].holder,'张三');assert.equal(validateBackup(s).requests[0].approver,actor);
});
test('未关联资产的分类和类型可删除，分类页映射保持有效',()=>{
 const s=initial();command(s,{action:'dictionary',key:'category',value:'固定资产',remove:true},actor);
 assert.ok(!s.dictionaries.category.includes('固定资产'));assert.ok(s.dictionaries.category.includes(s.categoryRoles.fixed));
 command(s,{action:'dictionary',key:'type',value:'电视',remove:true},actor);assert.ok(!s.dictionaries.type.includes('电视'));
 assert.equal(validateBackup(s).categoryRoles.fixed,s.categoryRoles.fixed);
});
test('无资产引用的核心状态可删除并保持流程映射及备份有效',()=>{
 const s=initial();command(s,{action:'dictionary',key:'status',value:'未使用',remove:true},actor);
 assert.ok(!s.dictionaries.status.includes('未使用'));assert.equal(s.statusRoles.idle,'闲置');assert.ok(s.dictionaries.status.includes('闲置'));
 assert.equal(validateBackup(s).statusRoles.idle,'闲置');
 command(s,{action:'save',asset:{...asset(),status:'闲置'}},actor);
 assert.throws(()=>command(s,{action:'dictionary',key:'status',value:'闲置',remove:true},actor),/使用/);
});
test('备份恢复支持旧备份与封装备份，拒绝重复编号及非法关联',()=>{
 const s=initial();command(s,{action:'save',asset:asset()},actor);const old=structuredClone(s);delete old.statusRoles;assert.equal(validateBackup(old).assets.length,1);
 const restored=command(initial(),{action:'restore',confirm:'恢复',backup:{format:'asset-hub-backup',version:1,state:s}},actor);assert.equal(restored.assets.length,1);assert.equal(restored.logs[0].action,'restore');
 const bad=structuredClone(s);bad.assets.push({...bad.assets[0],id:'another'});assert.throws(()=>validateBackup(bad),/重复/);
 assert.throws(()=>validateBackup({...s,requests:[{id:'r',assetId:'missing'}]}),/记录错误/);
 assert.throws(()=>validateBackup({format:'asset-hub-backup',version:99,state:s}),/版本/);
 assert.throws(()=>command(initial(),{action:'restore',backup:s},actor),/确认/);
});
test('生产旧备份保留未使用但有领用人的记录，新增编辑仍受校验',()=>{
 const s=initial();command(s,{action:'save',asset:{...asset(),status:'使用中',holder:'张三'}},actor);
 s.assets[0].status='未使用';const legacy=structuredClone(s);
 assert.throws(()=>command(structuredClone(s),{action:'save',asset:s.assets[0]},actor),/未使用资产不能存在领用人/);
 const checked=validateBackup(legacy);assert.equal(checked.assets[0].status,'未使用');assert.equal(checked.assets[0].holder,'张三');
 assert.match(claimBlockReason(checked,checked.assets[0]),/已由张三领用/);
 const restored=command(initial(),{action:'restore',confirm:'恢复',backup:legacy},actor);assert.equal(restored.assets[0].holder,'张三');
});
test('字段配置为空的旧数据可删除展示字段',()=>{
 const s=initial();s.fieldConfig=null;command(s,{action:'field',key:'price',remove:true},actor);
 assert.equal(s.fieldConfig.price.deleted,true);
});
test('旧显示设置为空或字段已删除时回退到可用列',()=>{
 const db=new DatabaseSync(':memory:');try{initPreferences(db);db.prepare('INSERT INTO display_preferences VALUES (?,?)').run('u','null');
  assert.ok(readDisplay(db,'u',initial()).columns.length>0);
  db.prepare('UPDATE display_preferences SET data=? WHERE user_id=?').run(JSON.stringify({columns:['price'],details:null}),'u');
  const s=initial();command(s,{action:'field',key:'price',remove:true},actor);assert.ok(readDisplay(db,'u',s).columns.length>0);
 }finally{db.close()}
});

test('三类资产删除归档、保留历史及备份可恢复，待处理申请禁止删除',()=>{
 for(const category of ['固定资产','易耗品','软件资产']){const s=initial();command(s,{action:'save',asset:{...asset(),category}},actor);const a=s.assets[0];assert.throws(()=>command(s,{action:'delete',id:a.id,confirm:'错误'},actor),/确认/);command(s,{action:'delete',id:a.id,confirm:a.number},actor);assert.equal(s.assets.length,0);assert.equal(s.deletedAssets.length,1);assert.equal(s.events.length,1);assert.equal(validateBackup(s).deletedAssets[0].number,a.number)}
 const s=initial();command(s,{action:'save',asset:asset()},actor);const a=s.assets[0];command(s,{action:'request',assetId:a.id,kind:'领用',to:'员工'},actor);assert.throws(()=>command(s,{action:'delete',id:a.id,confirm:a.number},actor),/待处理/);
});
test('批量删除整批校验、归档并保留流转记录',()=>{
 const s=initial();command(s,{action:'import',assets:[{...asset(),number:'IT-101'},{...asset(),number:'IT-102'},{...asset(),number:'IT-103'}]},actor);
 const ids=s.assets.map(a=>a.id),pending=ids[2];command(s,{action:'request',assetId:pending,kind:'领用',to:'张三'},actor);
 const before=JSON.stringify(s);
 assert.throws(()=>command(s,{action:'bulkDelete',ids,confirm:'批量删除'},actor),/待处理/);assert.equal(JSON.stringify(s),before);
 assert.throws(()=>command(s,{action:'bulkDelete',ids:[ids[0],ids[0]],confirm:'批量删除'},actor),/重复/);
 assert.throws(()=>command(s,{action:'bulkDelete',ids:[ids[0],ids[1]],confirm:'错误'},actor),/确认/);
 command(s,{action:'bulkDelete',ids:ids.slice(0,2),confirm:'批量删除'},actor);
 assert.deepEqual(s.assets.map(a=>a.number),['IT-103']);assert.deepEqual(s.deletedAssets.map(a=>a.number),['IT-101','IT-102']);
 assert.equal(s.requests.length,1);assert.equal(s.logs[0].action,'bulkDelete');assert.equal(validateBackup(s).deletedAssets.length,2);
});

test('审批领用日期使用北京时间，覆盖 UTC 跨日边界',()=>{assert.equal(approvalDate('2026-10-10T16:30:00Z'),'2026-10-11');assert.equal(approvalDate('2026-10-10T15:59:59Z'),'2026-10-10')});

test('导入自动新增四类字典，失败不改变字典',()=>{const s=initial();command(s,{action:'import',assets:[{...asset(),category:'新分类',ownership:'新公司',type:'新类型',status:'维修中'}]},actor);for(const [k,v] of Object.entries({category:'新分类',ownership:'新公司',type:'新类型',status:'维修中'}))assert.ok(s.dictionaries[k].includes(v));const before=JSON.stringify(s);assert.throws(()=>command(s,{action:'import',assets:[{...asset(),category:'不应新增',price:-1}]},actor));assert.equal(JSON.stringify(s),before)});
