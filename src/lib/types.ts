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
  /** 完整介绍（长文案）；缺省时详情页只渲染简介。 */
  fullDescription?: string;
  /** 媒体评分（0–5，一位小数）；缺省时详情页不渲染评分行。 */
  rating?: number;
  /** 开发者名称；缺省时右侧信息栏不渲染该行。 */
  developer?: string;
  /** 截图/视频地址（.mp4/.webm 渲染为视频），按展示顺序；缺省时媒体区回退为封面图。 */
  screenshots?: string[];
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
