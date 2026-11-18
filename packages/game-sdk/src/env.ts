export interface GameDockEnv {
  parentWindow: Window | null;
  selfWindow: Window;
  fetchImpl: typeof fetch;
  origin: string;
}

export function defaultEnv(): GameDockEnv {
  const selfWindow = window;
  return {
    parentWindow: selfWindow.parent === selfWindow ? null : selfWindow.parent,
    selfWindow,
    fetchImpl: fetch.bind(selfWindow),
    origin: selfWindow.location.origin,
  };
}
