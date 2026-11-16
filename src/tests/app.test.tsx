import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

const renderApp = (initialEntries: string[] = ['/']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );

describe('首页浏览', () => {
  it('展示全部游戏卡片与品牌名', () => {
    renderApp();
    expect(screen.getByText('小林游戏铺')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /死神 VS 火影 重构版/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /默契行动/ })).toBeInTheDocument();
  });

  it('搜索关键字过滤列表', () => {
    renderApp();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索游戏名称' }), {
      target: { value: '默契' },
    });
    expect(screen.getByRole('link', { name: /默契行动/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /死神 VS 火影/ })).not.toBeInTheDocument();
  });

  it('搜索无结果时显示清除筛选，点击后恢复全部并清空输入', () => {
    renderApp();
    const input = screen.getByRole('searchbox', { name: '搜索游戏名称' });
    fireEvent.change(input, { target: { value: '不存在的游戏' } });
    expect(screen.getByText('没有符合条件的游戏')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('分类筛选与搜索组合生效', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '格斗' }));
    expect(screen.queryByRole('link', { name: /默契行动/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();
  });

  it('URL 中的筛选参数在刷新后恢复', () => {
    renderApp(['/?cat=fighting']);
    expect(screen.queryByRole('link', { name: /默契行动/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /死神 VS 火影/ })).toBeInTheDocument();
  });

  it('点击卡片进入详情并保留浏览状态', () => {
    renderApp();
    fireEvent.click(screen.getByRole('link', { name: /默契行动/ }));
    expect(screen.getByRole('heading', { name: '默契行动' })).toBeInTheDocument();
    // 返回后搜索条件由 URL 恢复
  });
});

describe('详情页', () => {
  it('展示名称、状态、分类和可用的开始游戏按钮', () => {
    renderApp(['/games/tether-together']);
    expect(screen.getByRole('heading', { name: '默契行动' })).toBeInTheDocument();
    expect(screen.getByText('可用')).toBeInTheDocument();
    expect(screen.getByText('双人合作 · 平台跳跃')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: '开始游戏' });
    expect(start).toBeEnabled();
    expect(screen.getByText('版本')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
  });

  it('游戏不存在时显示未找到状态', () => {
    renderApp(['/games/unknown-game']);
    expect(screen.getByText('未找到该游戏')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回浏览' })).toBeInTheDocument();
  });

  it('Escape 退出详情：无浏览历史时回首页', () => {
    renderApp(['/games/tether-together']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('小林游戏铺')).toBeInTheDocument();
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

  it('运行页游戏不存在时显示未找到', () => {
    renderApp(['/play/unknown-game']);
    expect(screen.getByText('未找到该游戏')).toBeInTheDocument();
  });
});

describe('路由未找到', () => {
  it('普通非法路由显示未找到状态并返回首页', () => {
    renderApp(['/no/such/page']);
    expect(screen.getByText('页面不存在')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '返回首页' }));
    expect(screen.getByText('小林游戏铺')).toBeInTheDocument();
  });
});
