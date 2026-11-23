import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { EmptyState } from '../components/EmptyState';
import { UserAvatar } from '../components/UserAvatar';
import { AvatarPickerDialog } from '../components/AvatarPickerDialog';
import { authApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { useAuth } from '../state/auth';

/**
 * 个人主页(个人信息):头像(点击弹窗更换)、用户名(悬浮出编辑钮,内联改名)、
 * 用户 ID(名称下方,悬浮出复制图标)。加好友按 ID 搜索,故 ID 保留一键复制。
 */
export function ProfilePage() {
  const { status, user, updateUser } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (status === 'loading') {
    return (
      <div className="page profile-page">
        <SiteHeader />
        <main className="profile-main">
          <EmptyState title="正在加载…" detail="正在确认登录状态。" />
        </main>
      </div>
    );
  }

  if (status !== 'user' || !user) {
    return (
      <div className="page profile-page">
        <SiteHeader />
        <main className="profile-main">
          <EmptyState
            title="登录后查看个人主页"
            detail="游客可以通过右上角的用户菜单登录或注册。"
            action={
              <Link className="btn btn-secondary" to="/">
                返回首页
              </Link>
            }
          />
        </main>
      </div>
    );
  }

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用(如非安全上下文):ID 文本可手动选中复制。
      setCopied(false);
    }
  };

  const startEditing = () => {
    setNameDraft(user.username);
    setNameError(null);
    setEditing(true);
    window.setTimeout(() => inputRef.current?.select(), 0);
  };

  const cancelEditing = () => {
    setEditing(false);
    setNameError(null);
  };

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = nameDraft.trim();
    if (!next || next === user.username) {
      setEditing(false);
      setNameError(null);
      return;
    }
    if (savingName) return;
    setSavingName(true);
    try {
      const data = await authApi.updateProfile({ username: next });
      updateUser(data.user);
      setEditing(false);
      setNameError(null);
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : '保存失败,请稍后再试');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="page profile-page">
      <SiteHeader />
      <main className="profile-main">
        <section className="profile-card" aria-labelledby="profile-title">
          <div className="profile-identity">
            <button
              type="button"
              className="profile-avatar-btn"
              onClick={() => setPickerOpen(true)}
              aria-haspopup="dialog"
              aria-label="更换头像"
              title="更换头像"
            >
              <UserAvatar user={user} className="profile-avatar" />
              <span className="profile-avatar-edit" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 20c.5-4.3 2.8-6.5 7-6.5s6.5 2.2 7 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
            </button>
            <div className="profile-identity-text">
              <div className="profile-name-row">
                {editing ? (
                  <form className="profile-name-edit" onSubmit={(event) => void saveName(event)}>
                    <input
                      ref={inputRef}
                      className="form-input profile-name-input"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      aria-label="用户名"
                      maxLength={24}
                      data-autofocus
                    />
                    <button type="submit" className="btn btn-primary btn-sm" disabled={savingName}>
                      保存
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEditing}>
                      取消
                    </button>
                  </form>
                ) : (
                  <>
                    <h1 id="profile-title">{user.username}</h1>
                    <button
                      type="button"
                      className="profile-edit-btn"
                      onClick={startEditing}
                      aria-label="编辑用户名"
                      title="编辑用户名"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M4 20h4l11-11-4-4L4 16v4ZM13 7l4 4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </>
                )}
              </div>
              {nameError && (
                <p className="form-error profile-name-error" role="alert">
                  {nameError}
                </p>
              )}
              <div className="profile-id-row">
                <code className="profile-id">{user.id}</code>
                <button
                  type="button"
                  className="profile-copy-btn"
                  onClick={() => void copyId()}
                  aria-label="复制用户 ID"
                  title="复制用户 ID"
                >
                  {copied ? (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M15 5H7a2 2 0 0 0-2 2v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
                <span className="profile-copied-hint" role="status">
                  {copied ? '已复制' : ''}
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>
      {pickerOpen && <AvatarPickerDialog onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
