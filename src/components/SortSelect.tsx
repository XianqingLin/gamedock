import { useEffect, useRef, useState } from 'react';
import { SORT_IDS, SORT_LABELS, type SortId } from '../lib/browse';

interface SortSelectProps {
  value: SortId;
  onChange: (id: SortId) => void;
}

/** 排序下拉：触发按钮 + 选项列表，Escape 与点击外部关闭。 */
export function SortSelect({ value, onChange }: SortSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="sort-select" ref={rootRef}>
      <button
        type="button"
        className="sort-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {SORT_LABELS[value]}
        <svg className={open ? 'sort-chevron is-open' : 'sort-chevron'} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="sort-menu">
          {SORT_IDS.map((id) => (
            <li key={id}>
              <button
                type="button"
                className={id === value ? 'sort-option is-selected' : 'sort-option'}
                aria-current={id === value ? 'true' : undefined}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                {SORT_LABELS[id]}
                {id === value && (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
