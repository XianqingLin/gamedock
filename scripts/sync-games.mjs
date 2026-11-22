/**
 * 把 games.config.json 声明的游戏构建产物上传到 R2 bucket(gamedock-games)。
 * key 规则与 worker(server/game-assets.mjs)一致:`g/<slug>/<相对路径>`。
 *
 * 用法:
 *   node scripts/sync-games.mjs           # 差分上传到线上 R2(需 wrangler 登录)
 *   node scripts/sync-games.mjs --full    # 忽略差分清单,强制全量上传
 *   node scripts/sync-games.mjs --local   # 写入本地 wrangler dev 的 R2 模拟(.wrangler/state)
 *   node scripts/sync-games.mjs --purge-retired  # 本次同步末尾立即 DELETE 全部待删区(跳过 7 天保留期)
 *
 * 上传通道(都是单进程内并发,不逐文件起 CLI 进程):
 *   --local 经 getPlatformProxy 直连本地模拟的 R2 绑定(读 wrangler.jsonc);
 *   远程模式直连 R2 HTTP API,token 取 CLOUDFLARE_API_TOKEN 或 wrangler 登录态。
 *
 * 差分上传:成功上传的文件按 `R2 key → 内容 md5` 记入本地状态清单
 * (远程 `server/.r2-sync-state.json`,本地模拟 `server/.r2-sync-state.local.json`,
 * 均不入库);下次同步内容未变的文件直接跳过,重复部署从全量 ~8 分钟降到秒级。
 * 状态文件丢失 = 自动退化为一次全量(多传不漏传);`--full` 强制全量重建清单。
 * 前提:本脚本是唯一发布口——绕过脚本手工改 R2 会让清单失真(漏传),此时用 --full。
 * 延迟清理:产物中消失的 key 不立即删——移入"待删区"(retired,带时间戳),超过 7 天后
 * 于同步末尾发 DELETE(同一限流)。保留期覆盖旧 index.html 与长命标签页懒加载旧 chunk
 * 的窗口;待删期内文件复活(重回产物)则自动移出待删区。局限:差分清单诞生前的历史
 * 垃圾(无 key 记录)无法枚举清理——将来配 S3 凭证走 ListObjectsV2 一次性处理。
 *
 * 发布一致性:R2 没有原子目录替换,多文件更新存在短暂不一致窗口。
 * 游戏入口是 index.html,脚本把全部普通文件传完后再写各游戏的 index.html,
 * 更新期间旧 index.html 引用的旧资源始终可用,不一致窗口压到几乎为零;
 * index.html 不参与差分、每次无条件重写,该语义保持不变。
 */
import crypto from 'node:crypto';
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
// 待删区保留期:覆盖旧 index/长命标签页懒加载旧 chunk 的存活窗口。
const RETENTION_MS = 7 * 24 * 3600 * 1000;

const argv = process.argv.slice(2);
const local = argv.includes('--local');
const fullSync = argv.includes('--full');
const purgeRetired = argv.includes('--purge-retired');
const stateFile = path.join(projectRoot, 'server', local ? '.r2-sync-state.local.json' : '.r2-sync-state.json');

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  console.error('[sync-games] 读取 server/games.config.json 失败');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 差分状态清单:`{ version, entries: { r2key: md5hex }, retired: { r2key: isoTimestamp } }`。
 *  读取失败按空清单处理(退化为全量,绝不误删——待删区为空即无删除动作)。 */
