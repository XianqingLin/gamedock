import { useState, useEffect } from 'react';
import type { Game } from '../lib/types';

const DEFAULT_COVER = '/assets/covers/default.svg';

/** 封面加载失败或缺省时回退到本地默认封面，不出现破图或随机外链占位图。 */
export function GameCover({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [game.cover]);

  const src = !failed && game.cover ? game.cover : DEFAULT_COVER;
  return (
    <img
      className="game-cover-img"
      src={src}
      alt={`${game.title} 封面`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
