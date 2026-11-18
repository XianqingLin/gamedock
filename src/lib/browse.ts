import type { Category, Game, Topic } from './types';

export interface BrowseFilter {
  query: string;
  /** 选中的游戏类型（可多选，空集即“全部”）。 */
  categoryIds: string[];
  /** 专题单选：'' 表示未选（全不选），未知专题按未选处理。 */
  topicId: string;
  /** 排序方式，未知值按默认（数据顺序）处理。 */
  sort: SortId;
}

export const NO_TOPIC = '';

export type SortId = 'default' | 'newest' | 'upcoming' | 'alpha';

export const SORT_IDS: SortId[] = ['default', 'newest', 'upcoming', 'alpha'];

export const SORT_LABELS: Record<SortId, string> = {
  default: '全部',
  newest: '最新推出',
  upcoming: '即将推出',
  alpha: '按字母顺序',
};

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

/** 以本地日期比较发布状态：releaseDate 在今天或之前视为已推出。 */
function isReleased(game: Game, today: string): boolean {
  return !game.releaseDate || game.releaseDate <= today;
}

function byReleaseDesc(a: Game, b: Game): number {
  const da = a.releaseDate ?? '';
  const db = b.releaseDate ?? '';
  if (da !== db) return da < db ? 1 : -1;
  return a.order - b.order;
}

function byReleaseAsc(a: Game, b: Game): number {
  const da = a.releaseDate ?? '';
  const db = b.releaseDate ?? '';
  if (da !== db) return da < db ? -1 : 1;
  return a.order - b.order;
}

/** 排序方式应用在稳定排序之上；各方式内部仍保持稳定的次级顺序。 */
function applySort(games: readonly Game[], sort: SortId): Game[] {
  const base = sortGames(games);
  if (sort === 'alpha') {
    return [...base].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN') || a.order - b.order);
  }
  if (sort === 'default') return base;

  const today = new Date().toISOString().slice(0, 10);
  const released = base.filter((game) => isReleased(game, today));
  const upcoming = base.filter((game) => !isReleased(game, today));
  if (sort === 'newest') {
    return [...released].sort(byReleaseDesc).concat([...upcoming].sort(byReleaseDesc));
  }
  // upcoming：未推出的在前（越接近推出越靠前），已推出的按日期新→旧跟随。
  return [...upcoming].sort(byReleaseAsc).concat([...released].sort(byReleaseDesc));
}

/**
 * 搜索、分类与专题的组合筛选：名称包含匹配（忽略首尾空白与大小写）；
 * 分类为多选（空集即“全部”）；专题为单选（'' 即全不选）；
 * 未知分类/专题按未选处理，避免脏 URL 导致永久空结果。
 */
export function filterGames(
  games: readonly Game[],
  categories: readonly Category[],
  topics: readonly Topic[],
  filter: BrowseFilter,
): Game[] {
  const query = normalizeQuery(filter.query);
  const knownCategoryIds = filter.categoryIds.filter((id) => categories.some((c) => c.id === id));
  const categoryActive = knownCategoryIds.length > 0;
  const topicActive = filter.topicId !== NO_TOPIC && topics.some((t) => t.id === filter.topicId);
  const sort = SORT_IDS.includes(filter.sort) ? filter.sort : 'default';

  const matched = sortGames(games).filter((game) => {
    if (query && !game.title.toLowerCase().includes(query)) return false;
    if (categoryActive && !knownCategoryIds.some((id) => game.categories.includes(id))) return false;
    if (topicActive && game.topic !== filter.topicId) return false;
    return true;
  });
  return applySort(matched, sort);
}

export function findBySlug(games: readonly Game[], slug: string | undefined): Game | undefined {
  return slug ? games.find((game) => game.slug === slug) : undefined;
}

/** 筛选排除当前选中游戏时清除选中。 */
export function resolveSelectedAfterFilter(
  selectedId: string | null,
  results: readonly Game[],
): string | null {
  if (!selectedId) return null;
  return results.some((game) => game.id === selectedId) ? selectedId : null;
}
