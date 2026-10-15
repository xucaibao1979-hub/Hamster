'use client';
import {useState} from 'react';
import {Pencil,X} from 'lucide-react';
import {displayKeys,fieldName} from '../lib/display';
import type {Store} from '../lib/assets';

const types=[['text','文本'],['number','数字'],['date','日期'],['select','单选']];
export default function FieldDictionary({state,admin,busy,mutate}:{state:Store;admin:boolean;busy:boolean;mutate:(c:any)=>Promise<boolean>}){
 const [editing,setEditing]=useState(''),[name,setName]=useState(''),[adding,setAdding]=useState('');
 const [editType,setEditType]=useState('text'),[editOptions,setEditOptions]=useState('');
 const [newType,setNewType]=useState('text'),[newOptions,setNewOptions]=useState('');
 function begin(key:string){setEditing(key);setName(fieldName(key,state));setEditType(state.fieldConfig?.[key]?.type||'text');setEditOptions(state.fieldConfig?.[key]?.options?.join('，')||'')}
 return <div>
  <p>统一维护台账列与详情编辑字段。删除字段后停止展示，已有内容和历史保留。</p>
  <div className="chips">{displayKeys(state).map(key=><span key={key}>
   {fieldName(key,state)}{key.startsWith('extra:')&&<small> · {types.find(t=>t[0]===(state.fieldConfig?.[key]?.type||'text'))?.[1]}</small>}
   <button disabled={!admin||busy} title="修改" aria-label={'修改字段'+fieldName(key,state)} onClick={()=>begin(key)}><Pencil size={13}/></button>
   <button disabled={!admin||busy||['name','number','status','holder'].includes(key)} title="删除" aria-label={'删除字段'+fieldName(key,state)} onClick={()=>mutate({action:'field',key,remove:true})}><X size={13}/></button>
  </span>)}</div>
  {editing&&<form className="field-config-form" onSubmit={async e=>{e.preventDefault();if(await mutate({action:'field',key:editing,value:name,...(editing.startsWith('extra:')?{fieldType:editType,options:editOptions}:{})}))setEditing('')}}>
   <input aria-label="字段名称" required maxLength={40} value={name} onChange={e=>setName(e.target.value)}/>
   {editing.startsWith('extra:')&&<><select aria-label="字段类型" value={editType} onChange={e=>setEditType(e.target.value)}>{types.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   {editType==='select'&&<input aria-label="单选项" placeholder="选项一，选项二" value={editOptions} onChange={e=>setEditOptions(e.target.value)}/>}</>}
   <button type="button" onClick={()=>setEditing('')}>取消</button><button disabled={busy}>保存修改</button>
  </form>}
  <form className="field-config-form" onSubmit={async e=>{e.preventDefault();if(await mutate({action:'field',value:adding,fieldType:newType,options:newOptions})){setAdding('');setNewOptions('');setNewType('text')}}}>
   <input aria-label="新增字段名称" required maxLength={40} placeholder="例如：采购单号" value={adding} onChange={e=>setAdding(e.target.value)}/>
   <select aria-label="新增字段类型" value={newType} onChange={e=>setNewType(e.target.value)}>{types.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   {newType==='select'&&<input aria-label="新增字段单选项" placeholder="选项一，选项二" value={newOptions} onChange={e=>setNewOptions(e.target.value)}/>}
   <button disabled={!admin||busy}>新增字段</button>
  </form>
  <p className="chart-note">已有数据必须符合新类型才能保存类型变更；导入和资产编辑也会校验字段值。单选项用逗号分隔。</p>
 </div>
}
