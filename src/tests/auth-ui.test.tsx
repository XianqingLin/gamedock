import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

/**
 * 内存版假后端:完整模拟注册/登录/登出/好友/聊天接口的响应语义(含错误文案),
 * 用于驱动真实 UI 组件的集成测试。
 */
function makeFakeApi() {
  const users = new Map<
    string,
    { id: string; username: string; createdAt: string; password: string; avatar: string | null }
  >();
  const friendships: { id: string; a: string; b: string; status: 'pending' | 'accepted'; requestedBy: string }[] = [];
  const saves: { slug: string; key: string; updatedAt: string; size: number }[] = [];
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
    return { id: u.id, username: u.username, createdAt: u.createdAt, avatar: u.avatar };
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
    const me = currentUserId
      ? { id: currentUserId, username: usernameOf(currentUserId), online: true }
      : null;
    return { me, friends, incoming, outgoing };
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
        avatar: null,
      });
    },
    /** 注入一条存档槽位(存档页测试用)。 */
    seedSave(slug: string, key: string, updatedAt = '2026-11-23T00:00:00Z', size = 128) {
      saves.push({ slug, key, updatedAt, size });
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
        users.set(username.toLowerCase(), { id: `u${++seq}`, username, createdAt: '2026-11-16T00:00:00Z', password, avatar: null });
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
      if (path === '/api/auth/profile' && method === 'PATCH') {
        if (!currentUserId) return json({ error: '需要登录' }, 401);
        const me = [...users.values()].find((u) => u.id === currentUserId)!;
        if (body.username !== undefined) {
          const username = String(body.username);
          if (!/^[a-zA-Z0-9_一-龥]{2,24}$/u.test(username)) {
            return json({ error: '用户名需为 2-24 位字母、数字、下划线或中文' }, 400);
          }
          const owner = users.get(username.toLowerCase());
          if (owner && owner.id !== me.id) return json({ error: '用户名已存在' }, 400);
          me.username = username;
        }
        if (body.avatar !== undefined) {
          if (body.avatar !== null && !/^av(?:0|[1-9]|1[0-6])$/.test(String(body.avatar))) {
            return json({ error: '未知头像' }, 400);
          }
          me.avatar = body.avatar as string | null;
        }
        return json({ user: publicUser(me.id) });
      }
      if (path === '/api/saves' && method === 'GET') {
        if (!currentUserId) return json({ error: '需要登录' }, 401);
        const bySlug = new Map<string, { key: string; updatedAt: string; size: number }[]>();
        for (const slot of saves) {
          const slots = bySlug.get(slot.slug) ?? [];
          slots.push({ key: slot.key, updatedAt: slot.updatedAt, size: slot.size });
          bySlug.set(slot.slug, slots);
        }
        return json({ games: [...bySlug.entries()].map(([slug, slots]) => ({ slug, slots })) });
      }
      const saveRemove = /\/api\/saves\/([\w-]+)\/([\w-]+)$/.exec(path);
      if (saveRemove && method === 'DELETE') {
        if (!currentUserId) return json({ error: '需要登录' }, 401);
        const index = saves.findIndex((s) => s.slug === saveRemove[1] && s.key === saveRemove[2]);
        if (index !== -1) saves.splice(index, 1);
        return json({ ok: true });
      }
      if (path === '/api/friends' && method === 'GET') return json(lists());
      if (path === '/api/presence' && method === 'POST') return json({ ok: true });
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

  it('已登录用户可以从头像菜单进入个人主页,主页展示名称与用户 ID', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await openUserMenu('alice');

    const menu = within(screen.getByRole('group', { name: '用户操作' }));
    fireEvent.click(menu.getByRole('link', { name: '个人主页' }));
    expect(await screen.findByRole('heading', { name: 'alice' })).toBeInTheDocument();
    // 新版主页:ID 在名称下方悬浮出复制钮;侧栏个人主页二级目录展开
    expect(screen.getByRole('button', { name: '复制用户 ID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更换头像' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '个人信息' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '成就墙' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '存档' })).toBeInTheDocument();
  });

  it('个人主页内联改名:保存后顶栏与主页同步,重名报服务端错误', async () => {
    fake.addUser('bob');
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('link', { name: '个人主页' }));
    await screen.findByRole('heading', { name: 'alice' });

    fireEvent.click(screen.getByRole('button', { name: '编辑用户名' }));
    const input = screen.getByRole('textbox', { name: '用户名' });
    fireEvent.change(input, { target: { value: 'bob' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名已存在');
    // 编辑态下 h1 被表单替换,改名失败停留在编辑态
    expect(screen.getByRole('textbox', { name: '用户名' })).toHaveValue('bob');

    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), { target: { value: 'alice2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('heading', { name: 'alice2' })).toBeInTheDocument();
  });

  it('头像弹窗:点击预设立即保存,重新进入仍选中', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('link', { name: '个人主页' }));
    await screen.findByRole('heading', { name: 'alice' });

    fireEvent.click(screen.getByRole('button', { name: '更换头像' }));
    const dialog = screen.getByRole('dialog', { name: '选择头像' });
    const fox = within(dialog).getByRole('option', { name: /狐狸/ });
    expect(fox).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(fox);
    await waitFor(() => expect(fox).toHaveAttribute('aria-selected', 'true'));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '更换头像' }));
    const reopened = screen.getByRole('dialog', { name: '选择头像' });
    expect(within(reopened).getByRole('option', { name: /狐狸/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('存档页:按游戏分组展示槽位,可删除单条', async () => {
    fake.seedSave('bvn', 'slot1');
    fake.seedSave('bvn', 'slot2');
    fake.seedSave('tether-together', 'checkpoint');
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('link', { name: '个人主页' }));
    fireEvent.click(await screen.findByRole('link', { name: '存档' }));

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
    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('link', { name: '个人主页' }));
    fireEvent.click(await screen.findByRole('link', { name: '存档' }));
    expect(await screen.findByText('暂无存档')).toBeInTheDocument();
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
    await screen.findByRole('button', { name: /小舟AI/ });
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

  it('好友列表固定包含不可删除的 AI 助手,发送请求失败显示服务端错误', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByText('alice');
    openFriendsPanel();

    await screen.findByRole('button', { name: /小舟AI/ });
    // AI 助手不可删除:列表里唯一的「删除」按钮数量等于人类好友数量(0)。
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
    await screen.findByText('alice');
    openFriendsPanel();
    const panel = await screen.findByRole('dialog', { name: '好友' });
    await within(panel).findByRole('button', { name: /小舟AI/ });

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

  it('点击 AI 助手弹出聊天框,发送消息并收到回复', async () => {
    renderApp();
    await registerViaUi('alice', 'secret66');
    await screen.findByText('alice');
    openFriendsPanel();

    fireEvent.click(await screen.findByRole('button', { name: /小舟AI/ }));
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

    // 激活好友请求钮 → 主列表显示收到的请求,再点对号接受(请求来自 alice)
    await screen.findByRole('button', { name: /小舟AI/ });
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
