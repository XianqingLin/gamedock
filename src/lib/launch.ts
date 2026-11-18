import type { Game, LaunchResolution } from './types';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * 游戏内容域源(与 server/worker.mjs 的 GAME_HOST、wrangler.jsonc routes 对应)。
 * 生产环境游戏以跨源 iframe 运行在 games.gamedock.cn 下,与平台会话隔离;
 * 本地 dev(vitest/vite)为空串,launchUrl 保持同源路径经代理访问。
 */
export const GAME_ORIGIN = import.meta.env.PROD ? 'https://games.gamedock.cn' : '';

/**
 * 启动解析（产品需求 4.4）：
 * - available + 站内路径 → iframe 站内路由加载(生产环境拼游戏内容域 origin);
 * - available + http(s) 外链 → 新窗口（noopener/noreferrer）；
 * - available + 地址缺失/协议非法 → 暂不可启动；
 * - coming-soon / maintenance → 未开放 / 维护中。
 * 协议白名单校验拦截 javascript: 等危险地址；站内路径排除协议相对地址 `//`。
 * gameOrigin 可注入以便测试;默认取运行环境的 GAME_ORIGIN。
 */
export function resolveLaunch(game: Game, gameOrigin: string = GAME_ORIGIN): LaunchResolution {
  if (game.status === 'coming-soon') return { kind: 'disabled', reason: 'coming-soon' };
  if (game.status === 'maintenance') return { kind: 'disabled', reason: 'maintenance' };

  const raw = game.launchUrl?.trim();
  if (!raw) return { kind: 'disabled', reason: 'no-url' };

  if (raw.startsWith('/')) {
    return raw.startsWith('//')
      ? { kind: 'disabled', reason: 'invalid-url' }
      : { kind: 'internal', url: `${gameOrigin}${raw}` };
  }

  try {
    const parsed = new URL(raw);
    if (EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return { kind: 'external', url: parsed.toString() };
    }
  } catch {
    // 解析失败按无效地址处理。
  }
  return { kind: 'disabled', reason: 'invalid-url' };
}
