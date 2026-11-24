import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { friendsApi } from '../lib/api';
import type { FriendEntry, FriendLists, GameInviteEntry } from '../lib/api';
import { GAMES } from '../data';
import { useAuth } from '../state/auth';
import { AuthDialog } from './AuthDialog';
import type { AuthMode } from './AuthDialog';
import { ChatBox } from './ChatBox';
import { Modal } from './Modal';
import { UserAvatar } from './UserAvatar';
import { SelfIdentity } from './SelfIdentity';

/** 好友面板打开期间的好友/邀请列表轮询间隔(邀请与新在线状态靠它可见)。 */
const LISTS_POLL_INTERVAL_MS = 20000;

/** 正在游玩的游戏上下文(仅运行页提供;主站抽屉无此上下文 → 无「邀请游玩」入口)。 */
export interface CurrentGameContext {
  slug: string;
  title: string;
  /** 游戏经 SDK 上报的可加入参数(未上报为 null,此时邀请只带游戏本身)。 */
  params: Record<string, unknown> | null;
}

/**
 * 好友面板(苹果风):顶行左侧为当前用户身份(头像可点开换头像弹窗、名称旁编辑钮改名、
 * 「ID:」+ 用户 ID 悬浮可复制),右侧为关闭钮;
 * 工具独占一行:两条横线之间填另一种底色的带状区域,左侧「好友」标题,右侧三个圆形图标钮(搜索/好友请求/添加好友)。
 * 好友请求钮是切换钮:激活时主列表显示收到的/发出的全部请求,再次点击切回好友列表;
 * 搜索点击后标题与搜索钮让位给搜索框(从中点向左右展开、A 宽度不变、叉在框内右侧),
 * 好友请求与添加好友两钮保持原位;添加好友以下滑面板呈现。
 *
 * 好友行交互(2026-11-23):双击(或键盘 Enter/Space)打开聊天框;右键(键盘 Menu/Shift+F10)
 * 弹出操作菜单——发送消息 / 邀请游玩(仅正在游玩某游戏时提供,主站抽屉不显示) / 删除好友(二次确认);
 * 固定测试用户 bot 在列表首位:只有「发送消息」,不可删除、不可被邀请。
 * 待处理的游戏邀请内联在对应好友行的右侧:文字「邀请你玩 XX」在上、接受/拒绝两钮在文字正下方;
 * 同一邀请者的多次邀请新覆盖旧(服务端 superseded + 客户端按人去重);没有独立的顶部邀请行。
 * 好友在线状态来自真实心跳(/api/presence),由服务端统一判定(自身身份区显示 ID 而非在线状态)。
 * 面板底部提供退出登录;游客态在面板内提供登录/注册入口。
 * 所有操作失败都以服务端错误文案展示,不假装成功。
 */