function loadState() {
  const empty = { version: 2, entries: {}, retired: {} };
  if (fullSync) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (raw?.entries && typeof raw.entries === 'object') {
      return {
        version: 2,
        entries: raw.entries,
        retired: raw.retired && typeof raw.retired === 'object' ? raw.retired : {},
      };
    }
  } catch {}
  return empty;
}

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

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
    del: async (key) => {
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await bucket.delete(key);
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

/** 远程 DELETE:404 视为"已不存在"(重复清理/手工先删过)按成功处理。 */
function makeRemoteDeleter(token) {
  return async (key) => {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${key}`;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await waitSlot();
        const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        if (res.ok || res.status === 404) return;
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
    throw new Error(`删除失败 ${key}\n${lastErr?.message ?? ''}`);
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
  const del = makeRemoteDeleter(token);
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
  return { put: upload, del, dispose: async () => {} };
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

const state = loadState();
const uploader = local ? await makeLocalUploader().catch((err) => {
  console.error(`[sync-games] 初始化本地上传通道失败:${err.message}`);
  process.exit(1);
}) : makeRemoteUploader();

let totalFiles = 0;
let totalUploaded = 0;
let totalSkipped = 0;
let totalDeleted = 0;
const failures = [];
const deleteFailures = [];

try {
  for (const slug of Object.keys(config)) {
    const source = path.resolve(projectRoot, config[slug]);
    if (!fs.existsSync(source)) {
      console.warn(`[sync-games] 跳过 ${slug}:构建产物不存在(${config[slug]}),先构建该游戏`);
      continue;
    }

    const files = walk(source);
    const indexes = files.filter((f) => f.endsWith('/index.html') || f === 'index.html');
    const toUpload = []; // { key, rel, file, hash }
    let skipped = 0;
    const seen = new Set();

    for (const rel of files) {
      const key = `g/${slug}/${rel}`;
      seen.add(key);
      const file = path.join(source, rel.split('/').join(path.sep));
      const hash = md5(file);
      // index.html 不差分,恒重写(压不一致窗口的语义依赖它最后落笔)。
      if (!indexes.includes(rel) && state.entries[key] === hash) {
        skipped += 1;
        continue;
      }
      toUpload.push({ key, rel, file, hash });
    }

    try {
      // 先普通文件后 index.html;成功的 put 即记入清单,失败项不记(下次重传)。
      const assets = toUpload.filter((u) => !indexes.includes(u.rel));
      const indexUploads = toUpload.filter((u) => indexes.includes(u.rel));
      const put = async (u, contentType) => {
        await uploader.put(u.key, u.file, contentType ?? inferContentType(u.rel));
        state.entries[u.key] = u.hash;
      };
      await pool(assets, (u) => put(u));
      await pool(indexUploads, (u) => put(u));
      // 按 slug 剪枝:本次产物里已消失的条目移出清单、进待删区(7 天后删);
      // 待删期内复活的 key(重回产物)移出待删区。
      const prefix = `g/${slug}/`;
      const nowIso = new Date().toISOString();
      for (const key of Object.keys(state.entries)) {
        if (key.startsWith(prefix) && !seen.has(key)) {
          delete state.entries[key];
          if (!state.retired[key]) state.retired[key] = nowIso;
        }
      }
      for (const key of Object.keys(state.retired)) {
        if (seen.has(key)) delete state.retired[key];
      }
      totalFiles += files.length;
      totalUploaded += toUpload.length;
      totalSkipped += skipped;
      console.log(`[sync-games] ${slug}:上传 ${toUpload.length} / 未变跳过 ${skipped},共 ${files.length} 个文件 → ${BUCKET}/g/${slug}/`);
    } catch (err) {
      failures.push(`${slug}: ${err.message}`);
    }
  }
} finally {
  await uploader.dispose();
}

// 过期待删区清理:超过保留期的 key 逐个 DELETE;失败的保留墓碑下次重试。
// 删除失败不使整次同步失败(上传才是主职责);清单为空时此循环零动作,绝不会误删。
// --purge-retired 跳过 7 天保留期,本次同步末尾立即 DELETE 全部待删区——
// 运营显式决策用(2026-11-22 首次使用:流帧拼图替代的逐帧 webp 即时清理;
// 保留期本为覆盖旧 index.html 与长命标签页,跳过前须自行确认旧客户端窗口可接受)。
const dueForDeletion = Object.keys(state.retired)
  .filter((key) => Number.isFinite(Date.parse(state.retired[key])))
  .filter((key) => purgeRetired || Date.now() - Date.parse(state.retired[key]) > RETENTION_MS);
if (dueForDeletion.length) {
  await pool(dueForDeletion, async (key) => {
    try {
      await uploader.del(key);
      delete state.retired[key];
      totalDeleted += 1;
    } catch (err) {
      deleteFailures.push(err.message);
    }
  });
}

fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

if (failures.length) {
  console.error(`[sync-games] 失败 ${failures.length} 项(未记入清单,下次自动重传):\n${failures.join('\n')}`);
  if (!local && failures.some((f) => f.includes('30003') || f.includes('not found'))) {
    console.error('提示:bucket 可能不存在,先执行 npx wrangler r2 bucket create gamedock-games');
  }
  process.exit(1);
}
if (deleteFailures.length) {
  console.warn(`[sync-games] 待删区清理失败 ${deleteFailures.length} 项(墓碑保留,下次重试):\n${deleteFailures.join('\n')}`);
}
console.log(`[sync-games] 完成:共 ${totalFiles} 个文件,本次上传 ${totalUploaded},未变跳过 ${totalSkipped},过期清理删除 ${totalDeleted}${dueForDeletion.length ? '' : '(待删区空)'}`);
console.log(`[sync-games] 状态清单:${stateFile}(${Object.keys(state.entries).length} 个条目,待删区 ${Object.keys(state.retired).length})${local ? ' —— 本地模拟' : ''}`);
