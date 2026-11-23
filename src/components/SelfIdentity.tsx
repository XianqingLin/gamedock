import { useRef, useState } from 'react';
import { ApiError, authApi } from '../lib/api';
import { useAuth } from '../state/auth';
import { UserAvatar } from './UserAvatar';
import { AvatarPickerDialog } from './AvatarPickerDialog';

/**
 * 好友栏自身身份区(原个人信息页的三要素收进面板):
 * - 头像:点击弹出预设头像选择(点击即保存);
 * - 名称:悬浮/聚焦出编辑钮,内联改名(改名即改登录用户名,失败停留编辑态就地报错);
 * - ID:「ID:」+ 用户 ID,悬浮/聚焦该行出复制图标钮一键复制(加好友要把它发给对方)。
 */
export function SelfIdentity({ name, avatar, id }: { name: string; avatar: string | null; id: string }) {
  const { updateUser } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用(如非安全上下文):ID 文本可手动选中复制。
      setCopied(false);
    }
  };

  const startEditing = () => {
    setNameDraft(name);
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
    if (!next || next === name) {
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
    <div className="friends-self-identity">
      <button
        type="button"
        className="self-avatar-btn"
        onClick={() => setPickerOpen(true)}
        aria-haspopup="dialog"
        aria-label="更换头像"
        title="更换头像"
      >
        <UserAvatar user={{ username: name, avatar }} className="friend-avatar-lg" />
        <span className="self-avatar-edit" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 20c.5-4.3 2.8-6.5 7-6.5s6.5 2.2 7 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <div className="self-meta">
        <div className="self-name-row">
          {editing ? (
            <form className="self-name-edit" onSubmit={(event) => void saveName(event)}>
              <input
                ref={inputRef}
                className="self-name-input"
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
              <span className="self-name" title={name}>
                {name}
              </span>
              <button
                type="button"
                className="self-edit-btn"
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
          <p className="form-error self-name-error" role="alert">
            {nameError}
          </p>
        )}
        <div className="self-id-row">
          <span className="self-id-label">ID:</span>
          <span className="self-id">{id}</span>
          <button
            type="button"
            className="self-copy-btn"
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
          <span className="self-copied-hint" role="status">
            {copied ? '已复制' : ''}
          </span>
        </div>
      </div>
      {pickerOpen && <AvatarPickerDialog overlayClass="picker-overlay" onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
