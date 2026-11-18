import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './state/auth';
import { ExplorePage } from './pages/ExplorePage';
import { BrowsePage } from './pages/BrowsePage';
import { GameDetailPage } from './pages/GameDetailPage';
import { PlayPage } from './pages/PlayPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AppSidebar } from './components/AppSidebar';

export default function App() {
  return (
    <AuthProvider>
      <div className="app-shell">
        <AppSidebar />
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
