import {initial,statusValue} from '../lib/assets.ts';
import {defaultDisplay,displayKeys,validateDisplay} from '../lib/display.ts';
export function initPreferences(db){db.exec('CREATE TABLE IF NOT EXISTS display_preferences (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);')}
export function readDisplay(db,userId,state){const row=db.prepare('SELECT data FROM display_preferences WHERE user_id=?').get(userId);const parsed=row?JSON.parse(row.data):null;const raw=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:defaultDisplay();const allowed=new Set(displayKeys(state));const defaults=defaultDisplay();return Object.fromEntries(['columns','details',...(Array.isArray(raw.editDetails)?['editDetails']:[])].map(k=>{const values=Array.isArray(raw[k])?raw[k].filter(v=>allowed.has(v)):[];return [k,values.length?values:defaults[k].filter(v=>allowed.has(v))]}))}
export function saveDisplay(db,userId,raw,state){const prefs=validateDisplay(raw,state);db.prepare('INSERT INTO display_preferences (user_id,data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data').run(userId,JSON.stringify(prefs));return prefs}
export const directory=db=>db.prepare("SELECT e.id,e.name,e.active AS enabled,e.wecomUserId,e.department,e.loginUserId,COALESCE(u.username,'') AS username FROM employees e LEFT JOIN users u ON u.id=e.loginUserId").all();
export function hydrate(state,users){const map=new Map(users.map(u=>[u.id,u]));return {...state,assets:state.assets.map(a=>{const u=map.get(a.holderEmployeeId||a.holderUserId);return u?{...a,holder:u.name,holderEmployeeId:u.id,holderUserId:u.loginUserId||'',holderUsername:u.username||''}:a})}}
export function ownAssets(state,user,people=[]){
 const name=String(user.name||'').trim();
 const uniqueName=!!user.employeeId&&!!name&&people.filter(e=>e.enabled&&e.name.trim()===name).length===1;
 return state.assets.filter(a=>a.holderEmployeeId?!!user.employeeId&&a.holderEmployeeId===user.employeeId:a.holderUserId?a.holderUserId===user.id:uniqueName&&!a.holderUsername&&String(a.holder||'').trim()===name);
}
export function scopedState(state,user){
 if(user.role==='admin')return state;
 const assets=ownAssets(state,user);const base=initial();const dictionaries={...state.dictionaries};
 for(const k of ['category','ownership','type'])dictionaries[k]=state.dictionaries[k].filter(v=>assets.some(a=>a[k]===v)||base.dictionaries[k].includes(v));
 return {...state,deletedAssets:[],assets,dictionaries,requests:state.requests.filter(r=>(!!user.employeeId&&(r.toEmployeeId===user.employeeId||r.fromEmployeeId===user.employeeId))||r.toUserId===user.id||r.fromUserId===user.id),logs:[],events:[]};
}
function resolveRecipient(db,raw,old){
 const people=directory(db),id=String(raw.holderEmployeeId||''),legacy=String(raw.holderUserId||''),username=String(raw.holderUsername||'').trim().toLowerCase(),wecom=String(raw.wecomUserId||'');
 let user=id?people.find(e=>e.id===id):legacy?people.find(e=>e.loginUserId===legacy):wecom?people.find(e=>e.wecomUserId===wecom):username?people.find(e=>e.username===username):null;
 if(id||legacy||username||wecom){if(!user||!user.enabled&&old?.holderEmployeeId!==user.id&&old?.holderUserId!==user.loginUserId)throw new Error('关联员工不存在或已离职');return {...raw,holderEmployeeId:user.id,holderUserId:user.loginUserId||'',holderUsername:user.username,holder:user.name}}
 const matches=people.filter(e=>e.enabled&&e.name===String(raw.holder||'').trim());if(matches.length>1)throw new Error('领用人存在重名，请展开身份关联并指定企业微信 UserID');if(matches.length===1)return {...raw,holderEmployeeId:matches[0].id,holderUserId:matches[0].loginUserId||'',holderUsername:matches[0].username,holder:matches[0].name};
 return {...raw,holderEmployeeId:'',holderUserId:'',holderUsername:''};
}
export function resolveCommand(db,state,input){
 if(input.action==='save'){
  const old=state.assets.find(a=>a.id===input.asset?.id),asset=resolveRecipient(db,input.asset,old);
  if(old&&old.status===statusValue(state,'retired')&&asset.status!==old.status)throw new Error('已报废资产不能直接恢复使用');
  if(old?.holderEmployeeId&&old.status===statusValue(state,'active')&&asset.status===statusValue(state,'idle'))throw new Error('归还请通过验收流程处理');
  return {...input,asset};
 }
 if(input.action==='approve'){const r=state.requests.find(r=>r.id===input.id);if(r?.toEmployeeId&&!directory(db).some(e=>e.id===r.toEmployeeId&&e.enabled))throw new Error('接收员工已离职，请拒绝申请后重新提交')}
 if(input.action==='import'){if(!Array.isArray(input.assets))throw new Error('导入数据无效');return {...input,assets:input.assets.map(a=>resolveRecipient(db,a,null))}}
 if(input.action==='request'&&!['归还','报废'].includes(input.kind)){
  const id=String(input.toUserId||'');const username=String(input.toUsername||input.to||'').trim().toLowerCase();
  const user=directory(db).find(e=>e.enabled&&(input.toEmployeeId?e.id===input.toEmployeeId:id?e.loginUserId===id:e.username===username));
  if(!user)throw new Error('请先同步企业微信通讯录，再选择接收人');if(input.kind==='转让'&&!user.loginUserId&&!user.wecomUserId)throw new Error('接收员工需关联登录账号或企业微信 UserID 才能确认转让');return {...input,toEmployeeId:user.id,toUserId:user.loginUserId||'',toUsername:user.username,to:user.name};
 }
 return input;
}
