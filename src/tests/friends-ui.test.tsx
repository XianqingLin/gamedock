import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { makeFakeApi } from './fake-backend';
import type { FakeApi } from './fake-backend';

/**
 * 好友面板交互集成测试(2026-11-23 改版;2026-11-24 邀请改版):
 * 右键菜单(发送消息/邀请游玩/删除好友)、双击聊天、删除二次确认、
 * 好友行右侧内联邀请区(接受/拒绝)与邀请发送(仅游玩上下文)。
 */
let fake: FakeApi;

beforeEach(() => {
  fake = makeFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderApp = (initialEntries: string[] = ['/']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );

/** 游客态点顶栏头像打开好友抽屉。 */
async function openPanel(name = '游客') {
  fireEvent.click(await screen.findByRole('button', { name }));
}

/** 面板内注册(注册后面板保持打开并展示登录态好友列表)。 */
async function registerViaPanel(username: string) {
  fireEvent.click(await screen.findByRole('button', { name: '注册' }));
  const dialog = screen.getByRole('dialog', { name: '注册' });
  fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: username } });
  fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: 'secret66' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '注册' }));
  await screen.findAllByRole('button', { name: /测试用户/ });
}

describe('好友行交互', () => {
  it('右键好友弹出操作菜单:bot 只有发送消息;普通好友含删除;主站无邀请游玩', async () => {
    renderApp();
    await openPanel();
    await registerViaPanel('alice');

    // bot 行:菜单只有「发送消息」
    fireEvent.contextMenu(screen.getByRole('button', { name: /测试用户/ }));
    const menu = await screen.findByRole('menu', { name: /测试用户 的操作/ });
    expect(within(menu).getByRole('menuitem', { name: '发送消息' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: '邀请游玩' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: '删除好友' })).not.toBeInTheDocument();

    // Escape 关闭菜单
    fireEvent.keyDown(menu, { key: 'Escape', bubbles: true });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    // 普通好友(主站抽屉,无游玩上下文):有发送消息与删除好友,无邀请游玩
    fake.addUser('bob');
    fake.seedFriendship('alice', 'bob');
    await closeAndReopenPanel('alice');
    fireEvent.contextMenu(await screen.findByRole('button', { name: /好友 bob/ }));
    const bobMenu = await screen.findByRole('menu', { name: /bob 的操作/ });
    expect(within(bobMenu).getByRole('menuitem', { name: '发送消息' })).toBeInTheDocument();
    expect(within(bobMenu).getByRole('menuitem', { name: '删除好友' })).toBeInTheDocument();
    expect(within(bobMenu).queryByRole('menuitem', { name: '邀请游玩' })).not.toBeInTheDocument();
  });

  it('删除好友需要二次确认:取消不删除,确认后好友消失', async () => {
    renderApp();
    await openPanel();
    await registerViaPanel('alice');
    fake.addUser('bob');
    fake.seedFriendship('alice', 'bob');
    await closeAndReopenPanel('alice');
    const row = await screen.findByRole('button', { name: /好友 bob/ });

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除好友' }));
    const confirm = await screen.findByRole('dialog', { name: '删除好友' });
    expect(within(confirm).getByText(/确定删除好友「bob」吗/)).toBeInTheDocument();

    // 取消 → 好友仍在
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: /好友 bob/ })).toBeInTheDocument();

    // 再开菜单 → 确认删除 → 好友消失
    fireEvent.contextMenu(screen.getByRole('button', { name: /好友 bob/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除好友' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '删除好友' })).getByRole('button', { name: '删除好友' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /好友 bob/ })).not.toBeInTheDocument(),
    );
  });

  it('键盘操作:Enter 打开聊天框,菜单键弹出操作菜单', async () => {
    renderApp();
    await openPanel();
    await registerViaPanel('alice');

    const row = screen.getByRole('button', { name: /测试用户/ });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: '测试用户' })).toBeVisible();

    // 关闭聊天框后用菜单键开菜单
    fireEvent.click(screen.getAllByRole('button', { name: '关闭弹窗' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '测试用户' })).not.toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole('button', { name: /测试用户/ }), { key: 'ContextMenu' });
    expect(await screen.findByRole('menu', { name: /测试用户 的操作/ })).toBeInTheDocument();
  });
});

