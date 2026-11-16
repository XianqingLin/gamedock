import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { findBySlug } from '../lib/browse';
import { resolveLaunch } from '../lib/launch';
import { DISABLED_LABELS, STATUS_LABELS } from '../lib/types';
import { GAMES } from '../data';
import { UserArea } from '../components/UserArea';
import { GameFrame } from '../components/GameFrame';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../state/auth';

/**
 * 游戏运行页（/play/:slug）：平台外边框 + 游戏 iframe。
 * 外边框承担返回、标题与全屏；游戏逻辑全部在 iframe 内。
 * 仅站内游戏经由此页；外链游戏在详情页直接新窗口打开。
 */
export function PlayPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const game = findBySlug(GAMES, slug);
  const { status, user } = useAuth();
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen();
    }
  };

  if (!game) {
    return (
      <div className="page play-page">
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

  const resolution = resolveLaunch(game);

  if (resolution.kind === 'disabled') {
    const detail =
      resolution.reason === 'coming-soon' || resolution.reason === 'maintenance'
        ? `该游戏当前状态：${STATUS_LABELS[game.status]}。`
        : `该游戏（${DISABLED_LABELS[resolution.reason]}）的启动地址缺失或无效。`;
    return (
      <div className="page play-page">
        <main className="empty-wrap">
          <EmptyState
            title="当前无法启动"
            detail={detail}
            action={
              <Link className="btn btn-secondary" to={`/games/${game.slug}`}>
                返回详情
              </Link>
            }
          />
        </main>
      </div>
    );
  }

  if (resolution.kind === 'external') {
    return (
      <div className="page play-page">
        <main className="empty-wrap">
          <EmptyState
            title="该游戏在新窗口运行"
            detail="此游戏运行在外部站点，不在平台页面内嵌。"
            action={
              <a className="btn btn-primary" href={resolution.url} target="_blank" rel="noopener noreferrer">
                打开游戏
              </a>
            }
          />
        </main>
      </div>
    );
  }

  // 登录态确认前不挂 iframe:hello 握手会携带 user,auth 未就绪时下发 null
  // 会被游戏侧 SDK 定格（游戏只认首个 hello,后续补发不更新）。
  if (status === 'loading') {
    return (
      <div className="page play-page">
        <main className="empty-wrap">
          <EmptyState title="正在加载…" detail="正在确认登录状态。" />
        </main>
      </div>
    );
  }

  return (
    <div className="page play-page" ref={stageRef}>
      <header className="play-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(`/games/${game.slug}`)}>
          ← 返回
        </button>
        <h1 className="play-title">{game.title}</h1>
        <UserArea />
        <button type="button" className="btn btn-secondary" onClick={toggleFullscreen}>
          {isFullscreen ? '退出全屏' : '全屏'}
        </button>
      </header>
      <GameFrame
        game={game}
        src={resolution.url}
        user={status === 'user' && user ? { id: user.id, username: user.username } : null}
      />
    </div>
  );
}
