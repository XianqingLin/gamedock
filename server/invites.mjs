/**
 * 好友邀请(仅信息传递,对应 platform-seam 契约 §4)。
 *
 * 邀请 = 「来玩某款游戏」的记录:发出方在游戏运行页的好友面板右键好友发出,
 * 携带当前游戏 slug 与游戏经 SDK 上报的加入参数(平台只透传、不解析)。
 * 接收方通知:右下角 Toast + 好友栏好友行右侧内联邀请区(前端全站轮询通知端点发现,
 * 无推送通道)。接受即自动入房:接受 → 打开/重挂运行页(?invite= 深链)→ 游戏落
 * 主菜单凭未过期票自动入房;游戏内无任何邀请 UI。平台不参与连接建立。
 *
 * 同邀请者新邀请覆盖旧邀请:发出时把此前 pending 的同源邀请标记 superseded(终态,
 * 不再展示也不再可操作)。
 *
 * 邀请 TTL(3 分钟):过期不落状态位,读取(列表/通知)时过滤,接受/拒绝时明确拒绝——
 * 过期票兑了也进不了房(房间码早已冷却),不如让 A 重新邀请。
 *
 * params 一次性投递:运行页首次取参即标记 delivered_at 并返回 params,
 * 之后再取 params 为 null——防止游戏侧已销的票被复活(刷新恢复由游戏侧票自持)。
 *
 * 记录形状:{ id, fromUser, toUser, slug, params(object|null), status:'pending'|'accepted'|'declined'|'superseded', createdAt, respondedAt?, deliveredAt? }
 */
import { TEST_USER } from './bot.mjs';

const PARAMS_MAX_BYTES = 1024;

/** 邀请有效期:过期在列表/通知中不可见,接受/拒绝报「邀请已过期」。 */
export const INVITE_TTL_MS = 3 * 60_000;

/** 发起方回执窗口:被拒绝的邀请在此窗口内随通知端点下发(前端按 id 去重只提示一次)。 */
export const INVITE_RESPONSE_WINDOW_MS = 5 * 60_000;

function isExpired(invite, now = Date.now()) {
  return now - Date.parse(invite.createdAt) > INVITE_TTL_MS;
}


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

  // 同邀请者新邀请覆盖旧邀请:此前 pending 的同源邀请一律作废(superseded),
  // 接收侧不再堆积同一人的多条邀请。
  const stale = (await store.listPendingInvitesFor(target.id)).filter(
    (invite) => invite.fromUser === fromUserId,
  );
  for (const invite of stale) {
    await store.updateInvite(invite.id, { status: 'superseded' });
  }

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

/** 接收方视角的待处理邀请列表(按时间正序;过期邀请不出现在任何展示面)。 */
export async function listGameInvites(store, userId) {
  const invites = await store.listPendingInvitesFor(userId);
  const out = [];
  for (const invite of invites) {
    if (isExpired(invite)) continue;
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

/** 接收方点「接受」:标记 accepted,返回完整邀请(params 随后经 hello 交给游戏)。 */
export async function acceptGameInvite(store, userId, inviteId) {
  const invite = await findOwnInvite(store, userId, inviteId);
  if (!invite) return fail('邀请不存在或已处理');
  if (isExpired(invite)) return fail('邀请已过期');
  const respondedAt = new Date().toISOString();
  await store.updateInvite(invite.id, { status: 'accepted', respondedAt });
  return { ok: true, invite: { ...invite, status: 'accepted', respondedAt } };
}

/** 接收方点「拒绝」:标记 declined(发起方经通知端点的回执窗口看到轻提示)。 */
export async function declineGameInvite(store, userId, inviteId) {
  const invite = await findOwnInvite(store, userId, inviteId);
  if (!invite) return fail('邀请不存在或已处理');
  if (isExpired(invite)) return fail('邀请已过期');
  const respondedAt = new Date().toISOString();
  await store.updateInvite(invite.id, { status: 'declined', respondedAt });
  return { ok: true };
}

/** 发起方回执:我发出的、被拒绝且回执窗口内的邀请(通知端点用;前端按 id 去重只提示一次)。 */
export async function listDeclinedInvitesFrom(store, userId) {
  const declined = await store.listInvitesFromWithStatus(userId, 'declined');
  const now = Date.now();
  const out = [];
  for (const invite of declined) {
    if (!invite.respondedAt || now - Date.parse(invite.respondedAt) > INVITE_RESPONSE_WINDOW_MS) continue;
    const to = await store.getUserById(invite.toUser);
    out.push({
      id: invite.id,
      to: { id: invite.toUser, username: to?.username ?? '(已注销)' },
      respondedAt: invite.respondedAt,
    });
  }
  return out;
}

/** 运行页取邀请:params 仅接收方可见;一次性投递(见模块头)——首次取参标记
 *  delivered_at 并返回 params,之后再取 params 为 null(游戏侧票自持刷新恢复)。 */
export async function getGameInvite(store, userId, inviteId) {
  const invite = await store.getInvite(inviteId);
  if (!invite || invite.toUser !== userId) return fail('邀请不存在');
  let params = invite.params;
  if (!invite.deliveredAt) {
    // 首次取参 = 投递。此后刷新/重开运行页不再下发,防止已销的票被复活。
    const deliveredAt = new Date().toISOString();
    await store.updateInvite(invite.id, { deliveredAt });
  } else {
    params = null;
  }
  const from = await store.getUserById(invite.fromUser);
  return {
    ok: true,
    invite: {
      id: invite.id,
      from: { id: invite.fromUser, username: from?.username ?? '(已注销)' },
      slug: invite.slug,
      params,
      status: invite.status,
    },
  };
}
