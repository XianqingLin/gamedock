import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from './config.mjs';
import { loadDb } from './db.mjs';
import { handleApi } from './api.mjs';
import { attachRelay } from './relay.mjs';
import { resolveWithin, serveFileIfExists, sendText } from './static.mjs';

/**
 * 组装平台服务:静态资源(/ 与 /g/<slug>/...) + API(/api/...) + WS 中转(/api/relay)。
 * 导出 createApp 便于集成测试在临时端口/临时数据目录上启动。
 */
export function createApp(config) {
  const db = loadDb(config.dbFile);
  const ctx = { config, db, rooms: new Map() };

  const app = http.createServer((req, res) => {
    let pathname;
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendText(res, 400, '非法请求路径');
      return;
    }

    void (async () => {
      try {
        if (pathname === '/api' || pathname.startsWith('/api/')) {
          await handleApi(req, res, pathname, ctx);
          return;
        }

        if (pathname === '/g' || pathname.startsWith('/g/')) {
          serveGameStatic(res, pathname, config);
          return;
        }

        servePlatform(res, pathname, config);
      } catch (err) {
        console.error('[server] 请求处理失败:', err);
        if (!res.headersSent) sendText(res, 500, '服务器内部错误');
      }
    })();
  });

  attachRelay(app, ctx);

  return app;
}

/** /g/<slug>/... → 各游戏自己的静态构建产物(目录由 games.config.json 声明)。 */
function serveGameStatic(res, pathname, config) {
  const match = /^\/g\/([a-z0-9-]+)(\/.*)?$/.exec(pathname);
  if (!match) {
    sendText(res, 404, '无效的游戏资源路径');
    return;
  }
  const [, slug, rest = '/'] = match;
  const root = config.gameRoots[slug];
  if (!root) {
    sendText(res, 404, '未接入该游戏的静态资源');
    return;
  }
  if (!fs.existsSync(root)) {
    sendText(res, 404, '该游戏的构建产物尚未就绪');
    return;
  }

  const rel = rest === '/' ? 'index.html' : rest.slice(1);
  const target = resolveWithin(root, rel);
  if (!target) {
    sendText(res, 400, '非法路径');
    return;
  }
  if (serveFileIfExists(res, target)) return;
  // 目录形式的请求回退到该目录的 index.html。
  if (serveFileIfExists(res, path.join(target, 'index.html'))) return;
  sendText(res, 404, '资源不存在');
}

/** 其余路径全部交给平台 SPA 构建产物;无扩展名的路径回退到 index.html。 */
function servePlatform(res, pathname, config) {
  if (!fs.existsSync(config.platformDistDir)) {
    sendText(res, 503, '平台前端尚未构建:生产模式请先运行 npm run build;开发模式请使用 npm run dev。');
    return;
  }
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = resolveWithin(config.platformDistDir, rel);
  if (target && serveFileIfExists(res, target)) return;

  if (path.extname(pathname)) {
    sendText(res, 404, '资源不存在');
    return;
  }
  if (!serveFileIfExists(res, path.join(config.platformDistDir, 'index.html'))) {
    sendText(res, 500, '构建产物缺少 index.html');
  }
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const config = loadServerConfig();
  const app = createApp(config);
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[xiao-lin] 平台服务监听 :${config.port}`);
    console.log(`[xiao-lin] 已接入游戏静态资源: ${Object.keys(config.gameRoots).join(', ') || '(无)'}`);
  });

  const shutdown = () => app.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
