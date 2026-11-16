import { useEffect, useRef, useState } from 'react';
import type { Game } from '../lib/types';
import type { PlatformUser } from '../lib/embed';
import { isGameMessage, sendPlatformHello } from '../lib/embed';

interface GameFrameProps {
  game: Game;
  src: string;
  /** 当前登录用户(未登录为 null),随 hello 下发给游戏。 */
  user: PlatformUser | null;
}

/**
 * 游戏承载 iframe + postMessage 窄接口。
 * 加载完成后平台先发 hello 握手；游戏侧 `game:` 消息在此统一接收，
 * 后续存档、分数上报、联机凭证下发都在这条通道上扩展。
 */
export function GameFrame({ game, src, user }: GameFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isGameMessage(event.data)) return;
      // 游戏 `(re)request hello` 信号:平台重发 hello,保证握手不受加载时序影响。
      if (event.data.t === 'game:ready') {
        const frameWindow = iframeRef.current?.contentWindow;
        if (frameWindow) sendPlatformHello(frameWindow, window.location.origin, game.slug, user);
      }
      // 其余 `game:` 消息类型随联机/存档能力逐步接入。
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [game.slug, user]);

  // 登录态在 iframe 加载后才解析完成时,向游戏重发 hello 补发最终 user
  // (游戏侧 SDK 只认首个 hello,此重发作为兜底,正常时序下无副作用)。
  useEffect(() => {
    if (!loaded) return;
    const frameWindow = iframeRef.current?.contentWindow;
    if (frameWindow) sendPlatformHello(frameWindow, window.location.origin, game.slug, user);
  }, [loaded, game.slug, user]);

  const handleLoad = () => {
    setLoaded(true);
    const frameWindow = iframeRef.current?.contentWindow;
    if (frameWindow) sendPlatformHello(frameWindow, window.location.origin, game.slug, user);
  };

  return (
    <div className="game-frame">
      {!loaded && (
        <div className="frame-loading" role="status">
          <p>正在加载游戏…</p>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title={`${game.title} 游戏画面`}
        onLoad={handleLoad}
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        allow="fullscreen"
      />
    </div>
  );
}
