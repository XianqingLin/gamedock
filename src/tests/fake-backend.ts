import { vi } from 'vitest';

/**
 * 内存版假后端(被 auth-ui/friends-ui 等集成测试共享):
 * 完整模拟注册/登录/登出/好友/聊天/邀请/存档接口的响应语义(含错误文案),
 * 用于驱动真实 UI 组件的集成测试。语义与 server/ 侧业务模块保持一致。
 */
export function makeFakeApi() {
  const users = new Map<
    string,
    { id: string; username: string; createdAt: string; password: string; avatar: string | null }
  >();
  const friendships: { id: string; a: string; b: string; status: 'pending' | 'accepted'; requestedBy: string }[] = [];
  const saves: { slug: string; key: string; updatedAt: string; size: number }[] = [];
  const chatHistory: {
    id: string;
    fromId: string;
    toId: string;
    content: string;
    createdAt: string;
  }[] = [];
  const invites: {
    id: string;
    fromUser: string;
    toUser: string;
    slug: string;
    params: Record<string, unknown> | null;
    status: 'pending' | 'accepted' | 'declined';
    /** 运行页是否已取过参(一次性投递标记,镜像服务端 delivered_at)。 */
    delivered?: boolean;
  }[] = [];
  let currentUserId: string | null = null;
  let seq = 0;

  // 测试用户 bot:真实用户行,注册/登录接口视其为保留名。
  users.set('测试用户', {
    id: 'test-user',
    username: '测试用户',
    createdAt: '2026-11-23T00:00:00Z',
    password: 'bot-cannot-login',
    avatar: 'av0',
  });

  const usernameOf = (id: string) => [...users.values()].find((u) => u.id === id)?.username ?? '(已注销)';
  const publicUser = (id: string) => {
    const u = [...users.values()].find((entry) => entry.id === id)!;
    return { id: u.id, username: u.username, createdAt: u.createdAt, avatar: u.avatar };
  };
  const isFriendAccepted = (a: string, b: string) =>
    friendships.some(
      (r) => r.status === 'accepted' && ((r.a === a && r.b === b) || (r.a === b && r.b === a)),
    );
  /** 好友列表统一载荷:好友(bot 固定首位)/请求/待处理游戏邀请,与 /api/friends 响应同形。 */
  const lists = () => {
    const friends: unknown[] = [
      {
        id: 'test-user',
        user: { id: 'test-user', username: '测试用户', online: true, avatar: 'av0' },
        since: '',
        bot: true,
      },
    ];
    const incoming: unknown[] = [];
    const outgoing: unknown[] = [];
    for (const r of friendships) {
      if (r.a !== currentUserId && r.b !== currentUserId) continue;
      const other = r.a === currentUserId ? r.b : r.a;
      if (other === 'test-user') continue;
      if (r.status === 'accepted') {
        friends.push({ id: r.id, user: { id: other, username: usernameOf(other) }, since: r.id });
      } else if (r.requestedBy === currentUserId) {
        outgoing.push({ id: r.id, to: { id: other, username: usernameOf(other) }, createdAt: r.id });
      } else {
        incoming.push({ id: r.id, from: { id: r.requestedBy, username: usernameOf(r.requestedBy) }, createdAt: r.id });
      }
    }
    const myInvites = invites.filter((i) => i.toUser === currentUserId && i.status === 'pending');
    const inviteList = myInvites.map((i) => ({
      id: i.id,
      from: { id: i.fromUser, username: usernameOf(i.fromUser), avatar: null },
      slug: i.slug,
      params: i.params,
      createdAt: i.id,
    }));
    const me = currentUserId
      ? { id: currentUserId, username: usernameOf(currentUserId), online: true }
      : null;
    return { me, friends, incoming, outgoing, invites: inviteList };
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
    /** 注入一条已接受的好友关系(测试单会话无法完成对端接受动作)。 */
    seedFriendship(aUsername: string, bUsername: string) {
      const a = users.get(aUsername.toLowerCase())!;
      const b = users.get(bUsername.toLowerCase())!;
      friendships.push({ id: `f${++seq}`, a: a.id, b: b.id, status: 'accepted', requestedBy: a.id });
    },
    /** 注入一条 toUser 的待处理游戏邀请。 */
    seedInvite(fromUsername: string, toUsername: string, slug = 'bvn', params: Record<string, unknown> | null = null) {
      const from = users.get(fromUsername.toLowerCase())!;
      const to = users.get(toUsername.toLowerCase())!;
      invites.push({ id: `i${++seq}`, fromUser: from.id, toUser: to.id, slug, params, status: 'pending' });
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
        if (isFriendAccepted(currentUserId!, target.id)) return json({ error: '你们已经是好友了' }, 400);
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
        const peer = path.split('/').at(-1)!;
        const allowed =
          peer === 'test-user' ||
          (peer !== currentUserId && isFriendAccepted(currentUserId, peer));
        if (!allowed) return json({ error: '只能与好友聊天' }, 404);
        const mine = chatHistory.filter(
          (m) => (m.fromId === currentUserId && m.toId === peer) || (m.fromId === peer && m.toId === currentUserId),
        );
        const project = (m: { id: string; fromId: string; toId: string; content: string; createdAt: string }) => ({
          id: m.id,
          peer: m.fromId === currentUserId ? m.toId : m.fromId,
          mine: m.fromId === currentUserId,
          content: m.content,
          createdAt: m.createdAt,
        });
        if (method === 'GET') return json({ messages: mine.map(project) });
        if (method === 'POST') {
          const content = String(body.content ?? '').trim();
          if (!content) return json({ error: '消息不能为空' }, 400);
          if (content.length > 2000) return json({ error: '消息过长,最多 2000 字' }, 400);
          const mineMessage = {
            id: `m${++seq}`,
            fromId: currentUserId,
            toId: peer,
            content,
            createdAt: '2026-11-23T00:00:00Z',
          };
          chatHistory.push(mineMessage);
          const out = [project(mineMessage)];
          if (peer === 'test-user') {
            const reply = {
              id: `m${++seq}`,
              fromId: 'test-user',
              toId: currentUserId,
              content: `(测试用户自动回复)已收到:「${content}」`,
              createdAt: '2026-11-23T00:00:00Z',
            };
            chatHistory.push(reply);
            out.push(project(reply));
          }
          return json({ messages: out });
        }
      }
      if (path === '/api/invites' && method === 'GET') {
        if (!currentUserId) return json({ error: '需要登录' }, 401);
        return json({ invites: lists().invites });
      }
      if (path === '/api/invites' && method === 'POST') {
        if (!currentUserId) return json({ error: '需要登录' }, 401);
        const to = String(body.to ?? '');
        const slug = String(body.slug ?? '');
        const params = (body.params ?? null) as Record<string, unknown> | null;
        if (slug !== 'bvn') return json({ error: '未接入该游戏' }, 400);
        if (to === currentUserId) return json({ error: '不能邀请自己' }, 400);
        if (to === 'test-user') return json({ error: '测试用户无法加入游戏' }, 400);
        if (!isFriendAccepted(currentUserId, to)) return json({ error: '只能邀请好友' }, 400);
        invites.push({ id: `i${++seq}`, fromUser: currentUserId, toUser: to, slug, params, status: 'pending' });
        return json({ ok: true });
      }
      const inviteAction = /^\/api\/invites\/([\w-]+)\/(accept|decline)$/.exec(path);
      if (inviteAction && method === 'POST') {
        if (!currentUserId) return json({ error: '需要登录' }, 401);
        const invite = invites.find((i) => i.id === inviteAction[1]);
        if (!invite || invite.toUser !== currentUserId || invite.status !== 'pending') {
          return json({ error: '邀请不存在或已处理' }, 400);
        }
        invite.status = inviteAction[2] === 'accept' ? 'accepted' : 'declined';
        return json({ ok: true });
      }
      const inviteGet = /^\/api\/invites\/([\w-]+)$/.exec(path);
      if (inviteGet && method === 'GET') {
        if (!currentUserId) return json({ error: '需要登录' }, 401);
        const invite = invites.find((i) => i.id === inviteGet[1]);
        if (!invite || invite.toUser !== currentUserId) return json({ error: '邀请不存在' }, 404);
        // 与服务端 invites.mjs 同语义:params 一次性投递——首次取参返回并标记
        // delivered,之后 params 为 null(刷新恢复由游戏侧邀请票自持)。
        const firstDelivery = !invite.delivered;
        invite.delivered = true;
        return json({
          invite: {
            slug: invite.slug,
            params: firstDelivery ? invite.params : null,
          },
        });
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

export type FakeApi = ReturnType<typeof makeFakeApi>;
