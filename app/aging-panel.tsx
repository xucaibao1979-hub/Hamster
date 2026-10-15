'use client';
import type {Asset,Store} from '../lib/assets';
import {agingStats} from '../lib/aging';
export default function AgingPanel({state,onOpen}:{state:Store;onOpen:(asset:Asset)=>void}){
 const groups=agingStats(state);return <section className="panel aging-panel"><div className="panel-heading"><h2>资产使用时长提醒</h2><span>闲置满 90 天 · 领用满 180 天</span></div><div className="two-col">{[['长期闲置',groups.idle],['长期领用',groups.assigned]] .map(([title,items])=><div key={String(title)}><h3>{String(title)} · {(items as typeof groups.idle).length}</h3>{(items as typeof groups.idle).slice(0,5).map(({asset,days})=><button className="aging-item" key={asset.id} onClick={()=>onOpen(asset)}><span>{asset.name} · {asset.number}</span><b>{days} 天</b></button>)}{!(items as typeof groups.idle).length&&<p className="chart-note">暂无达到提醒时长的资产</p>}</div>)}</div><p className="chart-note">闲置起点优先取资产状态变更记录，旧资产无记录时按购入日期估算；领用时长按领用日期计算。点击资产可查看详情。</p></section>
}
