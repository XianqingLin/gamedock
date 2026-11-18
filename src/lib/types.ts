export type GameStatus = 'available' | 'coming-soon' | 'maintenance';

export interface GameOnlineCapability {
  mode: 'platform' | 'self-hosted';
  maxPlayers: number;
  modes: string[];
}

export interface GameCapabilities {
  singlePlayer?: boolean;
  localMultiplayer?: boolean;
  platformSave?: boolean;
  leaderboard?: boolean;
  online?: GameOnlineCapability;
}

export interface Game {
  id: string;
  slug: string;
  title: string;
  cover: string;
  accentColor: string;
  categories: string[];
  /** 专题标签（单值，见 data/topics.json），缺省表示不属于任何专题。 */
  topic?: string;
  /** 发布日期（ISO 日期），驱动“最新推出 / 即将推出”排序；缺省视为已发布但日期未知。 */
  releaseDate?: string;
  description?: string;
  launchUrl?: string;
  status: GameStatus;
  version?: string;
  updatedAt?: string;
  order: number;
  capabilities?: GameCapabilities;
}

export interface Category {
  id: string;
  label: string;
}

export interface Topic {
  id: string;
  label: string;
}

export type LaunchDisabledReason = 'coming-soon' | 'maintenance' | 'no-url' | 'invalid-url';

export type LaunchResolution =
  | { kind: 'internal'; url: string }
  | { kind: 'external'; url: string }
  | { kind: 'disabled'; reason: LaunchDisabledReason };

export const STATUS_LABELS: Record<GameStatus, string> = {
  available: '可用',
  'coming-soon': '未开放',
  maintenance: '维护中',
};

export const DISABLED_LABELS: Record<LaunchDisabledReason, string> = {
  'coming-soon': '未开放',
  maintenance: '维护中',
  'no-url': '暂不可启动',
  'invalid-url': '暂不可启动',
};
