/**
 * 按扩展名推断静态资源的 Content-Type。
 * R2 上传时会写入对象元数据(httpMetadata.contentType),这里只作兜底;
 * 游戏产物来源不可控(第三方构建),宁可推断齐全。
 */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/** 取 key 的扩展名推断 Content-Type;未知返回 application/octet-stream。 */
export function inferContentType(key) {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return TYPES[key.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}
