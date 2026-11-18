import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: 'dialog' | 'drawer';
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 通用模态弹层:焦点移入并圈定在弹层内,Escape 关闭,
 * 关闭后焦点恢复到原入口(产品需求 6.2)。
 */
export function Modal({ title, onClose, children, variant = 'dialog' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = dialogRef.current;
    if (dialog) {
      const autofocus = dialog.querySelector<HTMLElement>('[data-autofocus]');
      const first = autofocus ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className={`modal-overlay${variant === 'drawer' ? ' drawer-overlay' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal${variant === 'drawer' ? ' social-drawer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
      >
        <header className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="关闭弹窗">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
