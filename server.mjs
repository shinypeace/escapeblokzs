import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2','.wav':'audio/wav','.mp3':'audio/mpeg','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if (!target.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
  fs.stat(target,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404).end('Not found');return;}
    const headers={'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
    let start=0,end=stat.size-1,status=200;
    if(req.headers.range){
      const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(!range||(!range[1]&&!range[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
      if(range[1]){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;}
      else start=Math.max(0,stat.size-Number(range[2]));
      if(start>end||start>=stat.size||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
      status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length']=status===206?end-start+1:stat.size;
    res.writeHead(status,headers);
    if(req.method==='HEAD'||!stat.size){res.end();return;}
    fs.createReadStream(target,{start,end}).pipe(res);
  });
});
server.on('error',error=>{if(error.code==='EADDRINUSE'){console.log('Port is already in use. Open http://localhost:'+(Number(process.env.PORT)||4173)+' or set PORT to a different number.');}else{console.error(error.message);process.exitCode=1;}});
server.listen(Number(process.env.PORT)||4173,'0.0.0.0',()=>console.log('Local: http://localhost:'+(server.address().port)));
