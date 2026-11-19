import type { Game } from '../lib/types';
import { DISABLED_LABELS } from '../lib/types';
import { resolveLaunch } from '../lib/launch';

/**
 * 启动入口四态（产品需求 4.4）：
 * 可用+有效地址 → 可点击；未开放/维护中/地址缺失或无效 → 对应文案的禁用按钮。
 * 站内游戏在新窗口打开 /play/:slug 运行页，外链在新窗口打开。
 */
export function StartButton({ game }: { game: Game }) {
  const resolution = resolveLaunch(game);

  if (resolution.kind === 'disabled') {
    return (
      <button type="button" className="btn btn-primary" disabled>
        {DISABLED_LABELS[resolution.reason]}
      </button>
    );
  }

  if (resolution.kind === 'external') {
    return (
      <a className="btn btn-primary" href={resolution.url} target="_blank" rel="noopener noreferrer">
        开始游戏（新窗口）
      </a>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => window.open(`/play/${game.slug}`, '_blank', 'noopener,noreferrer')}
    >
      开始游戏
    </button>
  );
}
