import { FriendsPanel } from './FriendsPanel';
import type { CurrentGameContext } from './FriendsPanel';
import { Modal } from './Modal';

interface SocialSidebarProps {
  onClose: () => void;
  /** 正在游玩的游戏上下文(仅运行页;主站抽屉不传 → 好友菜单无「邀请游玩」)。 */
  currentGame?: CurrentGameContext;
}

/** 按需打开的好友抽屉:覆盖内容,不改变左右两栏布局。头部由面板自绘(无标题)。 */
export function SocialSidebar({ onClose, currentGame }: SocialSidebarProps) {
  return (
    <Modal title="好友" onClose={onClose} variant="drawer" hideHeader>
      <div className="social-drawer-content">
        <FriendsPanel onClose={onClose} currentGame={currentGame} />
      </div>
    </Modal>
  );
}
