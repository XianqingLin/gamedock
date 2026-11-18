import { FriendsPanel } from './FriendsPanel';
import { Modal } from './Modal';

interface SocialSidebarProps {
  onClose: () => void;
}

/** 按需打开的好友抽屉：覆盖内容，不改变左右两栏布局。 */
export function SocialSidebar({ onClose }: SocialSidebarProps) {
  return (
    <Modal title="好友" onClose={onClose} variant="drawer">
      <div className="social-drawer-content">
        <FriendsPanel />
      </div>
    </Modal>
  );
}
