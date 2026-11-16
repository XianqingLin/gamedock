import fs from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/** 把相对路径解析到 rootDir 内；越界（路径穿越）时返回 null。 */
export function resolveWithin(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/** 尝试按文件响应；成功返回 true。HTML 不缓存，其余资源短缓存。 */
export function serveFileIfExists(res, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const type = CONTENT_TYPES[ext] || 'application/octet-stream';
  const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=300';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': cacheControl });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

export function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
