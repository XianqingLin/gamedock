import { getPresetAvatar } from '../data/avatars';

/**
 * 统一用户头像:有预设编号渲染对应内置 SVG,否则回退用户名首字母(游客头像不适用,自绘)。
 * className 传尺寸变体类(如 profile-avatar / friend-avatar-lg),与现有 .user-avatar 圆底叠加。
 */
export function UserAvatar({
  user,
  className = '',
}: {
  user: { username: string; avatar?: string | null };
  className?: string;
}) {
  const preset = user.avatar ? getPresetAvatar(user.avatar) : null;
  return (
    <span className={`user-avatar${className ? ` ${className}` : ''}`} aria-hidden="true">
      {preset ? (
        <svg className="preset-avatar-icon" viewBox="0 0 32 32">
          {preset.svg}
        </svg>
      ) : (
        user.username.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
