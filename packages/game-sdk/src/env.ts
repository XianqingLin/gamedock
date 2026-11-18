export interface GameDockEnv {
  parentWindow: Window | null;
  selfWindow: Window;
  fetchImpl: typeof fetch;
  origin: string;
  /** WebSocket 构造器(测试注入用);默认用全局 WebSocket。 */
  WebSocketImpl: typeof WebSocket;
}

export function defaultEnv(): GameDockEnv {
  const selfWindow = window;
  return {
    parentWindow: selfWindow.parent === selfWindow ? null : selfWindow.parent,
    selfWindow,
    fetchImpl: fetch.bind(selfWindow),
    origin: selfWindow.location.origin,
    WebSocketImpl: selfWindow.WebSocket,
  };
}
