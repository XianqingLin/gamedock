import { Link } from 'react-router-dom';
import type { Category, Game } from '../lib/types';
import { STATUS_LABELS } from '../lib/types';
import { GameCover } from './GameCover';

export function GameCard({ game, categories }: { game: Game; categories: readonly Category[] }) {
  const categoryLabels = game.categories
    .map((id) => categories.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join(' · ');

  return (
    <Link className="game-card" to={`/games/${game.slug}`}>
      <span className="game-cover">
        <GameCover game={game} />
      </span>
      <span className="game-card-body">
        <span className="game-card-title">{game.title}</span>
        {categoryLabels && <span className="game-card-meta">{categoryLabels}</span>}
        {game.status !== 'available' && (
          <span className={`status-badge status-${game.status}`}>{STATUS_LABELS[game.status]}</span>
        )}
      </span>
    </Link>
  );
}
