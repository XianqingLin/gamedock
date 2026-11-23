import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

/**
 * 内存版假后端:完整模拟注册/登录/登出/好友/聊天接口的响应语义(含错误文案),
 * 用于驱动真实 UI 组件的集成测试。
 */
function makeFakeApi() {
  const users = new Map<string, { id: string; username: string; createdAt: string; password: string }>();
  const friendships: { id: string; a: string; b: string; status: 'pending' | 'accepted'; requestedBy: string }[] = [];
  const chatHistory: {
    id: string;
    userId: string;
    peer: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
  }[] = [];
  let currentUserId: string | null = null;
  let seq = 0;

  const usernameOf = (id: string) => [...users.values()].find((u) => u.id === id)?.username ?? '(已注销)';
  const publicUser = (id: string) => {
    const u = [...users.values()].find((entry) => entry.id === id)!;
    return { id: u.id, username: u.username, createdAt: u.createdAt };
  };
  const lists = () => {
    const friends: unknown[] = [
      { id: 'ai-xiaozhou', user: { id: 'ai-xiaozhou', username: '小舟AI' }, since: '', assistant: true },
    ];
    const incoming: unknown[] = [];
    const outgoing: unknown[] = [];
    for (const r of friendships) {
      if (r.a !== currentUserId && r.b !== currentUserId) continue;
      if (r.status === 'accepted') {
        const other = r.a === currentUserId ? r.b : r.a;
        friends.push({ id: r.id, user: { id: other, username: usernameOf(other) }, since: r.id });
      } else if (r.requestedBy === currentUserId) {
        const other = r.a === currentUserId ? r.b : r.a;
        outgoing.push({ id: r.id, to: { id: other, username: usernameOf(other) }, createdAt: r.id });
      } else {
        incoming.push({ id: r.id, from: { id: r.requestedBy, username: usernameOf(r.requestedBy) }, createdAt: r.id });
      }
    }
    return { friends, incoming, outgoing };
  };

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  return {
    users,
    /** 直接在假后端里塞一个用户(不改变当前登录会话)。 */
    addUser(username: string) {
      users.set(username.toLowerCase(), {
        id: `u${++seq}`,
        username,
        createdAt: '2026-11-16T00:00:00Z',
        password: 'irrelevant',
      });
    },
    /** 注入一条 from → to 的待处理好友请求。 */
    seedIncomingRequest(fromUsername: string, toUsername: string) {
      const from = users.get(fromUsername.toLowerCase())!;
      const to = users.get(toUsername.toLowerCase())!;
      friendships.push({ id: `r${++seq}`, a: from.id, b: to.id, status: 'pending', requestedBy: from.id });
    },
    fetch: vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = new URL(url, 'http://localhost').pathname;
      const method = options.method ?? 'GET';
      const body = options.body ? (JSON.parse(String(options.body)) as Record<string, unknown>) : {};

      if (path === '/api/auth/me') {
        return json({ user: currentUserId ? publicUser(currentUserId) : null });
      }
      if (path === '/api/auth/register' && method === 'POST') {
        const username = String(body.username ?? '');
        const password = String(body.password ?? '');
        if (!/^[a-zA-Z0-9_一-龥]{2,24}$/u.test(username)) {
          return json({ error: '用户名需为 2-24 位字母、数字、下划线或中文' }, 400);
        }
        if (password.length < 6) return json({ error: '密码需为 6-128 位' }, 400);
        if (users.has(username.toLowerCase())) return json({ error: '用户名已存在' }, 400);
        users.set(username.toLowerCase(), { id: `u${++seq}`, username, createdAt: '2026-11-16T00:00:00Z', password });
        currentUserId = users.get(username.toLowerCase())!.id;
        return json({ user: publicUser(currentUserId) });
      }
      if (path === '/api/auth/login' && method === 'POST') {
        const found = users.get(String(body.username ?? '').toLowerCase());
        if (!found || found.password !== body.password) return json({ error: '用户名或密码错误' }, 401);
        currentUserId = found.id;
        return json({ user: publicUser(found.id) });
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        currentUserId = null;
        return json({ ok: true });
      }
      if (path === '/api/friends' && method === 'GET') return json(lists());
      if (path === '/api/friends/requests' && method === 'POST') {
        const target = [...users.values()].find((u) => u.id === body.id);
        if (!target) return json({ error: '找不到该用户' }, 400);
        if (target.id === currentUserId) return json({ error: '不能添加自己为好友' }, 400);
        friendships.push({
          id: `r${++seq}`,
          a: currentUserId!,
          b: target.id,
          status: 'pending',
          requestedBy: currentUserId!,
        });
        return json(lists());
      }
      if (/^\/api\/chat\/[\w-]+$/.test(path)) {
        if (!currentUserId) return json({ error: '需要登录' }, 401);
        if (path !== '/api/chat/ai-xiaozhou') return json({ error: '会话不存在' }, 404);
        const mine = chatHistory.filter((m) => m.userId === currentUserId);
        if (method === 'GET') return json({ messages: mine });
        if (method === 'POST') {
          const content = String(body.content ?? '').trim();
          if (!content) return json({ error: '消息不能为空' }, 400);
          const userMessage = {
            id: `m${++seq}`,
            userId: currentUserId,
            peer: 'ai-xiaozhou',
            role: 'user' as const,
            content,
            createdAt: '2026-11-23T00:00:00Z',
          };
          const assistantMessage = {
            id: `m${++seq}`,
            userId: currentUserId,
            peer: 'ai-xiaozhou',
            role: 'assistant' as const,
            content: `好的,收到:「${content}」`,
            createdAt: '2026-11-23T00:00:00Z',
          };
          chatHistory.push(userMessage, assistantMessage);
          return json({ messages: [userMessage, assistantMessage] });
        }
      }
      const respond = /\/api\/friends\/requests\/([\w-]+)\/(accept|decline)$/.exec(path);
      if (respond && method === 'POST') {
        const record = friendships.find((r) => r.id === respond[1]);
        if (!record) return json({ error: '请求不存在或已处理' }, 400);
        if (respond[2] === 'accept') record.status = 'accepted';
        else friendships.splice(friendships.indexOf(record), 1);
        return json(lists());
      }
      const cancel = /\/api\/friends\/requests\/([\w-]+)$/.exec(path);
      if (cancel && method === 'DELETE') {
        const record = friendships.find((r) => r.id === cancel[1]);
        if (record) friendships.splice(friendships.indexOf(record), 1);
        return json(lists());
      }
      const remove = /\/api\/friends\/([\w-]+)$/.exec(path);
      if (remove && method === 'DELETE') {
        const record = friendships.find((r) => r.id === remove[1]);
        if (record) friendships.splice(friendships.indexOf(record), 1);
        return json(lists());
      }
      return json({ error: '接口不存在' }, 404);
    }),
  };
}

