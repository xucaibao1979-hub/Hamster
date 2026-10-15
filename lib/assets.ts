export type Asset = {id:string; name:string; number:string; category:string; ownership:string; type:string; status:string; holder:string; holderEmployeeId?:string;holderUserId?:string;holderUsername?:string;received:string; purchased:string; price:number; description:string; notes:string; location:string; serial:string; warranty:string; extras:Record<string,string>; retired?:string;quantity?:number;unit?:string;licenses?:number;expires?:string};
export type RequestItem={id:string;assetId:string;kind:string;from:string;to:string;fromEmployeeId?:string;toEmployeeId?:string;confirmedAt?:string;fromUserId?:string;toUserId?:string;toUsername?:string;reason:string;status:string;created:string;resolved?:string;approver?:string;undoAt?:string;undoBy?:string};
import {validateBackup} from './restore.ts';
export type Store={assets:Asset[]; deletedAssets?:Asset[]; dictionaries:Record<string,string[]>; statusRoles:Record<string,string>; categoryRoles?:Record<string,string>; fields:string[]; fieldConfig?:Record<string,{label?:string;deleted?:boolean;type?:'text'|'number'|'date'|'select';options?:string[]}>; requests:RequestItem[]; logs:{id:string;time:string;actor:string;action:string;detail:string}[]; events:{id:string;time:string;type:string;assetId:string;payload:Asset}[]};
const roles:Record<string,string>={active:'使用中',idle:'未使用',retired:'报废',damaged:'损坏'};
export const statusValue=(s:Store,role:string)=>s.statusRoles?.[role]||roles[role];
export const isIdleStatus=(s:Store,status:string)=>status===statusValue(s,'idle')||(['未使用','闲置','空闲'].includes(status)&&!['active','retired','damaged'].some(role=>status===statusValue(s,role)));
export const effectiveHolder=(a:Asset)=>!a.holderEmployeeId&&!a.holderUserId&&['未使用','闲置'].includes(String(a.holder||'').trim())?'':String(a.holder||'').trim();
export function claimBlockReason(s:Store,a:Asset):string|null{
 if(effectiveHolder(a)||a.holderEmployeeId||a.holderUserId)return `该资产已由${effectiveHolder(a)||'其他员工'}领用`;
 if(s.requests.some(r=>r.assetId===a.id&&['待审批','待接收确认'].includes(r.status)))return '该资产已有待处理申请';
 if(!isIdleStatus(s,a.status))return `当前设备状态为${a.status}，只有未使用、闲置或空闲资产可以申请领用`;
 return null;
}
const categoryDefaults:Record<string,string>={fixed:'固定资产',consumable:'易耗品',software:'软件资产'};
export const categoryValue=(s:Store,role:string)=>s.categoryRoles?.[role]||categoryDefaults[role];
export const initial=():Store=>({assets:[],dictionaries:{category:['固定资产','易耗品','软件资产'],ownership:[],type:['电脑','笔记本','平板','手机','服务器','显示器','打印机','电视','其他'],status:['使用中','未使用','报废','损坏']},statusRoles:{...roles},categoryRoles:{...categoryDefaults},fields:[],requests:[],logs:[],events:[]});
export const approvalDate=(time:string)=>new Date(new Date(time).getTime()+8*60*60*1000).toISOString().slice(0,10);
export const labels:Record<string,string>={name:'名称',number:'资产编号',serial:'序列号',category:'资产分类',ownership:'资产归属',type:'设备类型',status:'设备状态',holder:'领用人',received:'领用日期',purchased:'购入日期',price:'价格',description:'描述',notes:'备注'};
function requireValue(ok:unknown,message:string):asserts ok {if(!ok)throw new Error(message)}
export function validateAsset(raw:any,s:Store,options:{allowLegacyIdleHolder?:boolean}={}):Asset{
 requireValue(raw&&typeof raw==='object','资产格式错误');
 const a:any={id:typeof raw.id==='string'?raw.id:crypto.randomUUID(),extras:{}};
 for(const key of Object.keys(labels)){if(key==='price')continue;a[key]=String(raw[key]??'').trim();requireValue(a[key].length<=2000,`${labels[key]}过长`)}
 requireValue(a.name&&a.number,'名称和资产编号必填');requireValue(a.number.length<=100,'资产编号最多 100 字');
 a.price=Number(raw.price||0);requireValue(Number.isFinite(a.price)&&a.price>=0&&a.price<=1e12,'价格必须是有效的非负金额');a.price=Math.round(a.price*100)/100;
 for(const key of ['category','ownership','type','status'])requireValue(!a[key]||s.dictionaries[key].includes(a[key]),`${labels[key]}不在字典中`);
 requireValue(a.status,'请选择设备状态');
 for(const key of ['received','purchased'])if(a[key])requireValue(/^\d{4}-\d{2}-\d{2}$/.test(a[key])&&Number.isFinite(Date.parse(a[key]))&&new Date(a[key]).toISOString().slice(0,10)===a[key],`${labels[key]}无效`);
 // 保留旧记录的隐藏字段，避免编辑或恢复旧备份时丢失历史数据。
 for(const k of ['quantity','licenses']){a[k]=Number(raw[k]??1);requireValue(Number.isInteger(a[k])&&a[k]>=0&&a[k]<=100000000,`${k==='quantity'?'库存数量':'授权数量'}必须是非负整数`)}a.unit=String(raw.unit||'件').slice(0,30);a.expires=String(raw.expires||'');if(a.expires)requireValue(/^\d{4}-\d{2}-\d{2}$/.test(a.expires)&&Number.isFinite(Date.parse(a.expires))&&new Date(a.expires).toISOString().slice(0,10)===a.expires,'授权到期日无效');
 a.location=String(raw.location??'').slice(0,2000);a.warranty=String(raw.warranty??'').slice(0,50);
 a.holderEmployeeId=String(raw.holderEmployeeId||'');requireValue(a.holderEmployeeId.length<=100,'员工标识无效');
 a.holderUserId=String(raw.holderUserId||'');a.holderUsername=String(raw.holderUsername||'');requireValue(a.holderUserId.length<=100&&a.holderUsername.length<=100,'领用账号无效');requireValue(!a.holderUserId||a.holder,'关联用户必须有领用人');
 requireValue(a.status!==statusValue(s,'active')||a.holder,'使用中的资产必须填写领用人');requireValue(a.status!==statusValue(s,'idle')||!a.holder||options.allowLegacyIdleHolder,'未使用资产不能存在领用人');
 for(const f of s.fields){const value=String(raw.extras?.[f]??'').trim().slice(0,2000),rule=s.fieldConfig?.['extra:'+f];if(value&&rule?.type==='number')requireValue(Number.isFinite(Number(value)),`${rule.label||f}必须填写数字`);if(value&&rule?.type==='date')requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,`${rule.label||f}必须填写有效日期`);if(value&&rule?.type==='select')requireValue(!!rule.options?.includes(value),`${rule.label||f}不在可选项中`);a.extras[f]=value}
 if(a.status===statusValue(s,'retired'))a.retired=raw.retired||new Date().toISOString().slice(0,10);
 return a;
}
export function importDictionaries(s:Store,list:any[]):Store{
 const next={...s,dictionaries:Object.fromEntries(Object.entries(s.dictionaries).map(([k,v])=>[k,[...v]]))};
 for(const raw of list)for(const key of ['category','ownership','type','status']){const value=String(raw?.[key]??'').trim();requireValue(value.length<=60,'字典值最多60字');if(value&&!next.dictionaries[key].includes(value)){requireValue(next.dictionaries[key].length<500,'字典最多500项');next.dictionaries[key].push(value)}}return next;
}
export function command(s:Store,c:any,actor:string,employee=false):Store{
 const time=new Date().toISOString();let detail='';let action=c.action;let changed:Asset[]=[];
 requireValue(c&&typeof c.action==='string','操作无效');
 if(employee)requireValue(c.action==='request','员工接口只允许提交申请');
 if(action==='save'||action==='import'){
  const list=action==='save'?[c.asset]:c.assets;requireValue(Array.isArray(list)&&list.length>0&&list.length<=2000,'一次最多导入 2000 条资产');
  const importState=action==='import'?importDictionaries(s,list):s;const values:Asset[]=list.map((x:any)=>validateAsset(x,importState));const numbers=new Set(s.assets.filter(a=>action==='import'||a.id!==values[0].id).map(a=>a.number));
  for(const a of values){requireValue(!numbers.has(a.number),`资产编号重复：${a.number}`);numbers.add(a.number)}
  if(action==='save'){const old=s.assets.find(a=>a.id===values[0].id);if(old){requireValue(!s.requests.some(r=>r.assetId===old.id&&['待审批','待接收确认'].includes(r.status)),'该资产有待审批申请，请先处理');s.assets=s.assets.map(a=>a.id===old.id?values[0]:a)}else s.assets.push(values[0]);}else {for(const a of values)a.id=crypto.randomUUID();s.assets.push(...values)}
  s.dictionaries=importState.dictionaries;changed=values;detail=`保存 ${values.length} 条资产`; 
 }else if(action==='delete'){
  const a=s.assets.find(a=>a.id===c.id);requireValue(a,'资产不存在');requireValue(c.confirm===a.number,'请确认要删除的资产');requireValue(!s.requests.some(r=>r.assetId===a.id&&['待审批','待接收确认'].includes(r.status)),'该资产有待处理流转申请，请先处理');s.deletedAssets??=[];s.deletedAssets.push(structuredClone(a));s.assets=s.assets.filter(x=>x.id!==a.id);detail=`删除资产：${a.number} · ${a.name}`;
 }else if(action==='bulkDelete'){
  requireValue(Array.isArray(c.ids)&&c.ids.length>=2&&c.ids.length<=1000&&c.ids.every((id:unknown)=>typeof id==='string'),'每次可批量删除 2–1000 条资产');
  const ids=new Set<string>(c.ids);requireValue(ids.size===c.ids.length,'所选资产存在重复');requireValue(c.confirm==='批量删除','请确认批量删除');
  const targets=s.assets.filter(a=>ids.has(a.id));requireValue(targets.length===ids.size,'所选资产中有记录不存在，请刷新后重试');
  const pending=s.requests.find(r=>ids.has(r.assetId)&&['待审批','待接收确认'].includes(r.status));requireValue(!pending,`资产 ${targets.find(a=>a.id===pending?.assetId)?.number||''} 有待处理流转申请，请先处理`);
  requireValue((s.deletedAssets?.length||0)+targets.length<=10000,'删除归档已达上限，请先备份并联系管理员');
  s.deletedAssets??=[];s.deletedAssets.push(...targets.map(a=>structuredClone(a)));s.assets=s.assets.filter(a=>!ids.has(a.id));detail=`批量删除 ${targets.length} 条资产：${targets.slice(0,10).map(a=>a.number).join('、')}${targets.length>10?' 等':''}`;
 }else if(action==='dictionary'){
  requireValue(Object.hasOwn(s.dictionaries,c.key),'字典无效');const value=String(c.value||'').trim();requireValue(value&&value.length<=60,'字典值需为 1–60 字');
  if(c.oldValue!==undefined){const old=String(c.oldValue);requireValue(s.dictionaries[c.key].includes(old),'原字典值不存在');requireValue(old===value||!s.dictionaries[c.key].includes(value),'字典值已存在');
   if(c.key==='category'){s.categoryRoles={...categoryDefaults,...s.categoryRoles};for(const role of Object.keys(categoryDefaults))if(s.categoryRoles[role]===old)s.categoryRoles[role]=value}
   if(c.key==='status'){s.statusRoles={...roles,...s.statusRoles};for(const role of Object.keys(roles))if(s.statusRoles[role]===old)s.statusRoles[role]=value}
   s.dictionaries[c.key]=s.dictionaries[c.key].map(v=>v===old?value:v);for(const a of s.assets)if((a as any)[c.key]===old){(a as any)[c.key]=value;changed.push(a)}detail=`${labels[c.key]}：${old} → ${value}（同步 ${changed.length} 条资产）`;
  }else if(c.remove){requireValue(s.dictionaries[c.key].includes(value),'字典值不存在');requireValue(!s.assets.some((a:any)=>a[c.key]===value),'已有资产使用该字典值');s.dictionaries[c.key]=s.dictionaries[c.key].filter(v=>v!==value);if(c.key==='status'){const role=Object.keys(roles).find(r=>statusValue(s,r)===value);if(role){const used=new Set(Object.entries(s.statusRoles).filter(([r])=>r!==role).map(([,v])=>v));let replacement=s.dictionaries.status.find(v=>!used.has(v));if(!replacement){const alternatives:Record<string,string[]>={active:['在用','已领用'],idle:['闲置','空闲'],retired:['已报废','淘汰'],damaged:['异常','故障']};replacement=alternatives[role].find(v=>v!==value&&!s.dictionaries.status.includes(v));requireValue(replacement,'没有可替换的流程状态');s.dictionaries.status.push(replacement)}s.statusRoles[role]=replacement}}if(c.key==='category'){s.categoryRoles={...categoryDefaults,...s.categoryRoles};const role=Object.keys(categoryDefaults).find(r=>s.categoryRoles?.[r]===value);if(role){const used=new Set(Object.entries(s.categoryRoles).filter(([r])=>r!==role).map(([,v])=>v));let replacement=s.dictionaries.category.find(v=>!used.has(v));if(!replacement){replacement=`其他${value}`;requireValue(replacement.length<=60,'没有可替换的资产分类');s.dictionaries.category.push(replacement)}s.categoryRoles[role]=replacement}}detail=`删除 ${labels[c.key]}：${value}`}else {requireValue(!s.dictionaries[c.key].includes(value),'字典值已存在');s.dictionaries[c.key].push(value);detail=`${labels[c.key]}：${value}`}
 }else if(action==='field'){
  const builtin=[...Object.keys(labels),'quantity','unit','licenses','expires'];const key=String(c.key||'');const value=String(c.value||'').trim();if(!s.fieldConfig||typeof s.fieldConfig!=='object'||Array.isArray(s.fieldConfig))s.fieldConfig={};
  const fieldType=String(c.fieldType||key&&s.fieldConfig[key]?.type||'text');requireValue(['text','number','date','select'].includes(fieldType),'字段类型无效');const options=fieldType==='select'?String(c.options||s.fieldConfig[key]?.options?.join(',')||'').split(/[,，\n]/).map((v:string)=>v.trim()).filter(Boolean):[];if(fieldType==='select'&&!c.remove)requireValue(options.length>=2&&options.length<=30&&options.every((v:string)=>v.length<=60)&&new Set(options).size===options.length,'单选项需为 2–30 个不重复的值');
  if(key){requireValue(builtin.includes(key)||key.startsWith('extra:')&&s.fields.includes(key.slice(6)),'字段不存在');if(c.remove){requireValue(!['name','number','status','holder'].includes(key),'必填及流转字段不能删除');s.fieldConfig[key]={...s.fieldConfig[key],deleted:true};detail=`删除展示字段：${key}`}else{requireValue(value&&value.length<=40,'字段名称需为 1–40 字');requireValue(![...builtin,...s.fields.map(f=>'extra:'+f)].some(k=>k!==key&&!s.fieldConfig?.[k]?.deleted&&(s.fieldConfig?.[k]?.label||(k.startsWith('extra:')?k.slice(6):labels[k]))===value),'字段名称已存在');s.fieldConfig[key]=key.startsWith('extra:')?{...s.fieldConfig[key],label:value,deleted:false,type:fieldType as 'text'|'number'|'date'|'select',options}:{...s.fieldConfig[key],label:value,deleted:false};for(const a of s.assets)validateAsset(a,s,{allowLegacyIdleHolder:true});detail=`修改字段：${key} → ${value}`}}
  else{requireValue(value&&value.length<=40&&!['__proto__','constructor','prototype'].includes(value)&&!s.fields.includes(value)&&!Object.values(labels).includes(value),'字段名称为空、过长或已存在');s.fields.push(value);s.fieldConfig['extra:'+value]={label:value,type:fieldType as 'text'|'number'|'date'|'select',options};detail=`新增字段：${value}`;}
 }else if(action==='request'){
  const a=s.assets.find(a=>a.id===c.assetId);requireValue(a,'资产不存在');requireValue(!s.requests.some(r=>r.assetId===a.id&&['待审批','待接收确认'].includes(r.status)),'该资产已有待审批申请');requireValue(['领用','归还','转让','报废'].includes(c.kind),'申请类型无效');
  const to=['归还','报废'].includes(c.kind)?'':String(employee&&c.kind==='领用'?actor:c.to||'').trim();requireValue(to.length<=2000,'接收人信息过长');
  if(c.kind==='报废')requireValue(a.status!==statusValue(s,'retired'),'资产已报废');else if(c.kind==='领用'){requireValue(!claimBlockReason(s,a),claimBlockReason(s,a)||'资产不可领用');requireValue(to,'领用申请人不能为空')}else {requireValue(a.status===statusValue(s,'active')&&a.holder,'仅可归还或转让使用中资产');if(employee)requireValue((a.holderUsername||a.holder)===actor,'仅可操作本人名下资产');if(c.kind==='转让')requireValue(to&&(c.toEmployeeId&&a.holderEmployeeId?c.toEmployeeId!==a.holderEmployeeId:c.toUserId&&a.holderUserId?c.toUserId!==a.holderUserId:to!==a.holder),'接收人必须与当前领用人不同')}
  s.requests.push({id:crypto.randomUUID(),assetId:a.id,kind:c.kind,from:c.kind==='领用'?effectiveHolder(a):a.holder,to,fromEmployeeId:a.holderEmployeeId||'',toEmployeeId:c.toEmployeeId||'',fromUserId:a.holderUserId||'',toUserId:c.toUserId||'',toUsername:c.toUsername||'',reason:String(c.reason||'').slice(0,2000),status:c.kind==='转让'&&c.toEmployeeId?'待接收确认':'待审批',created:time});detail=`${a.number} · ${c.kind}`;
 }else if(action==='confirmTransfer'||action==='rejectTransfer'){const r=s.requests.find(r=>r.id===c.id);requireValue(r&&r.kind==='转让'&&r.status==='待接收确认','申请不能确认');requireValue(c.employeeId&&r.toEmployeeId===c.employeeId,'仅接收员工可确认');if(action==='confirmTransfer'){r.status='待审批';r.confirmedAt=time;detail='接收人确认转让'}else{r.status='已拒绝';r.resolved=time;detail='接收人拒绝转让'}
 }else if(action==='approve'||action==='reject'){
  const r=s.requests.find(r=>r.id===c.id);requireValue(r&&(action==='reject'?['待审批','待接收确认'].includes(r.status):r.status==='待审批'),'申请已处理或不存在');const a=s.assets.find(a=>a.id===r.assetId);requireValue(a,'资产不存在');
  if(action==='approve'){requireValue((r.fromEmployeeId&&a.holderEmployeeId?r.fromEmployeeId===a.holderEmployeeId:r.fromUserId&&a.holderUserId?r.fromUserId===a.holderUserId:(r.kind==='领用'?effectiveHolder(a):a.holder)===r.from)&&(r.kind==='报废'?a.status!==statusValue(s,'retired'):r.kind==='领用'?isIdleStatus(s,a.status)&&!effectiveHolder(a)&&!a.holderEmployeeId&&!a.holderUserId:a.status===statusValue(s,'active')),'资产状态已改变，请重新申请');a.holder=r.to;a.holderEmployeeId=['归还','报废'].includes(r.kind)?'':r.toEmployeeId||'';a.holderUserId=['归还','报废'].includes(r.kind)?'':r.toUserId||'';a.holderUsername=['归还','报废'].includes(r.kind)?'':r.toUsername||'';a.status=r.kind==='报废'?statusValue(s,'retired'):r.kind==='归还'?statusValue(s,'idle'):statusValue(s,'active');a.received=['归还','报废'].includes(r.kind)?'':approvalDate(time);if(r.kind==='报废')a.retired=time.slice(0,10);changed=[a];r.status='已批准'}else r.status='已拒绝';r.resolved=time;r.approver=actor;detail=`${a.number} · ${r.kind} · ${r.status}`;
 }else if(action==='restore'){const restored=validateBackup(c.backup);requireValue(c.confirm==='恢复','请确认恢复操作');restored.logs.unshift({id:crypto.randomUUID(),time,actor,action:'restore',detail:`恢复备份：${restored.assets.length} 条资产`});return restored;
 }else if(action==='clearLogs'){requireValue(c.confirm==='清空','请输入清空确认');detail=`清空操作记录：${s.logs.length} 条`;s.logs=[];
 }else throw new Error('不支持的操作');
 requireValue(s.assets.length<=10000,'当前版本最多支持 10000 条资产');
 s.logs.unshift({id:crypto.randomUUID(),time,actor,action,detail});
 for(const a of changed)s.events.push({id:crypto.randomUUID(),time,type:'asset.updated',assetId:a.id,payload:structuredClone(a)});
 return s;
}


