/**
 * 游戏静态资源服务(R2):`/g/<slug>/...` → R2 对象 `g/<slug>/...`。
 * - 目录路径(`'/g/bvn'`、`'/g/bvn/'`)回退 `<key>/index.html`
 * - Content-Type:对象元数据优先,扩展名推断兜底
 * - index.html 不缓存(发布一致性),其余短缓存
 * - 支持单区间 Range 请求(wasm/音视频流式加载需要)
 * 游戏域(games.gamedock.cn)与主域 dev 代理都经由此模块;
 * sync-games.mjs 负责按同样的 `g/<slug>/` 前缀写入 R2。
 */
import { inferContentType } from './mime.mjs';

const INDEX_CACHE = 'no-cache';
const ASSET_CACHE = 'public, max-age=300';

function textResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

/**
 * 解析 Range 头(bytes=N- / bytes=-N / bytes=N-M),不支持多区间。
 * 返回 R2 get 的 range 选项;无法解析返回 null(全量返回)。
 */
function parseRange(header) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, start, end] = match;
  if (start === '' && end === '') return null;
  if (start === '') return Number(end) > 0 ? { suffix: Number(end) } : null;
  const offset = Number(start);
  if (end === '') return { offset };
  const length = Number(end) - offset + 1;
  return length > 0 ? { offset, length } : null;
}

function baseHeaders(key, object) {
  const headers = new Headers();
  headers.set(
    'Content-Type',
    object.httpMetadata?.contentType ?? inferContentType(key),
  );
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', key.endsWith('/index.html') ? INDEX_CACHE : ASSET_CACHE);
  return headers;
}

/** R2 对象命中 → 响应(处理 206 / HEAD);object 为 R2ObjectBody,requestedRange 为请求解析出的区间。 */
function objectResponse(object, key, request, requestedRange) {
  const headers = baseHeaders(key, object);
  // 只有请求真正带 Range 时才按区间响应(workerd 的对象有时即使未请求也带 range 字段)。
  const range = requestedRange ? object.range : undefined;
  if (range && object.size > 0) {
    // R2 已按 range 截好流;按对象实际大小补 Content-Range。
    const offset = range.offset ?? Math.max(object.size - (range.suffix ?? 0), 0);
    const length = Math.min(range.length ?? object.size - offset, object.size - offset);
    if (length > 0) {
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('Content-Length', String(length));
      return new Response(request.method === 'HEAD' ? null : object.body, {
        status: 206,
        headers,
      });
    }
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

export async function handleGameAsset(request, env) {
  if (!env.GAMES) {
    return textResponse(503, '游戏资源绑定缺失:请检查 wrangler.jsonc 的 R2(GAMES)配置。');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse(405, 'Method Not Allowed');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return textResponse(400, '非法路径');
  }

  // R2 key 与路径一一对应(统一带 g/ 前缀);拒绝目录穿越与可疑分隔符。
  const key = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!key || key.includes('..') || key.includes('\\') || key.includes('\0')) {
    return textResponse(404, '游戏资源不存在');
  }

  const range = parseRange(request.headers.get('range'));
  try {
    let object = await env.GAMES.get(key, range ? { range } : undefined);
    if (!object) {
      // 目录路径回退 index.html('/g/bvn'、'/g/bvn/' → 'g/bvn/index.html')。
      object = await env.GAMES.get(`${key}/index.html`, range ? { range } : undefined);
      if (object) return objectResponse(object, `${key}/index.html`, request, range);
    } else {
      return objectResponse(object, key, request, range);
    }
  } catch (err) {
    // Range 非法(如超出对象大小)时退回全量响应。
    console.warn('[game-assets] 读取对象失败,退回全量:', key, err);
    try {
      const full = await env.GAMES.get(key);
      if (full) return objectResponse(full, key, request);
      const fallback = await env.GAMES.get(`${key}/index.html`);
      if (fallback) return objectResponse(fallback, `${key}/index.html`, request);
    } catch {
      /* fallthrough */
    }
  }
  return textResponse(404, '游戏资源不存在');
}
