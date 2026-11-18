import type { Category, Game, Topic } from '../lib/types';
import gamesJson from './games.json';
import categoriesJson from './categories.json';
import topicsJson from './topics.json';

/**
 * 平台唯一游戏数据源：列表、详情、启动（以及将来的 3D 场景）
 * 全部从这里派生，不允许各自维护一份过滤或陈列逻辑。
 */
export const GAMES = gamesJson as Game[];
export const CATEGORIES = categoriesJson as Category[];
export const TOPICS = topicsJson as Topic[];
