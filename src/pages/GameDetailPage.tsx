import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { findBySlug, gamePlayModes, PLAY_MODE_LABELS } from '../lib/browse';
import { STATUS_LABELS } from '../lib/types';
import { CATEGORIES, GAMES } from '../data';
import type { Game } from '../lib/types';
import { GameCover } from '../components/GameCover';
import { StartButton } from '../components/StartButton';
import { EmptyState } from '../components/EmptyState';
import { SiteHeader } from '../components/SiteHeader';
import { useBackToParent } from '../lib/navStack';

const DEFAULT_COVER = '/assets/covers/default.svg';

const DETAIL_TABS = [
  { id: 'overview', label: '概览' },
  { id: 'reviews', label: '评论' },
  { id: 'achievements', label: '成就' },
] as const;

type DetailTabId = (typeof DETAIL_TABS)[number]['id'];

const isVideoSrc = (src: string) => /\.(mp4|webm)$/i.test(src);

/** ISO 日期（YYYY-MM-DD）转「YYYY 年 M 月 D 日」，无法解析时原样返回。 */
function formatReleaseDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${y} 年 ${m} 月 ${d} 日`;
}

/** 星级评分：五颗星按比例填充，附数值。 */
function Stars({ rating }: { rating: number }) {
  const clamped = Math.max(0, Math.min(5, rating));
  return (
    <p className="detail-rating" aria-label={`评分 ${clamped.toFixed(1)}（满分 5）`}>
      <span className="rating-stars" aria-hidden="true">
        <span className="rating-stars-track">★★★★★</span>
        <span className="rating-stars-fill" style={{ width: `${(clamped / 5) * 100}%` }}>
          ★★★★★
        </span>
      </span>
      <span className="rating-value">{clamped.toFixed(1)}</span>
    </p>
  );
}

/**
 * 概览顶部的媒体轮播：截图/视频逐张展示，下方缩略图切换，两侧箭头循环切换。
 * 没有配置 screenshots 时回退为单张封面图（无缩略图与箭头）。
 */
function MediaCarousel({ game }: { game: Game }) {
  const media = game.screenshots?.length ? game.screenshots : [game.cover || DEFAULT_COVER];
  const [index, setIndex] = useState(0);
  const current = media[Math.min(index, media.length - 1)];
  const single = media.length === 1;

  return (
    <div className="detail-media">
      <div className="detail-media-stage">
        {isVideoSrc(current) ? (
          <video key={current} src={current} controls autoPlay muted loop playsInline />
        ) : (
          <img src={current} alt={`${game.title} 截图`} />
        )}
        {!single && (
          <>
            <button
              type="button"
              className="detail-media-arrow prev"
              aria-label="上一张"
              onClick={() => setIndex((index - 1 + media.length) % media.length)}
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
            <button
              type="button"
              className="detail-media-arrow next"
              aria-label="下一张"
              onClick={() => setIndex((index + 1) % media.length)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m9.5 5.5 6.5 6.5-6.5 6.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
      </div>
      {!single && (
        <div className="detail-media-thumbs">
          {media.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              className={`detail-media-thumb${i === index ? ' is-active' : ''}`}
              aria-label={`查看第 ${i + 1} 张`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
            >
              {isVideoSrc(src) ? (
                <video src={src} muted preload="metadata" />
              ) : (
                <img src={src} alt="" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 游戏详情页（/games/:slug）：可直接访问、刷新恢复、支持前进/后退。
 * 页内不设返回按钮，退出详情走顶栏返回按钮或 Escape：后退至历史中最近的
 * 浏览页位置（跳过运行页等非上级页面），历史中没有浏览页时直达浏览页；
 * 可选字段（评分/简介/完整介绍/开发者等）
 * 没有数据时不渲染。
 *
 * 布局：标题 + 评分 + 书签（概览/评论/成就）为通栏头部，书签向下滚动时
 * 吸顶固定在顶栏之下；书签下方分左右两栏——左栏为概览内容（媒体轮播、
 * 简介、游戏类型与游戏方式一行竖线分隔、完整介绍），右栏为封面、启动
 * 操作与信息列表。
 * 评论与成就页签暂为占位空状态。
 */
export function GameDetailPage() {
  const { slug } = useParams();
  const goBack = useBackToParent();
  const game = findBySlug(GAMES, slug);
  const [tab, setTab] = useState<DetailTabId>('overview');

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
    .filter((label): label is string => Boolean(label));

  // 游戏方式与浏览页筛选共用同一套标签（gamePlayModes / PLAY_MODE_LABELS）。
  const playModes = gamePlayModes(game).map((mode) => PLAY_MODE_LABELS[mode]);

  return (
    <div className="page detail-page">
      <SiteHeader />
      <main className="detail-main">
        <header className="detail-head">
          <h1 className="detail-title">《{game.title}》</h1>
          {typeof game.rating === 'number' && <Stars rating={game.rating} />}
        </header>
        {/* 书签是 detail-main 的直接子元素：sticky 只在父元素范围内移动，
            放在标题块里会随标题一起滚出视口。 */}
        <nav className="detail-tabs" aria-label="游戏详情">
          {DETAIL_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`detail-tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <div className="detail-layout">
            <section className="detail-info">
              <MediaCarousel game={game} />
              {game.description && <p className="detail-blurb">{game.description}</p>}
              {(categoryLabels.length > 0 || playModes.length > 0) && (
                <div className="detail-tagline">
                  <div className="detail-tagline-group">
                    {categoryLabels.length > 0 && (
                      <>
                        <h3>游戏类型</h3>
                        <ul className="detail-tagline-pills">
                          {categoryLabels.map((label) => (
                            <li key={label}>{label}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                  <span className="detail-tagline-divider" aria-hidden="true" />
                  <div className="detail-tagline-group">
                    {playModes.length > 0 && (
                      <>
                        <h3>游戏方式</h3>
                        <ul className="detail-tagline-pills">
                          {playModes.map((mode) => (
                            <li key={mode}>{mode}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              )}
              {game.fullDescription && <p className="detail-blurb">{game.fullDescription}</p>}
            </section>

            <aside className="detail-aside" aria-label="游戏信息">
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
                <dl className="detail-meta">
                  {game.developer && (
                    <div>
                      <dt>开发者</dt>
                      <dd>{game.developer}</dd>
                    </div>
                  )}
                  {game.releaseDate && (
                    <div>
                      <dt>发行日期</dt>
                      <dd>{formatReleaseDate(game.releaseDate)}</dd>
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
              </div>
            </aside>
          </div>
        )}

        {tab === 'reviews' && (
          <div className="detail-tab-panel">
            <EmptyState title="评论暂未开放" detail="游戏评论功能还在准备中。" />
          </div>
        )}
        {tab === 'achievements' && (
          <div className="detail-tab-panel">
            <EmptyState title="成就暂未开放" detail="游戏成就功能还在准备中。" />
          </div>
        )}
      </main>
    </div>
  );
}
