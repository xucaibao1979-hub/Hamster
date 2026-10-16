import {existsSync} from 'node:fs';
import {join} from 'node:path';

const timestamp='\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z';
export const databaseBackupFilenamePattern=new RegExp(`^(?:asset-hub-database-${timestamp}(?:-\\d+)?|\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z-[0-9a-f-]{36})\\.sqlite$`);

export function nextDatabaseBackupFilename(folder,now=new Date()){
 const stamp=now.toISOString().replace(/:/g,'-').replace(/\.\d{3}Z$/,'Z');
 const base=`asset-hub-database-${stamp}`;
 for(let sequence=1;sequence<=100;sequence++){
  const filename=`${base}${sequence===1?'':`-${sequence}`}.sqlite`;
  if(!existsSync(join(folder,filename))&&!existsSync(join(folder,filename+'.tmp')))return filename;
 }
 throw new Error('同一秒内数据库备份次数过多，请稍后重试');
}

export function backupMatchesUtcDay(filename,day){
 return filename.startsWith(`asset-hub-database-${day}`)||filename.startsWith(day);
}
