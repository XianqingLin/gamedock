/**
 * 把 games.config.json 声明的游戏构建产物上传到 R2 bucket(gamedock-games)。
 * key 规则与 worker(server/game-assets.mjs)一致:`g/<slug>/<相对路径>`。
 *
 * 用法:
 *   node scripts/sync-games.mjs           # 上传到线上 R2(需 wrangler 登录)
 *   node scripts/sync-games.mjs --local   # 写入本地 wrangler dev 的 R2 模拟(.wrangler/state)
 *
 * 上传通道:
 *   --local 经 getPlatformProxy 单进程直连本地模拟的 R2 绑定(读 wrangler.jsonc,
 *   持久化路径与 wrangler dev 一致),免去每文件一个 CLI 进程的冷启动;
 *   远程模式没有对应的编程接口,仍逐文件调 `wrangler r2 object put`。
 *
 * 发布一致性:R2 没有原子目录替换,多文件更新存在短暂不一致窗口。
 * 游戏入口是 index.html,脚本把全部普通文件传完后再写各游戏的 index.html,
 * 更新期间旧 index.html 引用的旧资源始终可用,不一致窗口压到几乎为零。
 * 旧文件不删除(R2 无 list 级 CLI),多传的对象只占空间不碍事;
 * 将来投稿/审核流 API 化时再引入精确清理。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inferContentType } from '../server/mime.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(projectRoot, 'server', 'games.config.json');
const BUCKET = 'gamedock-games';
const CONCURRENCY = 8;

const local = process.argv.slice(2).includes('--local');

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  console.error('[sync-games] 读取 server/games.config.json 失败');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 远程模式:调 wrangler(异步,并发池依赖非阻塞):优先本地 node_modules,否则回退 npx。 */
function runWrangler(args) {
  const localBin = path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const useLocal = fs.existsSync(localBin);
  return new Promise((resolvePromise) => {
    const child = useLocal
      ? spawn(process.execPath, [localBin, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn('npx', ['wrangler', ...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolvePromise({ status: code ?? 1, output }));
    child.on('error', (err) => resolvePromise({ status: 1, output: String(err) }));
  });
}

/**
 * 上传器:put(key, file, contentType) 抛错即失败。
 * 本地模式经 getPlatformProxy 直连模拟 R2(单进程,快);远程模式逐文件起 wrangler CLI。
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

function makeRemoteUploader() {
  const upload = async (key, file, contentType) => {
    const args = ['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--content-type', contentType];
    let lastResult;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      lastResult = await runWrangler(args);
      if (lastResult.status === 0) return;
      if (attempt < 3) await sleep(500 * attempt);
    }
    const detail = (lastResult.output || '').trim().split('\n').slice(-3).join('\n');
    throw new Error(`上传失败 ${key}\n${detail}`);
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
