import { useAuth } from '../state/auth';
import { useInviteHub } from '../state/invites';
import { UserAvatar } from './UserAvatar';

/**
 * 顶栏账号区:头像与名称是唯一入口,点击直接滑出好友栏(无下拉菜单)。
 * 游客同样滑出好友栏,由面板内提供登录/注册;身份状态由好友栏底部承担(退出登录)。
 * 待处理邀请未读时头像钮带角标(Toast 被作废后,入口角标兜底邀请可见性)。
 */
export function UserArea({ onOpenFriends }: { onOpenFriends: () => void }) {
  const { status, user } = useAuth();
  // 游客态不挂 hub(InviteHubProvider 在 AuthProvider 内恒可用,游客无邀请可提示)。
  const hub = useInviteHub();
  const badge = status === 'user' ? hub.badgeCount : 0;

  if (status === 'loading') {
    return <div className="user-area user-area-loading" aria-hidden="true" />;
  }

  const isUser = status === 'user' && user;
  const displayName = isUser ? user.username : '游客';

  return (
    <div className="user-area">
      <button
        type="button"
        className="user-profile"
        onClick={onOpenFriends}
        aria-haspopup="dialog"
        title="好友"
      >
        {isUser ? (
          <UserAvatar user={user} />
        ) : (
          <span className="user-avatar" aria-hidden="true">
            <svg className="guest-avatar-icon" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="11" r="5" fill="currentColor" />
              <path d="M6.5 27c.7-6 4.1-9 9.5-9s8.8 3 9.5 9" fill="currentColor" />
            </svg>
          </span>
        )}
        <span className="user-name">{displayName}</span>
        {badge > 0 && (
          <span className="user-invite-badge" aria-label={`${badge} 个待处理邀请`}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
    </div>
  );
}
