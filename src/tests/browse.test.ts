import { describe, expect, it } from 'vitest';
import { ALL_CATEGORY, filterGames, findBySlug, resolveSelectedAfterFilter, sortGames } from '../lib/browse';
import type { Game } from '../lib/types';
import { CATEGORIES } from '../data';

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
  makeGame({ id: 'bvn', slug: 'bvn', title: '死神 VS 火影 重构版', categories: ['fighting', 'action'], order: 1 }),
  makeGame({ id: 'tether', slug: 'tether', title: '默契行动', categories: ['co-op', 'platformer'], order: 2 }),
  makeGame({ id: 'aaa', slug: 'aaa', title: '默契行动 外传', categories: ['co-op'], order: 2 }),
];

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

describe('filterGames 搜索与分类组合筛选', () => {
  it('名称包含匹配，忽略大小写与首尾空白', () => {
    const results = filterGames(games, CATEGORIES, { query: '  默契 ', categoryId: ALL_CATEGORY });
    expect(results.map((g) => g.id).sort()).toEqual(['aaa', 'tether']);
  });

  it('分类筛选只保留属于该分类的游戏', () => {
    const results = filterGames(games, CATEGORIES, { query: '', categoryId: 'fighting' });
    expect(results.map((g) => g.id)).toEqual(['bvn']);
  });

  it('搜索与分类同时生效（结果须同时满足两个条件）', () => {
    const results = filterGames(games, CATEGORIES, { query: '默契', categoryId: 'co-op' });
    expect(results.map((g) => g.id).sort()).toEqual(['aaa', 'tether']);
  });

  it('搜索与分类组合后无结果', () => {
    const results = filterGames(games, CATEGORIES, { query: '默契', categoryId: 'fighting' });
    expect(results).toEqual([]);
  });

  it('未知分类按“全部”处理', () => {
    const results = filterGames(games, CATEGORIES, { query: '', categoryId: 'not-exist' });
    expect(results).toHaveLength(3);
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
    const results = filterGames(games, CATEGORIES, { query: '', categoryId: ALL_CATEGORY });
    expect(resolveSelectedAfterFilter('tether', results)).toBe('tether');
  });

  it('选中游戏被筛选排除时清除选中', () => {
    const results = filterGames(games, CATEGORIES, { query: '', categoryId: 'fighting' });
    expect(resolveSelectedAfterFilter('tether', results)).toBeNull();
  });

  it('无选中时保持 null', () => {
    expect(resolveSelectedAfterFilter(null, games)).toBeNull();
  });
});
