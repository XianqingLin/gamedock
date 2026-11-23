import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { makeFakeApi } from './fake-backend';
import type { FakeApi } from './fake-backend';

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

/** 点击右侧顶栏的头像/名称打开好友栏(登录与游客同一入口)。 */
async function openPanel(name = '游客') {
  const trigger = await screen.findByRole('button', { name });
  fireEvent.click(trigger);
}

/** 关闭好友栏(测试继续操作侧栏时需要)。 */
function closePanel() {
  fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
}

/** 打开注册弹窗并提交表单。 */
async function registerViaUi(username: string, password: string) {
  await openPanel();
  // 游客态面板内点「注册」打开弹窗;弹窗内按钮用 dialog 范围查询避免歧义
  fireEvent.click(await screen.findByRole('button', { name: '注册' }));
  const dialog = screen.getByRole('dialog', { name: '注册' });
  fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: username } });
  fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: password } });
  fireEvent.click(within(dialog).getByRole('button', { name: '注册' }));
}

describe('应用导航与社交浮层', () => {
  it('左侧提供游戏/成就墙/存档入口，顶栏提供探索与浏览导航，头像打开好友栏并可关闭', async () => {
    renderApp();
    expect(screen.getByRole('link', { name: '游戏' })).toBeVisible();
    expect(screen.getByRole('link', { name: '成就墙' })).toBeVisible();
    expect(screen.getByRole('link', { name: '存档' })).toBeVisible();
    expect(screen.getByRole('link', { name: '探索' })).toBeVisible();
    expect(screen.getByRole('link', { name: '浏览' })).toBeVisible();
    expect(await screen.findByRole('button', { name: '游客' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '好友' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '游客' }));
    expect(screen.getByRole('dialog', { name: '好友' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    expect(screen.queryByRole('dialog', { name: '好友' })).not.toBeInTheDocument();
  });
});

describe('游客身份', () => {
  it('默认显示游客头像与名称，点头像在好友栏内提供登录和注册', async () => {
    renderApp();
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '注册' })).not.toBeInTheDocument();

    await openPanel();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument();
  });

  it('注册失败时显示服务端错误,不伪装成功', async () => {
    renderApp();
    await registerViaUi('x', '123456');
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名需为 2-24 位字母、数字、下划线或中文');
    expect(screen.getByRole('dialog', { name: '注册' })).toBeInTheDocument();
  });

  it('注册成功后顶栏显示用户名,好友栏底部可退出登录', async () => {
    renderApp();
    await registerViaUi('小林', 'secret66');

    expect((await screen.findAllByText('小林')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '注册' })).not.toBeInTheDocument();
    // 注册弹窗关闭后好友栏仍开着,底部有退出登录;退出后面板回到游客态
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('好友栏自身身份区:展示 ID 与复制钮,内联改名全局同步,重名报服务端错误', async () => {
    fake.addUser('bob');
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByRole('button', { name: /测试用户/ });
    const panel = screen.getByRole('dialog', { name: '好友' });
    // 自身区不再显示在线状态,改为「ID:」+ 用户 ID,悬浮出复制钮
    const self = within(panel).getByText('ID:').closest('.friends-self-identity') as HTMLElement;
    expect(within(self).getByRole('button', { name: '复制用户 ID' })).toBeInTheDocument();
    expect(within(self).queryByText(/在线/)).not.toBeInTheDocument();


    fireEvent.click(within(panel).getByRole('button', { name: '编辑用户名' }));
    const input = within(panel).getByRole('textbox', { name: '用户名' });
    fireEvent.change(input, { target: { value: 'bob' } });
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名已存在');
    // 改名失败停留在编辑态
    expect(within(panel).getByRole('textbox', { name: '用户名' })).toHaveValue('bob');

    fireEvent.change(within(panel).getByRole('textbox', { name: '用户名' }), { target: { value: 'alice2' } });
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }));
    expect(await screen.findByText('alice2')).toBeInTheDocument();
  });

  it('好友栏点击自身头像弹窗:点击预设立即保存,重开仍选中', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByRole('button', { name: /测试用户/ });
    const panel = screen.getByRole('dialog', { name: '好友' });

    fireEvent.click(within(panel).getByRole('button', { name: '更换头像' }));
    const picker = await screen.findByRole('dialog', { name: '选择头像' });
    const fox = within(picker).getByRole('option', { name: /狐狸/ });
    expect(fox).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(fox);
    await waitFor(() => expect(fox).toHaveAttribute('aria-selected', 'true'));

    fireEvent.keyDown(picker, { key: 'Escape' });
    fireEvent.click(within(panel).getByRole('button', { name: '更换头像' }));
    const reopened = await screen.findByRole('dialog', { name: '选择头像' });
    expect(within(reopened).getByRole('option', { name: /狐狸/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('存档页:按游戏分组展示槽位,可删除单条', async () => {
    fake.seedSave('bvn', 'slot1');
    fake.seedSave('bvn', 'slot2');
    fake.seedSave('tether-together', 'checkpoint');
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByRole('button', { name: /测试用户/ });
    closePanel();
    fireEvent.click(screen.getByRole('link', { name: '存档' }));

    expect(await screen.findByRole('heading', { name: '死神 VS 火影 重构版' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '默契行动' })).toBeInTheDocument();
    expect(screen.getByText('slot1')).toBeInTheDocument();
    expect(screen.getByText('checkpoint')).toBeInTheDocument();

    const slot1row = screen.getByText('slot1').closest('.saves-row') as HTMLElement;
    fireEvent.click(within(slot1row).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByText('slot1')).not.toBeInTheDocument());
    expect(screen.getByText('slot2')).toBeInTheDocument();
    expect(screen.getByText('checkpoint')).toBeInTheDocument();
  });

  it('存档页空状态', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByRole('button', { name: /测试用户/ });
    closePanel();
    fireEvent.click(screen.getByRole('link', { name: '存档' }));
    expect(await screen.findByText('暂无存档')).toBeInTheDocument();
    // 非游戏栏目的顶栏不出现「探索/浏览」导航
    expect(screen.queryByRole('link', { name: '探索' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '浏览' })).not.toBeInTheDocument();
  });
});

