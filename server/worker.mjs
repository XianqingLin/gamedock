/**
 * GameDock Worker 入口(Cloudflare Workers)。
 * - 游戏内容域(games.gamedock.cn):全部请求 → R2 静态资源(handleGameAsset)。
 *   游戏与平台跨源隔离:平台会话 Cookie 为 host-only,不会进入游戏域。
 * - 主域(gamedock.cn / www):
 *   - /api/*:平台 API(handleApi,D1 存用户/好友,KV 存玩家存档);
 *     游戏域 iframe 跨源调用需 CORS,仅对游戏内容域开放(带凭据)。
 *   - /g/*:301 到游戏内容域同路径(dev 本地代理例外,直接读本地 R2 模拟)。
 *   - 其余路径:Static Assets 托管平台 SPA。
 */
import gamesData from '../src/data/games.json' with { type: 'json' };
import gamesConfig from './games.config.json' with { type: 'json' };
import { handleApi } from './api.mjs';
import { handleGameAsset } from './game-assets.mjs';
import { createD1Store } from './store-d1.mjs';
import { createKvSaves } from './saves-kv.mjs';

/** 游戏内容域:与 wrangler.jsonc 的 routes 保持一致(不导出,Workers 入口只允许 default)。 */
const GAME_HOST = 'games.gamedock.cn';
const PLATFORM_HOSTS = new Set(['gamedock.cn', 'www.gamedock.cn']);

const gameSlugs = new Set(Object.keys(gamesConfig));

function jsonResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function isGameHost(hostname) {
  return hostname === GAME_HOST || hostname.endsWith(`.${GAME_HOST}`);
}

export default {
  async fetch(request, env) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return jsonResponse(400, '非法请求');
    }
    const { pathname, search, hostname } = url;

    // 游戏内容域:只服务 R2 里的游戏静态资源。
    if (isGameHost(hostname)) {
      try {
        return await handleGameAsset(request, env);
      } catch (err) {
        console.error('[worker] 游戏资源请求失败:', err);
        return jsonResponse(500, '服务器内部错误');
      }
    }

    if (pathname.startsWith('/g/')) {
      // 生产主域不再托管游戏静态资源,统一 301 到内容域(key 与路径一一对应)。
      // 仅 https(真生产)才重定向:wrangler dev 配置自定义域后会把请求 URL 的
      // host 重写为第一个自定义域,无法用 hostname 区分 dev,只能靠协议。
      if (url.protocol === 'https:' && PLATFORM_HOSTS.has(hostname)) {
        return new Response(null, {
          status: 301,
          headers: { Location: `https://${GAME_HOST}${pathname}${search}` },
        });
      }
      // 本地 dev(vite/wrangler 代理):直接读本地 R2 模拟(sync-games.mjs --local 写入)。
      return handleGameAsset(request, env);
    }

    if (pathname !== '/api' && !pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (!env.DB || !env.SAVES) {
      return jsonResponse(503, '存储绑定缺失:请检查 wrangler.jsonc 的 D1/KV 配置。');
    }
    if (!env.GAMEDOCK_SESSION_SECRET) {
      return jsonResponse(503, '缺少会话密钥:请先 wrangler secret put GAMEDOCK_SESSION_SECRET。');
    }

    const appEnv = {
      store: createD1Store(env.DB),
      saves: createKvSaves(env.SAVES),
      sessionSecret: env.GAMEDOCK_SESSION_SECRET,
      gameSlugs,
      gamesData,
      gameOrigin: `https://${GAME_HOST}`,
    };

    try {
      return await handleApi(request, appEnv);
    } catch (err) {
      console.error('[worker] 请求处理失败:', err);
      return jsonResponse(500, '服务器内部错误');
    }
  },
};
