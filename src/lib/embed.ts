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
  /**
   * 邀请加入参数(2026-11-23,好友邀请深链):经邀请打开运行页时携带,
   * 值为游戏自定义的参数对象(平台只透传、不解析;无邀请时为 null)。
   */
  join?: Record<string, unknown> | null;
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
 * 游戏上报当前可加入的邀请参数(game:invite-context,2026-11-23):
 * 游戏进入房间等可被邀请加入的状态时上报参数对象(如房间码/节点),
 * 离开该状态时上报 null;平台存储最新值,好友面板发邀请时随邀请透传。
 * 平台不解析参数含义,只校验形状:对象且值为 string/number/boolean,总量 ≤1KB。
 */
export interface GameInviteContextMessage extends GameMessage {
  t: 'game:invite-context';
  params: Record<string, unknown> | null;
}

const INVITE_PARAMS_MAX = 1024;

/** game:invite-context 载荷校验:非法上报按 null 处理(清空)。 */
export function parseInviteContext(data: GameMessage): Record<string, unknown> | null | undefined {
  if (data.t !== 'game:invite-context') return undefined;
  const params = (data as { params?: unknown }).params;
  if (params === null) return null;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  for (const value of Object.values(params as Record<string, unknown>)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) return null;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
  }
  try {
    if (JSON.stringify(params).length > INVITE_PARAMS_MAX) return null;
  } catch {
    return null;
  }
  return params as Record<string, unknown>;
}


/**
 * 平台发送 hello 完成握手（携带 slug 与已登录用户或 null;邀请加入参数可选）。
 * 时序说明:hello 可能在游戏侧监听器就绪前发出(消息丢失),
 * 因此游戏可发 `game:ready` 请求重发,平台收到后再次 hello——两边谁先就绪都能完成握手。
 */
export function sendPlatformHello(
  target: Window,
  origin: string,
  slug: string,
  user: PlatformUser | null,
  join: Record<string, unknown> | null = null,
): void {
  const message: PlatformHelloMessage = {
    v: PROTOCOL_VERSION,
    t: 'platform:hello',
    platform: 'gamedock',
    slug,
    user,
    join,
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
