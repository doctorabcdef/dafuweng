import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.env.SERVE_DIR || '.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  try {
    let requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\/$/, '/index.html');
    if (!process.env.SERVE_DIR && requestPath.startsWith('/vendor/')) {
      requestPath = requestPath.startsWith('/vendor/addons/')
        ? '/node_modules/three/examples/jsm/' + requestPath.slice('/vendor/addons/'.length)
        : '/node_modules/three/build/' + requestPath.slice('/vendor/'.length);
    }
    const path = resolve(root, '.' + requestPath);
    if (!path.startsWith(root + sep) || path.split(sep).some(part => part.startsWith('.'))) {
      res.writeHead(403); res.end(); return;
    }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('Game available at http://127.0.0.1:' + (process.env.PORT || 4173)));
