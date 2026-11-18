import { Link } from 'react-router-dom';
import { UserArea } from './UserArea';

/** 全站统一顶部导航。 */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="site-navigation">
          <Link className="site-brand" to="/" aria-label="GameDock 首页">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M5 5h8v22H5zM19 5h8v8h-8zM19 19h8v8h-8z" fill="currentColor" />
            </svg>
            <span>GameDock</span>
          </Link>
          <nav className="site-nav" aria-label="主导航">
            <Link className="site-nav-link" to="/">
              首页
            </Link>
          </nav>
        </div>

        <div className="site-header-actions">
          <UserArea />
        </div>
      </div>
    </header>
  );
}
