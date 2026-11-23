import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { findBySlug } from '../lib/browse';
import { resolveLaunch } from '../lib/launch';
import { DISABLED_LABELS, STATUS_LABELS } from '../lib/types';
import { GAMES } from '../data';
import { friendsApi } from '../lib/api';
import { GameFrame } from '../components/GameFrame';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../state/auth';
import { SocialSidebar } from '../components/SocialSidebar';
import { UserArea } from '../components/UserArea';

/**
 * 游戏运行页（/play/:slug）：平台外边框 + 游戏 iframe。
 * 新窗口打开的独立游戏界面：无左侧栏，顶栏承担标题与账号区；
 * 游戏逻辑全部在 iframe 内。仅站内游戏经由此页；外链游戏在详情页直接新窗口打开。
 *
 * 邀请深链(2026-11-23):好友点「进入」打开 ?invite=<id>,运行页取回该邀请的
 * 游戏自定义参数,经 hello 的 join 字段交给游戏(平台只透传、不解析);
 * 刷新后重取,参数可重复下发(游戏按自身状态决定是否再次入房)。
 */
export function PlayPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const game = findBySlug(GAMES, slug);
  const { status, user } = useAuth();
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  // 游戏经 SDK 上报的当前可邀请加入参数(game:invite-context);null = 未上报/已离开。
  const [inviteContext, setInviteContext] = useState<Record<string, unknown> | null>(null);
  const inviteId = searchParams.get('invite');
  const [joinParams, setJoinParams] = useState<Record<string, unknown> | null | undefined>(undefined);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // 邀请深链:登录态就绪后取邀请(仅接收方可见),拿回参数随 hello 下发。
  useEffect(() => {
    if (!inviteId || status !== 'user') {
      setJoinParams(null);
      return;
    }
    let cancelled = false;
    friendsApi
      .getInvite(inviteId)
      .then((data) => {
        if (!cancelled) setJoinParams(data.invite.params);
      })
      .catch(() => {
        if (!cancelled) setJoinParams(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteId, status]);

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
    <div className="page play-page">
      <header className="play-header">
        <h1 className="play-title">{game.title}</h1>
        <div className="play-account-actions">
          <UserArea onOpenFriends={() => setSocialOpen(true)} />
        </div>        <button
          type="button"
          className="btn btn-icon play-fullscreen-toggle"
          aria-label={isFullscreen ? '退出全屏' : '全屏'}
          title={isFullscreen ? '退出全屏' : '全屏'}
          onClick={toggleFullscreen}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {isFullscreen ? (
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      </header>
      <main className="play-main" ref={stageRef}>
        <GameFrame
          game={game}
          src={resolution.url}
          user={status === 'user' && user ? { id: user.id, username: user.username } : null}
          join={joinParams ?? null}
          onInviteContext={setInviteContext}
        />
        {socialOpen && (
          <SocialSidebar
            onClose={() => setSocialOpen(false)}
            currentGame={{ slug: game.slug, title: game.title, params: inviteContext }}
          />
        )}
        <button
          type="button"
          className="btn btn-icon play-fullscreen-exit"
          aria-label="退出全屏"
          title="退出全屏"
          onClick={toggleFullscreen}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </main>
    </div>
  );
}