export function FriendsPanel({
  onClose,
  currentGame,
}: {
  onClose: () => void;
  /** 正在游玩的游戏(仅运行页;主站抽屉不传)。 */
  currentGame?: CurrentGameContext;
}) {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState<FriendLists | null>(null);
  const [input, setInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatPeer, setChatPeer] = useState<{ id: string; name: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<AuthMode | null>(null);
  const [menu, setMenu] = useState<{ entry: FriendEntry; x: number; y: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<FriendEntry | null>(null);

  const apply = useCallback(async (action: () => Promise<FriendLists>) => {
    setActionError(null);
    setBusy(true);
    try {
      setLists(await action());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '操作失败,请稍后重试');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setLists(null);
    setActionError(null);
    setChatPeer(null);
    setSearchOpen(false);
    setShowRequests(false);
    setAddOpen(false);
    setQuery('');
    setMenu(null);
    setConfirmRemove(null);
    if (status === 'user') void apply(() => friendsApi.list());
  }, [apply, status, user?.id]);

  // 面板打开期间轮询好友列表:收到的邀请、在线状态变化在面板开着时也能浮现。
  useEffect(() => {
    if (status !== 'user') return;
    const timer = window.setInterval(() => {
      if (!busy) {
        friendsApi
          .list()
          .then(setLists)
          .catch(() => {
            // 轮询失败静默,保留现有列表;下个周期重试。
          });
      }
    }, LISTS_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status, busy]);

  if (status !== 'user') {
    return (
      <div className="friends-panel">
        <header className="friends-toolbar">
          <span aria-hidden="true" />
          <div className="friends-toolbar-end">
            <button type="button" className="friend-icon-btn" aria-label="关闭弹窗" onClick={onClose}>
              <IconClose />
            </button>
          </div>
        </header>
        <div className="friends-guest">
          <p className="friends-guest-text">登录或注册后才能使用好友功能。</p>
          <div className="friends-guest-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setDialog('login')}
              title={status === 'error' ? '无法确认登录状态，可尝试重新登录' : undefined}
            >
              登录
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog('register')}>
              注册
            </button>
          </div>
        </div>
        {(dialog === 'login' || dialog === 'register') && (
          <AuthDialog mode={dialog} onClose={() => setDialog(null)} onSwitchMode={(mode) => setDialog(mode)} />
        )}
      </div>
    );
  }

  // 三个工具互斥:搜索/请求视图/添加同一时间只激活一个。
  const openSearch = () => {
    setSearchOpen(true);
    setShowRequests(false);
    setAddOpen(false);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };
  const toggleRequests = () => {
    setShowRequests((active) => !active);
    setSearchOpen(false);
    setAddOpen(false);
    setQuery('');
  };
  const toggleAdd = () => {
    setAddOpen((open) => !open);
    setSearchOpen(false);
    setShowRequests(false);
  };

  const keyword = query.trim().toLowerCase();
  const visibleFriends = lists?.friends.filter(
    (entry) => !keyword || entry.user.username.toLowerCase().includes(keyword),
  );
  // 邀请按邀请者归位到好友行(服务端已把同源旧邀请置为 superseded,这里再按人保最新兜底)。
  const inviteByFriend = new Map<string, GameInviteEntry>();
  for (const invite of lists?.invites ?? []) {
    const existing = inviteByFriend.get(invite.from.id);
    if (!existing || Date.parse(invite.createdAt) > Date.parse(existing.createdAt)) {
      inviteByFriend.set(invite.from.id, invite);
    }
  }

  const submitAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || busy) return;
    const target = input.trim();
    setInput('');
    // 面板立即切换,请求结果在主列表的请求视图中呈现(成功 → 已发出的请求;失败 → 错误文案)。
    setAddOpen(false);
    setShowRequests(true);
    void apply(() => friendsApi.sendRequest(target));
  };

  const openChat = (entry: FriendEntry) => {
    setChatPeer({ id: entry.user.id, name: entry.user.username });
  };

  const sendInvite = (entry: FriendEntry) => {
    if (!currentGame) return;
    setMenu(null);
    setActionError(null);
    setBusy(true);
    friendsApi
      .sendInvite(entry.user.id, currentGame.slug, currentGame.params)
      .then(() => {
        setStatusNote(`已向 ${entry.user.username} 发送游玩邀请`);
        window.setTimeout(() => setStatusNote(null), 3000);
      })
      .catch((err) => {
        setActionError(err instanceof Error ? err.message : '操作失败,请稍后重试');
      })
      .finally(() => setBusy(false));
  };

  const respondInvite = (invite: GameInviteEntry, accept: boolean) => {
    setActionError(null);
    setBusy(true);
    if (accept) {
      // 接受即自动入房:先标记 accepted,再进运行页(?invite= 深链)——
      // 已在本页游玩同一游戏则原地换 ?invite= 重挂 iframe(GameFrame 按 inviteId 重挂重新握手),
      // 否则新窗口打开;之后由游戏侧落主菜单自动入房,游戏内无任何邀请 UI。
      friendsApi
        .respondInvite(invite.id, true)
        .then(() => {
          if (currentGame?.slug === invite.slug) {
            navigate(`/play/${invite.slug}?invite=${encodeURIComponent(invite.id)}`);
            onClose();
            return friendsApi.list();
          }
          window.open(`/play/${invite.slug}?invite=${encodeURIComponent(invite.id)}`, '_blank', 'noopener,noreferrer');
          return friendsApi.list();
        })
        .then(setLists)
        .catch((err) => setActionError(err instanceof Error ? err.message : '操作失败,请稍后重试'))
        .finally(() => setBusy(false));
    } else {
      friendsApi
        .respondInvite(invite.id, false)
        .then(() => friendsApi.list())
        .then(setLists)
        .catch((err) => setActionError(err instanceof Error ? err.message : '操作失败,请稍后重试'))
        .finally(() => setBusy(false));
    }
  };

  return (
    <div className="friends-panel">
      <div className="friends-header">
        <header className="friends-toolbar">
          <div className="friends-self">
            <SelfIdentity
              name={lists?.me?.username ?? user?.username ?? ''}
              avatar={lists?.me?.avatar ?? user?.avatar ?? null}
              id={user?.id ?? ''}
            />
          </div>
          <div className="friends-toolbar-end">
            <button type="button" className="friend-icon-btn" aria-label="关闭弹窗" onClick={onClose}>
              <IconClose />
            </button>
          </div>
        </header>

        {/* 工具独占一行:左侧标题,右侧三个按钮;搜索时标题与搜索钮让位给搜索框,另外两个钮保持原位。 */}
        <div className="friends-toolbar-actions-row">
          {searchOpen ? (
            <form className="friends-search" onSubmit={(event) => event.preventDefault()}>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索好友"
                aria-label="搜索好友"
                maxLength={24}
                autoFocus
              />
              <button type="button" className="friend-icon-btn" aria-label="退出搜索" onClick={closeSearch}>
                <IconClose />
              </button>
            </form>
          ) : (
            <span className="friends-toolbar-title">好友</span>
          )}
          <div className="friends-toolbar-group">
            <button
              type="button"
              className={`friend-icon-btn ${searchOpen ? 'is-hidden' : ''}`}
              aria-label="搜索好友"
              aria-hidden={searchOpen}
              tabIndex={searchOpen ? -1 : 0}
              onClick={openSearch}
            >
              <IconSearch />
            </button>
            <button
              type="button"
              className="friend-icon-btn"
              aria-label="好友请求"
              aria-pressed={showRequests}
              onClick={toggleRequests}
            >
              <IconRequests />
              {lists && lists.incoming.length > 0 && (
                <span className="friend-badge" aria-hidden="true">
                  {lists.incoming.length > 9 ? '9+' : lists.incoming.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="friend-icon-btn"
              aria-label="添加好友"
              aria-expanded={addOpen}
              onClick={toggleAdd}
            >
              <IconAdd />
            </button>
          </div>
        </div>
      </div>

      {/* 添加好友面板:下滑展开 ID 输入框 + 发送按钮。 */}
      <div className={`friends-slide ${addOpen ? 'is-open' : ''}`}>
        <div className="friends-slide-inner">
          <form className="friends-add" onSubmit={submitAdd}>
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="输入对方用户 ID"
              aria-label="输入对方用户 ID 添加好友"
              maxLength={64}
              disabled={busy}
            />
            <button
              type="submit"
              className="friend-action-btn friend-action-accept"
              aria-label="发送好友请求"
              disabled={busy || !input.trim()}
            >
              <IconSend />
            </button>
          </form>
        </div>
      </div>

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {statusNote && (
        <p className="friends-status-note" role="status">
          {statusNote}
        </p>
      )}

      {!lists && !actionError && <p className="friends-empty">正在加载…</p>}

      {lists && (
        <section className="friends-main">
          {showRequests ? (
            <div className="friends-requests">
              {lists.incoming.map((entry) => (
                <div key={entry.id} className="friend-row">
                  <FriendIdentity name={entry.from.username} avatar={entry.from.avatar} online={entry.from.online} large />
                  <span className="friend-row-actions">
                    <button
                      type="button"
                      className="friend-action-btn friend-action-accept"
                      aria-label={`接受 ${entry.from.username} 的好友请求`}
                      disabled={busy}
                      onClick={() => void apply(() => friendsApi.respond(entry.id, true))}
                    >
                      <IconCheck />
                    </button>
                    <button
                      type="button"
                      className="friend-action-btn friend-action-decline"
                      aria-label={`拒绝 ${entry.from.username} 的好友请求`}
                      disabled={busy}
                      onClick={() => void apply(() => friendsApi.respond(entry.id, false))}
                    >
                      <IconClose />
                    </button>
                  </span>
                </div>
              ))}
              {lists.outgoing.map((entry) => (
                <div key={entry.id} className="friend-row">
                  <FriendIdentity name={entry.to.username} avatar={entry.to.avatar} online={entry.to.online} large />
                  <span className="friend-row-actions">
                    <span className="friend-pending">等待处理</span>
                    <button
                      type="button"
                      className="friend-action-btn friend-action-decline"
                      aria-label={`取消发给 ${entry.to.username} 的好友请求`}
                      disabled={busy}
                      onClick={() => void apply(() => friendsApi.cancel(entry.id))}
                    >
                      <IconClose />
                    </button>
                  </span>
                </div>
              ))}
              {lists.incoming.length === 0 && lists.outgoing.length === 0 && (
                <p className="friends-empty">暂无好友请求。</p>
              )}
            </div>
          ) : (
            <ul className="friends-list">
              {visibleFriends?.map((entry) => (
                <FriendRow
                  key={entry.id}
                  entry={entry}
                  invite={inviteByFriend.get(entry.user.id)}
                  busy={busy}
                  onOpenChat={openChat}
                  onRespond={respondInvite}
                  onMenu={(x, y) => setMenu({ entry, x, y })}
                />


              ))}
            </ul>
          )}
        </section>
      )}

      <div className="friends-footer">
        <button type="button" className="btn btn-secondary friends-logout" onClick={() => void logout()}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          退出登录
        </button>
      </div>

      {menu && (
        <FriendContextMenu
          entry={menu.entry}
          x={menu.x}
          y={menu.y}
          hasGameContext={Boolean(currentGame)}
          busy={busy}
          onClose={() => setMenu(null)}
          onChat={() => {
            openChat(menu.entry);
            setMenu(null);
          }}
          onInvite={() => sendInvite(menu.entry)}
          onRemove={() => {
            setConfirmRemove(menu.entry);
            setMenu(null);
          }}
        />
      )}

      {confirmRemove && (
        <Modal title="删除好友" overlayClass="confirm-overlay" onClose={() => setConfirmRemove(null)}>
          <div className="confirm-dialog">
            <p>
              确定删除好友「{confirmRemove.user.username}」吗？删除后需要重新添加。
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmRemove(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => {
                  const target = confirmRemove;
                  setConfirmRemove(null);
                  void apply(() => friendsApi.remove(target.id));
                }}
              >
                删除好友
              </button>
            </div>
          </div>
        </Modal>
      )}

      {chatPeer && (
        <Modal title={chatPeer.name} overlayClass="chat-overlay" onClose={() => setChatPeer(null)}>
          <ChatBox peerId={chatPeer.id} peerName={chatPeer.name} />
        </Modal>
      )}
    </div>
  );
}

/** 邀请行的游戏名:slug → 游戏数据标题(未知 slug 退回显示 slug 本身)。 */
function gameTitle(slug: string): string {
  return GAMES.find((game) => game.slug === slug)?.title ?? slug;
}

interface FriendRowProps {
  entry: FriendEntry;
  /** 该好友发来的待处理邀请(无则行右侧不显示邀请区)。 */
  invite?: GameInviteEntry;
  busy: boolean;
  onOpenChat: (entry: FriendEntry) => void;
  onRespond: (invite: GameInviteEntry, accept: boolean) => void;
  /** 右键/菜单键回调(菜单项集合由面板按游玩上下文决定,含删除入口的二次确认)。 */
  onMenu: (x: number, y: number) => void;
}


/**
 * 好友行:双击/Enter/Space 打开聊天框;右键或键盘菜单键弹出操作菜单。
 * bot 行只有聊天入口(菜单仅「发送消息」);普通好友菜单含删除(带二次确认)。
 * 有待处理邀请时行右侧内联邀请区:文字「邀请你玩 XX」在上、接受/拒绝两钮在文字正下方。
 */
function FriendRow({ entry, invite, busy, onOpenChat, onRespond, onMenu }: FriendRowProps) {


  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenChat(entry);
      return;
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      onMenu(rect.left, rect.bottom);
    }
  };

  return (
    <li className="friend-item">
      <button
        type="button"
        className="friend-item-btn"
        disabled={busy}
        onDoubleClick={() => onOpenChat(entry)}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu(event.clientX, event.clientY);
        }}
        onKeyDown={handleKeyDown}
        aria-haspopup="menu"
        aria-label={`好友 ${entry.user.username},双击打开聊天,右键打开操作菜单`}
        title={`${entry.user.username}(双击发消息 / 右键操作)`}
      >
        <FriendIdentity name={entry.user.username} avatar={entry.user.avatar} online={entry.user.online} large />
      </button>
      {invite && (
        <span className="friend-invite-side">
          <span className="friend-invite-text">邀请你玩 {gameTitle(invite.slug)}</span>
          <span className="friend-row-actions">
            <button
              type="button"
              className="friend-action-btn friend-action-accept"
              aria-label={`接受 ${invite.from.username} 的游玩邀请`}
              disabled={busy}
              onClick={() => onRespond(invite, true)}
            >
              <IconCheck />
            </button>
            <button
              type="button"
              className="friend-action-btn friend-action-decline"
              aria-label={`拒绝 ${invite.from.username} 的游玩邀请`}
              disabled={busy}
              onClick={() => onRespond(invite, false)}
            >
              <IconClose />
            </button>
          </span>
        </span>
      )}
      {entry.bot && <span className="friend-row-tag">测试</span>}
    </li>
  );
}

