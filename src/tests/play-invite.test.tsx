import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { makeFakeApi } from './fake-backend';
import type { FakeApi } from './fake-backend';
import { friendsApi } from '../lib/api';

/**
 * 运行页邀请取参竞速回归(2026-11-24):游戏侧 SDK 只认首个 hello,
 * 邀请取参未就绪就挂 iframe 会让首个 hello 以 join=null 定格,邀请参数丢失。
 * 要求:取参中(joinParams undefined)不挂 iframe,就绪后再挂载。
 */

// 只拦截 friendsApi.getInvite;登录/注册等其余 API 走真实模块 + fake 后端,
// 以便精确控制取参完成时机。
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, friendsApi: { ...actual.friendsApi, getInvite: vi.fn() } };
});

let fake: FakeApi;

beforeEach(() => {
  fake = makeFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(friendsApi.getInvite).mockReset();
});

const renderPlay = (inviteId?: string) =>
  render(
    <MemoryRouter initialEntries={[inviteId ? `/play/bvn?invite=${inviteId}` : '/play/bvn']}>
      <App />
    </MemoryRouter>,
  );

/** 面板内注册(注册后登录态就绪,邀请取参才会发起);等待注册完成页面重新渲染。 */
async function registerViaPanel(username: string) {
  fireEvent.click(await screen.findByRole('button', { name: '游客' }));
  fireEvent.click(await screen.findByRole('button', { name: '注册' }));
  const dialog = screen.getByRole('dialog', { name: '注册' });
  fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: username } });
  fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: 'secret66' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '注册' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '注册' })).not.toBeInTheDocument());
}

describe('运行页邀请取参', () => {
  it('取参未就绪前不挂游戏 iframe,就绪后挂载', async () => {
    let resolveInvite: (v: Awaited<ReturnType<typeof friendsApi.getInvite>>) => void = () => {};
    vi.mocked(friendsApi.getInvite).mockImplementation(
      () =>
        new Promise((res) => {
          resolveInvite = res;
        }),
    );

    renderPlay('i1');
    // 游客态:取参需登录态,先按无邀请挂 iframe
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());

    // 面板注册(注册成功即登录;游客期挂过的 iframe 随登录卸载,等 join 就绪重挂)
    await registerViaPanel('alice');
    await waitFor(() => expect(document.querySelector('iframe')).toBeNull());
    expect(screen.getByText('正在加载…')).toBeInTheDocument();

    resolveInvite({ invite: { slug: 'bvn', params: { room: '123456', node: 'cn' } } });
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
  });

  it('取参失败按无邀请处理,正常挂载 iframe', async () => {
    vi.mocked(friendsApi.getInvite).mockRejectedValue(new Error('邀请不存在'));
    renderPlay('iX');
    await registerViaPanel('alice');
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
  });

  it('无邀请深链不拦截挂载', async () => {
    renderPlay();
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
  });
});
