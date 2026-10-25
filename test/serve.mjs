import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(process.argv[2] || '.'); const port = +process.argv[3] || 8765;
const types = {'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.map':'application/json'};
http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p.endsWith('/')) p+='index.html';
  const f = path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){res.writeHead(404);res.end('nf');return;} res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); res.end(d);});
}).listen(port,()=>console.log('serving',root,port));
