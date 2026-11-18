/**
 * 按 server/games.config.json 把各游戏的构建产物拷贝到 dist/g/<slug>/,
 * 使 Cloudflare Static Assets(assets.directory = dist)能一并托管游戏静态资源。
 * 单个游戏目录缺失时告警跳过,不阻塞其余游戏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(projectRoot, 'server', 'games.config.json');
const distGamesDir = path.join(projectRoot, 'dist', 'g');

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  console.error('[copy-games] 读取 server/games.config.json 失败');
  process.exit(1);
}

fs.mkdirSync(distGamesDir, { recursive: true });

let copied = 0;
for (const [slug, rel] of Object.entries(config)) {
  const source = path.resolve(projectRoot, rel);
  if (!fs.existsSync(source)) {
    console.warn(`[copy-games] 跳过 ${slug}:构建产物不存在(${rel}),先构建该游戏`);
    continue;
  }
  const target = path.join(distGamesDir, slug);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  copied += 1;
  console.log(`[copy-games] ${slug} → dist/g/${slug}`);
}

console.log(`[copy-games] 完成:${copied}/${Object.keys(config).length} 个游戏`);
