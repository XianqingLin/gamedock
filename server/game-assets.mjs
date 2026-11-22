/**
 * 游戏静态资源服务(R2):`/g/<slug>/...` → R2 对象 `g/<slug>/...`。
 * - 目录路径(`'/g/bvn'`、`'/g/bvn/'`)回退 `<key>/index.html`
 * - Content-Type:对象元数据优先,扩展名推断兜底
 * - 缓存分层(2026-11-22 重定,压掉跨边境慢拉取):
 *     index.html         no-cache(发布一致性;不进边缘缓存)
 *     <slug>/assets/*    max-age=31536000, immutable(Vite 内容哈希块,文件名即版本)
 *     其余(数据/图集/音频) max-age=86400(一天,发布后 ≤1 天收敛——与原 nginx expires 1d 同取舍)
 *     带 ?v= 的任意路径  immutable(2026-11-22 追加:客户端 asset-versioning 追加内容
 *                        指纹 ?v=<8位哈希>——内容变 URL 变,可永久缓存;旧客户端
 *                        不带 ?v= 仍走上表,双轨兼容)
 * - 边缘缓存 = Cache API(worker 响应默认不进 CF 缓存;仅 ctx 可用且 GET 无 Range 时,
 *   陈旧度以响应自身 Cache-Control max-age 为上界);带 If-None-Match 的数据资产请求
 *   一律绕过边缘直连 R2 校验——边缘不得拿旧 ETag 回 304,否则更新永不到达。
 * - If-None-Match 协商:非 immutable 路径用 R2 head() 校验(不取 body);immutable 路径
 *   同 URL 内容不变,可与边缘缓存副本比对直接 304。
 * - 支持单区间 Range 请求(wasm/音视频流式加载需要);Range 路径不进边缘缓存。
 * 游戏域(games.gamedock.cn)与主域 dev 代理都经由此模块;
 * sync-games.mjs 负责按同样的 `g/<slug>/` 前缀写入 R2。
 */
import { inferContentType } from './mime.mjs';

const INDEX_CACHE = 'no-cache';
const HASHED_CACHE = 'public, max-age=31536000, immutable';
const DATA_CACHE = 'public, max-age=86400';

function textResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** R2 key → 缓存策略(index.html / Vite 哈希块 / 数据资产)。versioned = URL 带 ?v= 内容指纹。 */
function cacheControlOf(key, versioned) {
  // 指纹 URL（客户端 asset-versioning 追加 ?v=<8 位内容哈希>）：内容变 → URL 变，
  // URL 不变 → 内容永不变 → 与 Vite 内容哈希块同等信任，永久缓存。
  if (versioned) return HASHED_CACHE;
  if (key.endsWith('/index.html')) return INDEX_CACHE;
  if (/(^|\/)assets\/[^/]+$/.test(key)) return HASHED_CACHE;
  return DATA_CACHE;
}

