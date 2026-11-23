import { validSegment, MAX_SLOTS_PER_GAME, DEFAULT_VALUE_LIMIT } from './saves-shared.mjs';

/**
 * 平台存档(Workers KV 实现),接口形状与 saves.mjs 的 fs 实现一致。
 * - 键:saves/<userId>/<slug>/<key>(三段均经 SEGMENT_RE 校验)
 * - 值:完整记录 JSON({ value, updatedAt, size }),元数据(updatedAt/size)放 KV metadata 供列表免读值
 * - KV 是最终一致:写入后极短时间内他处读取可能看到旧值,对游戏存档场景可接受
 */

const fail = (error) => ({ ok: false, error });

const encoder = new TextEncoder();

function slotKey(userId, slug, key) {
  return `saves/${userId}/${slug}/${key}`;
}

function parseRecord(raw) {
  try {
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object') return null;
    return record;
  } catch {
    return null;
  }
}

export function createKvSaves(kv) {
  return {
    /** 列出某用户在某游戏的全部槽位(元数据来自 KV metadata,只排序不读值)。 */
    async listSaves(userId, slug) {
      if (!validSegment(userId) || !validSegment(slug)) return fail('非法参数');
      let list;
      try {
        list = await kv.list({ prefix: `saves/${userId}/${slug}/` });
      } catch {
        return fail('存档读取失败');
      }
      const slots = [];
      for (const item of list.keys) {
        const key = item.name.slice(`saves/${userId}/${slug}/`.length);
        if (!validSegment(key)) continue;
        slots.push({
          key,
          updatedAt: item.metadata?.updatedAt ?? null,
          size: item.metadata?.size ?? null,
        });
      }
      slots.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return { ok: true, slug, slots };
    },

    /** 跨游戏聚合:一次 KV list 前缀扫出全部槽位,按 slug 分组(只含非空游戏,最近在前)。 */
    async listAllSaves(userId) {
      if (!validSegment(userId)) return fail('非法参数');
      let list;
      try {
        list = await kv.list({ prefix: `saves/${userId}/` });
      } catch {
        return fail('存档读取失败');
      }
      const prefix = `saves/${userId}/`;
      const bySlug = new Map();
      for (const item of list.keys) {
        const rest = item.name.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash <= 0) continue;
        const slug = rest.slice(0, slash);
        const key = rest.slice(slash + 1);
        if (!validSegment(slug) || !validSegment(key)) continue;
        const slots = bySlug.get(slug) ?? [];
        slots.push({ key, updatedAt: item.metadata?.updatedAt ?? null, size: item.metadata?.size ?? null });
        bySlug.set(slug, slots);
      }
      const games = [...bySlug.entries()].map(([slug, slots]) => {
        slots.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return { slug, slots };
      });
      games.sort((a, b) => {
        const aTime = a.slots[0]?.updatedAt ?? '';
        const bTime = b.slots[0]?.updatedAt ?? '';
        return aTime < bTime ? 1 : -1;
      });
      return { ok: true, games };
    },

    /** 读取单个槽位;不存在返回失败。 */
    async readSave(userId, slug, key) {
      if (!validSegment(userId) || !validSegment(slug) || !validSegment(key)) {
        return fail('非法参数');
      }
      const raw = await kv.get(slotKey(userId, slug, key));
      if (!raw) return fail('存档不存在');
      const record = parseRecord(raw);
      if (!record) return fail('存档不存在');
      return { ok: true, record: { key, value: record.value ?? null, updatedAt: record.updatedAt ?? null } };
    },

    /**
     * 写入槽位。value 为任意可 JSON 序列化的值;超过 valueLimit 拒绝;
     * 新建槽位超过每游戏槽位上限拒绝。
     */
    async writeSave(userId, slug, key, value, options = {}) {
      if (!validSegment(userId) || !validSegment(slug) || !validSegment(key)) {
        return fail('非法参数');
      }
      if (value === undefined) return fail('请求体需包含 value 字段');

      const valueLimit = options.valueLimit ?? DEFAULT_VALUE_LIMIT;
      const serialized = JSON.stringify(value);
      if (serialized === undefined || encoder.encode(serialized).length > valueLimit) {
        return fail(`存档过大,上限 ${Math.floor(valueLimit / 1024)}KB`);
      }

      const fullKey = slotKey(userId, slug, key);
      const existing = await kv.get(fullKey);
      if (!existing) {
        let list;
        try {
          list = await kv.list({ prefix: `saves/${userId}/${slug}/` });
        } catch {
          return fail('存档写入失败');
        }
        if (list.keys.length >= (options.maxSlots ?? MAX_SLOTS_PER_GAME)) {
          return fail(`每个游戏最多 ${options.maxSlots ?? MAX_SLOTS_PER_GAME} 个存档槽位`);
        }
      }

      const updatedAt = new Date().toISOString();
      const size = encoder.encode(serialized).length;
      const record = JSON.stringify({ value, updatedAt, size });
      try {
        await kv.put(fullKey, record, { metadata: { updatedAt, size } });
      } catch {
        return fail('存档写入失败');
      }
      return { ok: true, record: { key, updatedAt, size } };
    },

    /** 删除槽位。不存在也返回成功(幂等)。 */
    async deleteSave(userId, slug, key) {
      if (!validSegment(userId) || !validSegment(slug) || !validSegment(key)) {
        return fail('非法参数');
      }
      await kv.delete(slotKey(userId, slug, key));
      return { ok: true };
    },
  };
}
