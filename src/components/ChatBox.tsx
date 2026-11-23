import { useEffect, useRef, useState } from 'react';
import { chatApi } from '../lib/api';
import type { ChatMessage } from '../lib/api';
import { ApiError } from '../lib/api';

interface ChatBoxProps {
  peerId: string;
  peerName: string;
}

/**
 * 与「小舟AI」的聊天框:打开时加载历史,发送后由服务端一并返回用户消息与 AI 回复;
 * 发送失败展示服务端错误文案,不假装成功。
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

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setInput('');
    try {
      const data = await chatApi.send(peerId, text);
      setMessages((prev) => [...(prev ?? []), ...data.messages]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败,请稍后重试');
      // 5xx 表示 AI 回复环节失败,用户消息已在服务端落库,本地补显避免消息凭空消失;
      // 关闭重开聊天框时会从服务端历史加载同一条消息。
      if (err instanceof ApiError && err.status >= 500) {
        setMessages((prev) => [
          ...(prev ?? []),
          { id: `local-${Date.now()}`, peer: peerId, role: 'user', content: text, createdAt: new Date().toISOString() },
        ]);
      }
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
            <div key={message.id} className={`chat-message chat-message-${message.role}`}>
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
