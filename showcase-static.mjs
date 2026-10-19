import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('./docs/showcase/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.vtt': 'text/vtt; charset=utf-8', '.mp4': 'video/mp4', '.md': 'text/plain; charset=utf-8' };

export async function serveShowcase(req, res, url) {
  if (url.pathname !== '/showcase' && !url.pathname.startsWith('/showcase/')) return false;
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return true; }
  if (url.pathname === '/showcase') { res.writeHead(302, { Location: '/showcase/' }); res.end(); return true; }
  const relative = decodeURIComponent(url.pathname.slice('/showcase/'.length)) || 'index.html';
  const file = path.resolve(root, relative);
  const extension = path.extname(file);
  if (!file.startsWith(root) || relative.split(/[\\/]/).some(part => part.startsWith('.')) || !Object.hasOwn(types, extension)) {
    res.writeHead(404); res.end(); return true;
  }
  let content;
  try { content = await readFile(file); } catch { res.writeHead(404); res.end(); return true; }
  const headers = { 'Content-Type': types[extension], 'Content-Length': content.length, 'Cache-Control': 'no-cache' };
  if (extension === '.mp4') {
    headers['Accept-Ranges'] = 'bytes';
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      let start = content.length, end = content.length - 1;
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, content.length - Number(range[2]));
        if (range[1] && range[2]) end = Math.min(end, Number(range[2]));
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= content.length || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${content.length}` }); res.end(); return true;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Content-Length': end - start + 1 });
      res.end(req.method === 'HEAD' ? undefined : content.subarray(start, end + 1));
      return true;
    }
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}
