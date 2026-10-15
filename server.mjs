import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2','.wav':'audio/wav','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if (!target.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
  fs.stat(target,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(target).pipe(res);
  });
});
server.on('error',error=>{if(error.code==='EADDRINUSE'){console.log('Port is already in use. Open http://localhost:'+(Number(process.env.PORT)||4173)+' or set PORT to a different number.');}else{console.error(error.message);process.exitCode=1;}});
server.listen(Number(process.env.PORT)||4173,'0.0.0.0',()=>console.log('Local: http://localhost:'+(server.address().port)));
