import { describe, expect, it } from 'vitest';
import { handleGameAsset } from '../game-assets.mjs';

/**
 * 极简 R2 模拟:值可以是字符串(仅对象体)或 { body, contentType }(带元数据);
 * range 时按语义切片并回填 object.range/size。
 * 只模拟 handleGameAsset 依赖的字段(body/httpMetadata/httpEtag/size/range)。
 */
function createR2Mock(objects) {
  const map = new Map(
    Object.entries(objects).map(([key, value]) => [
      key,
      typeof value === 'string' ? { body: value } : value,
    ]),
  );
  return {
    async get(key, options) {
      const entry = map.get(key);
      if (entry === undefined) return null;
      const size = new TextEncoder().encode(entry.body).length;
      const object = {
        body: entry.body,
        size,
        httpEtag: '"mock"',
        httpMetadata: entry.contentType ? { contentType: entry.contentType } : undefined,
      };
      if (options?.range) {
        // 与 R2 一致:offset 越界视为非法 range,抛错(由调用方退回全量)。
        if (options.range.suffix === undefined && (options.range.offset ?? 0) >= size) {
          throw new Error('R2: range out of bounds');
        }
        object.range = options.range;
        if (options.range.suffix !== undefined) {
          object.body = entry.body.slice(-options.range.suffix);
        } else {
          const start = options.range.offset ?? 0;
          const length = options.range.length ?? size - start;
          object.body = entry.body.slice(start, start + length);
        }
      }
      return object;
    },
  };
}

const R2 = createR2Mock({
  'g/bvn/index.html': '<html>bvn</html>',
  'g/bvn/js/app.js': 'console.log(1)',
  'g/bvn/assets/index-AbC.js': 'export default 1',
  'g/bvn/assets/logo.svg': '<svg/>',
  'g/bvn/packages/data/assets/fighters/x.webp': 'webp',
  'g/bvn/packages/data/baked/x.json': '{"ok":true}',
  'g/tether-together/data.bin': '0123456789',
  'g/meta/index.html': '<html>meta</html>',
});

function request(path, { method = 'GET', headers = {} } = {}) {
  return new Request(`https://games.gamedock.cn${path}`, { method, headers });
}

describe('handleGameAsset R2 静态资源服务', () => {
  it('命中文件 → 200 + 元数据 Content-Type 优先', async () => {
    const r2 = createR2Mock({
      'g/bvn/js/app.js': { body: 'ok', contentType: 'text/javascript; charset=utf-8' },
    });
    const res = await handleGameAsset(request('/g/bvn/js/app.js'), { GAMES: r2 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(await res.text()).toBe('ok');
  });

  it('无元数据时按扩展名推断 Content-Type', async () => {
    const res = await handleGameAsset(request('/g/bvn/assets/logo.svg'), { GAMES: R2 });
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
  });

  it('未知扩展名 → application/octet-stream', async () => {
    const res = await handleGameAsset(request('/g/tether-together/data.bin'), { GAMES: R2 });
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('目录路径回退 index.html:/g/bvn 与 /g/bvn/', async () => {
    for (const path of ['/g/bvn', '/g/bvn/']) {
      const res = await handleGameAsset(request(path), { GAMES: R2 });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(await res.text()).toBe('<html>bvn</html>');
    }
  });

  it('index.html 不缓存;哈希块 immutable;数据资产一天', async () => {
    const index = await handleGameAsset(request('/g/bvn/index.html'), { GAMES: R2 });
    const hashed = await handleGameAsset(request('/g/bvn/assets/index-AbC.js'), { GAMES: R2 });
    const data = await handleGameAsset(request('/g/bvn/js/app.js'), { GAMES: R2 });
    const nested = await handleGameAsset(request('/g/bvn/packages/data/assets/fighters/x.webp'), {
      GAMES: R2,
    });
    expect(index.headers.get('Cache-Control')).toBe('no-cache');
    expect(hashed.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(data.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(nested.headers.get('Cache-Control')).toBe('public, max-age=86400');
    // 测试环境无 ctx → 不走边缘缓存
    expect(hashed.headers.get('X-Cache')).toBe('MISS');
  });

  it('?v= 指纹 URL → immutable(任意路径;无指纹同路径维持原策略)', async () => {
    const data = await handleGameAsset(request('/g/bvn/packages/data/baked/x.json?v=f7bede49'), {
      GAMES: R2,
    });
    const audio = await handleGameAsset(
      request('/g/bvn/packages/data/assets/fighters/x.webp?v=abcd1234'),
      { GAMES: R2 },
    );
    expect(data.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(audio.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    // 无指纹的同路径维持一天策略
    const sameUnversioned = await handleGameAsset(request('/g/bvn/packages/data/baked/x.json'), {
      GAMES: R2,
    });
    expect(sameUnversioned.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('未命中 → 404', async () => {
    const res = await handleGameAsset(request('/g/nope/index.html'), { GAMES: R2 });
    expect(res.status).toBe(404);
  });

  it('路径穿越(..)与反斜杠 → 404', async () => {
    for (const path of ['/g/../secret', '/g/bvn%2F..%2Fsecret', '/g/bvn\\..\\secret']) {
      const res = await handleGameAsset(request(path), { GAMES: R2 });
      expect(res.status).toBe(404);
    }
  });

  it('根路径 → 404(游戏域不托管平台内容)', async () => {
    const res = await handleGameAsset(request('/'), { GAMES: R2 });
    expect(res.status).toBe(404);
  });

  it('非 GET/HEAD → 405', async () => {
    const res = await handleGameAsset(request('/g/bvn/index.html', { method: 'PUT' }), { GAMES: R2 });
    expect(res.status).toBe(405);
  });

  it('缺少 R2 绑定 → 503', async () => {
    const res = await handleGameAsset(request('/g/bvn/index.html'), {});
    expect(res.status).toBe(503);
  });

  it('HEAD → 200 无响应体', async () => {
    const res = await handleGameAsset(request('/g/bvn/index.html', { method: 'HEAD' }), { GAMES: R2 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  describe('Range 请求', () => {
    it('bytes=N-M → 206 + Content-Range', async () => {
      const res = await handleGameAsset(request('/g/tether-together/data.bin', {
        headers: { Range: 'bytes=2-5' },
      }), { GAMES: R2 });
      expect(res.status).toBe(206);
      expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10');
      expect(res.headers.get('Content-Length')).toBe('4');
      expect(await res.text()).toBe('2345');
    });

    it('bytes=N- → 206 到末尾', async () => {
      const res = await handleGameAsset(request('/g/tether-together/data.bin', {
        headers: { Range: 'bytes=8-' },
      }), { GAMES: R2 });
      expect(res.status).toBe(206);
      expect(res.headers.get('Content-Range')).toBe('bytes 8-9/10');
      expect(await res.text()).toBe('89');
    });

    it('bytes=-N → 206 末尾 N 字节', async () => {
      const res = await handleGameAsset(request('/g/tether-together/data.bin', {
        headers: { Range: 'bytes=-4' },
      }), { GAMES: R2 });
      expect(res.status).toBe(206);
      expect(res.headers.get('Content-Range')).toBe('bytes 6-9/10');
      expect(await res.text()).toBe('6789');
    });

    it('超界 Range 不炸:退回全量 200', async () => {
      const res = await handleGameAsset(request('/g/tether-together/data.bin', {
        headers: { Range: 'bytes=100-' },
      }), { GAMES: R2 });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('0123456789');
    });
  });
});
