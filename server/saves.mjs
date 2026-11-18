import fs from 'node:fs';
import path from 'node:path';
import { SEGMENT_RE, MAX_SLOTS_PER_GAME, DEFAULT_VALUE_LIMIT, fail, validSegment } from './saves-shared.mjs';

/**
 * 平台存档(fs 实现):按 (userId, slug, key) 存 JSON 值,文件落盘在 savesDir 下。
 * 值对平台不透明,格式由游戏自定义;last-write-wins。
 * 用户隔离靠路径段校验(三段均检查,无穿越风险)。
 * 接口同 store.mjs 风格;线上 KV 实现见 saves-kv.mjs。
 */

function slotFile(savesDir, userId, slug, key) {
  return path.join(savesDir, userId, slug, `${key}.json`);
}

/** fs 实现工厂:产出与 saves-kv.mjs 相同形状的 saves 接口(测试/本地用)。 */
export function createFsSaves(savesDir) {
  return {
    listSaves: (userId, slug) => listSaves(savesDir, userId, slug),
    readSave: (userId, slug, key) => readSave(savesDir, userId, slug, key),
    writeSave: (userId, slug, key, value, options) => writeSave(savesDir, userId, slug, key, value, options),
    deleteSave: (userId, slug, key) => deleteSave(savesDir, userId, slug, key),
  };
}

function readSlot(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 列出某用户在某游戏的全部槽位(只给元数据,值不返回)。 */
export function listSaves(savesDir, userId, slug) {
  if (!validSegment(userId) || !validSegment(slug)) return fail('非法参数');
  const gameDir = path.join(savesDir, userId, slug);
  let entries;
  try {
    entries = fs.readdirSync(gameDir);
  } catch {
    return { ok: true, slug, slots: [] };
  }

  const slots = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const key = name.slice(0, -'.json'.length);
    if (!validSegment(key)) continue;
    const record = readSlot(path.join(gameDir, name));
    if (!record) continue;
    slots.push({ key, updatedAt: record.updatedAt ?? null, size: record.size ?? null });
  }
  slots.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { ok: true, slug, slots };
}

/** 读取单个槽位。 */
export function readSave(savesDir, userId, slug, key) {
  if (!validSegment(userId) || !validSegment(slug) || !validSegment(key)) {
    return fail('非法参数');
  }
  const record = readSlot(slotFile(savesDir, userId, slug, key));
  if (!record) return fail('存档不存在');
  return { ok: true, record: { key, value: record.value ?? null, updatedAt: record.updatedAt ?? null } };
}

/**
 * 写入槽位。value 为任意可 JSON 序列化的值(平台不解析内容)。
 * 超过 valueLimit 拒绝;新建槽位超过每游戏槽位上限拒绝。
 */
export function writeSave(savesDir, userId, slug, key, value, options = {}) {
  if (!validSegment(userId) || !validSegment(slug) || !validSegment(key)) {
    return fail('非法参数');
  }
  if (value === undefined) return fail('请求体需包含 value 字段');

  const valueLimit = options.valueLimit ?? DEFAULT_VALUE_LIMIT;
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > valueLimit) {
    return fail(`存档过大,上限 ${Math.floor(valueLimit / 1024)}KB`);
  }

  const gameDir = path.join(savesDir, userId, slug);
  const file = slotFile(savesDir, userId, slug, key);
  if (!fs.existsSync(file)) {
    let existing = [];
    try {
      existing = fs.readdirSync(gameDir).filter((n) => n.endsWith('.json'));
    } catch {
      // 目录不存在:首个槽位。
    }
    if (existing.length >= (options.maxSlots ?? MAX_SLOTS_PER_GAME)) {
      return fail(`每个游戏最多 ${options.maxSlots ?? MAX_SLOTS_PER_GAME} 个存档槽位`);
    }
  }

  const record = { value, updatedAt: new Date().toISOString(), size: Buffer.byteLength(serialized, 'utf8') };
  try {
    fs.mkdirSync(gameDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, file);
  } catch {
    return fail('存档写入失败');
  }
  return { ok: true, record: { key, updatedAt: record.updatedAt, size: record.size } };
}

/** 删除槽位。不存在也返回成功(幂等)。 */
export function deleteSave(savesDir, userId, slug, key) {
  if (!validSegment(userId) || !validSegment(slug) || !validSegment(key)) {
    return fail('非法参数');
  }
  try {
    fs.rmSync(slotFile(savesDir, userId, slug, key));
  } catch {
    // 文件不存在视为已删除。
  }
  return { ok: true };
}
