import { Link } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../state/auth';

export function ProfilePage() {
  const { status, user } = useAuth();

  return (
    <div className="page profile-page">
      <SiteHeader />
      <main className="profile-main">
        {status === 'loading' ? (
          <EmptyState title="正在加载…" detail="正在确认登录状态。" />
        ) : status === 'user' && user ? (
          <section className="profile-card" aria-labelledby="profile-title">
            <div className="profile-identity">
              <span className="user-avatar profile-avatar" aria-hidden="true">
                {user.username.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <p className="profile-eyebrow">个人主页</p>
                <h1 id="profile-title">{user.username}</h1>
              </div>
            </div>
            <dl className="profile-fields">
              <div>
                <dt>用户名</dt>
                <dd>{user.username}</dd>
              </div>
              <div>
                <dt>加入时间</dt>
                <dd>
                  {new Intl.DateTimeFormat('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }).format(new Date(user.createdAt))}
                </dd>
              </div>
            </dl>
          </section>
        ) : (
          <EmptyState
            title="登录后查看个人主页"
            detail="游客可以通过右上角的用户菜单登录或注册。"
            action={
              <Link className="btn btn-secondary" to="/">
                返回首页
              </Link>
            }
          />
        )}
      </main>
    </div>
  );
}