/** 是否内容寻址(immutable):同 URL 内容永不变,边缘缓存副本可安全用于 304 协商。 */
function isImmutable(key, versioned) {
  return cacheControlOf(key, versioned) === HASHED_CACHE;
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

function baseHeaders(key, object, versioned) {
  const headers = new Headers();
  headers.set(
    'Content-Type',
    object.httpMetadata?.contentType ?? inferContentType(key),
  );
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', cacheControlOf(key, versioned));
  return headers;
}

/** R2 对象命中 → 响应(处理 206 / HEAD);object 为 R2ObjectBody,requestedRange 为请求解析出的区间。 */
function objectResponse(object, key, request, requestedRange, versioned) {
  const headers = baseHeaders(key, object, versioned);
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

/** ETag 归一化:If-None-Match 按 RFC 7232 用弱比较——忽略 W/ 前缀与引号。 */
function etagToken(v) {
  return v.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}

/** If-None-Match 与 ETag 匹配(弱比较;允许多值逗号分隔与裸值形式)。 */
function etagMatches(inm, etag) {
  const t = etagToken(etag);
  return inm.split(',').some((raw) => etagToken(raw) === t);
}

/**
 * R2 key 的当前 ETag。immutable 路径可信任边缘缓存副本的 ETag(同 URL 内容不变);
 * 其余一律 R2 head() 权威校验——head 不可用(旧 mock)时回退全量 get。
 */
async function currentEtag(env, key, object, cached, versioned) {
  if (isImmutable(key, versioned) && cached) {
    const etag = cached.headers.get('ETag');
    if (etag !== null) return etag;
  }
  if (typeof env.GAMES?.head === 'function') {
    const head = await env.GAMES.head(key);
    return head?.httpEtag ?? null;
  }
  return object?.httpEtag ?? null;
}

export async function handleGameAsset(request, env, ctx) {
  if (!env.GAMES) {
    return textResponse(503, '游戏资源绑定缺失:请检查 wrangler.jsonc 的 R2(GAMES)配置。');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse(405, 'Method Not Allowed');
  }

  let pathname;
  let versioned = false;
  try {
    const url = new URL(request.url);
    pathname = decodeURIComponent(url.pathname);
    // ?v=<内容指纹>（web-bvn asset-versioning）：内容寻址 URL，按 immutable 下发。
    versioned = url.searchParams.has('v');
  } catch {
    return textResponse(400, '非法路径');
  }

  // R2 key 与路径一一对应(统一带 g/ 前缀);拒绝目录穿越与可疑分隔符。
  const key = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!key || key.includes('..') || key.includes('\\') || key.includes('\0')) {
    return textResponse(404, '游戏资源不存在');
  }

  const range = parseRange(request.headers.get('range'));
  const edgeCacheable =
    ctx !== undefined &&
    request.method === 'GET' &&
    range === null &&
    !key.endsWith('/index.html') &&
    typeof caches !== 'undefined' &&
    caches.default !== undefined;
  const edge = edgeCacheable ? caches.default : null;
  const inm = request.headers.get('if-none-match');

  try {
    // —— 边缘缓存命中(无 If-None-Match 的普通 GET;协商请求必须走权威校验) ——
    if (edge !== null && inm === null) {
      const cached = await edge.match(request);
      if (cached !== undefined) {
        const hit = new Response(cached.body, cached);
        hit.headers.set('X-Cache', 'HIT');
        return hit;
      }
    }

    // —— If-None-Match 协商:immutable 用边缘副本 ETag,其余 R2 head() 权威校验 ——
    if (inm !== null && range === null) {
      const cached = edge !== null ? await edge.match(request) : undefined;
      const current = await currentEtag(env, key, null, cached, versioned);
      if (current !== null && etagMatches(inm, current)) {
        return new Response(null, {
          status: 304,
          headers: {
            ETag: current,
            'Cache-Control': cacheControlOf(key, versioned),
            'X-Content-Type-Options': 'nosniff',
            'X-Cache': cached !== undefined ? 'HIT' : 'MISS',
          },
        });
      }
      // 协商未命中:继续走全量 R2 读取(下方),响应头上补协商结果标记。
    }

    // —— 全量读取 R2 ——
    let object = await env.GAMES.get(key, range ? { range } : undefined);
    if (!object) {
      // 目录路径回退 index.html('/g/bvn'、'/g/bvn/' → 'g/bvn/index.html')。
      object = await env.GAMES.get(`${key}/index.html`, range ? { range } : undefined);
      if (object) return objectResponse(object, `${key}/index.html`, request, range, versioned);
    } else {
      const response = objectResponse(object, key, request, range, versioned);
      // 200 全量响应且可策略缓存 → 写边缘缓存(不缓存 index.html;陈旧度 ≤ max-age)。
      if (
        edge !== null &&
        response.status === 200 &&
        inm === null
      ) {
        const cached = new Response(response.clone().body, response);
        cached.headers.set('X-Cache', 'HIT');
        ctx.waitUntil(edge.put(request, cached));
      }
      response.headers.set('X-Cache', inm !== null ? 'REVALIDATED-MISS' : 'MISS');
      return response;
    }
  } catch (err) {
    // Range 非法(如超出对象大小)时退回全量响应。
    console.warn('[game-assets] 读取对象失败,退回全量:', key, err);
    try {
      const full = await env.GAMES.get(key);
      if (full) return objectResponse(full, key, request, undefined, versioned);
      const fallback = await env.GAMES.get(`${key}/index.html`);
      if (fallback) return objectResponse(fallback, `${key}/index.html`, request, undefined, versioned);
    } catch {
      /* fallthrough */
    }
  }
  return textResponse(404, '游戏资源不存在');
}
