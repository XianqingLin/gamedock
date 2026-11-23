import { Link, NavLink } from 'react-router-dom';

/**
 * 全站左侧栏:品牌 + 「游戏」「成就墙」「存档」三个顶级入口(与游戏同级,均为页面级栏目)。
 * 「探索/浏览」导航只在右侧顶栏,不在侧栏展开。
 */
export function AppSidebar() {
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
          to="/achievements"
          className={({ isActive }) => `app-sidebar-link${isActive ? ' is-active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M8 4h8v4.5a4 4 0 0 1-8 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path
              d="M8 5.5H5.2a2.8 2.8 0 0 0 2.9 3.4M16 5.5h2.8a2.8 2.8 0 0 1-2.9 3.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path d="M12 12.5v3M9 20h6l-.6-4.5H9.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span>成就墙</span>
        </NavLink>

        <NavLink
          to="/saves"
          className={({ isActive }) => `app-sidebar-link${isActive ? ' is-active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H4Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M5 9v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M10 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>存档</span>
        </NavLink>
      </nav>
    </aside>
  );
}
