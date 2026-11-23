import { useCallback, useEffect, useState } from 'react';
import { friendsApi } from '../lib/api';
import type { FriendEntry, FriendLists } from '../lib/api';
import { useAuth } from '../state/auth';
import { ChatBox } from './ChatBox';
import { Modal } from './Modal';

/**
 * 好友面板(仅好友关系,无在线状态)。
 * 固定 AI 助手「小舟AI」永远在好友列表首位,不可删除,点击打开聊天框;
 * 添加好友通过对方用户 ID 搜索,需对方同意。
 * 所有操作失败都以服务端错误文案展示,不假装成功。
 */
export function FriendsPanel() {
  const { status, user } = useAuth();
  const [lists, setLists] = useState<FriendLists | null>(null);
  const [input, setInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatPeer, setChatPeer] = useState<{ id: string; name: string } | null>(null);

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
    if (status === 'user') void apply(() => friendsApi.list());
  }, [apply, status, user?.id]);

  if (status !== 'user') {
    return <p className="friends-empty">登录或注册后才能使用好友功能。</p>;
  }

  const humanFriends = lists?.friends.filter((entry) => !entry.assistant) ?? [];

  return (
    <div className="friends-panel">
      <form
        className="friends-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim()) return;
          const target = input.trim();
          setInput('');
          void apply(() => friendsApi.sendRequest(target));
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入对方用户 ID 添加好友"
          aria-label="输入对方用户 ID 添加好友"
          maxLength={64}
        />
        <button type="submit" className="btn btn-secondary" disabled={busy || !input.trim()}>
          发送请求
        </button>
      </form>
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {!lists && !actionError && <p className="friends-empty">正在加载…</p>}

      {lists && (
        <>
          <section>
            <h3 className="friends-section-title">我的好友</h3>
            <ul className="friends-list">
              {lists.friends.map((entry) => (
                <FriendRow
                  key={entry.id}
                  entry={entry}
                  busy={busy}
                  onOpenChat={setChatPeer}
                  onRemove={() => void apply(() => friendsApi.remove(entry.id))}
                />
              ))}
            </ul>
          </section>

          {lists.incoming.length > 0 && (
            <section>
              <h3 className="friends-section-title">收到的请求</h3>
              <ul className="friends-list">
                {lists.incoming.map((entry) => (
                  <li key={entry.id} className="friend-row">
                    <span>{entry.from.username}</span>
                    <span className="friend-row-actions">
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busy}
                        onClick={() => void apply(() => friendsApi.respond(entry.id, true))}
                      >
                        接受
                      </button>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busy}
                        onClick={() => void apply(() => friendsApi.respond(entry.id, false))}
                      >
                        拒绝
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lists.outgoing.length > 0 && (
            <section>
              <h3 className="friends-section-title">已发出的请求</h3>
              <ul className="friends-list">
                {lists.outgoing.map((entry) => (
                  <li key={entry.id} className="friend-row">
                    <span>{entry.to.username}</span>
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy}
                      onClick={() => void apply(() => friendsApi.cancel(entry.id))}
                    >
                      取消
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {humanFriends.length === 0 && lists.incoming.length === 0 && lists.outgoing.length === 0 && (
            <p className="friends-empty">还没有其他好友,通过上面的输入框发送好友请求吧。</p>
          )}
        </>
      )}

      {chatPeer && (
        <Modal
          title={chatPeer.name}
          overlayClass="chat-overlay"
          onClose={() => setChatPeer(null)}
        >
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
      <li className="friend-row">
        <button
          type="button"
          className="friend-open"
          onClick={() => onOpenChat({ id: entry.user.id, name: entry.user.username })}
        >
          {entry.user.username}
        </button>
      </li>
    );
  }
  return (
    <li className="friend-row">
      <span>{entry.user.username}</span>
      <button type="button" className="btn-link" disabled={busy} onClick={onRemove}>
        删除
      </button>
    </li>
  );
}
