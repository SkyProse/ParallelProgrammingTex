import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain'};
const port=Number(process.env.PORT || 5173);
http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=pathname.replace(/^\/+/, '') || 'index.html';
  const target=path.resolve(root,relative);
  if(!target.startsWith(root)) throw Error('Invalid path');
  const info=await stat(target);
  const file=info.isDirectory()?path.join(target,'index.html'):target;
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-cache'});
  res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'0.0.0.0',()=>console.log(`Concurrency Theatre: http://localhost:${port}`));
