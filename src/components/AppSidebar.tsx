import { Link, NavLink, useLocation } from 'react-router-dom';

/**
 * 全站左侧栏:品牌 + 「游戏」「个人主页」入口。
 * 「探索/浏览」导航只在右侧顶栏,不在侧栏展开;
 * 「个人主页」含二级目录(个人信息/成就墙/存档),位于个人主页区块时自动展开。
 */
export function AppSidebar() {
  const { pathname } = useLocation();
  const profileSection = pathname.startsWith('/profile');

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-brand">
        <Link className="site-brand" to="/" aria-label="GameDock 首页">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M5 5h8v22H5zM19 5h8v8h-8zM19 19h8v8h-8z" fill="currentColor" />
          </svg>
          <span>GameDock</span>
        </Link>
      </div>

      <nav className="app-sidebar-nav" aria-label="主导航">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `app-sidebar-link${isActive ? ' is-active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M7 8h10a4.5 4.5 0 0 1 4.4 5.4l-.8 3.6a2.6 2.6 0 0 1-4.5 1.1L14.6 16H9.4l-1.5 2.1a2.6 2.6 0 0 1-4.5-1.1l-.8-3.6A4.5 4.5 0 0 1 7 8Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M8.5 11v3M7 12.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="15.5" cy="11.5" r="0.9" fill="currentColor" />
            <circle cx="17.5" cy="13.5" r="0.9" fill="currentColor" />
          </svg>
          <span>游戏</span>
        </NavLink>

        <NavLink
          to="/profile"
          className={({ isActive }) => `app-sidebar-link${isActive ? ' is-active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M5 20c.5-4.3 2.8-6.5 7-6.5s6.5 2.2 7 6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span>个人主页</span>
        </NavLink>

        {profileSection && (
          <div className="app-sidebar-subnav">
            <NavLink
              to="/profile"
              end
              className={({ isActive }) => `app-sidebar-sublink${isActive ? ' is-active' : ''}`}
            >
              个人信息
            </NavLink>
            <NavLink
              to="/profile/achievements"
              className={({ isActive }) => `app-sidebar-sublink${isActive ? ' is-active' : ''}`}
            >
              成就墙
            </NavLink>
            <NavLink
              to="/profile/saves"
              className={({ isActive }) => `app-sidebar-sublink${isActive ? ' is-active' : ''}`}
            >
              存档
            </NavLink>
          </div>
        )}
      </nav>
    </aside>
  );
}
