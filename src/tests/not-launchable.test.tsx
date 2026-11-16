import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

// 不可启动样例游戏（夹具，定义在 mock 工厂内避免提升问题）：详情页/运行页的
// "暂不可启动"分支不依赖真实 games.json 的可用性（bvn/tether 均已可启动）。
vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  const fixture = {
    id: 'fixture-offline',
    slug: 'fixture-offline',
    title: '夹具·未接入',
    cover: '/assets/covers/default.svg',
    accentColor: '#888888',
    categories: [],
    description: '测试夹具：available 但缺少启动地址。',
    status: 'available' as const,
    order: 99,
    capabilities: { singlePlayer: true },
  };
  return { ...actual, GAMES: [...actual.GAMES, fixture] };
});

const renderApp = (initialEntries: string[]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );

describe('不可启动游戏', () => {
  it('可用但启动地址缺失时详情页显示"暂不可启动"且禁用', () => {
    renderApp(['/games/fixture-offline']);
    const start = screen.getByRole('button', { name: '暂不可启动' });
    expect(start).toBeDisabled();
  });

  it('不可启动游戏进入运行页时显示状态说明', () => {
    renderApp(['/play/fixture-offline']);
    expect(screen.getByText('当前无法启动')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回详情' })).toBeInTheDocument();
  });
});
