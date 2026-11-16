import type { Game, LaunchResolution } from './types';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * 启动解析（产品需求 4.4）：
 * - available + 站内路径 → iframe 站内路由加载；
 * - available + http(s) 外链 → 新窗口（noopener/noreferrer）；
 * - available + 地址缺失/协议非法 → 暂不可启动；
 * - coming-soon / maintenance → 未开放 / 维护中。
 * 协议白名单校验拦截 javascript: 等危险地址；站内路径排除协议相对地址 `//`。
 */
export function resolveLaunch(game: Game): LaunchResolution {
  if (game.status === 'coming-soon') return { kind: 'disabled', reason: 'coming-soon' };
  if (game.status === 'maintenance') return { kind: 'disabled', reason: 'maintenance' };

  const raw = game.launchUrl?.trim();
  if (!raw) return { kind: 'disabled', reason: 'no-url' };

  if (raw.startsWith('/')) {
    return raw.startsWith('//') ? { kind: 'disabled', reason: 'invalid-url' } : { kind: 'internal', url: raw };
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
