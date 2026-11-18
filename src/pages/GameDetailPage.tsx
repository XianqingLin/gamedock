import { useCallback, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { findBySlug } from '../lib/browse';
import { STATUS_LABELS } from '../lib/types';
import { CATEGORIES, GAMES } from '../data';
import { GameCover } from '../components/GameCover';
import { StartButton } from '../components/StartButton';
import { EmptyState } from '../components/EmptyState';
import { SiteHeader } from '../components/SiteHeader';

/**
 * 游戏详情页（/games/:slug）：可直接访问、刷新恢复、支持前进/后退。
 * Escape 或“返回浏览”退出详情：有历史时后退，直接打开详情 URL 时回首页；
 * 可选字段（版本/更新时间/简介）没有数据时不渲染。
 */
export function GameDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const game = findBySlug(GAMES, slug);

  const goBack = useCallback(() => {
    const idx = Number((window.history.state as { idx?: number } | null)?.idx ?? 0);
    if (idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') goBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goBack]);

  if (!game) {
    return (
      <div className="page detail-page">
        <SiteHeader />
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

  const playModes = [
    game.capabilities?.singlePlayer ? '单人' : null,
    game.capabilities?.localMultiplayer ? '本地双人' : null,
    game.capabilities?.online
      ? game.capabilities.online.modes.join('、') || '在线联机'
      : null,
  ].filter((mode): mode is string => Boolean(mode));

  return (
    <div className="page detail-page">
      <SiteHeader />
      <main className="detail-main">
        <button type="button" className="back-button" onClick={goBack}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          返回浏览
        </button>

        <div className="detail-layout">
          <section className="detail-info">
            {categoryLabels && <p className="detail-categories">{categoryLabels}</p>}
            <h1>{game.title}</h1>
            {game.description && <p className="detail-description">{game.description}</p>}

            <section className="detail-specifications" aria-labelledby="game-info-title">
              <h2 id="game-info-title">游戏信息</h2>
              <dl className="detail-fields">
                {playModes.length > 0 && (
                  <div>
                    <dt>游戏方式</dt>
                    <dd>{playModes.join(' / ')}</dd>
                  </div>
                )}
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
            </section>
          </section>

          <aside className="detail-aside" aria-label="启动游戏">
            <div className="detail-cover">
              <GameCover game={game} />
            </div>
            <div className="detail-aside-body">
              <p className={`detail-status status-${game.status}`}>
                <span className="status-dot" aria-hidden="true" />
                {STATUS_LABELS[game.status]}
              </p>
              <div className="detail-actions">
                <StartButton game={game} />
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