describe('好友间聊天', () => {
  it('双击普通好友打开聊天框,发送消息落历史', async () => {
    renderApp();
    await openPanel();
    await registerViaPanel('alice');
    fake.addUser('bob');
    fake.seedFriendship('alice', 'bob');
    await closeAndReopenPanel('alice');

    fireEvent.doubleClick(await screen.findByRole('button', { name: /好友 bob/ }));
    const chat = await screen.findByRole('dialog', { name: 'bob' });
    fireEvent.change(within(chat).getByLabelText('发消息给bob'), { target: { value: '来一局?' } });
    fireEvent.click(within(chat).getByRole('button', { name: '发送' }));
    expect(await within(chat).findByText('来一局?')).toBeInTheDocument();
  });
});

describe('游戏邀请', () => {
  it('邀请内联在好友行右侧:拒绝后消失,接受打开运行页深链', async () => {
    fake.addUser('alice');
    fake.addUser('bob');
    fake.seedFriendship('alice', 'bob');
    fake.seedInvite('bob', 'alice', 'bvn', { room: '123456', node: 'cn' });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    renderApp();
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: '登录' }));
    const loginDialog = screen.getByRole('dialog', { name: '登录' });
    fireEvent.change(within(loginDialog).getByLabelText('用户名'), { target: { value: 'alice' } });
    fireEvent.change(within(loginDialog).getByLabelText('密码'), { target: { value: 'irrelevant' } });
    fireEvent.click(within(loginDialog).getByRole('button', { name: '登录' }));
    await screen.findAllByRole('button', { name: /测试用户/ });

    // 邀请内联在 bob 好友行右侧:文字 + 接受/拒绝两钮(在文字下方)
    const inviteText = await screen.findByText((_, el) => el?.classList.contains('friend-invite-text') === true);
    expect(inviteText.closest('.friend-invite-side')).toBeInTheDocument();
    expect(screen.queryByText('邀请你游玩')).not.toBeInTheDocument();

    // 拒绝 → 好友行内联邀请区消失(队列中的 Toast 最多再停留一个周期,与行内状态无关)
    fireEvent.click(screen.getByRole('button', { name: '拒绝 bob 的游玩邀请' }));
    await waitFor(() => expect(document.querySelector('.friend-invite-text')).toBeNull());

    // 再注入一条,重开抽屉(列表重拉),点「接受」→ 打开 /play/bvn?invite=... 新窗口(带 noopener)
    fake.seedInvite('bob', 'alice', 'bvn', { room: '654321', node: 'cf' });
    await closeAndReopenPanel('alice');
    await screen.findByText((_, el) => el?.classList.contains('friend-invite-text') === true);

    fireEvent.click(screen.getByRole('button', { name: '接受 bob 的游玩邀请' }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    const [url] = openSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/^\/play\/bvn\?invite=i\d+$/);
    openSpy.mockRestore();
  });

  it('运行页游玩同一游戏时接受邀请:原地换 ?invite= 重挂,不开新窗口', async () => {
    fake.addUser('bob');
    renderApp(['/play/bvn']);
    await openPanel();
    await registerViaPanel('alice');
    fake.seedFriendship('alice', 'bob');
    fake.seedInvite('bob', 'alice', 'bvn', { room: '654321', node: 'cf' });
    await closeAndReopenPanel('alice');
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    fireEvent.click(await screen.findByRole('button', { name: '接受 bob 的游玩邀请' }));
    await waitFor(() => expect(openSpy).not.toHaveBeenCalled());
    // 抽屉自动关闭,运行页携带新 ?invite= 原地重挂(iframe src 未变,join 参数经 hello 重新下发)
    await waitFor(() => expect(screen.queryByRole('button', { name: '接受 bob 的游玩邀请' })).not.toBeInTheDocument());
    openSpy.mockRestore();
  });

  it('运行页游玩上下文下普通好友菜单含「邀请游玩」,发送成功出现提示', async () => {
    fake.addUser('bob');
    renderApp(['/play/bvn']);
    await openPanel();
    await registerViaPanel('alice');
    fake.seedFriendship('alice', 'bob');
    await closeAndReopenPanel('alice');

    // 运行页抽屉由游玩上下文驱动:菜单含邀请游玩(注意 game 可启动,PlayPage 正常渲染)
    fireEvent.contextMenu(await screen.findByRole('button', { name: /好友 bob/ }));
    const bobMenu = await screen.findByRole('menu', { name: /bob 的操作/ });
    expect(within(bobMenu).getByRole('menuitem', { name: '邀请游玩' })).toBeInTheDocument();

    fireEvent.click(within(bobMenu).getByRole('menuitem', { name: '邀请游玩' }));
    expect(await screen.findByText('已向 bob 发送游玩邀请')).toBeInTheDocument();
  });
});

/** 关闭抽屉再重新打开,使面板重新拉取列表(fake 后端的数据注入需要重开才可见)。 */
async function closeAndReopenPanel(username: string) {
  fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
  await openPanel(username);
}
