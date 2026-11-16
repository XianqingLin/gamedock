import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';

export function NotFoundPage() {
  return (
    <div className="page">
      <main className="empty-wrap">
        <EmptyState
          title="页面不存在"
          detail="访问的地址没有对应页面。"
          action={
            <Link className="btn btn-secondary" to="/">
              返回首页
            </Link>
          }
        />
      </main>
    </div>
  );
}
