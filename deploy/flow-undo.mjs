import {randomUUID} from 'node:crypto';
import {recordHistory} from './operations.mjs';

export function undoCandidate(db,state,assetId){
 const asset=state.assets.find(a=>a.id===assetId);if(!asset)return null;
 const rows=db.prepare("SELECT * FROM asset_history WHERE assetId=? AND beforeData IS NOT NULL AND afterData IS NOT NULL ORDER BY time DESC,rowid DESC").all(assetId);
 const last=rows.find(h=>h.beforeData!==h.afterData);if(!last||last.action!=='approve'||Date.now()-Date.parse(last.time)>15*60_000)return null;
 const before=JSON.parse(last.beforeData),after=JSON.parse(last.afterData);
 if(JSON.stringify(asset)!==JSON.stringify(after)||!db.prepare('SELECT id FROM users WHERE username=? AND role=?').get(last.actor,'admin'))return null;
 const request=state.requests.find(r=>r.assetId===assetId&&r.status==='已批准'&&r.approver===last.actor&&Math.abs(Date.parse(r.resolved)-Date.parse(last.time))<10_000);
 if(!request||state.requests.some(r=>r.assetId===assetId&&r.id!==request.id&&Date.parse(r.created)>Date.parse(request.resolved)))return null;
 return {historyId:last.id,requestId:request.id,assetId,before,number:asset.number,kind:request.kind,time:last.time};
}
export function undoApprovedFlow(db,state,assetId,historyId,actor){
 const candidate=undoCandidate(db,state,assetId);if(!candidate||candidate.historyId!==historyId)throw new Error('该流转已不能撤销，请刷新后核对资产历史');
 const before=structuredClone(state),index=state.assets.findIndex(a=>a.id===assetId),time=new Date().toISOString();state.assets[index]=candidate.before;
 const request=state.requests.find(r=>r.id===candidate.requestId);request.status='已撤销';request.undoAt=time;request.undoBy=actor;
 state.logs.unshift({id:randomUUID(),time,actor,action:'undoFlow',detail:`撤销 ${candidate.number} · ${candidate.kind} 的审批`});
 state.events.push({id:randomUUID(),time,type:'asset.updated',assetId,payload:structuredClone(candidate.before)});
 recordHistory(db,before,state,actor,'undoFlow','管理员撤销最近一次流转审批');return state;
}
