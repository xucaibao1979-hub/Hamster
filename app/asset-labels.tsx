'use client';
import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import type {Asset} from '../lib/assets';
export default function AssetLabels({assets,onClose}:{assets:Asset[];onClose:()=>void}){
 const [codes,setCodes]=useState<Record<string,string>>({}),[error,setError]=useState('');useEffect(()=>{Promise.all(assets.map(async a=>[a.id,await QRCode.toDataURL(location.origin+'/#asset='+encodeURIComponent(a.id),{width:180,margin:2})])).then(v=>setCodes(Object.fromEntries(v))).catch(e=>setError(e.message))},[assets]);
 return <div className="modal-backdrop label-backdrop"><section className="modal" role="dialog" aria-label="资产二维码标签"><div className="modal-heading no-print"><h2>资产标签</h2><div className="actions"><button onClick={()=>window.print()} disabled={!Object.keys(codes).length}>打印标签</button><button onClick={onClose}>关闭标签</button></div></div><p className="no-print">二维码指向当前系统地址。正式部署后请在内网访问地址生成，扫码后仍需登录并验证资产查看权限。</p>{error&&<p role="alert">{error}</p>}<div className="print-labels">{assets.map(a=><div className="asset-label" key={a.id}>{codes[a.id]&&<img src={codes[a.id]} alt={a.number+'二维码'}/>}<strong>{a.number}</strong><span>{a.name}</span><small>{a.ownership}</small></div>)}</div></section></div>
}
