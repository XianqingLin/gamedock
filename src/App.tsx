import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './state/auth';
import { HomePage } from './pages/HomePage';
import { GameDetailPage } from './pages/GameDetailPage';
import { PlayPage } from './pages/PlayPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/games/:slug" element={<GameDetailPage />} />
        <Route path="/play/:slug" element={<PlayPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
