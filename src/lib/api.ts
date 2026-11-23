export interface ApiUser {
  id: string;
  username: string;
  createdAt: string;
  /** 系统预设头像编号(av0~av16);null = 未设置,渲染用户名首字母。 */
  avatar: string | null;
}

export interface FriendEntry {
  id: string;
  user: Pick<ApiUser, 'id' | 'username' | 'avatar'> & { online?: boolean };
  since: string;
  /** 固定测试用户 bot(不可删除、恒在线、自动回复)。 */
  bot?: boolean;
}

export interface IncomingRequestEntry {
  id: string;
  from: Pick<ApiUser, 'id' | 'username' | 'avatar'> & { online?: boolean };
  createdAt: string;
}

export interface OutgoingRequestEntry {
  id: string;
  to: Pick<ApiUser, 'id' | 'username' | 'avatar'> & { online?: boolean };
  createdAt: string;
}

export interface GameInviteEntry {
  id: string;
  from: Pick<ApiUser, 'id' | 'username' | 'avatar'>;
  slug: string;
  /** 游戏自定义加入参数(平台不解析,原样透传给游戏)。 */
  params: Record<string, unknown> | null;
  createdAt: string;
}

export interface FriendLists {
  /** 当前登录用户自身状态,与好友共用同一份 last_seen_at 判定。 */
  me: { id: string; username: string; online?: boolean; avatar?: string | null };
  friends: FriendEntry[];
  incoming: IncomingRequestEntry[];
  outgoing: OutgoingRequestEntry[];
  /** 待处理的游戏邀请(仅信息传递;好友列表顶部固定展示)。 */
  invites: GameInviteEntry[];
}


export interface ChatMessage {
  id: string;
  /** 对方用户 ID(聊天是好友间双向会话)。 */
  peer: string;
  /** 是否本端发出。 */
  mine: boolean;
  content: string;
  createdAt: string;
}


export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new ApiError(data?.error ?? `请求失败(${res.status})`, res.status);
  }
  return data as T;
}

export const authApi = {
  me: () => apiRequest<{ user: ApiUser | null }>('/api/auth/me'),
  register: (username: string, password: string) =>
    apiRequest<{ user: ApiUser }>('/api/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: string) =>
    apiRequest<{ user: ApiUser }>('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  /** 资料更新:改用户名(= 登录名)与头像;avatar 传 null 恢复默认首字母头像。 */
  updateProfile: (patch: { username?: string; avatar?: string | null }) =>
    apiRequest<{ user: ApiUser }>('/api/auth/profile', { method: 'PATCH', body: patch }),
};

export const presenceApi = {
  /** 登录态在线心跳:服务端记录 last_seen_at,好友列表据此判定在线(静默失败,不影响使用)。 */
  beat: () => apiRequest<{ ok: true }>('/api/presence', { method: 'POST' }),
};

export const friendsApi = {
  list: () => apiRequest<FriendLists>('/api/friends'),
  sendRequest: (id: string) =>
    apiRequest<FriendLists>('/api/friends/requests', { method: 'POST', body: { id } }),
  respond: (requestId: string, accept: boolean) =>
    apiRequest<FriendLists>(`/api/friends/requests/${requestId}/${accept ? 'accept' : 'decline'}`, { method: 'POST' }),
  cancel: (requestId: string) => apiRequest<FriendLists>(`/api/friends/requests/${requestId}`, { method: 'DELETE' }),
  remove: (friendshipId: string) => apiRequest<FriendLists>(`/api/friends/${friendshipId}`, { method: 'DELETE' }),
  /** 游戏邀请(仅信息传递):params 为游戏上报的加入参数,平台原样透传。 */
  sendInvite: (to: string, slug: string, params: Record<string, unknown> | null) =>
    apiRequest<{ ok: true }>('/api/invites', { method: 'POST', body: { to, slug, params } }),
  respondInvite: (inviteId: string, accept: boolean) =>
    apiRequest<{ ok: true }>(`/api/invites/${inviteId}/${accept ? 'accept' : 'decline'}`, { method: 'POST' }),
  /** 运行页取邀请(任意状态;刷新后可重取加入参数)。 */
  getInvite: (inviteId: string) =>
    apiRequest<{ invite: { slug: string; params: Record<string, unknown> | null } }>(
      `/api/invites/${encodeURIComponent(inviteId)}`,
    ),
};


export const chatApi = {
  history: (peer: string) => apiRequest<{ messages: ChatMessage[] }>(`/api/chat/${encodeURIComponent(peer)}`),
  send: (peer: string, content: string) =>
    apiRequest<{ messages: ChatMessage[] }>(`/api/chat/${encodeURIComponent(peer)}`, {
      method: 'POST',
      body: { content },
    }),
};

export interface SaveSlotMeta {
  key: string;
  updatedAt: string | null;
  size: number | null;
}

export interface SaveGameGroup {
  slug: string;
  slots: SaveSlotMeta[];
}

export const savesApi = {
  /** 跨游戏聚合:列出当前用户在所有游戏的存档槽位元数据(只含非空游戏)。 */
  listAll: () => apiRequest<{ games: SaveGameGroup[] }>('/api/saves'),
  remove: (slug: string, key: string) =>
    apiRequest<{ ok: true }>(`/api/saves/${encodeURIComponent(slug)}/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};
