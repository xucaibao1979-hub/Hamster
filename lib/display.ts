import {labels,type Store} from './assets.ts';
export type DisplayPreferences={columns:string[];details:string[];editDetails?:string[]};
export const detailOrder=['ownership','name','number','purchased','price','status','serial','category','type','holder','received','description','notes'];
export const defaultDisplay=():DisplayPreferences=>({columns:['name','number','category','type','ownership','status','holder','price'],details:[...detailOrder,'quantity','unit','licenses','expires'],editDetails:[...detailOrder,'quantity','unit','licenses','expires']});
export const fieldName=(key:string,s?:Store)=>s?.fieldConfig?.[key]?.label||(key.startsWith('extra:')?key.slice(6):key==='holderUsername'?'用户名':key==='ownership'?'设备归属':({quantity:'库存数量',unit:'单位',licenses:'授权数量',expires:'授权到期日'} as Record<string,string>)[key]||labels[key]||key);
export const displayKeys=(s:Store)=>[...detailOrder,'quantity','unit','licenses','expires',...s.fields.map(f=>'extra:'+f)].filter(k=>!s.fieldConfig?.[k]?.deleted);
export function validateDisplay(raw:any,s:Store):DisplayPreferences{
 const allowed=new Set(displayKeys(s));const result:any={};
 for(const key of ['columns','details',...(raw?.editDetails?['editDetails']:[])]){if(!Array.isArray(raw?.[key])||raw[key].length<1||raw[key].length>allowed.size||raw[key].some((v:any)=>typeof v!=='string'||!allowed.has(v))||new Set(raw[key]).size!==raw[key].length)throw new Error('显示设置无效，请至少选择一个有效字段');result[key]=raw[key]}
 return result;
}
