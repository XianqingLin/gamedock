import { describe, expect, it } from 'vitest';
import {
  NO_TOPIC,
  filterGames,
  findBySlug,
  resolveSelectedAfterFilter,
  sortGames,
} from '../lib/browse';
import type { Game } from '../lib/types';
import { CATEGORIES, TOPICS } from '../data';

const makeGame = (overrides: Partial<Game>): Game => ({
  id: 'g',
  slug: 'g',
  title: '游戏',
  cover: '/assets/covers/default.svg',
  accentColor: '#e8a54e',
  categories: [],
  status: 'available',
  order: 1,
  ...overrides,
});

const games: Game[] = [
  makeGame({ id: 'bvn', slug: 'bvn', title: '死神 VS 火影 重构版', categories: ['fighting', 'action'], topic: 'classic-remake', releaseDate: '2025-06-18', order: 1 }),
  makeGame({ id: 'tether', slug: 'tether', title: '默契行动', categories: ['co-op', 'platformer'], releaseDate: '2025-10-09', order: 2 }),
  makeGame({ id: 'aaa', slug: 'aaa', title: '默契行动 外传', categories: ['co-op'], order: 2 }),
];

const noFilter = {
  query: '',
  categoryIds: [],
  topicId: NO_TOPIC,
  sort: 'default' as const,
};

describe('sortGames 稳定排序', () => {
  it('按 order 升序排列，order 相同时按 id 排序', () => {
    const sorted = sortGames(games);
    expect(sorted.map((g) => g.id)).toEqual(['bvn', 'aaa', 'tether']);
  });

  it('不修改原数组', () => {
    sortGames(games);
    expect(games.map((g) => g.id)).toEqual(['bvn', 'tether', 'aaa']);
  });
});

describe('filterGames 搜索、分类与专题组合筛选', () => {
  it('名称包含匹配，忽略大小写与首尾空白', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, { ...noFilter, query: '  默契 ' });
    expect(results.map((g) => g.id).sort()).toEqual(['aaa', 'tether']);
  });

  it('分类筛选只保留属于该分类的游戏', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, { ...noFilter, categoryIds: ['fighting'] });
    expect(results.map((g) => g.id)).toEqual(['bvn']);
  });

  it('分类多选时命中任一分类即保留', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, {
      ...noFilter,
      categoryIds: ['fighting', 'platformer'],
    });
    expect(results.map((g) => g.id)).toEqual(['bvn', 'tether']);
  });

  it('搜索、分类与专题同时生效（结果须同时满足所有条件）', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, {
      ...noFilter,
      query: '默契',
      categoryIds: ['co-op'],
    });
    expect(results.map((g) => g.id).sort()).toEqual(['aaa', 'tether']);
  });

  it('搜索与分类组合后无结果', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, {
      ...noFilter,
      query: '默契',
      categoryIds: ['fighting'],
    });
    expect(results).toEqual([]);
  });

  it('未知分类按“全部”处理', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, { ...noFilter, categoryIds: ['not-exist'] });
    expect(results).toHaveLength(3);
  });

  it('专题筛选只保留属于该专题的游戏', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, {
      ...noFilter,
      topicId: 'classic-remake',
    });
    expect(results.map((g) => g.id)).toEqual(['bvn']);
  });

  it('未知专题按全不选处理', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, { ...noFilter, topicId: 'not-exist' });
    expect(results).toHaveLength(3);
  });
});

describe('filterGames 排序', () => {
  it('默认排序按数据顺序（order 升序）', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, noFilter);
    expect(results.map((g) => g.id)).toEqual(['bvn', 'aaa', 'tether']);
  });

  it('按字母顺序按中文标题排序', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, { ...noFilter, sort: 'alpha' });
    expect(results.map((g) => g.id)).toEqual(['tether', 'aaa', 'bvn']);
  });

  it('最新推出按发布日期新→旧', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, { ...noFilter, sort: 'newest' });
    expect(results.map((g) => g.id)).toEqual(['tether', 'bvn', 'aaa']);
  });

  it('即将推出把未来发布的排前面（越接近推出越靠前）', () => {
    const futureA = makeGame({
      id: 'future-a',
      slug: 'future-a',
      title: '未来 A',
      releaseDate: '2999-01-01',
      order: 3,
    });
    const futureB = makeGame({
      id: 'future-b',
      slug: 'future-b',
      title: '未来 B',
      releaseDate: '2999-06-01',
      order: 4,
    });
    const results = filterGames([futureB, futureA, ...games], CATEGORIES, TOPICS, {
      ...noFilter,
      sort: 'upcoming',
    });
    expect(results.map((g) => g.id)).toEqual(['future-a', 'future-b', 'tether', 'bvn', 'aaa']);
  });
});

describe('findBySlug', () => {
  it('按 slug 找到游戏', () => {
    expect(findBySlug(games, 'bvn')?.id).toBe('bvn');
  });

  it('slug 不存在时返回 undefined（含空 slug）', () => {
    expect(findBySlug(games, 'nope')).toBeUndefined();
    expect(findBySlug(games, undefined)).toBeUndefined();
  });
});

describe('resolveSelectedAfterFilter', () => {
  it('选中游戏仍在结果中时保留', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, noFilter);
    expect(resolveSelectedAfterFilter('tether', results)).toBe('tether');
  });

  it('选中游戏被筛选排除时清除选中', () => {
    const results = filterGames(games, CATEGORIES, TOPICS, { ...noFilter, categoryIds: ['fighting'] });
    expect(resolveSelectedAfterFilter('tether', results)).toBeNull();
  });

  it('无选中时保持 null', () => {
    expect(resolveSelectedAfterFilter(null, games)).toBeNull();
  });
});
