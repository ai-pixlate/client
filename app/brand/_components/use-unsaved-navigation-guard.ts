'use client';

import { useEffect, useRef } from 'react';

export type BlockedNavigation = { kind: 'href'; href: string } | { kind: 'history-back' };

/**
 * 미저장 변경이 있는 동안 화면 이탈을 막는다. App Router에는 이동 전 이벤트가 없어 두 경로를 직접 잡는다.
 *
 * - 내부 링크: document capture 단계에서 같은 출처 <a> 클릭을 막는다. next/link의 클릭 처리보다 먼저
 *   돌기 때문에 GNB처럼 화면 밖에 있는 링크도 각각 연결할 필요가 없다.
 * - 브라우저 뒤로가기: dirty가 되면 같은 URL의 history 항목을 하나 더 쌓아 두고, popstate가 오면 다시 쌓는다.
 *   history.state를 그대로 넘기므로 Next 라우터의 route 전환이 일어나지 않는다.
 *
 * 탭 닫기·새로고침은 막지 않는다(이번 범위 밖).
 * onBlocked는 안정된 참조로 넘긴다.
 */
export function useUnsavedNavigationGuard(dirty: boolean, onBlocked: (navigation: BlockedNavigation) => void) {
  const hasGuardEntry = useRef(false);

  // cleanup에서 history를 건드리지 않는다 — 언마운트 시점의 history.back()은 진행 중인 이동을 되돌린다.
  useEffect(() => {
    if (dirty && !hasGuardEntry.current) {
      window.history.pushState(window.history.state, '', window.location.href);
      hasGuardEntry.current = true;
    } else if (!dirty && hasGuardEntry.current) {
      // 저장·취소로 깨끗해지면 쌓아 둔 항목을 걷어, 뒤로가기를 두 번 누르지 않게 한다.
      hasGuardEntry.current = false;
      window.history.back();
    }
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;

    const onPopState = () => {
      window.history.pushState(window.history.state, '', window.location.href);
      onBlocked({ kind: 'history-back' });
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      onBlocked({ kind: 'href', href: `${url.pathname}${url.search}${url.hash}` });
    };

    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, onBlocked]);

  /** 변경을 버리고 나갈 때 — 쌓아 둔 항목은 이동이 소비하므로 걷어내지 않게 표시한다. */
  return {
    release: () => {
      hasGuardEntry.current = false;
    },
  };
}
