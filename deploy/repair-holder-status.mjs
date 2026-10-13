import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {statusValue} from '../lib/assets.ts';

const ignoredHolders=new Set(['已报废','未使用','闲置']);
export function holderStatusChanges(state){
 return state.assets.filter(a=>{
  const holder=String(a.holder||'').trim();
  return holder&&!ignoredHolders.has(holder)&&a.status!=='使用中';
 });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const apply=process.argv.includes('--apply');
 const dir=resolve(process.env.DATA_DIR||'data');
 const db=new DatabaseSync(join(dir,'assets.sqlite'));
 try{
  const load=()=>db.prepare("SELECT revision,data FROM asset_state WHERE id='company'").get();
  const current=load();if(!current)throw new Error('资产数据库未初始化');
  let state=JSON.parse(current.data),changed=holderStatusChanges(state);
  const pending=new Set(state.requests.filter(r=>['待审批','待接收确认'].includes(r.status)).map(r=>r.assetId));
  const affectedPending=changed.filter(a=>pending.has(a.id));
  console.log(JSON.stringify({mode:apply?'apply':'preview',total:state.assets.length,changeCount:changed.length,affectedPending:affectedPending.length,ignoredHolderCount:state.assets.filter(a=>ignoredHolders.has(String(a.holder||'').trim())).length}));
  if(!apply||!changed.length)process.exitCode=0;
  else{
   if(statusValue(state,'active')!=='使用中'||!state.dictionaries.status.includes('使用中'))throw new Error('当前使用中状态配置不同，请先检查状态字典');
   if(affectedPending.length)throw new Error(`有 ${affectedPending.length} 条待处理申请关联的资产，需先处理申请再修正状态`);
   const backupDir=join(dir,'manual-backups');mkdirSync(backupDir,{recursive:true});
   const backupPath=join(backupDir,`assets-before-holder-status-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.sqlite`);
   db.prepare('VACUUM INTO ?').run(backupPath);
   db.exec('BEGIN IMMEDIATE');
   try{
    const row=load();if(row.revision!==current.revision)throw new Error('资产数据已变化，请重新预览并执行');
    state=JSON.parse(row.data);changed=holderStatusChanges(state);
    const insert=db.prepare('INSERT INTO asset_history (id,assetId,time,actor,action,beforeData,afterData,detail) VALUES (?,?,?,?,?,?,?,?)');
    const time=new Date().toISOString();
    for(const asset of changed){const before=JSON.stringify(asset),oldStatus=asset.status;asset.status='使用中';insert.run(randomUUID(),asset.id,time,'管理员批量修正','holderStatusRepair',before,JSON.stringify(asset),`根据领用人将设备状态从${oldStatus}修正为使用中`)}
    state.logs.unshift({id:randomUUID(),time,actor:'管理员批量修正',action:'holderStatusRepair',detail:`根据领用人修正 ${changed.length} 条资产的设备状态`});
    const result=db.prepare("UPDATE asset_state SET data=?,revision=revision+1 WHERE id='company' AND revision=?").run(JSON.stringify(state),row.revision);
    if(result.changes!==1)throw new Error('资产版本发生变化，修正未提交');
    db.exec('COMMIT');console.log(JSON.stringify({applied:changed.length,backupPath}));
   }catch(error){db.exec('ROLLBACK');throw error}
  }
 }finally{db.close()}
}
