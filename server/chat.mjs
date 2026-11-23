/**
 * 平台聊天(2026-11-23 起:好友间聊天,取代原「小舟AI」AI 助手聊天)。
 * 消息存储形状:{ id, fromId, toId, content, createdAt }(双向各存一条,对等);
 * 对外投影为 { id, peer, mine, content, createdAt }(peer = 对方用户 ID,mine = 是否本端发出)。
 *
 * 内置「测试用户」bot(见 bot.mjs)给TA发消息后由服务端落一条固定自动回复,
 * 让好友聊天链路在单账号下可自测收发闭环;除 bot 外无任何自动应答。
 */
import { TEST_USER } from './bot.mjs';

export { TEST_USER };

const CONTENT_MAX = 2000;
/** 返回给前端的历史条数上限。 */
const HISTORY_LIMIT = 100;

const fail = (error) => ({ ok: false, error });

/** peer 必须是已接受的好友(测试用户 friendship 由 ensureTestUserFriend 保证);不能对自己发消息。 */
async function peerGuard(store, userId, peerId) {
  if (typeof peerId !== 'string' || !peerId) return fail('会话不存在');
  if (peerId === userId) return fail('只能与好友聊天');
  const friendship = await store.getFriendshipBetween(userId, peerId);
  if (!friendship || friendship.status !== 'accepted') return fail('只能与好友聊天');
  return null;
}

function project(message, userId) {
  const peerId = message.fromId === userId ? message.toId : message.fromId;
  return {
    id: message.id,
    peer: peerId,
    mine: message.fromId === userId,
    content: message.content,
    createdAt: message.createdAt,
  };
}

/** 聊天历史(按时间正序,最多 HISTORY_LIMIT 条)。 */
export async function listChatMessages(store, userId, peerId) {
  const invalid = await peerGuard(store, userId, peerId);
  if (invalid) return invalid;
  const rows = await store.listChatMessagesBetween(userId, peerId, HISTORY_LIMIT);
  return { ok: true, messages: rows.map((row) => project(row, userId)) };
}

/**
 * 发送消息:落库本端消息;对方是测试用户时追加一条 bot 自动回复。
 * 普通好友不自动应答,对方通过聊天历史轮询收到(前端打开聊天框时轮询)。
 */
export async function sendChatMessage(store, userId, peerId, content) {
  const invalid = await peerGuard(store, userId, peerId);
  if (invalid) return invalid;
  if (typeof content !== 'string' || !content.trim()) return fail('消息不能为空');
  const text = content.trim();
  if (text.length > CONTENT_MAX) return fail(`消息过长,最多 ${CONTENT_MAX} 字`);

  const mine = {
    id: crypto.randomUUID(),
    fromId: userId,
    toId: peerId,
    content: text,
    createdAt: new Date().toISOString(),
  };
  await store.insertChatMessage(mine);
  const out = [project(mine, userId)];

  if (peerId === TEST_USER.id) {
    // bot 固定回声式回复:内容回显截断,让单账号即可验证收发闭环。
    const quoted = text.length > 50 ? `${text.slice(0, 50)}…` : text;
    const reply = {
      id: crypto.randomUUID(),
      fromId: TEST_USER.id,
      toId: userId,
      content: `(测试用户自动回复)已收到:「${quoted}」`,
      createdAt: new Date().toISOString(),
    };
    await store.insertChatMessage(reply);
    out.push(project(reply, userId));
  }
  return { ok: true, messages: out };
}
