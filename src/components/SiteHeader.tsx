import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SocialEntry } from './SocialEntry';
import { UserArea } from './UserArea';
import { SearchBar } from './SearchBar';
import { useBackToParent } from '../lib/navStack';

/**
 * 右侧工作区顶栏：返回按钮、搜索框与「探索/浏览」导航居左，全局社交与账号入口居右。
 * 搜索词与浏览页 URL（?q=）双向同步；在浏览页外输入时跳转到浏览页。
 * 返回按钮为层级式：详情页的上级是浏览页——后退至历史中最近的浏览页位置
 * （跳过运行页等非上级页面），历史中没有浏览页时直达浏览页；
 * 探索、浏览等顶级页面无上级，按钮呈禁用态。
 */
export function SiteHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const onBrowse = location.pathname === '/browse';
  const [input, setInput] = useState(params.get('q') ?? '');

  // 层级式上级：目前只有游戏详情页有上级（浏览页）。
  const parent = /^\/games\/[^/]+$/.test(location.pathname) ? '/browse' : null;
  const goBackToParent = useBackToParent();

  // 浏览页 URL 的搜索词变化（前进/后退、清除筛选）时同步输入框。
  useEffect(() => {
    setInput(params.get('q') ?? '');
  }, [params]);

  const updateQuery = (value: string) => {
    setInput(value);
    if (onBrowse) {
      const next = new URLSearchParams(params);
      if (value.trim()) next.set('q', value);
      else next.delete('q');
      setParams(next, { replace: true });
      return;
    }
    navigate(value.trim() ? `/browse?q=${encodeURIComponent(value)}` : '/browse');
  };

  const goBack = () => {
    if (!parent) return;
    goBackToParent();
  };

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="header-leading">
          <button
            type="button"
            className="btn btn-icon header-back"
            aria-label="返回"
            disabled={!parent}
            onClick={goBack}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M14.5 5.5 8 12l6.5 6.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="header-search">
            <SearchBar value={input} onChange={updateQuery} />
          </div>
          <nav className="site-nav" aria-label="主导航">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}
            >
              探索
            </NavLink>
            <NavLink
              to="/browse"
              className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}
            >
              浏览
            </NavLink>
          </nav>
        </div>
        <div className="site-header-actions">
          <SocialEntry />
          <UserArea />
        </div>
      </div>
    </header>
  );
}
