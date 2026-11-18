import { useCallback, useState } from 'react';
import { SocialSidebar } from './SocialSidebar';

/** 顶栏好友入口：按需打开浮层，不参与主内容布局。 */
export function SocialEntry() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost social-entry"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M3.5 19c.5-4 2.3-6 5.5-6s5 2 5.5 6M16 5.5a3 3 0 0 1 0 5.8M17 13.5c2.2.5 3.3 2.3 3.5 5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span>好友</span>
      </button>
      {open && <SocialSidebar onClose={close} />}
    </>
  );
}
