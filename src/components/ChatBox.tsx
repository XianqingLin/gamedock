import { useEffect, useRef, useState } from 'react';
import { chatApi } from '../lib/api';
import type { ChatMessage } from '../lib/api';

interface ChatBoxProps {
  peerId: string;
  peerName: string;
}

/** 聊天历史轮询间隔:好友间聊天无推送,打开期间靠轮询收对方的新消息。 */
const POLL_INTERVAL_MS = 4000;

/**
 * 好友间聊天框(测试用户 bot 由服务端自动回复):打开时加载历史,发送后服务端
 * 返回本端消息(bot 会话还带自动回复);打开期间轮询历史,收到对方新消息即上屏。
 * 发送失败展示服务端错误文案,不假装成功;输入内容在成功前不清空。
 */
export function ChatBox({ peerId, peerName }: ChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setError(null);
    chatApi
      .history(peerId)
      .then((data) => {
        if (!cancelled) setMessages(data.messages);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '聊天记录加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [peerId]);

  // 打开期间轮询:拉取服务端最新历史(整表刷新,消息量 ≤100,替换渲染)。
  useEffect(() => {
    if (messages === null) return;
    const timer = window.setInterval(() => {
      chatApi
        .history(peerId)
        .then((data) => setMessages(data.messages))
        .catch(() => {
          // 轮询失败静默:下个周期重试,不打断输入中的用户。
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [peerId, messages === null]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    try {
      const data = await chatApi.send(peerId, text);
      setInput('');
      setMessages((prev) => {
        const known = new Set((prev ?? []).map((m) => m.id));
        return [...(prev ?? []), ...data.messages.filter((m) => !known.has(m.id))];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败,请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-box">
      <div className="chat-messages" ref={listRef}>
        {messages === null && !error ? (
          <p className="chat-status">正在加载…</p>
        ) : messages?.length === 0 ? (
          <p className="chat-status">和{peerName}打个招呼吧。</p>
        ) : (
          messages?.map((message) => (
            <div key={message.id} className={`chat-message chat-message-${message.mine ? 'mine' : 'their'}`}>
              <p>{message.content}</p>
            </div>
          ))
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={`发消息给${peerName}`}
          aria-label={`发消息给${peerName}`}
          maxLength={2000}
          disabled={busy}
          data-autofocus
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}
