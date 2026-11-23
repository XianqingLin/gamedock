import { Link } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { EmptyState } from '../components/EmptyState';

/**
 * 成就墙:占位页。平台目前不感知游戏内对局,尚无成就数据源;
 * 接入成就上报后在此按成就渲染,页面骨架与导航先行。
 */
export function AchievementsPage() {
  return (
    <div className="page profile-page">
      <SiteHeader />
      <main className="profile-main">
        <section className="profile-card achievements-card">
          <h1 className="profile-page-title">成就墙</h1>
          <EmptyState
            title="成就系统即将上线"
            detail="成就数据接入后,这里会展示你在各游戏中解锁的成就。"
            action={
              <Link className="btn btn-secondary" to="/">
                去逛逛游戏
              </Link>
            }
          />
        </section>
      </main>
    </div>
  );
}
