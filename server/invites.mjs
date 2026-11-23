/**
 * 好友邀请(仅信息传递,对应 platform-seam 契约 §4;2026-11-23 落地)。
 *
 * 邀请 = 「来玩某款游戏」的记录:发出方在游戏运行页的好友面板右键好友发出,
 * 携带当前游戏 slug 与游戏经 SDK 上报的加入参数(平台只透传、不解析)。
 * 接收方在好友列表顶部看到邀请行:进入(标记 accepted → 打开运行页,参数经
 * postMessage 握手交给游戏)或 忽略(标记 declined)。平台不参与连接建立。
 *
 * 记录形状:{ id, fromUser, toUser, slug, params(object|null), status:'pending'|'accepted'|'declined', createdAt, respondedAt? }
 */
import { TEST_USER } from './bot.mjs';

const PARAMS_MAX_BYTES = 1024;


const fail = (error) => ({ ok: false, error });

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 参数载荷校验:仅允许对象且值为 string/number/boolean(可 JSON 序列化、尺寸受限)。 */
function validateParams(params) {
  if (params === undefined || params === null) return null;
  if (!isPlainObject(params)) return '邀请参数格式无效';
  for (const value of Object.values(params)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) return '邀请参数格式无效';
    if (typeof value === 'number' && !Number.isFinite(value)) return '邀请参数格式无效';
  }
  let json;
  try {
    json = JSON.stringify(params);
  } catch {
    return '邀请参数格式无效';
  }
  if (json.length > PARAMS_MAX_BYTES) return '邀请参数过大';
  return null;
}

/**
 * 发出邀请:对方必须是已接受好友(测试用户不是可游玩对象),slug 必须已接入。
 * 返回 {ok, invite|error}。
 */
export async function sendGameInvite(store, fromUserId, { to, slug, params }, gameSlugs) {
  if (typeof to !== 'string' || !to.trim()) return fail('请选择邀请对象');
  if (typeof slug !== 'string' || !slug || !gameSlugs.has(slug)) return fail('未接入该游戏');
  const paramsError = validateParams(params);
  if (paramsError) return fail(paramsError);

  const target = await store.getUserById(to.trim());
  if (!target) return fail('找不到该用户');
  if (target.id === fromUserId) return fail('不能邀请自己');
  if (target.id === TEST_USER.id) return fail('测试用户无法加入游戏');

  const friendship = await store.getFriendshipBetween(fromUserId, target.id);

  if (!friendship || friendship.status !== 'accepted') return fail('只能邀请好友');

  const invite = {
    id: crypto.randomUUID(),
    fromUser: fromUserId,
    toUser: target.id,
    slug,
    params: params ?? null,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await store.insertInvite(invite);
  return { ok: true, invite };
}

async function findOwnInvite(store, userId, inviteId, expectedStatus = 'pending') {
  const invite = await store.getInvite(inviteId);
  if (!invite || invite.toUser !== userId || invite.status !== expectedStatus) return null;
  return invite;
}

/** 接收方视角的待处理邀请列表(按时间正序)。 */
export async function listGameInvites(store, userId) {
  const invites = await store.listPendingInvitesFor(userId);
  const out = [];
  for (const invite of invites) {
    const from = await store.getUserById(invite.fromUser);
    out.push({
      id: invite.id,
      from: {
        id: invite.fromUser,
        username: from?.username ?? '(已注销)',
        avatar: from?.avatar ?? null,
      },
      slug: invite.slug,
      params: invite.params,
      createdAt: invite.createdAt,
    });
  }
  return { ok: true, invites: out };
}

/** 接收方点「进入」:标记 accepted,返回完整邀请(params 随后经 hello 交给游戏)。 */
export async function acceptGameInvite(store, userId, inviteId) {
  const invite = await findOwnInvite(store, userId, inviteId);
  if (!invite) return fail('邀请不存在或已处理');
  const respondedAt = new Date().toISOString();
  await store.updateInvite(invite.id, { status: 'accepted', respondedAt });
  return { ok: true, invite: { ...invite, status: 'accepted', respondedAt } };
}

/** 接收方点「忽略」:标记 declined。 */
export async function declineGameInvite(store, userId, inviteId) {
  const invite = await findOwnInvite(store, userId, inviteId);
  if (!invite) return fail('邀请不存在或已处理');
  const respondedAt = new Date().toISOString();
  await store.updateInvite(invite.id, { status: 'declined', respondedAt });
  return { ok: true };
}

/** 运行页取邀请:params 仅接收方可见(任意状态,刷新后可重新拿到加入参数)。 */
export async function getGameInvite(store, userId, inviteId) {
  const invite = await store.getInvite(inviteId);
  if (!invite || invite.toUser !== userId) return fail('邀请不存在');
  const from = await store.getUserById(invite.fromUser);
  return {
    ok: true,
    invite: {
      id: invite.id,
      from: { id: invite.fromUser, username: from?.username ?? '(已注销)' },
      slug: invite.slug,
      params: invite.params,
      status: invite.status,
    },
  };
}
