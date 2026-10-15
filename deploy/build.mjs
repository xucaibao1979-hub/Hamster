import {build} from 'esbuild';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
mkdirSync('internal-dist',{recursive:true});
copyFileSync('public/brand.png','internal-dist/brand.png');
copyFileSync('public/concierge.png','internal-dist/concierge.png');
await build({entryPoints:['deploy/client.tsx'],bundle:true,minify:true,format:'esm',outfile:'internal-dist/app.js',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const css=readFileSync('app/globals.css','utf8').split(/\r?\n/).filter(line=>!line.trim().startsWith('@import')).join('\n');
writeFileSync('internal-dist/app.css',css+`.login-page{min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at top,#e6eeff,#f5f7fb 65%);padding:20px}.login-card{width:400px;max-width:100%;background:white;border:1px solid #e2e9f6;border-radius:16px;padding:40px;box-shadow:0 15px 60px #30528710}.login-card h1{font-size:34px;color:#3868eb;margin:15px 0}.login-card label{display:grid;gap:10px;margin:25px 0 18px;color:#60718a;font-size:12px}.login-card>.primary{width:100%;margin:10px 0 22px}.logout{position:fixed;bottom:15px;left:26px;z-index:5;font-size:10px}.sidebar-bottom{margin-bottom:32px}@media(max-width:760px){.logout{left:4px;padding:5px;font-size:9px}}`);
writeFileSync('internal-dist/index.html','<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="每件资产，都有自己的位置。"><title>小仓鼠资产管理平台</title><link rel="icon" type="image/png" href="/brand.png"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
console.log('Internal production bundle ready: internal-dist/');

