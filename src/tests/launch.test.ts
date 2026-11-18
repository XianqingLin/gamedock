import { describe, expect, it } from 'vitest';
import { resolveLaunch } from '../lib/launch';
import { DISABLED_LABELS } from '../lib/types';
import type { Game } from '../lib/types';

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

describe('resolveLaunch 启动解析', () => {
  it('可用 + 站内路径 → 站内启动', () => {
    const result = resolveLaunch(makeGame({ launchUrl: '/g/tether/index.html' }));
    expect(result).toEqual({ kind: 'internal', url: '/g/tether/index.html' });
  });

  it('站内路径 + 注入游戏内容域 origin → 拼完整跨源地址(生产形态)', () => {
    const result = resolveLaunch(makeGame({ launchUrl: '/g/bvn/index.html' }), 'https://games.gamedock.cn');
    expect(result).toEqual({ kind: 'internal', url: 'https://games.gamedock.cn/g/bvn/index.html' });
  });

  it('可用 + https 外链 → 新窗口启动', () => {
    const result = resolveLaunch(makeGame({ launchUrl: 'https://game.example.com/play' }));
    expect(result).toEqual({ kind: 'external', url: 'https://game.example.com/play' });
  });

  it('可用 + http 外链 → 新窗口启动', () => {
    const result = resolveLaunch(makeGame({ launchUrl: 'http://game.example.com/play' }));
    expect(result.kind).toBe('external');
  });

  it('可用 + 地址缺失 → 暂不可启动', () => {
    expect(resolveLaunch(makeGame({}))).toEqual({ kind: 'disabled', reason: 'no-url' });
    expect(resolveLaunch(makeGame({ launchUrl: '   ' }))).toEqual({ kind: 'disabled', reason: 'no-url' });
  });

  it('可用 + javascript: 协议 → 无效地址，不执行', () => {
    expect(resolveLaunch(makeGame({ launchUrl: 'javascript:alert(1)' }))).toEqual({
      kind: 'disabled',
      reason: 'invalid-url',
    });
  });

  it('可用 + data: 协议 → 无效地址', () => {
    expect(resolveLaunch(makeGame({ launchUrl: 'data:text/html,<h1>x</h1>' }))).toEqual({
      kind: 'disabled',
      reason: 'invalid-url',
    });
  });

  it('可用 + 协议相对地址 // → 无效地址', () => {
    expect(resolveLaunch(makeGame({ launchUrl: '//evil.example.com' }))).toEqual({
      kind: 'disabled',
      reason: 'invalid-url',
    });
  });

  it('可用 + 非法字符串 → 无效地址', () => {
    expect(resolveLaunch(makeGame({ launchUrl: 'not a url' }))).toEqual({
      kind: 'disabled',
      reason: 'invalid-url',
    });
  });

  it('未开放 → 无论地址如何都禁用', () => {
    expect(resolveLaunch(makeGame({ status: 'coming-soon', launchUrl: '/g/x/index.html' }))).toEqual({
      kind: 'disabled',
      reason: 'coming-soon',
    });
  });

  it('维护中 → 禁用', () => {
    expect(resolveLaunch(makeGame({ status: 'maintenance', launchUrl: '/g/x/index.html' }))).toEqual({
      kind: 'disabled',
      reason: 'maintenance',
    });
  });
});

describe('禁用文案', () => {
  it('四种禁用原因都有对应文案且不为空', () => {
    for (const reason of ['coming-soon', 'maintenance', 'no-url', 'invalid-url'] as const) {
      expect(DISABLED_LABELS[reason].length).toBeGreaterThan(0);
    }
    expect(DISABLED_LABELS['coming-soon']).toBe('未开放');
    expect(DISABLED_LABELS.maintenance).toBe('维护中');
    expect(DISABLED_LABELS['no-url']).toBe('暂不可启动');
    expect(DISABLED_LABELS['invalid-url']).toBe('暂不可启动');
  });
});
