import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../lib/api';
import type { ApiUser } from '../lib/api';

export type AuthStatus = 'loading' | 'guest' | 'user' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 身份状态边界(技术要求 4.1):加载、游客、已登录、错误四种状态明确区分,
 * 未确认前不得按已登录处理。错误时可通过 refresh 重试,不误用注册身份。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<ApiUser | null>(null);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await authApi.me();
      setUser(data.user);
      setStatus(data.user ? 'user' : 'guest');
    } catch {
      setUser(null);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await authApi.login(username, password);
    setUser(data.user);
    setStatus('user');
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const data = await authApi.register(username, password);
    setUser(data.user);
    setStatus('user');
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setStatus('guest');
  }, []);

  const value = useMemo(
    () => ({ status, user, login, register, logout, refresh }),
    [status, user, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
