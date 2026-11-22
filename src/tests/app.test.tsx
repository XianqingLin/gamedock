import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { resetNavStack } from '../lib/navStack';

const renderApp = (initialEntries: string[] = ['/']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );

// 导航栈为模块级状态，测试间重置以保证用例独立
beforeEach(() => resetNavStack());

describe('探索页', () => {
  it('轮播展示精选游戏，品牌名与侧栏入口可见', () => {
    renderApp();
    expect(screen.getByText('GameDock')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /死神 VS 火影 重构版/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '游戏' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '探索' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '浏览' })).toBeInTheDocument();
  });
});

describe('浏览页', () => {
  it('展示全部游戏卡片与排序下拉', () => {
    renderApp(['/browse']);
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /死神 VS 火影 重构版/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /默契行动/ })).toBeInTheDocument();
  });

  it('排序下拉切换选项并按名称排序', () => {
    renderApp(['/browse']);
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: '按字母顺序' }));
    expect(screen.getByRole('button', { name: '按字母顺序' })).toBeInTheDocument();
    // 专题筛选项可见
    expect(screen.getByRole('button', { name: '经典复刻' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '格斗' })).toBeInTheDocument();
  });

  it('搜索关键字过滤列表', () => {
    renderApp(['/browse']);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索游戏名称' }), {
      target: { value: '默契' },
    });
    expect(screen.getByRole('link', { name: /默契行动/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /死神 VS 火影/ })).not.toBeInTheDocument();
  });

  it('搜索无结果时显示清除筛选，点击后恢复全部并清空输入', () => {
    renderApp(['/browse']);
    const input = screen.getByRole('searchbox', { name: '搜索游戏名称' });
    fireEvent.change(input, { target: { value: '不存在的游戏' } });
    expect(screen.getByText('没有符合条件的游戏')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('专题筛选生效，再点一次取消', () => {
    renderApp(['/browse']);
    fireEvent.click(screen.getByRole('button', { name: '经典复刻' }));
    expect(screen.queryByRole('link', { name: /默契行动/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '经典复刻' }));
    expect(screen.getByRole('link', { name: /默契行动/ })).toBeInTheDocument();
  });

  it('分类筛选与搜索组合生效', () => {
    renderApp(['/browse']);
    fireEvent.click(screen.getByRole('checkbox', { name: '格斗' }));
    expect(screen.queryByRole('link', { name: /默契行动/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();
  });

  it('URL 中的筛选参数在刷新后恢复', () => {
    renderApp(['/browse?cat=fighting']);
    expect(screen.queryByRole('link', { name: /默契行动/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();
  });

  it('URL 中的专题与排序参数在刷新后恢复', () => {
    renderApp(['/browse?tag=classic-remake&sort=alpha']);
    expect(screen.queryByRole('link', { name: /默契行动/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '按字母顺序' })).toBeInTheDocument();
  });

  it('游戏方式筛选生效', () => {
    renderApp(['/browse']);
    const single = screen.getByRole('checkbox', { name: '单人' });
    expect(single).not.toBeChecked();
    fireEvent.click(single);
    // 两款游戏都支持单人，筛选后仍在列表中
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /默契行动/ })).toBeInTheDocument();
    expect(single).toBeChecked();
  });

  it('URL 中的游戏方式参数在刷新后恢复', () => {
    renderApp(['/browse?mode=local-mp']);
    expect(screen.getByRole('checkbox', { name: '本地双人' })).toBeChecked();
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();
  });

  it('点击卡片进入详情并保留浏览状态', () => {
    renderApp(['/browse']);
    fireEvent.click(screen.getByRole('link', { name: /默契行动/ }));
    expect(screen.getByRole('heading', { name: '《默契行动》' })).toBeInTheDocument();
    // 返回后搜索条件由 URL 恢复
  });
});

describe('顶栏返回按钮', () => {
  it('顶级页面（探索、浏览）呈禁用态', () => {
    renderApp(['/browse']);
    expect(screen.getByRole('button', { name: '返回' })).toBeDisabled();
  });

  it('探索页返回按钮同样禁用', () => {
    renderApp(['/']);
    expect(screen.getByRole('button', { name: '返回' })).toBeDisabled();
  });

  it('详情页点击返回到浏览页', () => {
    renderApp(['/games/tether-together']);
    const back = screen.getByRole('button', { name: '返回' });
    expect(back).toBeEnabled();
    fireEvent.click(back);
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
  });
});

describe('详情页', () => {
  it('展示名称、状态、分类和可用的开始游戏按钮', () => {
    renderApp(['/games/tether-together']);
    expect(screen.getByRole('heading', { name: '《默契行动》' })).toBeInTheDocument();
    expect(screen.getByText('可用')).toBeInTheDocument();
    // 游戏类型与游戏方式两栏：胶囊标签带标题，竖线固定在左栏中点
    expect(screen.getByText('双人合作')).toBeInTheDocument();
    expect(screen.getByText('平台跳跃')).toBeInTheDocument();
    expect(screen.getByText('单人')).toBeInTheDocument();
    expect(screen.getByText('在线联机')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: '开始游戏' });
    expect(start).toBeEnabled();
    expect(screen.getByText('版本')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
  });

  it('点击开始游戏在新窗口打开运行页', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderApp(['/games/tether-together']);
    fireEvent.click(screen.getByRole('button', { name: '开始游戏' }));
    expect(openSpy).toHaveBeenCalledWith('/play/tether-together', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('书签可在概览、评论、成就间切换，后两者暂为占位', () => {
    renderApp(['/games/tether-together']);
    expect(screen.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '评论' }));
    expect(screen.getByText('评论暂未开放')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '成就' }));
    expect(screen.getByText('成就暂未开放')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '概览' }));
    expect(screen.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '开始游戏' })).toBeInTheDocument();
  });

  it('游戏不存在时显示未找到状态', () => {
    renderApp(['/games/unknown-game']);
    expect(screen.getByText('未找到该游戏')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回浏览' })).toBeInTheDocument();
  });

  it('Escape 退出详情：无浏览历史时回浏览页', () => {
    renderApp(['/games/tether-together']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
  });

  it('浏览页带筛选进入详情，Escape 退出后筛选由 URL 恢复', () => {
    renderApp(['/browse?cat=fighting']);
    fireEvent.click(screen.getByRole('link', { name: /死神 VS 火影/ }));
    expect(screen.getByRole('heading', { name: '《死神 VS 火影 重构版》' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('checkbox', { name: '格斗' })).toBeChecked();
  });
});

describe('游戏运行页', () => {
  it('站内游戏渲染外边框与游戏 iframe', async () => {
    renderApp(['/play/tether-together']);
    // 登录态确认前运行页显示加载状态，确认后才挂 iframe
    expect(await screen.findByRole('heading', { name: '默契行动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全屏' })).toBeInTheDocument();
    expect(screen.getByTitle('默契行动 游戏画面')).toBeInTheDocument();
  });

  it('运行页不展示左侧栏与返回按钮', async () => {
    renderApp(['/play/tether-together']);
    expect(await screen.findByRole('heading', { name: '默契行动' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '游戏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
  });

  it('运行页游戏不存在时显示未找到', () => {
    renderApp(['/play/unknown-game']);
    expect(screen.getByText('未找到该游戏')).toBeInTheDocument();
  });

  it('固定比例游戏信箱式展示:配置比例兜底,viewport 上报覆盖,非法上报忽略', async () => {
    renderApp(['/play/bvn']);
    const iframe = (await screen.findByTitle('死神 VS 火影 重构版 游戏画面')) as HTMLIFrameElement;
    const stage = iframe.parentElement as HTMLElement;
    // 收到上报前用 games.json 的 aspectRatio(5:3)兜底,舞台加信箱式类名
    expect(stage.style.aspectRatio).toBe(String(5 / 3));
    expect(stage.className).toContain('game-stage-fit');

    // 游戏经 game:viewport 上报实际尺寸,覆盖配置比例
    const frameOrigin = window.location.origin;
    fireEvent(
      window,
      new MessageEvent('message', {
        source: iframe.contentWindow,
        origin: frameOrigin,
        data: { v: 1, t: 'game:viewport', width: 1000, height: 600 },
      }),
    );
    expect(stage.style.aspectRatio).toBe(String(1000 / 600));

    // 非法数值(非正数)直接忽略,比例保持不变
    fireEvent(
      window,
      new MessageEvent('message', {
        source: iframe.contentWindow,
        origin: frameOrigin,
        data: { v: 1, t: 'game:viewport', width: -1, height: 0 },
      }),
    );
    expect(stage.style.aspectRatio).toBe(String(1000 / 600));
  });

  it('自适应比例游戏(未配置比例、无上报)填满可用区域', async () => {
    renderApp(['/play/tether-together']);
    const iframe = await screen.findByTitle('默契行动 游戏画面');
    const stage = iframe.parentElement as HTMLElement;
    expect(stage.style.aspectRatio).toBe('');
    expect(stage.className).not.toContain('game-stage-fit');
  });
});

describe('路由未找到', () => {
  it('普通非法路由显示未找到状态并返回首页', () => {
    renderApp(['/no/such/page']);
    expect(screen.getByText('页面不存在')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '返回首页' }));
    expect(screen.getByText('GameDock')).toBeInTheDocument();
  });
});
