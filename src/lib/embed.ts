/**
 * 平台 ↔ 游戏（iframe）之间的 postMessage 窄接口信封。
 * 平台消息以 `platform:` 开头，游戏消息以 `game:` 开头；版本号 v 当前为 1。
 * 存档、分数、凭证下发等后续能力在此信封上扩展，游戏不直接操作平台内部状态。
 */

export const PROTOCOL_VERSION = 1;

export interface PlatformUser {
  id: string;
  username: string;
}

export interface PlatformHelloMessage {
  v: typeof PROTOCOL_VERSION;
  t: 'platform:hello';
  platform: 'gamedock';
  /** 当前游戏 slug,游戏侧 SDK 直接用它拼存档等 API 路径。 */
  slug: string;
  user: PlatformUser | null;
}

export interface GameMessage {
  v: number;
  t: string;
  [key: string]: unknown;
}

/** 游戏上报画面尺寸(game:viewport):平台据此信箱式限制 iframe 比例。 */
export interface GameViewportMessage extends GameMessage {
  t: 'game:viewport';
  width: number;
  height: number;
}

/**
 * 平台发送 hello 完成握手（携带 slug 与已登录用户或 null）。
 * 时序说明:hello 可能在游戏侧监听器就绪前发出(消息丢失),
 * 因此游戏可发 `game:ready` 请求重发,平台收到后再次 hello——两边谁先就绪都能完成握手。
 */
export function sendPlatformHello(
  target: Window,
  origin: string,
  slug: string,
  user: PlatformUser | null,
): void {
  const message: PlatformHelloMessage = {
    v: PROTOCOL_VERSION,
    t: 'platform:hello',
    platform: 'gamedock',
    slug,
    user,
  };
  target.postMessage(message, origin);
}

export function isGameMessage(data: unknown): data is GameMessage {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const value = data as Record<string, unknown>;
  return value.v === PROTOCOL_VERSION && typeof value.t === 'string' && value.t.startsWith('game:');
}

/** game:viewport 载荷校验:宽高必须是正的有限数,非法上报直接忽略。 */
export function isGameViewportMessage(data: GameMessage): data is GameViewportMessage {
  const finitePositive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return data.t === 'game:viewport' && finitePositive(data.width) && finitePositive(data.height);
}
