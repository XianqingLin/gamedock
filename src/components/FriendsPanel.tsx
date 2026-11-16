import { useCallback, useEffect, useState } from 'react';
import { friendsApi } from '../lib/api';
import type { FriendLists } from '../lib/api';
import { Modal } from './Modal';

interface FriendsPanelProps {
  onClose: () => void;
}

/**
 * 好友面板(首版:仅好友关系,无在线状态;presence 待联机中转上线后接入)。
 * 所有操作失败都以服务端错误文案展示,不假装成功。
 */
export function FriendsPanel({ onClose }: FriendsPanelProps) {
  const [lists, setLists] = useState<FriendLists | null>(null);
  const [input, setInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    void apply(() => friendsApi.list());
  }, [apply]);

  const hasError = actionError;

  return (
    <Modal title="好友" onClose={onClose}>
      <div className="friends-panel">
        <form
          className="friends-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!input.trim()) return;
            const target = input;
            setInput('');
            void apply(() => friendsApi.sendRequest(target));
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入用户名添加好友"
            aria-label="输入用户名添加好友"
            maxLength={24}
          />
          <button type="submit" className="btn btn-secondary" disabled={busy || !input.trim()}>
            发送请求
          </button>
        </form>
        {hasError && (
          <p className="form-error" role="alert">
            {hasError}
          </p>
        )}

        {!lists && !hasError && <p className="friends-empty">正在加载…</p>}

        {lists && (
          <>
            {lists.friends.length > 0 && (
              <section>
                <h3 className="friends-section-title">我的好友</h3>
                <ul className="friends-list">
                  {lists.friends.map((entry) => (
                    <li key={entry.id} className="friend-row">
                      <span>{entry.user.username}</span>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busy}
                        onClick={() => void apply(() => friendsApi.remove(entry.id))}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

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

            {lists.friends.length === 0 &&
              lists.incoming.length === 0 &&
              lists.outgoing.length === 0 && (
                <p className="friends-empty">还没有好友。通过上面的输入框发送好友请求吧。</p>
              )}
          </>
        )}
      </div>
    </Modal>
  );
}
