import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdtempSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {databaseBackupManager,validateDatabaseFile} from '../deploy/database-backups.mjs';
import {restoreDatabase} from '../deploy/restore-database.mjs';
import {backupDatabase} from '../deploy/backup-database.mjs';
import {pruneBackups} from '../deploy/backup-retention.mjs';

test('完整数据库快照包含账号和资产，验证后可离线恢复',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'asset-db-backup-'));
 try{
  const path=join(dir,'assets.sqlite'),db=new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE asset_state(id TEXT PRIMARY KEY,revision INTEGER,data TEXT); CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT);");
  db.prepare('INSERT INTO asset_state VALUES (?,0,?)').run('company',JSON.stringify({assets:[{number:'A001'}]}));
  db.prepare('INSERT INTO users VALUES (?,?)').run('admin','admin');
  const manager=databaseBackupManager(db,dir),snapshot=await manager.create();
  assert.equal(snapshot.assets,1);assert.equal(snapshot.users,1);
  assert.equal(manager.verify(snapshot.filename).verified,true);
  assert.equal(manager.list().length,1);
  assert.equal(await manager.daily(),null);
  db.prepare('UPDATE asset_state SET data=? WHERE id=?').run(JSON.stringify({assets:[{number:'A001'},{number:'A002'}]}),'company');
  db.close();
  const result=await restoreDatabase(manager.filePath(snapshot.filename),dir);
  assert.equal(result.restored.assets,1);
  assert.equal(validateDatabaseFile(path).assets,1);
  assert.equal(validateDatabaseFile(join(dir,'database-backups',result.previousDatabase)).assets,2);
  const invalid=join(dir,'invalid.sqlite');writeFileSync(invalid,'not a SQLite database');
  assert.throws(()=>validateDatabaseFile(invalid));
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('服务器定时备份可在 WAL 写入期间生成可恢复的宿主机快照',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'asset-cron-backup-'));
 try{
  const path=join(dir,'assets.sqlite'),db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE asset_state(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE users(id TEXT PRIMARY KEY);');
  db.prepare('INSERT INTO asset_state VALUES (?,?)').run('company',JSON.stringify({assets:[{number:'001'}]}));
  db.prepare('INSERT INTO users VALUES (?)').run('admin');
  const result=await backupDatabase(path,join(dir,'host-backups'));
  assert.equal(result.assets,1);
  assert.equal(validateDatabaseFile(join(dir,'host-backups',result.filename)).users,1);
  assert.equal(existsSync(join(dir,'host-backups',result.filename+'.tmp-shm')),false);
  assert.equal(existsSync(join(dir,'host-backups',result.filename+'.tmp-wal')),false);
  db.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('项目备份仅清理超过30天的匹配文件',()=>{
 const dir=mkdtempSync(join(tmpdir(),'asset-backup-retention-'));
 try{
  const old=join(dir,'2026-01-01T00-00-00-000Z-11111111-1111-4111-8111-111111111111.sqlite');
  const recent=join(dir,'2026-01-02T00-00-00-000Z-22222222-2222-4222-8222-222222222222.sqlite');
  const unrelated=join(dir,'manual-backup.sqlite');
  for(const path of [old,recent,unrelated])writeFileSync(path,'test');
  const now=Date.now();utimesSync(old,new Date(now-31*86400000),new Date(now-31*86400000));
  utimesSync(recent,new Date(now-29*86400000),new Date(now-29*86400000));
  utimesSync(unrelated,new Date(now-31*86400000),new Date(now-31*86400000));
  assert.equal(pruneBackups(dir,/^\d{4}-.*\.sqlite$/,now),1);
  assert.equal(existsSync(old),false);assert.equal(existsSync(recent),true);assert.equal(existsSync(unrelated),true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
