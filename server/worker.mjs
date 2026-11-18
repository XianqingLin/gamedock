/**
 * GameDock Worker 入口(Cloudflare Workers)。
 * - /api/*:平台 API(handleApi,D1 存用户/好友,KV 存玩家存档)
 * - 其余路径:Static Assets 托管平台 SPA 与 /g/<slug> 游戏静态资源
 *   (wrangler.jsonc 的 assets 配置负责直接命中与 SPA 回退,这里只兜底)。
 */
import gamesData from '../src/data/games.json' with { type: 'json' };
import gamesConfig from './games.config.json' with { type: 'json' };
import { handleApi } from './api.mjs';
import { createD1Store } from './store-d1.mjs';
import { createKvSaves } from './saves-kv.mjs';

const gameSlugs = new Set(Object.keys(gamesConfig));

function jsonResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
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
    };

    try {
      return await handleApi(request, appEnv);
    } catch (err) {
      console.error('[worker] 请求处理失败:', err);
      return jsonResponse(500, '服务器内部错误');
    }
  },
};
