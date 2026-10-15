import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import AssetsApp from '../app/assets-app';
import type {Profile} from '../app/users-panel';
function App(){
 const [profile,setProfile]=useState<Profile|null>(null),[loading,setLoading]=useState(true),[username,setUsername]=useState('admin'),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('/api/session').then(async r=>{if(r.ok)setProfile(await r.json() as Profile)}).catch(()=>setError('无法连接服务器')).finally(()=>setLoading(false))},[]);
 async function logout(){await fetch('/api/logout',{method:'POST'});setProfile(null);setPassword('')}
 if(loading)return <div className="login-page">正在连接小仓鼠资产管理平台…</div>;
 if(profile)return <AssetsApp email={profile.email} profile={profile} onLogout={logout}/>;
 return <div className="login-page"><form className="login-card" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const d:any=await r.json();if(!r.ok)throw new Error(d.error);setProfile(d);setPassword('')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}><div className="login-brand"><img src="/brand.png" alt="小仓鼠资产管理平台"/></div><p className="login-tagline">每件资产，都有自己的位置。</p><label>账号<input required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label><label>密码<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="alert">{error}</div>}<button className="primary" disabled={busy}>{busy?'登录中…':'登录工作空间'}</button><small>联系管理员获取账号及密码。</small></form></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
