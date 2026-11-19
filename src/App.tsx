import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './state/auth';
import { ExplorePage } from './pages/ExplorePage';
import { BrowsePage } from './pages/BrowsePage';
import { GameDetailPage } from './pages/GameDetailPage';
import { PlayPage } from './pages/PlayPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AppSidebar } from './components/AppSidebar';
import { trackNavigation } from './lib/navStack';

export default function App() {
  const location = useLocation();
  const { pathname } = location;
  // 记录站内访问位置，供层级式返回（顶栏返回按钮、详情页 Escape）使用
  useEffect(() => {
    trackNavigation(location.key, pathname + location.search);
  }, [location]);
  // 游戏运行页是新窗口中的独立游戏界面:无左侧栏,标题与账号区由运行页顶栏承担
  const showSidebar = !pathname.startsWith('/play/');

  return (
    <AuthProvider>
      <div className="app-shell">
        {showSidebar && <AppSidebar />}
        <div className="app-content">
          <Routes>
            <Route path="/" element={<ExplorePage />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/games/:slug" element={<GameDetailPage />} />
            <Route path="/play/:slug" element={<PlayPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </div>
    </AuthProvider>
  );
}
