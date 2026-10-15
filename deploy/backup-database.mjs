import {backup,DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,renameSync,rmSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDatabaseFile} from './database-backups.mjs';

export async function backupDatabase(source,outputDir){
 const input=resolve(source),folder=resolve(outputDir);
 if(!existsSync(input))throw new Error('数据库文件不存在：'+input);
 mkdirSync(folder,{recursive:true,mode:0o700});
 const filename=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite';
 const target=resolve(folder,filename),temporary=target+'.tmp';
 const database=new DatabaseSync(input,{readOnly:true});
 try{
  await backup(database,temporary);
  const verified=validateDatabaseFile(temporary);
  chmodSync(temporary,0o600);
  renameSync(temporary,target);
  return {filename,bytes:statSync(target).size,...verified};
 }catch(error){rmSync(temporary,{force:true});throw error}
 finally{database.close()}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 backupDatabase(process.env.DATA_DIR?resolve(process.env.DATA_DIR,'assets.sqlite'):'/data/assets.sqlite',process.argv[2]||'/backup')
  .then(result=>console.log(JSON.stringify(result)))
  .catch(error=>{console.error(error.message);process.exitCode=1});
}
