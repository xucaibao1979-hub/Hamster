import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const version=process.argv[2]||new Date().toISOString().slice(0,10).replaceAll('-','');
if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,50}$/.test(version))throw new Error('版本名仅允许字母、数字、点、下划线和短横线');
const name=`asset-hub-source-${version}`;
const outDir=join(root,'outputs','publication');
const stage=join(outDir,name);
if(existsSync(stage))throw new Error(`归档目录已存在：${stage}；请使用新的版本名`);
mkdirSync(stage,{recursive:true});

const entries=['app','lib','deploy','public','tests','docs','Dockerfile','compose.yaml','.dockerignore','.gitignore','.npmrc','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','next-env.d.ts','postcss.config.mjs','README.md','CHANGELOG.md'];
for(const entry of entries){
 const source=join(root,entry);
 if(!existsSync(source))throw new Error(`缺少发布文件：${entry}`);
 cpSync(source,join(stage,entry),{recursive:true});
}
mkdirSync(join(stage,'scripts'));
cpSync(join(root,'scripts','package-clean.mjs'),join(stage,'scripts','package-clean.mjs'));
cpSync(join(root,'scripts','backup-database-cron.sh'),join(stage,'scripts','backup-database-cron.sh'));
cpSync(join(root,'scripts','backup-project-cron.sh'),join(stage,'scripts','backup-project-cron.sh'));

const forbidden=/(^|\/)(?:\.env(?:\..*)?|data|backups|outputs|node_modules|internal-dist|dist|\.git|\.next|\.openai|\.codex|\.agents)(?:\/|$)|\.(?:sqlite(?:-wal|-shm)?|db|pem|key|zip|tar\.gz)$/i;
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(item=>{const path=join(dir,item.name);return item.isDirectory()?files(path):[path]})}
const all=files(stage).map(path=>({path,relative:path.slice(stage.length+1).replaceAll('\\','/')}));
for(const item of all)if(forbidden.test(item.relative))throw new Error(`发布包含禁止文件：${item.relative}`);
const manifest={name,createdAt:new Date().toISOString(),files:all.map(item=>({path:item.relative,sha256:createHash('sha256').update(readFileSync(item.path)).digest('hex')}))};
writeFileSync(join(stage,'SOURCE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
const archive=join(outDir,`${name}.tar.gz`);
const tar=spawnSync('tar',['-czf',archive,'-C',outDir,name],{stdio:'inherit'});
if(tar.error||tar.status!==0)throw tar.error||new Error(`tar 失败：${tar.status}`);
const digest=createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`,`${digest}  ${basename(archive)}\n`);
console.log(JSON.stringify({stage,archive,sha256:digest,files:all.length},null,2));

