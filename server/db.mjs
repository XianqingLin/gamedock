import fs from 'node:fs';
import path from 'node:path';

/**
 * v1 存储:单文件 JSON(原子写:临时文件 + rename)。
 * 规模上来后再换 SQLite 等真实存储,业务逻辑模块(auth/friends)不感知存储细节。
 */
export function emptyDb() {
  return { users: [], friendships: [] };
}

export function loadDb(dbFile) {
  let data = emptyDb();
  try {
    data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch {
    // 首次使用或文件损坏:从空库开始。
  }
  data.users ??= [];
  data.friendships ??= [];
  return data;
}

export function saveDb(dbFile, data) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = `${dbFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, dbFile);
}
