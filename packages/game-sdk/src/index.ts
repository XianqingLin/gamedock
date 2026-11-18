/**
 * GameDock游戏侧 SDK v1。
 *
 * 游戏通过 connectGameDock() 与平台握手,获得:
 * - 当前游戏 slug 与登录用户(来自 platform:hello)
 * - 存档 API(saves.*):平台 /api/saves 的封装
 * - postMessage 收发通道(平台层事件)
 *
 * 游戏 iframe 内不要用 localStorage 做持久化,统一走 saves。
 * 未在平台内运行(独立开发调试)时 SDK 进入 standalone 模式:握手字段为空,
 * saves 调用异步抛 GameDockError,游戏自身逻辑不受影响。
 */

import { GameDockApiError, GameDockError } from './errors';
import { defaultEnv } from './env';
import { requestPlatform } from './http';
import type { GameDockEnv } from './env';

export type { GameDockEnv };
export { GameDockError, GameDockApiError };

export const PROTOCOL_VERSION = 1;

export interface PlatformUser {
  id: string;
  username: string;
}

export interface PlatformHelloMessage {
  v: typeof PROTOCOL_VERSION;
  t: 'platform:hello';
  platform: string;
  slug: string;
  user: PlatformUser | null;
}

export interface GameMessage {
  v: number;
  t: string;
  [key: string]: unknown;
}

export interface SaveSlotMeta {
  key: string;
  updatedAt: string | null;
  size: number | null;
}

export interface SaveReadResult<T = unknown> {
  key: string;
  value: T;
  updatedAt: string | null;
}

export interface SaveWriteResult {
  key: string;
  updatedAt: string;
  size: number;
}

export interface SavesApi {
  /** 列出当前游戏全部槽位元数据(按更新时间倒序)。 */
  list(): Promise<SaveSlotMeta[]>;
  /** 读取槽位;不存在返回 null(其余错误抛 GameDockApiError)。 */
  get<T = unknown>(key: string): Promise<SaveReadResult<T> | null>;
  /** 写入槽位(值须可 JSON 序列化,单槽上限 256KB);last-write-wins。 */
  put<T = unknown>(key: string, value: T): Promise<SaveWriteResult>;
  /** 删除槽位(幂等)。 */
  remove(key: string): Promise<void>;
}

export interface GameDockSdk {
  /** 已登录用户;未登录或 standalone 为 null。 */
  readonly user: PlatformUser | null;
  /** 当前游戏 slug(来自 hello);standalone 为 null。 */
  readonly slug: string | null;
  /** 未在平台内运行时为 true。 */
  readonly standalone: boolean;
  /** 订阅平台消息(platform: 前缀,信封已校验)。返回退订函数。 */
  onPlatformMessage(handler: (message: GameMessage) => void): () => void;
  /** 向平台发消息,自动补 v。 */
  send(message: { t: string } & Record<string, unknown>): void;
  readonly saves: SavesApi;
}

export interface ConnectOptions {
  /** 等待 hello 的超时毫秒数,默认 1500;超时进入 standalone。 */
  helloTimeoutMs?: number;
  /**
   * 环境完整注入(仅测试用):不传则取 window / fetch / WebSocket。
   * 注入时必须是完整 GameDockEnv,SDK 不会触碰任何浏览器全局。
   */
  env?: GameDockEnv;
}

const READY_MESSAGE: GameMessage = { v: PROTOCOL_VERSION, t: 'game:ready' };

function isHello(data: unknown): data is PlatformHelloMessage {
  if (!data || typeof data !== 'object') return false;
  const value = data as Record<string, unknown>;
  return (
    value.v === PROTOCOL_VERSION &&
    value.t === 'platform:hello' &&
    typeof value.slug === 'string' &&
    value.slug.length > 0
  );
}

function isPlatformMessage(data: unknown): data is GameMessage {
  if (!data || typeof data !== 'object') return false;
  const value = data as Record<string, unknown>;
  return value.v === PROTOCOL_VERSION && typeof value.t === 'string' && value.t.startsWith('platform:');
}

/** 与平台握手并创建 SDK。永不 reject:握手失败按 standalone 处理。 */
export async function connectGameDock(options: ConnectOptions = {}): Promise<GameDockSdk> {
  // env 完整注入时(仅测试)完全不触碰 window 等浏览器全局。
  const env = options.env ?? defaultEnv();
  const timeoutMs = options.helloTimeoutMs ?? 1500;

  const hello = env.parentWindow ? await waitForHello(env, env.parentWindow, timeoutMs) : null;

  if (!hello) return createStandaloneSdk();
  return createConnectedSdk(env, hello);
}

function waitForHello(env: GameDockEnv, parent: Window, timeoutMs: number): Promise<PlatformHelloMessage | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (message: PlatformHelloMessage | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      env.selfWindow.removeEventListener('message', onMessage);
      resolve(message);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== parent) return;
      if (isHello(event.data)) finish(event.data);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    env.selfWindow.addEventListener('message', onMessage);
    // 主动请求握手:hello 可能在本监听器就绪前已发出。
    parent.postMessage(READY_MESSAGE, '*');
  });
}

function createStandaloneSdk(): GameDockSdk {
  // 必须是异步抛错:接口契约是返回 Promise,同步 throw 会绕过调用方的 await 链。
  const notAvailable = async () => {
    throw new GameDockError('未在平台内运行,该能力不可用');
  };
  return {
    user: null,
    slug: null,
    standalone: true,
    onPlatformMessage: () => () => {},
    send: () => {},
    saves: { list: notAvailable, get: notAvailable, put: notAvailable, remove: notAvailable },
  };
}

function createConnectedSdk(env: GameDockEnv, hello: PlatformHelloMessage): GameDockSdk {
  const handlers = new Set<(message: GameMessage) => void>();

  env.selfWindow.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== env.parentWindow) return;
    if (!isPlatformMessage(event.data)) return;
    for (const handler of handlers) handler(event.data);
  });

  const assertKey = (key: string) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
      throw new GameDockError(`非法存档 key:${key}`);
    }
  };

  const savesRequest = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> =>
    requestPlatform(env, method, `/api/saves/${hello.slug}${path}`, body);

  const saves: SavesApi = {
    async list() {
      const data = await savesRequest('GET', '');
      return (data.slots as SaveSlotMeta[]) ?? [];
    },
    async get<T = unknown>(key: string) {
      assertKey(key);
      try {
        return (await savesRequest('GET', `/${key}`)) as unknown as SaveReadResult<T>;
      } catch (err) {
        if (err instanceof GameDockApiError && err.status === 404) return null;
        throw err;
      }
    },
    async put(key, value) {
      assertKey(key);
      return (await savesRequest('PUT', `/${key}`, { value })) as unknown as SaveWriteResult;
    },
    async remove(key) {
      assertKey(key);
      await savesRequest('DELETE', `/${key}`);
    },
  };

  return {
    user: hello.user,
    slug: hello.slug,
    standalone: false,
    onPlatformMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    send(message) {
      if (!env.parentWindow) return;
      const payload: GameMessage = { v: PROTOCOL_VERSION, ...message };
      env.parentWindow.postMessage(payload, '*');
    },
    saves,
  };
}
