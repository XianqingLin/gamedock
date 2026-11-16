import { useState } from 'react';
import { useAuth } from '../state/auth';
import { AuthDialog } from './AuthDialog';
import type { AuthMode } from './AuthDialog';
import { FriendsPanel } from './FriendsPanel';

type Dialog = AuthMode | 'friends' | null;

/**
 * 头部用户区:游客显示登录/注册;已登录显示用户名、好友入口与退出。
 * 游客点击“好友”时引导先登录(存档/好友/联机均要求登录,单机不要求)。
 */
export function UserArea() {
  const { status, user, logout } = useAuth();
  const [dialog, setDialog] = useState<Dialog>(null);

  if (status === 'loading') {
    return <div className="user-area" aria-hidden="true" />;
  }

  if (status === 'user' && user) {
    return (
      <div className="user-area">
        <span className="user-name">{user.username}</span>
        <button type="button" className="btn btn-secondary" onClick={() => setDialog('friends')}>
          好友
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
          退出登录
        </button>
        {dialog === 'friends' && <FriendsPanel onClose={() => setDialog(null)} />}
      </div>
    );
  }

  // guest 与 error 都展示登录/注册;error 状态下提交失败会显示真实错误,不伪装身份。
  return (
    <div className="user-area">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setDialog('login')}
        title={status === 'error' ? '无法确认登录状态,可尝试重新登录' : undefined}
      >
        登录
      </button>
      <button type="button" className="btn btn-primary" onClick={() => setDialog('register')}>
        注册
      </button>
      {(dialog === 'login' || dialog === 'register') && (
        <AuthDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSwitchMode={(mode) => setDialog(mode)}
        />
      )}
    </div>
  );
}