/** 好友右键操作菜单:固定定位在指针/键盘位置,点外部、Escape 或滚动即关闭。 */
function FriendContextMenu({
  entry,
  x,
  y,
  hasGameContext,
  busy,
  onClose,
  onChat,
  onInvite,
  onRemove,
}: {
  entry: FriendEntry;
  x: number;
  y: number;
  hasGameContext: boolean;
  busy: boolean;
  onClose: () => void;
  onChat: () => void;
  onInvite: () => void;
  onRemove: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstItemRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    // Escape 只关菜单不关抽屉:window 捕获先于 Modal 的 document 捕获,拦截后不再下传。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onScrollOrResize = () => onClose();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [onClose]);


  // 视口内夹取:菜单 160px 宽、每项约 40px,右/下方向各留 8px 余量。
  const left = Math.max(8, Math.min(x, window.innerWidth - 176));
  const top = Math.max(8, Math.min(y, window.innerHeight - 144));
  const items: { key: string; label: string; onClick: () => void }[] = [
    { key: 'chat', label: '发送消息', onClick: onChat },
  ];
  if (hasGameContext && !entry.bot) {
    items.push({ key: 'invite', label: '邀请游玩', onClick: onInvite });
  }
  if (!entry.bot) {
    items.push({ key: 'remove', label: '删除好友', onClick: onRemove });
  }

  return (
    <div className="friend-menu" style={{ left, top }} role="menu" aria-label={`${entry.user.username} 的操作`} ref={menuRef}>
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={index === 0 ? firstItemRef : undefined}
          type="button"
          role="menuitem"
          className={`friend-menu-item${item.key === 'remove' ? ' friend-menu-danger' : ''}`}
          disabled={busy}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 行左侧的统一身份区:圆形头像(预设或首字母)+ 名称 + 在线状态。 */
function FriendIdentity({
  name,
  avatar,
  online,
  large,
}: {
  name: string;
  avatar?: string | null;
  online?: boolean;
  large?: boolean;
}) {
  return (
    <span className="friend-identity">
      <UserAvatar user={{ username: name, avatar }} className={large ? 'friend-avatar-lg' : 'friend-avatar'} />
      <span className="friend-meta">
        <span className="friend-name">{name}</span>
        {online === undefined ? null : (
          <span className="friend-status">
            <span className={online ? 'status-dot status-online' : 'status-dot status-offline'} aria-hidden="true" />
            {online ? '在线' : '离线'}
          </span>
        )}
      </span>
    </span>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m16.2 16.2 4.3 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconRequests() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* 抬手的小人(实心):头 + 圆顶身体 + 斜向上的手臂 */}
      <circle cx="13.6" cy="6" r="3.2" fill="currentColor" />
      <path d="M7.4 20.6c0-4 2.5-6.6 5.9-6.6 3.3 0 5.8 2.6 5.8 6.6Z" fill="currentColor" />
      <path d="M9.8 14.8 5.6 9.2" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function IconAdd() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* 小人 + 右下角加号徽章(实心);徽章底色用工具条带状区底色,形成镂空叠放效果 */}
      <circle cx="10.8" cy="6" r="3.2" fill="currentColor" />
      <path d="M5.2 20.6c0-4 2.5-6.6 5.9-6.6 3.3 0 5.8 2.6 5.8 6.6Z" fill="currentColor" />
      <circle cx="17.4" cy="17.4" r="5.3" fill="#2b2b30" />
      <path
        d="M17.4 14.4v6M14.4 17.4h6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m4 11.2 16-7-7 16-2.6-6.4L4 11.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 5 5L19.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
