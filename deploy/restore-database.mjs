import {backup, DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {chmodSync,chownSync,copyFileSync,existsSync,mkdirSync,renameSync,rmSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDatabaseFile} from './database-backups.mjs';

export async function restoreDatabase(source,dataDir){
 const input=resolve(source),dir=resolve(dataDir),destination=join(dir,'assets.sqlite');
 if(input===destination||!existsSync(input))throw new Error('请指定存在的数据库备份文件，不能选择当前数据库');
 const restored=validateDatabaseFile(input);
 if(!existsSync(destination))throw new Error('当前数据库不存在，请先确认数据卷是否正确');
 const folder=join(dir,'database-backups');mkdirSync(folder,{recursive:true,mode:0o700});
 const safetyName=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite';
 const safety=join(folder,safetyName),current=new DatabaseSync(destination,{readOnly:true});
 try{await backup(current,safety)}finally{current.close()}
 validateDatabaseFile(safety);chmodSync(safety,0o600);
 const temp=destination+'.restore-'+randomUUID()+'.tmp',original=statSync(destination);
 try{
  copyFileSync(input,temp);
  validateDatabaseFile(temp);
  chmodSync(temp,original.mode&0o777);
  if(process.platform!=='win32')chownSync(temp,original.uid,original.gid);
  renameSync(temp,destination);
  rmSync(destination+'-wal',{force:true});
  rmSync(destination+'-shm',{force:true});
 }catch(error){rmSync(temp,{force:true});throw error}
 return {restored,previousDatabase:safetyName};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[3]!=='--confirm=RESTORE'){
  console.error('用法：node deploy/restore-database.mjs <备份文件.sqlite> --confirm=RESTORE');
  process.exitCode=2;
 }else{
  restoreDatabase(process.argv[2],process.env.DATA_DIR||'/data').then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1});
 }
}
