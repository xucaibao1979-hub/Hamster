import {createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {backup, DatabaseSync} from 'node:sqlite';
import {pruneBackups} from './backup-retention.mjs';

const filenamePattern=/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.sqlite$/;

export function validateDatabaseFile(path){
 const database=new DatabaseSync(path,{readOnly:true});
 try{
  const result=database.prepare('PRAGMA integrity_check').all();
  if(result.length!==1||result[0].integrity_check!=='ok')throw new Error('数据库完整性检查失败');
  for(const table of ['asset_state','users']){
   if(!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error(`数据库缺少 ${table} 表`);
  }
  const row=database.prepare("SELECT data FROM asset_state WHERE id='company'").get();
  if(!row)throw new Error('数据库缺少资产台账');
  const state=JSON.parse(row.data);
  if(!Array.isArray(state.assets))throw new Error('资产台账数据无效');
  return {verified:true,assets:state.assets.length,users:database.prepare('SELECT COUNT(*) AS count FROM users').get().count};
 }finally{database.close()}
}

export function databaseBackupManager(database,dataDir){
 const folder=join(dataDir,'database-backups');mkdirSync(folder,{recursive:true,mode:0o700});
 let running=null;
 function list(){return readdirSync(folder).filter(name=>filenamePattern.test(name)).sort().reverse().map(filename=>({filename,bytes:statSync(join(folder,filename)).size}))}
 function filePath(filename){if(!filenamePattern.test(String(filename||''))||!list().some(item=>item.filename===filename))throw new Error('数据库备份不存在');return join(folder,filename)}
 function verify(filename){return validateDatabaseFile(filePath(filename))}
 function create(){
  if(running)return running;
  running=(async()=>{
   const filename=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite';
   const target=join(folder,filename),temporary=target+'.tmp';
   try{
    await backup(database,temporary);
    const result=validateDatabaseFile(temporary);
    chmodSync(temporary,0o600);
    renameSync(temporary,target);
    pruneBackups(folder,filenamePattern);
    return {filename,bytes:statSync(target).size,...result};
   }catch(error){if(existsSync(temporary))rmSync(temporary,{force:true});throw error}
  })().finally(()=>{running=null});
  return running;
 }
 async function daily(){if(!list().some(item=>item.filename.startsWith(new Date().toISOString().slice(0,10))))return create();pruneBackups(folder,filenamePattern);return null}
 function stream(filename){return createReadStream(filePath(filename))}
 return {folder,list,filePath,verify,create,daily,stream};
}
