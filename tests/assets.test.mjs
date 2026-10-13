import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,command,approvalDate} from '../lib/assets.ts';
import {validateBackup} from '../lib/restore.ts';
import {parseCSV,csvCell} from '../lib/csv.ts';
const actor='admin@example.com';
const asset=()=>({name:'测试电脑',number:'IT-001',category:'固定资产',ownership:'',type:'电脑',status:'未使用',holder:'',purchased:'2026-10-10',price:8000});
test('必填项、编号重复、无效字典和负价格被拒绝',()=>{
 const s=initial();assert.throws(()=>command(s,{action:'save',asset:{...asset(),name:''}},actor),/必填/);
 command(s,{action:'save',asset:asset()},actor);assert.throws(()=>command(s,{action:'save',asset:asset()},actor),/重复/);
 assert.throws(()=>command(initial(),{action:'save',asset:{...asset(),price:-1}},actor),/非负/);
 assert.throws(()=>command(initial(),{action:'save',asset:{...asset(),type:'无效类型'}},actor),/字典/);
});
test('领用、转让、归还在批准后更新台账，产生日志和事件',()=>{
 const s=initial();command(s,{action:'save',asset:asset()},actor);const a=s.assets[0];
 command(s,{action:'request',assetId:a.id,kind:'领用',to:'alice@example.com'},actor);assert.equal(a.holder,'');
 command(s,{action:'approve',id:s.requests[0].id},actor);assert.equal(a.holder,'alice@example.com');assert.equal(a.status,'使用中');
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
 assert.throws(()=>command(s,{action:'dictionary',key:'status',value:'闲置',remove:true},actor),/核心/);
 assert.equal(validateBackup(s).assets[0].holder,'张三');
});
test('备份恢复支持旧备份与封装备份，拒绝重复编号及非法关联',()=>{
 const s=initial();command(s,{action:'save',asset:asset()},actor);const old=structuredClone(s);delete old.statusRoles;assert.equal(validateBackup(old).assets.length,1);
 const restored=command(initial(),{action:'restore',confirm:'恢复',backup:{format:'asset-hub-backup',version:1,state:s}},actor);assert.equal(restored.assets.length,1);assert.equal(restored.logs[0].action,'restore');
 const bad=structuredClone(s);bad.assets.push({...bad.assets[0],id:'another'});assert.throws(()=>validateBackup(bad),/重复/);
 assert.throws(()=>validateBackup({...s,requests:[{id:'r',assetId:'missing'}]}),/记录错误/);
 assert.throws(()=>validateBackup({format:'asset-hub-backup',version:99,state:s}),/版本/);
 assert.throws(()=>command(initial(),{action:'restore',backup:s},actor),/确认/);
});

test('三类资产删除归档、保留历史及备份可恢复，待处理申请禁止删除',()=>{
 for(const category of ['固定资产','易耗品','软件资产']){const s=initial();command(s,{action:'save',asset:{...asset(),category}},actor);const a=s.assets[0];assert.throws(()=>command(s,{action:'delete',id:a.id,confirm:'错误'},actor),/确认/);command(s,{action:'delete',id:a.id,confirm:a.number},actor);assert.equal(s.assets.length,0);assert.equal(s.deletedAssets.length,1);assert.equal(s.events.length,1);assert.equal(validateBackup(s).deletedAssets[0].number,a.number)}
 const s=initial();command(s,{action:'save',asset:asset()},actor);const a=s.assets[0];command(s,{action:'request',assetId:a.id,kind:'领用',to:'员工'},actor);assert.throws(()=>command(s,{action:'delete',id:a.id,confirm:a.number},actor),/待处理/);
});

test('审批领用日期使用北京时间，覆盖 UTC 跨日边界',()=>{assert.equal(approvalDate('2026-10-10T16:30:00Z'),'2026-10-11');assert.equal(approvalDate('2026-10-10T15:59:59Z'),'2026-10-10')});

test('导入自动新增四类字典，失败不改变字典',()=>{const s=initial();command(s,{action:'import',assets:[{...asset(),category:'新分类',ownership:'新公司',type:'新类型',status:'维修中'}]},actor);for(const [k,v] of Object.entries({category:'新分类',ownership:'新公司',type:'新类型',status:'维修中'}))assert.ok(s.dictionaries[k].includes(v));const before=JSON.stringify(s);assert.throws(()=>command(s,{action:'import',assets:[{...asset(),category:'不应新增',price:-1}]},actor));assert.equal(JSON.stringify(s),before)});
