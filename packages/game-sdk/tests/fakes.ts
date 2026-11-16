import type { GameMessage, PlatformHelloMessage, XlpEnv } from '../src/index';

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

/** 最小 WebSocket 替身:记录发出的消息,测试可手动 open/receive/close。 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.fire('close', { code, reason });
  }

  /** 测试驱动:模拟连接建立。 */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.fire('open', {});
  }

  /** 测试驱动:模拟服务端来消息。 */
  receive(envelope: Record<string, unknown>) {
    this.fire('message', { data: JSON.stringify(envelope) });
  }

  /** 测试视角:取本连接发出的第 n 条 JSON 信封。 */
  sentAt(index: number): Record<string, unknown> {
    return JSON.parse(this.sent[index]!);
  }

  private fire(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

export function helloMessage(user: PlatformHelloMessage['user'] = null): PlatformHelloMessage {
  return { v: 1, t: 'platform:hello', platform: 'xiao-lin-game-shop', slug: 'tether-together', user };
}

export function makeEnv(
  hello: PlatformHelloMessage,
  fetcher: FakeFetch,
  parent = new FakeWindow(),
  self = new FakeWindow(),
  webSocketImpl: typeof WebSocket = FakeWebSocket as unknown as typeof WebSocket,
): XlpEnv {
  return {
    parentWindow: parent as unknown as Window,
    selfWindow: self as unknown as Window,
    fetchImpl: fetcher.impl,
    origin: 'https://platform.test',
    WebSocketImpl: webSocketImpl,
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
