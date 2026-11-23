import { FriendsPanel } from './FriendsPanel';
import { Modal } from './Modal';

interface SocialSidebarProps {
  onClose: () => void;
}

/** 按需打开的好友抽屉:覆盖内容,不改变左右两栏布局。头部由面板自绘(无标题)。 */
export function SocialSidebar({ onClose }: SocialSidebarProps) {
  return (
    <Modal title="好友" onClose={onClose} variant="drawer" hideHeader>
      <div className="social-drawer-content">
        <FriendsPanel onClose={onClose} />
      </div>
    </Modal>
  );
}
