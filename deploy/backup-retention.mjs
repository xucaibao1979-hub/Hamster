import {readdirSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';

export const BACKUP_RETENTION_DAYS=30;
const retentionMs=BACKUP_RETENTION_DAYS*24*60*60*1000;

export function pruneBackups(folder,filenamePattern,now=Date.now()){
 let removed=0;
 for(const entry of readdirSync(folder,{withFileTypes:true})){
  if(!entry.isFile()||!filenamePattern.test(entry.name))continue;
  const path=join(folder,entry.name);
  if(statSync(path).mtimeMs>=now-retentionMs)continue;
  rmSync(path);removed++;
 }
 return removed;
}
