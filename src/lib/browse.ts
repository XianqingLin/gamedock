import type { Category, Game } from './types';

export interface BrowseFilter {
  query: string;
  categoryId: string;
}

export const ALL_CATEGORY = 'all';

export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 稳定排序：order 升序，order 相同按 id 字典序，保证陈列顺序不随输入顺序漂移。 */
export function sortGames(games: readonly Game[]): Game[] {
  return [...games].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 搜索与分类的组合筛选：名称包含匹配（忽略首尾空白与大小写）；
 * 分类为单选，未知分类按“全部”处理，避免脏 URL 导致永久空结果。
 */
export function filterGames(
  games: readonly Game[],
  categories: readonly Category[],
  filter: BrowseFilter,
): Game[] {
  const query = normalizeQuery(filter.query);
  const categoryActive =
    filter.categoryId !== ALL_CATEGORY && categories.some((c) => c.id === filter.categoryId);

  return sortGames(games).filter((game) => {
    if (query && !game.title.toLowerCase().includes(query)) return false;
    if (categoryActive && !game.categories.includes(filter.categoryId)) return false;
    return true;
  });
}

export function findBySlug(games: readonly Game[], slug: string | undefined): Game | undefined {
  return slug ? games.find((game) => game.slug === slug) : undefined;
}

/** 筛选排除当前选中游戏时清除选中（3D 场景与列表共享选中状态使用）。 */
export function resolveSelectedAfterFilter(
  selectedId: string | null,
  results: readonly Game[],
): string | null {
  if (!selectedId) return null;
  return results.some((game) => game.id === selectedId) ? selectedId : null;
}
