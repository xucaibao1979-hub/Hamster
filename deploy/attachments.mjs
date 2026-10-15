import {randomUUID} from 'node:crypto';

const LIMIT=2_000_000;
const TOTAL_LIMIT=16_000_000;
const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
export function initAttachments(db){db.exec(`CREATE TABLE IF NOT EXISTS asset_attachments(id TEXT PRIMARY KEY,assetId TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created TEXT NOT NULL,actor TEXT NOT NULL,data BLOB NOT NULL);CREATE INDEX IF NOT EXISTS attachment_asset ON asset_attachments(assetId)`)}
export function attachmentList(db,assetId){return db.prepare('SELECT id,assetId,name,kind,mime,size,created,actor FROM asset_attachments WHERE assetId=? ORDER BY created DESC').all(assetId)}
export function allAttachments(db){return db.prepare('SELECT * FROM asset_attachments').all().map(a=>({...a,data:Buffer.from(a.data).toString('base64')}))}
export function validateAttachments(items,assetIds){
 if(items===undefined)return [];
 if(!Array.isArray(items)||items.length>2000)throw new Error('附件备份无效');
 let size=0;const ids=new Set();
 return items.map(a=>{if(!a||typeof a.id!=='string'||!a.id||ids.has(a.id)||!assetIds.has(a.assetId)||typeof a.name!=='string'||!a.name||a.name.length>150||!['photo','invoice'].includes(a.kind)||!types[a.mime]||!Number.isInteger(a.size)||a.size<1||a.size>LIMIT||typeof a.data!=='string'||!Number.isFinite(Date.parse(a.created))||typeof a.actor!=='string'||a.actor.length>100)throw new Error('附件备份无效');ids.add(a.id);const data=Buffer.from(a.data,'base64');size+=data.length;if(size>TOTAL_LIMIT||data.length!==a.size||data.toString('base64')!==a.data||!validMagic(data,a.mime))throw new Error('附件备份内容无效');return {...a,data}})
}
function validMagic(data,mime){return mime==='image/jpeg'?data[0]===0xff&&data[1]===0xd8&&data.at(-2)===0xff&&data.at(-1)===0xd9:mime==='image/png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/webp'?data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP':data.toString('ascii',0,5)==='%PDF-'}
export function addAttachment(db,assetId,input,actor){
 const name=String(input.name||'').replace(/[\\/\x00-\x1f]/g,'').trim(),kind=String(input.kind||''),mime=String(input.mime||'');
 if(!name||name.length>150||!['photo','invoice'].includes(kind)||!types[mime]||typeof input.data!=='string'||input.data.length>3_000_000)throw new Error('附件名称、类型或大小无效');
 const data=Buffer.from(input.data,'base64');if(data.length<1||data.length>LIMIT||data.toString('base64')!==input.data||!validMagic(data,mime))throw new Error('附件格式或内容无效，单个文件最大 2MB');
 if(db.prepare('SELECT COUNT(*) AS n FROM asset_attachments WHERE assetId=?').get(assetId).n>=5)throw new Error('每条资产最多 5 个附件');
 if(db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM asset_attachments').get().n+data.length>TOTAL_LIMIT)throw new Error('全部附件已达到 16MB 上限，请先清理旧附件');
 const id=randomUUID();db.prepare('INSERT INTO asset_attachments VALUES (?,?,?,?,?,?,?,?,?)').run(id,assetId,name,kind,mime,data.length,new Date().toISOString(),actor,data);return id;
}