describe('好友面板', () => {
  it('未登录时在面板内提示先登录或注册', async () => {
    renderApp();
    await openPanel();
    expect(await screen.findByText('登录或注册后才能使用好友功能。')).toBeInTheDocument();
  });

  it('已登录用户可以按用户 ID 发送好友请求', async () => {
    fake.addUser('bob');
    const bobId = fake.users.get('bob')!.id;
    renderApp();
    await registerViaUi('alice', 'secret66');
    // 注册后好友栏保持打开
    await screen.findByRole('button', { name: /测试用户/ });

    // 等待面板初始加载完成,避免提交按钮仍处于 busy 禁用状态
    await screen.findByRole('button', { name: /测试用户/ });
    fireEvent.click(screen.getByRole('button', { name: '添加好友' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '输入对方用户 ID 添加好友' }), {
      target: { value: bobId },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送好友请求' }));

    // 发送成功后自动切到请求视图,能看到已发出的请求
    expect(await screen.findByText('等待处理')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加好友' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('好友列表固定包含不可删除的测试用户,发送请求失败显示服务端错误', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByRole('button', { name: /测试用户/ });

    await screen.findByRole('button', { name: /测试用户/ });
    // 测试用户 bot 不可删除:列表里唯一的「删除」按钮数量等于人类好友数量(0,内联删除钮已移除)。
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();


    fireEvent.click(screen.getByRole('button', { name: '添加好友' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '输入对方用户 ID 添加好友' }), {
      target: { value: 'ghost' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送好友请求' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('找不到该用户');
  });

  it('搜索时工具区整行换成搜索框,退出搜索后恢复', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByRole('button', { name: /测试用户/ });
    const panel = await screen.findByRole('dialog', { name: '好友' });
    await within(panel).findByRole('button', { name: /测试用户/ });

    fireEvent.click(within(panel).getByRole('button', { name: '搜索好友' }));
    expect(within(panel).queryByText('好友')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: '搜索好友' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '好友请求' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '添加好友' })).toBeInTheDocument();
    expect(within(panel).getByRole('textbox', { name: '搜索好友' })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '退出搜索' }));
    expect(within(panel).getByText('好友')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '搜索好友' })).toBeInTheDocument();
  });

  it('双击测试用户打开聊天框,发送消息并收到自动回复', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByRole('button', { name: /测试用户/ });

    // 双击(而非单击)打开聊天框;单击不触发
    fireEvent.click(await screen.findByRole('button', { name: /测试用户/ }));
    expect(screen.queryByRole('dialog', { name: '测试用户' })).not.toBeInTheDocument();
    fireEvent.doubleClick(screen.getByRole('button', { name: /测试用户/ }));
    const chatDialog = await screen.findByRole('dialog', { name: '测试用户' });
    expect(chatDialog).toBeVisible();

    fireEvent.change(within(chatDialog).getByLabelText('发消息给测试用户'), {
      target: { value: '你好' },
    });
    fireEvent.click(within(chatDialog).getByRole('button', { name: '发送' }));

    expect(await within(chatDialog).findByText('(测试用户自动回复)已收到:「你好」')).toBeInTheDocument();
  });


  it('收到的好友请求可以接受', async () => {
    fake.addUser('alice');
    fake.addUser('bob');
    fake.seedIncomingRequest('alice', 'bob');
    renderApp();

    // 以 bob 身份登录
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: '登录' }));
    const dialog = screen.getByRole('dialog', { name: '登录' });
    fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: 'bob' } });
    fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: 'irrelevant' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '登录' }));

    // 登录后面板保持在打开状态
    await screen.findByRole('button', { name: /测试用户/ });

    // 激活好友请求钮 → 主列表显示收到的请求,再点对号接受(请求来自 alice)
    await screen.findByRole('button', { name: /测试用户/ });
    const requestBtn = screen.getByRole('button', { name: '好友请求' });
    fireEvent.click(requestBtn);
    expect(requestBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(await screen.findByRole('button', { name: '接受 alice 的好友请求' }));

    // 接受后该请求消失;再次点击请求钮退出激活态,好友列表里出现 alice
    await waitFor(() => expect(screen.queryByRole('button', { name: /^接受/ })).not.toBeInTheDocument());
    fireEvent.click(requestBtn);
    expect(requestBtn).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByText('alice')).toBeInTheDocument();
  });
});
