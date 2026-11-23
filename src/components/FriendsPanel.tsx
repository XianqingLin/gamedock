import { useCallback, useEffect, useState } from 'react';
import { friendsApi } from '../lib/api';
import type { FriendEntry, FriendLists } from '../lib/api';
import { useAuth } from '../state/auth';
import { AuthDialog } from './AuthDialog';
import type { AuthMode } from './AuthDialog';
import { ChatBox } from './ChatBox';
import { Modal } from './Modal';
import { UserAvatar } from './UserAvatar';
import { SelfIdentity } from './SelfIdentity';

/**
 * 好友面板(苹果风):顶行左侧为当前用户身份(头像可点开换头像弹窗、名称旁编辑钮改名、
 * 「ID:」+ 用户 ID 悬浮可复制),右侧为关闭钮;
 * 工具独占一行:两条横线之间填另一种底色的带状区域,左侧「好友」标题,右侧三个圆形图标钮(搜索/好友请求/添加好友)。
 * 好友请求钮是切换钮:激活时主列表显示收到的/发出的全部请求,再次点击切回好友列表;
 * 搜索点击后标题与搜索钮让位给搜索框(从中点向左右展开、A 宽度不变、叉在框内右侧),
 * 好友请求与添加好友两钮保持原位;添加好友以下滑面板呈现。
 * 固定 AI 助手「小舟AI」永远在好友列表首位,不可删除,点击打开聊天框;
 * 好友在线状态来自真实心跳(/api/presence),由服务端统一判定(自身身份区显示 ID 而非在线状态)。
 * 面板底部提供退出登录;游客态在面板内提供登录/注册入口。
 * 所有操作失败都以服务端错误文案展示,不假装成功。
 */
export function FriendsPanel({ onClose }: { onClose: () => void }) {
  const { status, user, logout } = useAuth();
  const [lists, setLists] = useState<FriendLists | null>(null);
  const [input, setInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatPeer, setChatPeer] = useState<{ id: string; name: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<AuthMode | null>(null);

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
    if (status === 'user') void apply(() => friendsApi.list());
  }, [apply, status, user?.id]);

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
                  busy={busy}
                  onOpenChat={setChatPeer}
                  onRemove={() => void apply(() => friendsApi.remove(entry.id))}
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

      {chatPeer && (
        <Modal title={chatPeer.name} overlayClass="chat-overlay" onClose={() => setChatPeer(null)}>
          <ChatBox peerId={chatPeer.id} peerName={chatPeer.name} />
        </Modal>
      )}
    </div>
  );
}

interface FriendRowProps {
  entry: FriendEntry;
  busy: boolean;
  onOpenChat: (peer: { id: string; name: string }) => void;
  onRemove: () => void;
}

function FriendRow({ entry, busy, onOpenChat, onRemove }: FriendRowProps) {
  if (entry.assistant) {
    return (
      <li className="friend-item">
        <button
          type="button"
          className="friend-item-btn"
          onClick={() => onOpenChat({ id: entry.user.id, name: entry.user.username })}
        >
          <FriendIdentity name={entry.user.username} avatar={entry.user.avatar} online={entry.user.online} large />
        </button>
      </li>
    );
  }
  return (
    <li className="friend-item">
      <FriendIdentity name={entry.user.username} avatar={entry.user.avatar} online={entry.user.online} large />
      <button type="button" className="btn-link" disabled={busy} onClick={onRemove}>
        删除
      </button>
    </li>
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
        <span className="friend-status">
          <span className={online ? 'status-dot status-online' : 'status-dot status-offline'} aria-hidden="true" />
          {online ? '在线' : '离线'}
        </span>
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
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 19c.5-4 2.3-6 5.5-6s5 2 5.5 6M16 5.5a3 3 0 0 1 0 5.8M17 13.5c2.2.5 3.3 2.3 3.5 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAdd() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
