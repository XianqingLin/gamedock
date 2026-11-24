import { useEffect, useMemo, useState } from 'react';
import { GAMES } from '../data';
import { UserAvatar } from './UserAvatar';
import { useInviteHub } from '../state/invites';

/** 邀请 Toast 停留时长(之后下滑消失,队列中的下一个才登场)。 */
const TOAST_VISIBLE_MS = 6000;

type ToastItem =
  | { key: string; kind: 'invite'; id: string; name: string; avatar: string | null; slug: string }
  | { key: string; kind: 'response'; id: string; name: string; avatar: string | null };

/** slug → 游戏标题(未知 slug 退回显示 slug 本身)。 */
function gameTitle(slug: string): string {
  return GAMES.find((game) => game.slug === slug)?.title ?? slug;
}

/**
 * 右下角邀请通知 Toast(固定栈位,严格单显队列)。
 * - 邀请 Toast:自下滑入,停留约 6s 后下滑出,前一个完全离场后下一个才登场;
 *   同一邀请者重复邀请在 hub 层去重,不重复排队。
 * - 点击邀请 Toast → 打开好友栏并作废剩余队列(剩余邀请只在好友栏可见,入口有角标兜底)。
 * - 拒绝回执 Toast(发起方):纯提示,不可点,展示一次即记。
 */
export function InviteToasts() {
  const hub = useInviteHub();
  const [shown, setShown] = useState<ToastItem | null>(null);
  const [leaving, setLeaving] = useState(false);

  // 展示队列 = 未弹过的邀请(先到先显)+ 未提示过的拒绝回执,每次渲染从 hub 派生。
  const queue = useMemo<ToastItem[]>(() => {
    const inviteItems: ToastItem[] = hub.toastQueue.map((invite) => ({
      key: `invite:${invite.id}`,
      kind: 'invite',
      id: invite.id,
      name: invite.from.username,
      avatar: invite.from.avatar,
      slug: invite.slug,
    }));
    const responseItems: ToastItem[] = hub.pendingResponses.map((entry) => ({
      key: `response:${entry.id}`,
      kind: 'response',
      id: entry.id,
      name: entry.to.username,
      avatar: null,
    }));
    return [...inviteItems, ...responseItems];
  }, [hub.toastQueue, hub.pendingResponses]);

  // 空闲且有排队 → 登场下一条;当前条目被处理(接受/拒绝/覆盖)后自动让位。
  useEffect(() => {
    if (shown || leaving || queue.length === 0) return;
    setShown(queue[0]);
  }, [shown, leaving, queue]);

  // 停留计时:离场动画由点击或计时触发;离场完成后记账并让位。
  useEffect(() => {
    if (!shown || leaving) return;
    const timer = window.setTimeout(() => setLeaving(true), TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [shown, leaving]);

  // 当前邀请在别处已被处理(接受/拒绝/覆盖,轮询后从 pending 消失)→ 提前离场,不挂陈旧提示。
  useEffect(() => {
    if (!shown || leaving || shown.kind !== 'invite') return;
    if (!hub.invites.some((invite) => invite.id === shown.id)) setLeaving(true);
  }, [hub.invites, shown, leaving]);

  const finalize = (item: ToastItem) => {
    if (item.kind === 'invite') hub.markToastsSeen([item.id]);
    else hub.markResponsesSeen([item.id]);
    setShown(null);
    setLeaving(false);
  };

  const onClick = (item: ToastItem) => {
    if (item.kind !== 'invite') return;
    // 作废整个队列(含当前条):被作废的邀请只在好友栏可见,角标兜底可见性。
    hub.markToastsSeen(queue.filter((entry) => entry.kind === 'invite').map((entry) => entry.id));
    hub.requestOpenFriends();
    setLeaving(true);
  };

  return (
    <div className="invite-toast-stack" aria-live="polite">
      {shown && (
        <button
          type="button"
          key={shown.key}
          className={`invite-toast ${leaving ? 'is-leaving' : 'is-entering'}${shown.kind === 'response' ? ' invite-toast-plain' : ''}`}
          onClick={() => onClick(shown)}
          onAnimationEnd={() => {
            if (leaving) finalize(shown);
          }}
          aria-label={
            shown.kind === 'invite'
              ? `${shown.name} 邀请你玩 ${gameTitle(shown.slug)},点击打开好友栏`
              : undefined
          }
        >
          <UserAvatar user={{ username: shown.name, avatar: shown.avatar }} className="friend-avatar" />
          <span className="invite-toast-text">
            {shown.kind === 'invite' ? (
              <>
                <strong>{shown.name}</strong> 邀请你玩 {gameTitle(shown.slug)}
              </>
            ) : (
              <>
                <strong>{shown.name}</strong> 拒绝了你的游玩邀请
              </>
            )}
          </span>
        </button>
      )}
    </div>
  );
}
