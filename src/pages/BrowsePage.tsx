import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NO_TOPIC, SORT_IDS, filterGames, type SortId } from '../lib/browse';
import { CATEGORIES, GAMES, TOPICS } from '../data';
import { SiteHeader } from '../components/SiteHeader';
import { SortSelect } from '../components/SortSelect';
import { BrowseSidebar } from '../components/BrowseSidebar';
import { GameCard } from '../components/GameCard';
import { EmptyState } from '../components/EmptyState';

/**
 * 浏览页（游戏目录）：排序下拉 + 封面网格 + 右侧筛选栏（专题单选、游戏类型与
 * 游戏方式多选）。搜索、排序与筛选状态全部写入 URL（?q=&cat=&tag=&mode=&sort=），
 * 刷新与前进/后退均可恢复。
 */
export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const selectedCategories = params.getAll('cat');
  const selectedModes = params.getAll('mode');
  const topicId = params.get('tag') ?? NO_TOPIC;
  const sortParam = params.get('sort');
  const sort: SortId = sortParam && SORT_IDS.includes(sortParam as SortId) ? (sortParam as SortId) : 'default';

  const updateParams = (update: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    update(next);
    setParams(next, { replace: true });
  };

  const setSort = (id: SortId) =>
    updateParams((next) => {
      if (id === 'default') next.delete('sort');
      else next.set('sort', id);
    });

  const toggleRepeatedParam = (key: string, current: readonly string[], id: string) =>
    updateParams((next) => {
      if (next.getAll(key).includes(id)) {
        next.delete(key);
        for (const value of current) {
          if (value !== id) next.append(key, value);
        }
      } else {
        next.append(key, id);
      }
    });

  const toggleCategory = (id: string) => toggleRepeatedParam('cat', selectedCategories, id);

  const toggleMode = (id: string) => toggleRepeatedParam('mode', selectedModes, id);

  const setTopic = (id: string) =>
    updateParams((next) => {
      if (id === topicId) next.delete('tag');
      else next.set('tag', id);
    });

  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  const results = useMemo(
    () =>
      filterGames(GAMES, CATEGORIES, TOPICS, {
        query,
        categoryIds: selectedCategories,
        topicId,
        modeIds: selectedModes,
        sort,
      }),
    [query, selectedCategories, topicId, selectedModes, sort],
  );

  return (
    <div className="page browse-page">
      <SiteHeader />
      <main className="browse-main">
        <div className="browse-toolbar">
          <span className="browse-toolbar-label">显示：</span>
          <SortSelect value={sort} onChange={setSort} />
        </div>

        <div className="browse-layout">
          <section className="browse-results" aria-label="游戏目录">
            {GAMES.length === 0 ? (
              <EmptyState title="暂无游戏数据" detail="平台还没有接入任何游戏。" />
            ) : results.length === 0 ? (
              <EmptyState
                title="没有符合条件的游戏"
                detail="试试其他关键词或筛选条件。"
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
                    <GameCard game={game} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <BrowseSidebar
            topics={TOPICS}
            categories={CATEGORIES}
            topicId={topicId}
            selectedCategories={selectedCategories}
            selectedModes={selectedModes}
            onTopicChange={setTopic}
            onToggleCategory={toggleCategory}
            onToggleMode={toggleMode}
          />
        </div>
      </main>
    </div>
  );
}
