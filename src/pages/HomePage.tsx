import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ALL_CATEGORY, filterGames } from '../lib/browse';
import { CATEGORIES, GAMES } from '../data';
import { SiteHeader } from '../components/SiteHeader';
import { SearchBar } from '../components/SearchBar';
import { CategoryFilter } from '../components/CategoryFilter';
import { GameCard } from '../components/GameCard';
import { EmptyState } from '../components/EmptyState';

/**
 * 首页（列表模式）：品牌、搜索、分类筛选、游戏网格。
 * 搜索与分类状态写入 URL（?q=&cat=），刷新与前进/后退均可恢复。
 */
export function HomePage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const categoryId = params.get('cat') ?? ALL_CATEGORY;
  const [input, setInput] = useState(query);

  // 浏览器前进/后退时同步输入框内容。
  useEffect(() => {
    setInput(query);
  }, [query]);

  const updateParams = (nextQuery: string, nextCategory: string) => {
    const next = new URLSearchParams();
    if (nextQuery.trim()) next.set('q', nextQuery);
    if (nextCategory !== ALL_CATEGORY) next.set('cat', nextCategory);
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    setInput('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const results = useMemo(
    () => filterGames(GAMES, CATEGORIES, { query, categoryId }),
    [query, categoryId],
  );

  return (
    <div className="page home-page">
      <SiteHeader />

      <main className="home-main">
        <div className="catalog-heading">
          <div className="catalog-title">
            <h1>全部游戏</h1>
            <span className="catalog-count">{results.length} 款游戏</span>
          </div>
          <div className="catalog-search">
            <SearchBar
              value={input}
              onChange={(value) => {
                setInput(value);
                updateParams(value, categoryId);
              }}
            />
          </div>
        </div>

        <CategoryFilter
          categories={CATEGORIES}
          value={categoryId}
          onChange={(id) => updateParams(query, id)}
        />

        <section className="catalog-results" aria-label="游戏目录">
          {GAMES.length === 0 ? (
            <EmptyState title="暂无游戏数据" detail="平台还没有接入任何游戏。" />
          ) : results.length === 0 ? (
            <EmptyState
              title="没有符合条件的游戏"
              detail="试试其他关键词或分类。"
              action={
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                  清除筛选
                </button>
              }
            />
          ) : (
            <ul className="game-grid" aria-label="游戏列表">
              {results.map((game) => (
                <li key={game.id}>
                  <GameCard game={game} categories={CATEGORIES} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <span>gamedock.cn</span>
        <span>网页游戏平台</span>
      </footer>
    </div>
  );
}
