import { useState } from 'react';
import { ApiError, authApi } from '../lib/api';
import { useAuth } from '../state/auth';
import { USER_SELECTABLE_AVATARS, getPresetAvatar } from '../data/avatars';
import { UserAvatar } from './UserAvatar';
import { Modal } from './Modal';

/**
 * 头像选择弹窗:展示当前头像 + 系统预设网格,点击即保存生效;
 * 「默认」项恢复首字母头像。失败保留原选择并就地报错。
 */
export function AvatarPickerDialog({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const current = user.avatar ?? null;

  const apply = async (avatar: string | null) => {
    if (saving) return;
    setSaving(avatar ?? 'default');
    setError(null);
    try {
      const data = await authApi.updateProfile({ avatar });
      updateUser(data.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败,请稍后再试');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal title="选择头像" onClose={onClose}>
      <div className="avatar-picker">
        <div className="avatar-picker-current">
          <UserAvatar user={user} className="avatar-picker-current-avatar" />
          <div>
            <p className="avatar-picker-hint">当前头像</p>
            <p className="avatar-picker-current-label">
              {current ? getPresetAvatar(current)?.label ?? current : '默认(首字母)'}
            </p>
          </div>
        </div>

        <div className="avatar-picker-grid" role="listbox" aria-label="系统预设头像">
          <button
            type="button"
            role="option"
            aria-selected={current === null}
            className={`avatar-option${current === null ? ' is-current' : ''}`}
            onClick={() => void apply(null)}
            disabled={saving !== null}
          >
            <span className="user-avatar avatar-option-avatar">{user.username.slice(0, 1).toUpperCase()}</span>
            <span className="avatar-option-label">默认</span>
            {saving === 'default' && <span className="avatar-option-saving">保存中…</span>}
          </button>
          {USER_SELECTABLE_AVATARS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={current === preset.id}
              className={`avatar-option${current === preset.id ? ' is-current' : ''}`}
              onClick={() => void apply(preset.id)}
              disabled={saving !== null}
            >
              <span className="user-avatar avatar-option-avatar">
                <svg className="preset-avatar-icon" viewBox="0 0 32 32">
                  {preset.svg}
                </svg>
              </span>
              <span className="avatar-option-label">{preset.label}</span>
              {saving === preset.id && <span className="avatar-option-saving">保存中…</span>}
            </button>
          ))}
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
