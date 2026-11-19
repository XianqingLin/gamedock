import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  connectGameDock,
  GameDockApiError,
  GameDockError,
  type GameMessage,
  type PlatformHelloMessage,
  type GameDockEnv,
} from '../src/index';
import { FakeFetch, FakeWindow, autoReplyPlatform, helloMessage, makeEnv } from './fakes';

function makeEnv_(hello: PlatformHelloMessage, fetcher: FakeFetch, parent?: FakeWindow, self?: FakeWindow): GameDockEnv {
  return makeEnv(hello, fetcher, parent, self);
}

describe('connectGameDock 握手', () => {
  it('parentWindow 非 null 但无应答 → 走超时 standalone,能力不可用', async () => {
    const sdk = await connectGameDock({
      env: makeEnv_(helloMessage(), new FakeFetch(() => new Response('{}')), new FakeWindow()),
      helloTimeoutMs: 30,
    });
    assert.equal(sdk.standalone, true);
    assert.equal(sdk.slug, null);
    assert.equal(sdk.user, null);
    await assert.rejects(() => sdk.saves.put('slot1', {}), GameDockError);
  });

  it('平台应答 game:ready → 完成握手,拿到 slug 与用户', async () => {
    const parent = new FakeWindow();
    const self = new FakeWindow();
    const fetcher = new FakeFetch(() => new Response('{}'));
    autoReplyPlatform(parent, helloMessage({ id: 'u1', username: '小林' }), self);

    const sdk = await connectGameDock({ env: makeEnv_(helloMessage(), fetcher, parent, self) });
    assert.equal(sdk.standalone, false);
    assert.equal(sdk.slug, 'tether-together');
    assert.deepEqual(sdk.user, { id: 'u1', username: '小林' });
    // 主动发过 game:ready。
    assert.ok(parent.sent.some((m) => (m.message as GameMessage).t === 'game:ready'));
  });

  it('超时未收到 hello → standalone', async () => {
    const sdk = await connectGameDock({
      env: makeEnv_(helloMessage(), new FakeFetch(() => new Response('{}'))),
      helloTimeoutMs: 30,
    });
    assert.equal(sdk.standalone, true);
  });
});

describe('saves API', () => {
  async function connectedSdk(responder: (call: { method: string; path: string; body?: unknown }) => Response) {
    const parent = new FakeWindow();
    const self = new FakeWindow();
    const fetcher = new FakeFetch(responder);
    autoReplyPlatform(parent, helloMessage(), self);
    const sdk = await connectGameDock({ env: makeEnv_(helloMessage(), fetcher, parent, self) });
    return { sdk, fetcher };
  }

  it('put → PUT /api/saves/<slug>/<key>,body 为 { value }', async () => {
    const { sdk, fetcher } = await connectedSdk(
      () => new Response(JSON.stringify({ key: 'slot1', updatedAt: '2026-11-16T00:00:00Z', size: 10 })),
    );
    const result = await sdk.saves.put('slot1', { level: 2 });
    assert.deepEqual(result, { key: 'slot1', updatedAt: '2026-11-16T00:00:00Z', size: 10 });
    const call = fetcher.calls[0]!;
    assert.equal(call.method, 'PUT');
    assert.equal(call.path, '/api/saves/tether-together/slot1');
    assert.deepEqual(call.body, { value: { level: 2 } });
  });

  it('get 命中返回 value,404 返回 null,其余错误抛 GameDockApiError', async () => {
    let status = 200;
    const { sdk } = await connectedSdk(() =>
      new Response(JSON.stringify(status === 200 ? { key: 'slot1', value: { hp: 9 }, updatedAt: 't' } : { error: '需要登录' }), { status }),
    );
    const hit = await sdk.saves.get('slot1');
    assert.deepEqual(hit?.value, { hp: 9 });

    status = 404;
    assert.equal(await sdk.saves.get('missing'), null);

    status = 401;
    await assert.rejects(
      () => sdk.saves.get('slot1'),
      (err: unknown) => err instanceof GameDockApiError && err.status === 401 && /需要登录/.test(String((err as Error).message)),
    );
  });

  it('非法 key 抛 GameDockError 且不发出请求', async () => {
    const { sdk, fetcher } = await connectedSdk(() => new Response('{}'));
    for (const bad of ['bad.key', '../escape', '']) {
      await assert.rejects(() => sdk.saves.put(bad as string, 1), GameDockError);
    }
    assert.equal(fetcher.calls.length, 0);
  });

  it('list 与 remove 走对应方法与路径', async () => {
    const { sdk, fetcher } = await connectedSdk(() => new Response(JSON.stringify({ slug: 'tether-together', slots: [{ key: 'progress', updatedAt: 't', size: 5 }] })));
    const slots = await sdk.saves.list();
    assert.deepEqual(slots, [{ key: 'progress', updatedAt: 't', size: 5 }]);

    await sdk.saves.remove('progress');
    assert.equal(fetcher.calls.at(-1)!.method, 'DELETE');
    assert.equal(fetcher.calls.at(-1)!.path, '/api/saves/tether-together/progress');
  });
});

describe('postMessage 通道', () => {
  it('send 自动补 v,平台消息经 onPlatformMessage 送达', async () => {
    const parent = new FakeWindow();
    const self = new FakeWindow();
    autoReplyPlatform(parent, helloMessage(), self);
    const sdk = await connectGameDock({ env: makeEnv_(helloMessage(), new FakeFetch(() => new Response('{}')), parent, self) });

    const received: GameMessage[] = [];
    const off = sdk.onPlatformMessage((m) => received.push(m));

    // 平台来源的消息送达;错误来源与非 platform: 前缀被过滤。
    self.dispatch({ v: 1, t: 'platform:match-found', roomId: 'r1' }, parent);
    self.dispatch({ v: 1, t: 'game:whatever' }, parent);
    self.dispatch({ v: 1, t: 'platform:fake' }, { source: 'other' } as unknown as FakeWindow);

    sdk.send({ t: 'game:score', score: 10 });
    const sent = parent.sent.at(-1)!.message as GameMessage;
    assert.equal(sent.v, 1);
    assert.equal(sent.t, 'game:score');
    assert.equal(sent.score, 10);

    off();
    self.dispatch({ v: 1, t: 'platform:after-off' }, parent);
    assert.deepEqual(received.map((m) => m.t), ['platform:match-found']);
  });

  it('reportViewport 发送 game:viewport 载荷;standalone 下为 no-op', async () => {
    const parent = new FakeWindow();
    const self = new FakeWindow();
    autoReplyPlatform(parent, helloMessage(), self);
    const sdk = await connectGameDock({ env: makeEnv_(helloMessage(), new FakeFetch(() => new Response('{}')), parent, self) });

    sdk.reportViewport(1000, 600);
    const sent = parent.sent.at(-1)!.message as GameMessage;
    assert.equal(sent.v, 1);
    assert.equal(sent.t, 'game:viewport');
    assert.equal(sent.width, 1000);
    assert.equal(sent.height, 600);

    const standalone = await connectGameDock({
      env: makeEnv_(helloMessage(), new FakeFetch(() => new Response('{}'))),
      helloTimeoutMs: 30,
    });
    assert.doesNotThrow(() => standalone.reportViewport(1000, 600));
  });
});
