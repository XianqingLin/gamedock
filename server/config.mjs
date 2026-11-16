import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

/** xiao-lin-game-shop 项目根目录 */
export const projectRoot = path.resolve(serverDir, '..');

/** 会话签名密钥:优先环境变量,否则自动生成并落盘到数据目录(0600)。 */
function ensureSessionSecret(dataDir) {
  const secretFile = path.join(dataDir, 'session-secret.key');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // 文件不存在则生成。
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

/**
 * 服务端配置。环境变量:PORT / PLATFORM_DIST_DIR / XLP_DATA_DIR / XLP_SESSION_SECRET;
 * 游戏静态资源根目录由 server/games.config.json 声明(slug → 相对项目根的目录)。
 */
export function loadServerConfig() {
  const port = Number(process.env.PORT || 8787);
  const platformDistDir = path.resolve(projectRoot, process.env.PLATFORM_DIST_DIR || 'dist');
  const gamesDataFile = path.resolve(projectRoot, 'src/data/games.json');
  const dataDir = path.resolve(serverDir, process.env.XLP_DATA_DIR || 'data');
  const dbFile = path.join(dataDir, 'db.json');
  const savesDir = path.join(dataDir, 'saves');
  const sessionSecret = process.env.XLP_SESSION_SECRET || ensureSessionSecret(dataDir);

  const gameRoots = {};
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(serverDir, 'games.config.json'), 'utf8'));
    for (const [slug, rel] of Object.entries(raw)) {
      gameRoots[slug] = path.resolve(projectRoot, rel);
    }
  } catch {
    // 没有 games.config.json 时仅提供平台静态服务,不提供游戏静态资源。
  }

  return { port, platformDistDir, gamesDataFile, gameRoots, dataDir, dbFile, savesDir, sessionSecret };
}
