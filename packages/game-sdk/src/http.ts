import { GameDockApiError } from './errors';
import type { GameDockEnv } from './env';

/** 平台 REST 通用请求:非 2xx 抛 GameDockApiError(文案为服务端原文)。 */
export async function requestPlatform(
  env: GameDockEnv,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await env.fetchImpl(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new GameDockApiError((data?.error as string) ?? `平台请求失败(${res.status})`, res.status);
  }
  return data ?? {};
}
