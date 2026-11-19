import { beforeEach, describe, expect, it } from 'vitest';
import { backStepsToParent, isBrowsePath, resetNavStack, trackNavigation } from '../lib/navStack';

const track = (path: string, key: string) => trackNavigation(key, path);

describe('navStack 层级式返回', () => {
  beforeEach(() => resetNavStack());

  it('浏览 → 运行页 → 详情：后退步数跳过运行页直达浏览页', () => {
    track('/browse?q=格斗', 'k1');
    track('/play/tether-together', 'k2');
    track('/games/tether-together', 'k3');
    expect(backStepsToParent(isBrowsePath)).toBe(2);
  });

  it('浏览 → 详情：后退一步回浏览页', () => {
    track('/browse?q=格斗', 'k1');
    track('/games/tether-together', 'k2');
    expect(backStepsToParent(isBrowsePath)).toBe(1);
  });

  it('探索 → 详情且历史中无浏览页：无上级可退', () => {
    track('/', 'k1');
    track('/games/x', 'k2');
    expect(backStepsToParent(isBrowsePath)).toBeNull();
  });

  it('后退到已访问位置会截断后续记录', () => {
    track('/browse', 'k1');
    track('/games/x', 'k2');
    track('/games/x', 'k2'); // 后退回到详情位置：复用旧 key、path 不变
    expect(backStepsToParent(isBrowsePath)).toBe(1);
    track('/browse', 'k1'); // 再后退到浏览页：截断详情记录
    expect(backStepsToParent(isBrowsePath)).toBeNull();
  });

  it('replace 导航原地更新当前记录', () => {
    track('/games/x', 'k1');
    track('/games/x?tab=comments', 'k1');
    expect(backStepsToParent(isBrowsePath)).toBeNull();
  });
});
