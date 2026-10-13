'use client';
import {useState} from 'react';
import {Pencil,X} from 'lucide-react';
import {displayKeys,fieldName} from '../lib/display';
import type {Store} from '../lib/assets';
export default function FieldDictionary({state,admin,busy,mutate}:{state:Store;admin:boolean;busy:boolean;mutate:(c:any)=>Promise<boolean>}){
 const [editing,setEditing]=useState(''),[name,setName]=useState(''),[adding,setAdding]=useState('');
 return <div><p>统一维护台账列与详情编辑字段的名称。删除字段后停止展示，已有资产内容和历史记录保留。</p><div className="chips">{displayKeys(state).map(k=><span key={k}>{fieldName(k,state)}<button disabled={!admin||busy} title="修改" aria-label={'修改字段'+fieldName(k,state)} onClick={()=>{setEditing(k);setName(fieldName(k,state))}}><Pencil size={13}/></button><button disabled={!admin||busy||['name','number','status','holder'].includes(k)} title="删除" aria-label={'删除字段'+fieldName(k,state)} onClick={()=>mutate({action:'field',key:k,remove:true})}><X size={13}/></button></span>)}</div>{editing&&<form className="inline-form" onSubmit={async e=>{e.preventDefault();if(await mutate({action:'field',key:editing,value:name}))setEditing('')}}><input aria-label="字段名称" required maxLength={40} value={name} onChange={e=>setName(e.target.value)}/><button type="button" onClick={()=>setEditing('')}>取消</button><button disabled={busy}>保存修改</button></form>}<form className="inline-form" onSubmit={async e=>{e.preventDefault();if(await mutate({action:'field',value:adding}))setAdding('')}}><input aria-label="新增字段名称" required maxLength={40} placeholder="例如：采购单号" value={adding} onChange={e=>setAdding(e.target.value)}/><button disabled={!admin||busy}>新增字段</button></form><p className="chart-note">名称、资产编号、设备状态、领用人是必填或流转字段，保留其业务用途。新增字段为文本类型。</p></div>
}
