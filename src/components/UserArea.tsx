import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { AuthDialog } from './AuthDialog';
import type { AuthMode } from './AuthDialog';
import { FriendsPanel } from './FriendsPanel';

type Dialog = AuthMode | 'friends' | null;

/** 头部用户入口：游客默认浏览，头像与名称共同触发用户菜单。 */
export function UserArea() {
  const { status, user, logout } = useAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!areaRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [status, user?.id]);

  if (status === 'loading') {
    return <div className="user-area user-area-loading" aria-hidden="true" />;
  }

  const isUser = status === 'user' && user;
  const displayName = isUser ? user.username : '游客';
  const openDialog = (nextDialog: Dialog) => {
    setMenuOpen(false);
    setDialog(nextDialog);
  };

  return (
    <div className="user-area" ref={areaRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-profile"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-controls={menuId}
        aria-haspopup="true"
        title="用户菜单"
      >
        <span className="user-avatar" aria-hidden="true">
          {isUser ? (
            user.username.slice(0, 1).toUpperCase()
          ) : (
            <svg className="guest-avatar-icon" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="11" r="5" fill="currentColor" />
              <path d="M6.5 27c.7-6 4.1-9 9.5-9s8.8 3 9.5 9" fill="currentColor" />
            </svg>
          )}
        </span>
        <span className="user-name">{displayName}</span>
        <svg className={`user-menu-chevron${menuOpen ? ' is-open' : ''}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {menuOpen && (
        <div className="user-dropdown" id={menuId} role="group" aria-label="用户操作">
          {isUser ? (
            <>
              <Link className="user-menu-item" to="/profile" onClick={() => setMenuOpen(false)}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 20c.5-4.3 2.8-6.5 7-6.5s6.5 2.2 7 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                个人主页
              </Link>
              <button type="button" className="user-menu-item" onClick={() => openDialog('friends')}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M3.5 19c.4-3.8 2.2-5.7 5.5-5.7s5.1 1.9 5.5 5.7M16 5.5a3 3 0 0 1 0 5.8M17 13.7c2.2.5 3.3 2.3 3.5 5.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                好友
              </button>
              <div className="user-menu-divider" />
              <button
                type="button"
                className="user-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                退出登录
              </button>
            </>
          ) : (
            <div className="guest-menu-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => openDialog('login')}
                title={status === 'error' ? '无法确认登录状态，可尝试重新登录' : undefined}
              >
                登录
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => openDialog('register')}>
                注册
              </button>
            </div>
          )}
        </div>
      )}

      {(dialog === 'login' || dialog === 'register') && (
        <AuthDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSwitchMode={(mode) => setDialog(mode)}
        />
      )}
      {dialog === 'friends' && <FriendsPanel onClose={() => setDialog(null)} />}
    </div>
  );
}
