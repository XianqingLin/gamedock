import type { GameMessage, PlatformHelloMessage, GameDockEnv } from '../src/index';

/** 最小 Window 替身:捕获 message 监听器,可手动注入事件。 */
export class FakeWindow {
  readonly sent: Array<{ message: unknown; origin: string }> = [];
  private listeners = new Set<(event: MessageEvent) => void>();

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') this.listeners.delete(listener);
  }

  postMessage(message: unknown, origin: string) {
    this.sent.push({ message, origin });
  }

  dispatch(message: unknown, source: unknown) {
    for (const listener of this.listeners) listener({ data: message, source } as MessageEvent);
  }
}

/** fetch 替身:按 (method, path) 记录请求并返回预置 Response。 */
export class FakeFetch {
  readonly calls: Array<{ method: string; path: string; body?: unknown }> = [];
  constructor(
    private responder: (call: { method: string; path: string; body?: unknown }) => Response,
  ) {}

  impl = (url: string, init?: RequestInit): Response => {
    const path = new URL(url, 'https://platform.test').pathname;
    const call = {
      method: init?.method ?? 'GET',
      path,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    this.calls.push(call);
    return this.responder(call);
  };
}

export function helloMessage(user: PlatformHelloMessage['user'] = null): PlatformHelloMessage {
  return { v: 1, t: 'platform:hello', platform: 'gamedock', slug: 'tether-together', user };
}

export function makeEnv(
  hello: PlatformHelloMessage,
  fetcher: FakeFetch,
  parent = new FakeWindow(),
  self = new FakeWindow(),
): GameDockEnv {
  return {
    parentWindow: parent as unknown as Window,
    selfWindow: self as unknown as Window,
    fetchImpl: fetcher.impl,
    origin: 'https://platform.test',
  };
}

/** 模拟平台:收到 game:ready 即回 hello。 */
export function autoReplyPlatform(parent: FakeWindow, hello: PlatformHelloMessage, self: FakeWindow) {
  parent.postMessage = (message: unknown) => {
    parent.sent.push({ message, origin: '*' });
    const msg = message as GameMessage;
    if (msg?.t === 'game:ready') self.dispatch(hello, parent);
  };
}
