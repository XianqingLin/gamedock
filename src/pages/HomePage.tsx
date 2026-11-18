import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ALL_CATEGORY, filterGames } from '../lib/browse';
import { CATEGORIES, GAMES } from '../data';
import { SearchBar } from '../components/SearchBar';
import { UserArea } from '../components/UserArea';
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
      <header className="home-header">
        <div className="brand">
          <h1 className="brand-zh">GameDock</h1>
          <p className="brand-en">gamedock.cn</p>
        </div>
        <UserArea />
      </header>

      <div className="home-toolbar">
        <SearchBar
          value={input}
          onChange={(value) => {
            setInput(value);
            updateParams(value, categoryId);
          }}
        />
      </div>

      <CategoryFilter
        categories={CATEGORIES}
        value={categoryId}
        onChange={(id) => updateParams(query, id)}
      />

      <main className="home-main">
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
      </main>
    </div>
  );
}
