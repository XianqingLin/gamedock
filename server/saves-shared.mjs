/**
 * 存档公共校验与限额(fs 实现与 KV 实现共用;本模块必须保持零 Node/平台依赖,
 * 否则会把 node:fs 拖进 Worker bundle)。
 */
export const SEGMENT_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const MAX_SLOTS_PER_GAME = 20;
export const DEFAULT_VALUE_LIMIT = 256 * 1024;

export const fail = (error) => ({ ok: false, error });

/** 校验路径段(userId/slug/key 共用),杜绝目录穿越。 */
export function validSegment(segment) {
  return typeof segment === 'string' && SEGMENT_RE.test(segment);
}
