import { Link } from 'react-router-dom';
import type { Game } from '../lib/types';
import { GameCover } from './GameCover';

/** 浏览页卡片：只保留封面与游戏名。 */
export function GameCard({ game }: { game: Game }) {
  return (
    <Link className="game-card" to={`/games/${game.slug}`}>
      <span className="game-card-cover">
        <GameCover game={game} />
      </span>
      <span className="game-card-body">
        <span className="game-card-title">{game.title}</span>
      </span>
    </Link>
  );
}
