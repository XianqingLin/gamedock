import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useAuth } from '../state/auth';
import { Modal } from './Modal';

export type AuthMode = 'login' | 'register';

interface AuthDialogProps {
  mode: AuthMode;
  onClose: () => void;
  onSwitchMode: (mode: AuthMode) => void;
}

/**
 * 登录 / 注册对话框(注册字段按已确认方案:用户名 + 密码,无邮箱)。
 * 提交失败显示服务端错误,不伪装成功;成功后由身份状态统一更新。
 */
export function AuthDialog({ mode, onClose, onSwitchMode }: AuthDialogProps) {
  const { login, register } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === 'register';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      if (isRegister) await register(username, password);
      else await login(username, password);
      onClose();
    } catch (err) {
      if (!(err instanceof ApiError)) console.error('[auth] 意外错误:', err);
      setError(err instanceof ApiError ? err.message : '网络异常,请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={isRegister ? '注册' : '登录'} onClose={onClose}>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="auth-username">用户名</label>
          <input
            id="auth-username"
            data-autofocus
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            maxLength={24}
            required
          />
          {isRegister && <p className="form-hint">2-24 位字母、数字、下划线或中文</p>}
        </div>
        <div className="form-field">
          <label htmlFor="auth-password">密码</label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            maxLength={128}
            required
          />
          {isRegister && <p className="form-hint">至少 6 位</p>}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? '提交中…' : isRegister ? '注册' : '登录'}
        </button>
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setError(null);
            onSwitchMode(isRegister ? 'login' : 'register');
          }}
        >
          {isRegister ? '已有账号?去登录' : '没有账号?去注册'}
        </button>
      </form>
    </Modal>
  );
}
