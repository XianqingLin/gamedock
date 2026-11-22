/**
 * 把 games.config.json 声明的游戏构建产物上传到 R2 bucket(gamedock-games)。
 * key 规则与 worker(server/game-assets.mjs)一致:`g/<slug>/<相对路径>`。
 *
 * 用法:
 *   node scripts/sync-games.mjs           # 上传到线上 R2(需 wrangler 登录)
 *   node scripts/sync-games.mjs --local   # 写入本地 wrangler dev 的 R2 模拟(.wrangler/state)
 *
 * 上传通道(都是单进程内并发,不逐文件起 CLI 进程):
 *   --local 经 getPlatformProxy 直连本地模拟的 R2 绑定(读 wrangler.jsonc);
 *   远程模式直连 R2 HTTP API,token 取 CLOUDFLARE_API_TOKEN 或 wrangler 登录态。
 *
 * 发布一致性:R2 没有原子目录替换,多文件更新存在短暂不一致窗口。
 * 游戏入口是 index.html,脚本把全部普通文件传完后再写各游戏的 index.html,
 * 更新期间旧 index.html 引用的旧资源始终可用,不一致窗口压到几乎为零。
 * 旧文件不删除(R2 无 list 级 CLI),多传的对象只占空间不碍事;
 * 将来投稿/审核流 API 化时再引入精确清理。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferContentType } from '../server/mime.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(projectRoot, 'server', 'games.config.json');
const BUCKET = 'gamedock-games';
const CONCURRENCY = 8;
// 直连 API 太快会撞 Cloudflare 的速率限制(429)：全局节流 ~10 req/s，配合 429 退避重试。
const REQUEST_INTERVAL_MS = 100;
const MAX_ATTEMPTS = 5;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? '603d5e2ca6482dd2a6472c1db04484db';

const local = process.argv.slice(2).includes('--local');

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  console.error('[sync-games] 读取 server/games.config.json 失败');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 全局节流：所有并发 worker 共用一个发牌时钟，保证请求间隔不低于 REQUEST_INTERVAL_MS。 */
let nextSlot = 0;
async function waitSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + REQUEST_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
}

/**
 * 上传器:put(key, file, contentType) 抛错即失败。
 * 本地模式经 getPlatformProxy 直连模拟 R2,远程模式直连 R2 HTTP API,均单进程并发。
 * 两种通道都可能偶发竞争(与 wrangler dev 共享本地状态库 / 远端限流),重试 3 次兜底。
 */
async function makeLocalUploader() {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy();
  const bucket = proxy.env.GAMES;
  if (!bucket) {
    await proxy.dispose();
    throw new Error(`wrangler 绑定 GAMES 不存在(实际绑定:${Object.keys(proxy.env).join(', ') || '无'}),检查 wrangler.jsonc 的 r2_buckets`);
  }
  return {
    async put(key, file, contentType) {
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await bucket.put(key, fs.readFileSync(file), { httpMetadata: { contentType } });
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) await sleep(500 * attempt);
        }
      }
      throw lastErr;
    },
    dispose: () => proxy.dispose(),
  };
}

/** 远程上传通道：直连 R2 HTTP API（单进程并发 PUT）。
 *  不用 `wrangler r2 object put` 的原因有二：① wrangler 4.164+ 该命令默认写本地模拟
 *  存储，需显式 --remote，历史上曾静默传入本地而线上没更新；② 每文件一个 CLI 进程
 *  冷启动，4000+ 文件要半小时。token 优先取 CLOUDFLARE_API_TOKEN，否则读 wrangler
 *  OAuth 配置（wrangler login 生成）。 */
function readApiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const configDir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, '.wrangler', 'config')
    : process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config')
      : path.join(os.homedir(), '.config', '.wrangler', 'config');
  const text = fs.readFileSync(path.join(configDir, 'default.toml'), 'utf8');
  const match = text.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('未找到 Cloudflare API token：设置 CLOUDFLARE_API_TOKEN 或先执行 wrangler login');
  return match[1];
}

function makeRemoteUploader() {
  const token = readApiToken();
  const upload = async (key, file, contentType) => {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${key}`;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await waitSlot();
        const res = await fetch(url, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
          body: fs.readFileSync(file),
        });
        if (res.ok) return;
        const retryAfter = Number(res.headers.get('retry-after'));
        lastErr = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
          await sleep(retryAfter * 1000);
          continue;
        }
      } catch (err) {
        lastErr = err;
      }
      if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
    }
    throw new Error(`上传失败 ${key}\n${lastErr?.message ?? ''}`);
  };
  return { put: upload, dispose: async () => {} };
}

/** 递归收集目录下的相对路径(posix 分隔)。跟随符号链接:web-bvn 的构建产物把 packages/data/assets 以符号链接形式链入 dist,withFileTypes 下链接项 isDirectory() 为 false,按 stat(解引用)判断。 */
function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, base));
    else if (stat.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** 简单并发池。 */
async function pool(items, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

let totalFiles = 0;
const failures = [];

const uploader = local ? await makeLocalUploader().catch((err) => {
  console.error(`[sync-games] 初始化本地上传通道失败:${err.message}`);
  process.exit(1);
}) : makeRemoteUploader();

try {
  for (const slug of Object.keys(config)) {
    const source = path.resolve(projectRoot, config[slug]);
    if (!fs.existsSync(source)) {
      console.warn(`[sync-games] 跳过 ${slug}:构建产物不存在(${config[slug]}),先构建该游戏`);
      continue;
    }

    const files = walk(source);
    const indexes = files.filter((f) => f.endsWith('/index.html') || f === 'index.html');
    const assets = files.filter((f) => !indexes.includes(f));
    const upload = (rel) => uploader.put(`g/${slug}/${rel}`, path.join(source, rel.split('/').join(path.sep)), inferContentType(rel));

    try {
      await pool(assets, upload);
      await pool(indexes, upload);
      totalFiles += files.length;
      console.log(`[sync-games] ${slug}:${files.length} 个文件 → ${BUCKET}/g/${slug}/`);
    } catch (err) {
      failures.push(`${slug}: ${err.message}`);
    }
  }
} finally {
  await uploader.dispose();
}

if (failures.length) {
  console.error(`[sync-games] 失败 ${failures.length} 项:\n${failures.join('\n')}`);
  if (!local && failures.some((f) => f.includes('30003') || f.includes('not found'))) {
    console.error('提示:bucket 可能不存在,先执行 npx wrangler r2 bucket create gamedock-games');
  }
  process.exit(1);
}
console.log(`[sync-games] 完成:共 ${totalFiles} 个文件${local ? '(本地模拟)' : '(线上)'}`);
