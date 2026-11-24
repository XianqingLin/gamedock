import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { friendsApi } from '../lib/api';
import type { GameInviteEntry, InviteResponseEntry } from '../lib/api';
import { useAuth } from './auth';

/** 全站通知轮询间隔(可见时;页面不可见退避——无推送通道,轮询是邀请可见性的唯一来源)。 */
const POLL_VISIBLE_MS = 10_000;
const POLL_HIDDEN_MS = 30_000;
/** 与服务端一致(TTL 3 分钟):客户端同样按 createdAt 过滤,容 clock 漂移多留 30s 余量。 */
const INVITE_TTL_MS = 3 * 60_000 - 30_000;
/** 本会话已弹过 Toast 的邀请 id(sessionStorage:刷新不重弹,关标签页即忘)。 */
const TOAST_SEEN_KEY = 'gamedock.toastSeenInvites';
/** 已提示过的拒绝回执 id(localStorage:跨会话只提示一次)。 */
const RESPONSE_SEEN_KEY = 'gamedock.declineSeenInvites';
const RESPONSE_SEEN_MAX = 200;

function loadIdSet(key: string, storage: Storage): Set<string> {
  try {
    const raw = storage.getItem(key);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? new Set(list.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveIdSet(key: string, ids: Set<string>, storage: Storage, cap?: number) {
  try {
    let list = [...ids];
    if (cap !== undefined && list.length > cap) list = list.slice(-cap);
    storage.setItem(key, JSON.stringify(list));
  } catch {
    // 存储不可用(隐私模式等)只影响去重,功能不受损。
  }
}

interface InviteHubValue {
  /** 待处理邀请(TTL 内,同一邀请者只留最新一条,按时间正序)。 */
  invites: GameInviteEntry[];
  /** 等待 Toast 展示的邀请(id 未进过本会话 Toast)。 */
  toastQueue: GameInviteEntry[];
  /** 尚未提示过的拒绝回执。 */
  pendingResponses: InviteResponseEntry[];
  /** 好友入口角标:抽屉打开后未查看过的邀请数。 */
  badgeCount: number;
  /** 标记邀请已弹过 Toast(会话内去重)。 */
  markToastsSeen: (ids: string[]) => void;
  /** 标记拒绝回执已提示(跨会话去重)。 */
  markResponsesSeen: (ids: string[]) => void;
  /** 抽屉打开时调用:清零角标。 */
  markInvitesViewed: () => void;
  /** 请求打开好友栏(Toast 点击);计数器,宿主组件监听变化后自行打开。 */
  openRequest: number;
  requestOpenFriends: () => void;
}

const InviteHubContext = createContext<InviteHubValue | null>(null);

/**
 * 全站邀请通知中心(挂 App 根部,登录态下轮询 /api/friends/notifications)。
 * 平台无推送通道,登录态 10 秒轮询、页面不可见退避 30 秒;回到可见且数据过期时立即补拉。
 * 派生出三份消费面:Toast 队列(会话内按 id 去重)、好友入口角标(抽屉打开即视为已读)、
 * 发起方拒绝回执(localStorage 按 id 去重只提示一次)。
 */
export function InviteHubProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [invites, setInvites] = useState<GameInviteEntry[]>([]);
  const [responses, setResponses] = useState<InviteResponseEntry[]>([]);
  const [toastSeen, setToastSeen] = useState<Set<string>>(() =>
    typeof sessionStorage !== 'undefined' ? loadIdSet(TOAST_SEEN_KEY, sessionStorage) : new Set(),
  );
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [openRequest, setOpenRequest] = useState(0);
  const responseSeenRef = useRef<Set<string>>(
    typeof localStorage !== 'undefined' ? loadIdSet(RESPONSE_SEEN_KEY, localStorage) : new Set(),
  );

  const fetchNotifications = useCallback(() => {
    friendsApi
      .notifications()
      .then((data) => {
        setInvites(data.invites);
        setResponses(data.responses);
      })
      .catch(() => {
        // 轮询失败静默:保留下次周期重试,不打断用户。
      });
  }, []);

  useEffect(() => {
    if (status !== 'user') {
      setInvites([]);
      setResponses([]);
      return;
    }
    let lastFetch = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const interval = document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
      if (Date.now() - lastFetch >= interval - 500) {
        lastFetch = Date.now();
        fetchNotifications();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch > POLL_VISIBLE_MS) {
        lastFetch = Date.now();
        fetchNotifications();
      }
    };
    fetchNotifications();
    lastFetch = Date.now();
    const timer = window.setInterval(tick, POLL_VISIBLE_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, fetchNotifications]);

  const markToastsSeen = useCallback((ids: string[]) => {
    setToastSeen((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      saveIdSet(TOAST_SEEN_KEY, next, sessionStorage);
      return next;
    });
  }, []);

  const markResponsesSeen = useCallback((ids: string[]) => {
    const next = responseSeenRef.current;
    for (const id of ids) next.add(id);
    saveIdSet(RESPONSE_SEEN_KEY, next, localStorage, RESPONSE_SEEN_MAX);
    setResponses((prev) => prev.filter((entry) => !next.has(entry.id)));
  }, []);

  const markInvitesViewed = useCallback(() => {
    setViewedIds((prev) => {
      const next = new Set(prev);
      for (const invite of invites) next.add(invite.id);
      return next;
    });
  }, [invites]);

  const requestOpenFriends = useCallback(() => setOpenRequest((count) => count + 1), []);

  const value = useMemo<InviteHubValue>(() => {
    const now = Date.now();
    // TTL 过滤(客户端镜像服务端判定)→ 同一邀请者只留最新 → 时间正序(Toast 先到先显)。
    const fresh = invites.filter((invite) => now - Date.parse(invite.createdAt) < INVITE_TTL_MS);
    const byFrom = new Map<string, GameInviteEntry>();
    for (const invite of fresh) {
      const existing = byFrom.get(invite.from.id);
      if (!existing || Date.parse(invite.createdAt) > Date.parse(existing.createdAt)) byFrom.set(invite.from.id, invite);
    }
    const deduped = [...byFrom.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return {
      invites: deduped,
      toastQueue: deduped.filter((invite) => !toastSeen.has(invite.id)),
      pendingResponses: responses.filter((entry) => !responseSeenRef.current.has(entry.id)),
      badgeCount: deduped.filter((invite) => !viewedIds.has(invite.id)).length,
      markToastsSeen,
      markResponsesSeen,
      markInvitesViewed,
      openRequest,
      requestOpenFriends,
    };
  }, [invites, responses, toastSeen, viewedIds, markToastsSeen, markResponsesSeen, markInvitesViewed, openRequest, requestOpenFriends]);

  return <InviteHubContext.Provider value={value}>{children}</InviteHubContext.Provider>;
}

export function useInviteHub(): InviteHubValue {
  const value = useContext(InviteHubContext);
  if (!value) throw new Error('useInviteHub 必须在 InviteHubProvider 内使用');
  return value;
}
