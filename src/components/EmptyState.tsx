import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  detail?: string;
  action?: ReactNode;
}

export function EmptyState({ title, detail, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {detail && <p className="empty-detail">{detail}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
