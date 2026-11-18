import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GAMES } from '../data';
import { sortGames } from '../lib/browse';
import { GameCover } from '../components/GameCover';
import { SiteHeader } from '../components/SiteHeader';

const MAX_HERO_SLIDES = 5;
const HERO_INTERVAL_MS = 6000;

/**
 * 探索页（首页）：精选游戏大图轮播。
 * 大图下方横排进度条式指示器，当前项填充高亮，点击切换；
 * 自动轮播尊重 prefers-reduced-motion，悬停或焦点进入时暂停。
 */
export function ExplorePage() {
  const slides = useMemo(() => sortGames(GAMES).slice(0, MAX_HERO_SLIDES), []);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % slides.length),
      HERO_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  const active = slides[index];

  return (
    <div className="page explore-page">
      <SiteHeader />
      <main className="explore-main">
        <section
          className={paused ? 'hero is-paused' : 'hero'}
          aria-roledescription="轮播"
          aria-label="精选游戏"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div className="hero-stage">
            {slides.map((game, i) => (
              <article
                key={game.id}
                className={i === index ? 'hero-slide is-active' : 'hero-slide'}
                aria-hidden={i !== index}
              >
                <GameCover game={game} />
                <div className="hero-shade" aria-hidden="true" />
                <div className="hero-body">
                  <span className="hero-accent" style={{ background: game.accentColor }} aria-hidden="true" />
                  <h1 className="hero-title">{game.title}</h1>
                  {game.description && <p className="hero-description">{game.description}</p>}
                  <Link
                    className="btn btn-primary hero-cta"
                    to={`/games/${game.slug}`}
                    aria-label={`查看${game.title}详情`}
                    tabIndex={i === index ? 0 : -1}
                  >
                    查看详情
                  </Link>
                </div>
              </article>
            ))}
          </div>
          {slides.length > 1 && (
            <div className="hero-indicators" role="group" aria-label="选择轮播内容">
              {slides.map((game, i) => (
                <button
                  key={game.id}
                  type="button"
                  className="hero-indicator"
                  aria-label={`查看${game.title}`}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => setIndex(i)}
                >
                  {i === index && <span className="hero-indicator-fill" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
          {active && <p className="visually-hidden">{`正在展示：${active.title}`}</p>}
        </section>
      </main>
    </div>
  );
}
