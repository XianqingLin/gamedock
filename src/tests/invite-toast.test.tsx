import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { makeFakeApi } from './fake-backend';
import type { FakeApi } from './fake-backend';

/**
 * 邀请 Toast 队列集成测试(2026-11-24 邀请改版):
 * 右下角矩形自下滑入、停留约 6s 后下滑出、严格单显(前一个离场后下一个才登场);
 * 点击任一 Toast → 打开好友栏并作废剩余队列;入口(头像钮)带未读角标。
 * jsdom 不跑 CSS 动画,离场完成以 fireEvent.animationEnd 驱动。
 */
let fake: FakeApi;

beforeEach(() => {
  fake = makeFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  // shouldAdvanceTime:waitFor/轮询依赖的内部定时器不被假时钟卡死,手动 advance 仍可控。
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );

/** 登录 alice(面板打开期间完成,注册的种子用户带密码);完成后关抽屉,恢复"抽屉外"视角。 */
async function loginAlice() {
  fireEvent.click(await screen.findByRole('button', { name: '游客' }));
  fireEvent.click(await screen.findByRole('button', { name: '登录' }));
  const dialog = screen.getByRole('dialog', { name: '登录' });
  fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: 'alice' } });
  fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: 'irrelevant' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '登录' }));
  await screen.findAllByRole('button', { name: /测试用户/ });
  fireEvent.click(screen.getAllByRole('button', { name: '关闭弹窗' }).at(-1)!);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('邀请 Toast 队列', () => {
  it('单显队列:前一个下滑离场后下一个才登场;点击打开好友栏并作废剩余队列', async () => {
    fake.addUser('alice');
    fake.addUser('bob');
    fake.addUser('carol');
    fake.seedFriendship('alice', 'bob');
    fake.seedFriendship('alice', 'carol');
    // E 先到,F 后到(时间错开保证 FIFO)。
    fake.seedInvite('bob', 'alice', 'bvn', null, new Date(Date.now() - 20_000).toISOString());
    fake.seedInvite('carol', 'alice', 'bvn', null, new Date(Date.now() - 10_000).toISOString());

    renderApp();
    await loginAlice();

    // 第一条:bob 的邀请;E 的邀请在抽屉开着时到达 → 已读不算角标;
    // 关抽屉后 bob 再发一条(覆盖式新 id)→ 角标 = 1,Toast 仍按队列先显 E 的旧邀请。
    const firstToast = await screen.findByRole('button', { name: /bob 邀请你玩 死神 VS 火影 重构版/ });
    expect(document.querySelector('.user-invite-badge')).toBeNull();
    fake.seedInvite('bob', 'alice', 'bvn', { room: '777777' }, new Date().toISOString());
    // 轮询间隔 10s:推进一个周期后通知端点带回新邀请,角标出现。
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    await waitFor(() => expect(document.querySelector('.user-invite-badge')?.textContent).toBe('1'));

    // 停留 6s → 下滑离场 → 完全离场后 F 才登场
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    fireEvent.animationEnd(firstToast);
    const secondToast = await screen.findByRole('button', { name: /carol 邀请你玩 死神 VS 火影 重构版/ });

    // 点击 F → 打开好友栏并作废剩余队列(此后不再有 Toast),角标随抽屉打开清零
    fireEvent.click(secondToast);
    fireEvent.animationEnd(secondToast);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /邀请你玩/ })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('好友')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.user-invite-badge')).toBeNull());
  });

  it('点击 Toast 后新到邀请不再弹 Toast,只在好友栏可见', async () => {
    fake.addUser('alice');
    fake.addUser('bob');
    fake.seedFriendship('alice', 'bob');
    fake.seedInvite('bob', 'alice', 'bvn', null, new Date().toISOString());

    renderApp();
    await loginAlice();

    const toast = await screen.findByRole('button', { name: /bob 邀请你玩/ });
    fireEvent.click(toast);
    fireEvent.animationEnd(toast);
    await screen.findByText('好友');

    // 队列作废后再注入新邀请:好友行内联区出现,但 Toast 不再弹出
    fake.addUser('carol');
    fake.seedFriendship('alice', 'carol');
    fake.seedInvite('carol', 'alice', 'bvn', null, new Date().toISOString());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole('button', { name: /carol 邀请你玩/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    fireEvent.click(await screen.findByRole('button', { name: 'alice' }));
    const inviteTexts = await screen.findAllByText((_, el) => el?.classList.contains('friend-invite-text') === true);
    expect(inviteTexts.length).toBeGreaterThan(0);
  });
});