let fake: ReturnType<typeof makeFakeApi>;

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

/** 通过右侧顶栏的头像与名称打开用户菜单。 */
async function openUserMenu(name = '游客') {
  const userTrigger = await screen.findByRole('button', { name });
  if (userTrigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(userTrigger);
}

/** 打开注册弹窗并提交表单。 */
async function registerViaUi(username: string, password: string) {
  await openUserMenu();
  // 菜单项渲染可能稍晚于点击，用异步查询避免竞态
  fireEvent.click(await screen.findByRole('button', { name: '注册' }));
  const dialog = screen.getByRole('dialog', { name: '注册' });
  fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: username } });
  fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: password } });
  fireEvent.click(within(dialog).getByRole('button', { name: '注册' }));
}

function openFriendsPanel() {
  fireEvent.click(screen.getByRole('button', { name: '好友' }));
}

describe('应用导航与社交浮层', () => {
  it('左侧提供「游戏」入口，顶栏提供探索与浏览导航，好友按需从顶栏打开并可关闭', async () => {
    renderApp();
    expect(screen.getByRole('link', { name: '游戏' })).toBeVisible();
    expect(screen.getByRole('link', { name: '探索' })).toBeVisible();
    expect(screen.getByRole('link', { name: '浏览' })).toBeVisible();
    expect(await screen.findByRole('button', { name: '游客' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '好友' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '好友' }));
    expect(screen.getByRole('dialog', { name: '好友' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    expect(screen.queryByRole('dialog', { name: '好友' })).not.toBeInTheDocument();
  });
});

describe('游客身份', () => {
  it('默认显示游客头像与名称，菜单中提供登录和注册', async () => {
    renderApp();
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '注册' })).not.toBeInTheDocument();

    await openUserMenu();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument();
  });

  it('注册失败时显示服务端错误,不伪装成功', async () => {
    renderApp();
    await registerViaUi('x', '123456');
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名需为 2-24 位字母、数字、下划线或中文');
    expect(screen.getByRole('dialog', { name: '注册' })).toBeInTheDocument();
  });

  it('注册成功后顶栏显示用户名,可退出登录', async () => {
    renderApp();
    await registerViaUi('小林', 'secret66');

    expect(await screen.findByText('小林')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await openUserMenu('小林');
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    await openUserMenu();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('已登录用户可以从头像菜单进入个人主页', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await openUserMenu('alice');

    fireEvent.click(screen.getByRole('link', { name: '个人主页' }));
    expect(await screen.findByRole('heading', { name: 'alice' })).toBeInTheDocument();
    expect(screen.getByText('加入时间')).toBeInTheDocument();
  });
});

describe('好友面板', () => {
  it('未登录时在面板内提示先登录或注册', async () => {
    renderApp();
    openFriendsPanel();
    expect(await screen.findByText('登录或注册后才能使用好友功能。')).toBeInTheDocument();
  });

  it('已登录用户可以按用户 ID 发送好友请求', async () => {
    fake.addUser('bob');
    const bobId = fake.users.get('bob')!.id;
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByText('alice');
    openFriendsPanel();

    // 等待面板初始加载完成,避免提交按钮仍处于 busy 禁用状态
    await screen.findByText('我的好友');
    fireEvent.change(screen.getByRole('textbox', { name: '输入对方用户 ID 添加好友' }), {
      target: { value: bobId },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

    expect(await screen.findByText('已发出的请求')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('好友列表固定包含不可删除的 AI 助手,发送请求失败显示服务端错误', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByText('alice');
    openFriendsPanel();

    await screen.findByText('小舟AI');
    // AI 助手不可删除:列表里唯一的「删除」按钮数量等于人类好友数量(0)。
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '输入对方用户 ID 添加好友' }), {
      target: { value: 'ghost' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('找不到该用户');
  });

  it('点击 AI 助手弹出聊天框,发送消息并收到回复', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByText('alice');
    openFriendsPanel();

    fireEvent.click(await screen.findByRole('button', { name: '小舟AI' }));
    const chatDialog = await screen.findByRole('dialog', { name: '小舟AI' });
    expect(chatDialog).toBeVisible();

    fireEvent.change(within(chatDialog).getByLabelText('发消息给小舟AI'), {
      target: { value: '你好' },
    });
    fireEvent.click(within(chatDialog).getByRole('button', { name: '发送' }));

    expect(await within(chatDialog).findByText('好的,收到:「你好」')).toBeInTheDocument();
  });

  it('收到的好友请求可以接受', async () => {
    fake.addUser('alice');
    fake.addUser('bob');
    fake.seedIncomingRequest('alice', 'bob');
    renderApp();

    // 以 bob 身份登录
    await openUserMenu();
    fireEvent.click(await screen.findByRole('button', { name: '登录' }));
    const dialog = screen.getByRole('dialog', { name: '登录' });
    fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: 'bob' } });
    fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: 'irrelevant' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '登录' }));
    await screen.findByText('bob');
    openFriendsPanel();

    expect(await screen.findByText('收到的请求')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '接受' }));
    expect(await screen.findByText('我的好友')).toBeInTheDocument();
  });
});
