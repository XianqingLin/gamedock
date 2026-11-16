export interface ApiUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface FriendEntry {
  id: string;
  user: Pick<ApiUser, 'id' | 'username'>;
  since: string;
}

export interface IncomingRequestEntry {
  id: string;
  from: Pick<ApiUser, 'id' | 'username'>;
  createdAt: string;
}

export interface OutgoingRequestEntry {
  id: string;
  to: Pick<ApiUser, 'id' | 'username'>;
  createdAt: string;
}

export interface FriendLists {
  friends: FriendEntry[];
  incoming: IncomingRequestEntry[];
  outgoing: OutgoingRequestEntry[];
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
};

export const friendsApi = {
  list: () => apiRequest<FriendLists>('/api/friends'),
  sendRequest: (username: string) =>
    apiRequest<FriendLists>('/api/friends/requests', { method: 'POST', body: { username } }),
  respond: (requestId: string, accept: boolean) =>
    apiRequest<FriendLists>(`/api/friends/requests/${requestId}/${accept ? 'accept' : 'decline'}`, { method: 'POST' }),
  cancel: (requestId: string) => apiRequest<FriendLists>(`/api/friends/requests/${requestId}`, { method: 'DELETE' }),
  remove: (friendshipId: string) => apiRequest<FriendLists>(`/api/friends/${friendshipId}`, { method: 'DELETE' }),
};
