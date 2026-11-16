import { useNavigate } from 'react-router-dom';
import type { Game } from '../lib/types';
import { DISABLED_LABELS } from '../lib/types';
import { resolveLaunch } from '../lib/launch';

/**
 * 启动入口四态（产品需求 4.4）：
 * 可用+有效地址 → 可点击；未开放/维护中/地址缺失或无效 → 对应文案的禁用按钮。
 * 站内游戏经 /play/:slug 站内路由进入，外链在新窗口打开。
 */
export function StartButton({ game }: { game: Game }) {
  const navigate = useNavigate();
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
    <button type="button" className="btn btn-primary" onClick={() => navigate(`/play/${game.slug}`)}>
      开始游戏
    </button>
  );
}
