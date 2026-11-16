import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { findBySlug } from '../lib/browse';
import { STATUS_LABELS } from '../lib/types';
import { CATEGORIES, GAMES } from '../data';
import { GameCover } from '../components/GameCover';
import { StartButton } from '../components/StartButton';
import { EmptyState } from '../components/EmptyState';

/**
 * 游戏详情页（/games/:slug）：可直接访问、刷新恢复、支持前进/后退。
 * Escape 或“返回浏览”退出详情：有历史时后退，直接打开详情 URL 时回首页；
 * 可选字段（版本/更新时间/简介）没有数据时不渲染。
 */
export function GameDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const game = findBySlug(GAMES, slug);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const idx = Number((window.history.state as { idx?: number } | null)?.idx ?? 0);
      if (idx > 0) navigate(-1);
      else navigate('/', { replace: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  if (!game) {
    return (
      <div className="page detail-page">
        <main className="empty-wrap">
          <EmptyState
            title="未找到该游戏"
            detail="游戏标识不存在或已下架。"
            action={
              <Link className="btn btn-secondary" to="/">
                返回浏览
              </Link>
            }
          />
        </main>
      </div>
    );
  }

  const categoryLabels = game.categories
    .map((id) => CATEGORIES.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="page detail-page">
      <header className="page-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          ← 返回浏览
        </button>
      </header>
      <main className="detail-layout">
        <div className="detail-cover">
          <GameCover game={game} />
        </div>
        <section className="detail-info">
          <h1>{game.title}</h1>
          <p className="detail-meta">
            <span className={`status-badge status-${game.status}`}>{STATUS_LABELS[game.status]}</span>
            {categoryLabels && <span>{categoryLabels}</span>}
          </p>
          {game.description && <p className="detail-description">{game.description}</p>}
          <dl className="detail-fields">
            {game.version && (
              <div>
                <dt>版本</dt>
                <dd>{game.version}</dd>
              </div>
            )}
            {game.updatedAt && (
              <div>
                <dt>更新时间</dt>
                <dd>{game.updatedAt}</dd>
              </div>
            )}
          </dl>
          <div className="detail-actions">
            <StartButton game={game} />
          </div>
        </section>
      </main>
    </div>
  );
}
