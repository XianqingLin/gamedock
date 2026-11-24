import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './state/auth';
import { InviteHubProvider } from './state/invites';
import { presenceApi } from './lib/api';
import { ExplorePage } from './pages/ExplorePage';
import { BrowsePage } from './pages/BrowsePage';
import { GameDetailPage } from './pages/GameDetailPage';
import { PlayPage } from './pages/PlayPage';
import { AchievementsPage } from './pages/AchievementsPage';
import { SavesPage } from './pages/SavesPage';import { NotFoundPage } from './pages/NotFoundPage';
import { AppSidebar } from './components/AppSidebar';
import { InviteToasts } from './components/InviteToasts';
import { trackNavigation } from './lib/navStack';

/**
 * 在线心跳:登录后周期性上报(页面可见时),好友列表据此判定在线;
 * 静默失败,不影响任何功能。
 */
function PresenceHeartbeat() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'user') return;
    let stopped = false;
    const beat = () => {
      if (!stopped && document.visibilityState === 'visible') {
        void presenceApi.beat().catch(() => {});
      }
    };
    beat();
    const timer = window.setInterval(beat, 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [status]);

  return null;
}

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
      <PresenceHeartbeat />
      {/* 全站邀请通知:轮询 + 右下角 Toast 队列(登录态;任何页面都可见,不依赖好友抽屉)。 */}
      <InviteHubProvider>
        <InviteToasts />
        <div className="app-shell">
          {showSidebar && <AppSidebar />}
          <div className="app-content">
            <Routes>
              <Route path="/" element={<ExplorePage />} />
              <Route path="/browse" element={<BrowsePage />} />
              <Route path="/games/:slug" element={<GameDetailPage />} />
              <Route path="/play/:slug" element={<PlayPage />} />
              <Route path="/achievements" element={<AchievementsPage />} />
              <Route path="/saves" element={<SavesPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </div>
        </div>
      </InviteHubProvider>
    </AuthProvider>
  );
}
