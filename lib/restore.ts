import { initial, validateAsset, statusValue, type Store } from './assets.ts';
const ensure=(ok:unknown,message:string)=>{if(!ok)throw new Error('备份无效：'+message)};
export function validateBackup(input:any):Store{
 if(input?.format==='asset-hub-backup')ensure(input.version===1,'备份版本不支持');
 const raw=input?.format==='asset-hub-backup'?input.state:input;
 ensure(raw&&typeof raw==='object','格式错误');
 const s=initial();
 for(const key of Object.keys(s.dictionaries)){
  const values=raw.dictionaries?.[key];ensure(Array.isArray(values)&&values.length<=500,'字典缺失或过大');
  ensure(values.every((v:any)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=60)&&new Set(values).size===values.length,'字典值无效或重复');s.dictionaries[key]=values;
 }
 if(raw.fieldConfig){ensure(typeof raw.fieldConfig==='object'&&!Array.isArray(raw.fieldConfig)&&Object.entries(raw.fieldConfig).every(([k,v]:any)=>!['__proto__','constructor','prototype'].includes(k)&&v&&typeof v==='object'&&(!v.label||typeof v.label==='string'&&v.label.length<=40)&&(!v.deleted||!['name','number','status','holder'].includes(k))&&(!v.type||k.startsWith('extra:')&&['text','number','date','select'].includes(v.type))&&(!v.options||Array.isArray(v.options)&&v.options.length<=30&&v.options.every((x:any)=>typeof x==='string'&&x.length>0&&x.length<=60))),'字段配置无效');s.fieldConfig=raw.fieldConfig}
 if(raw.categoryRoles){ensure(typeof raw.categoryRoles==='object'&&Object.keys(raw.categoryRoles).every(k=>['fixed','consumable','software'].includes(k))&&Object.values(raw.categoryRoles).every(v=>typeof v==='string'&&v.length<=60),'分类映射无效');s.categoryRoles=raw.categoryRoles}
 s.statusRoles=raw.statusRoles||s.statusRoles;
 ensure(s.statusRoles&&typeof s.statusRoles==='object','状态映射无效');
 for(const role of ['active','idle','retired','damaged'])ensure(typeof s.statusRoles[role]==='string'&&s.dictionaries.status.includes(s.statusRoles[role]),'核心状态缺失');
 ensure(new Set(Object.values(s.statusRoles)).size===4&&Object.keys(s.statusRoles).length===4,'核心状态映射重复');
 ensure(Array.isArray(raw.fields)&&raw.fields.length<=100,'自定义字段无效');
 ensure(raw.fields.every((v:any)=>typeof v==='string'&&v.length>0&&v.length<=40&&!['__proto__','prototype','constructor'].includes(v))&&new Set(raw.fields).size===raw.fields.length,'自定义字段重复或无效');s.fields=raw.fields;
 ensure(Array.isArray(raw.assets)&&raw.assets.length<=10000,'资产列表无效或过大');
 s.assets=raw.assets.map((a:any)=>{ensure(typeof a.id==='string'&&a.id.length>0&&a.id.length<=100,'资产 ID 缺失');return validateAsset(a,s,{allowLegacyIdleHolder:true})});
 ensure(new Set(s.assets.map(a=>a.id)).size===s.assets.length&&new Set(s.assets.map(a=>a.number)).size===s.assets.length,'资产 ID 或编号重复');
 ensure(!raw.deletedAssets||Array.isArray(raw.deletedAssets)&&raw.deletedAssets.length<=10000,'删除归档无效');const deleted=(raw.deletedAssets||[]).map((a:any)=>{const historical={...s,dictionaries:{...s.dictionaries}};for(const k of ['category','ownership','type','status'])historical.dictionaries[k]=[...new Set([...s.dictionaries[k],String(a[k]||'')])];return validateAsset(a,historical,{allowLegacyIdleHolder:true})});s.deletedAssets=deleted;ensure(new Set([...s.assets,...deleted].map(a=>a.id)).size===s.assets.length+deleted.length,'删除归档 ID 重复');
 const ids=new Set([...s.assets,...deleted].map(a=>a.id));
 ensure(Array.isArray(raw.requests)&&raw.requests.length<=50000,'申请列表无效');
 const text=(v:any,max=2000)=>typeof v==='string'&&v.length<=max;
 const date=(v:any)=>text(v,50)&&Number.isFinite(Date.parse(v));
 s.requests=raw.requests.map((r:any)=>{ensure(r&&text(r.id,100)&&r.id&&ids.has(r.assetId)&&['领用','归还','转让','报废'].includes(r.kind)&&['待审批','待接收确认','已批准','已拒绝','已撤销'].includes(r.status)&&text(r.from)&&text(r.to)&&text(r.reason)&&date(r.created)&&(!r.resolved||date(r.resolved))&&(!r.approver||text(r.approver,200))&&(!r.undoAt||date(r.undoAt))&&(!r.undoBy||text(r.undoBy,200)),'流转申请记录错误');return {id:r.id,assetId:r.assetId,kind:r.kind,from:r.from,to:r.to,fromEmployeeId:String(r.fromEmployeeId||'').slice(0,100),toEmployeeId:String(r.toEmployeeId||'').slice(0,100),...(r.confirmedAt?{confirmedAt:r.confirmedAt}:{}),fromUserId:String(r.fromUserId||'').slice(0,100),toUserId:String(r.toUserId||'').slice(0,100),toUsername:String(r.toUsername||'').slice(0,100),reason:r.reason,status:r.status,created:r.created,...(r.resolved?{resolved:r.resolved}:{}),...(r.approver?{approver:r.approver}:{}),...(r.undoAt?{undoAt:r.undoAt}:{}),...(r.undoBy?{undoBy:r.undoBy}:{})}});
 ensure(new Set(s.requests.map(r=>r.id)).size===s.requests.length,'申请 ID 重复');
 const pending=s.requests.filter(r=>['待审批','待接收确认'].includes(r.status));ensure(new Set(pending.map(r=>r.assetId)).size===pending.length,'资产存在重复待审批申请');
 for(const r of pending){const a=s.assets.find(a=>a.id===r.assetId)!;ensure((r.kind==='报废'||(r.fromEmployeeId&&a.holderEmployeeId?r.fromEmployeeId===a.holderEmployeeId:a.holder===r.from))&&(r.kind==='报废'?a.status!==statusValue(s,'retired'):r.kind==='领用'?a.status===statusValue(s,'idle')&&!r.from&&!!r.to:a.status===statusValue(s,'active')&&!!r.from)&&(['归还','报废'].includes(r.kind)?!r.to:(r.toEmployeeId&&r.fromEmployeeId?r.toEmployeeId!==r.fromEmployeeId:r.toUserId&&r.fromUserId?r.toUserId!==r.fromUserId:r.to!==r.from)),'待审批申请与资产状态不一致')}
 ensure(Array.isArray(raw.logs)&&raw.logs.length<=100000,'日志列表无效');
 s.logs=raw.logs.map((l:any)=>{ensure(l&&text(l.id,100)&&l.id&&date(l.time)&&text(l.actor)&&text(l.action,60)&&text(l.detail),'日志记录错误');return {id:l.id,time:l.time,actor:l.actor,action:l.action,detail:l.detail}});
 ensure(new Set(s.logs.map(l=>l.id)).size===s.logs.length,'日志 ID 重复');
 ensure(Array.isArray(raw.events)&&raw.events.length<=100000,'事件列表无效');
 s.events=raw.events.map((e:any)=>{ensure(e&&text(e.id,100)&&e.id&&date(e.time)&&e.type==='asset.updated'&&ids.has(e.assetId)&&e.payload?.id===e.assetId,'事件记录错误');const historical={...s,dictionaries:{...s.dictionaries}};for(const k of ['category','ownership','type','status'])historical.dictionaries[k]=[...new Set([...s.dictionaries[k],String(e.payload[k]||'')])];return {id:e.id,time:e.time,type:e.type,assetId:e.assetId,payload:validateAsset(e.payload,historical,{allowLegacyIdleHolder:true})}});
 ensure(new Set(s.events.map(e=>e.id)).size===s.events.length,'事件 ID 重复');return s;
}


