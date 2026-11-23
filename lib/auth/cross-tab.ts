import { AUTH_CHANNEL_NAME } from './constants.ts';

/**
 * 탭 사이 인증 알림. BroadcastChannel 로 사건 종류와 최소 식별자(sellerId)만 보낸다.
 * access token·refresh token 은 싣지 않는다 — 받은 탭은 자기 refresh 로 토큰을 받는다.
 * 보내는 값은 toWireEvent 가 허용한 필드만 새로 만들어 담으므로, 호출부가 다른 필드를 넘겨도 채널로 나가지 않는다.
 */
export type AuthTabEvent =
  | { type: 'login-complete'; sellerId: number }
  | { type: 'refresh-complete' }
  | { type: 'account-changed'; sellerId: number }
  | { type: 'logout' };

export type AuthTabEventType = AuthTabEvent['type'];

/** 채널 구현 최소 형태(브라우저 BroadcastChannel 과 같다). 검증 스크립트가 대역을 넣는다 */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface AuthChannel {
  post(event: AuthTabEvent): void;
  subscribe(listener: (event: AuthTabEvent) => void): () => void;
  /** type 알림을 timeoutMs 동안 기다린다. 받으면 true, 시간이 지나면 false */
  waitFor(type: AuthTabEventType, timeoutMs: number): Promise<boolean>;
  close(): void;
}

export function toWireEvent(event: AuthTabEvent): AuthTabEvent {
  switch (event.type) {
    case 'login-complete':
    case 'account-changed':
      return { type: event.type, sellerId: event.sellerId };
    case 'refresh-complete':
    case 'logout':
      return { type: event.type };
  }
}

export function parseWireEvent(data: unknown): AuthTabEvent | null {
  if (!data || typeof data !== 'object') return null;
  const { type, sellerId } = data as { type?: unknown; sellerId?: unknown };
  if (type === 'refresh-complete' || type === 'logout') return { type };
  if ((type === 'login-complete' || type === 'account-changed') && typeof sellerId === 'number') return { type, sellerId };
  return null;
}

export function createAuthChannel(factory: (() => ChannelLike | null) | null = defaultChannelFactory): AuthChannel {
  const channel = factory ? factory() : null;
  const listeners = new Set<(event: AuthTabEvent) => void>();

  const onMessage = (message: { data: unknown }) => {
    const event = parseWireEvent(message.data);
    if (event) listeners.forEach((listener) => listener(event));
  };
  channel?.addEventListener('message', onMessage);

  const subscribe = (listener: (event: AuthTabEvent) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    post(event) {
      channel?.postMessage(toWireEvent(event));
    },
    subscribe,
    waitFor(type, timeoutMs) {
      return new Promise<boolean>((resolve) => {
        let unsubscribe = () => {};
        const timer = setTimeout(() => {
          unsubscribe();
          resolve(false);
        }, timeoutMs);
        unsubscribe = subscribe((event) => {
          if (event.type !== type) return;
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        });
      });
    },
    close() {
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      listeners.clear();
    },
  };
}

/** BroadcastChannel 이 없는 환경(SSR·구형 브라우저)에서는 알림 없이 동작한다 — 기다리는 쪽은 시간 초과로 넘어간다 */
function defaultChannelFactory(): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(AUTH_CHANNEL_NAME) as unknown as ChannelLike;
}
