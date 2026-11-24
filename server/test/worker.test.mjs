import { describe, expect, it } from 'vitest';
import worker from '../worker.mjs';

/** 与 game-assets.test.mjs 相同的最小 R2 模拟(只覆盖 worker 路由测试所需)。 */
function createR2Mock(objects) {
  const map = new Map(Object.entries(objects));
  return {
    async get(key) {
      const value = map.get(key);
      if (value === undefined) return null;
      return {
        body: value,
        size: new TextEncoder().encode(value).length,
        httpEtag: '"mock"',
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      };
    },
  };
}

const GAMES = createR2Mock({ 'g/bvn/index.html': '<html>bvn</html>' });
const ASSETS = { fetch: async () => new Response('spa') };

describe('worker 路由分流', () => {
  it('游戏内容域任意路径 → R2 静态资源', async () => {
    const res = await worker.fetch(new Request('https://games.gamedock.cn/g/bvn/index.html'), { GAMES, ASSETS });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>bvn</html>');
  });

  it('游戏内容域源站名(QEdge 回源 Host)同样 → R2 静态资源', async () => {
    const res = await worker.fetch(new Request('https://origin-games.gamedock.cn/g/bvn/index.html'), { GAMES, ASSETS });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>bvn</html>');
  });

  it('游戏内容域根路径 → 404(不托管平台 SPA)', async () => {
    const res = await worker.fetch(new Request('https://games.gamedock.cn/'), { GAMES, ASSETS });
    expect(res.status).toBe(404);
  });

  it('主域 /g/* → 301 到游戏内容域(保留路径与查询)', async () => {
    const res = await worker.fetch(
      new Request('https://gamedock.cn/g/bvn/index.html?v=2'),
      { GAMES, ASSETS },
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://games.gamedock.cn/g/bvn/index.html?v=2');
  });

  it('本地 dev(localhost)/g/* → 直接读 R2 模拟,不重定向', async () => {
    const res = await worker.fetch(
      new Request('http://localhost:8787/g/bvn/index.html'),
      { GAMES, ASSETS },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>bvn</html>');
  });

  it('主域其余路径 → Static Assets', async () => {
    const res = await worker.fetch(new Request('https://gamedock.cn/'), { GAMES, ASSETS });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('spa');
  });
});
