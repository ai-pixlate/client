"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ensureBackendSession, isApiMockingEnabled } from "@/lib/api/session";

/**
 * 서버에서 가져오는 모든 데이터는 TanStack Query를 통해서만 다룹니다.
 * QueryClient는 재렌더링될 때마다 새로 생기지 않도록 useState로 한 번만 생성합니다.
 */

// 모듈 수준 Promise 캐시 — React Strict Mode의 이중 실행과 HMR 재마운트 시
// worker.start()를 중복 호출하지 않고, 이미 시작된 경우 같은 Promise를 재사용합니다.
let mswReadyPromise: Promise<void> | null = null;

function enableMocking(): Promise<void> {
  // MSW on/off 기준은 NODE_ENV가 아니라 NEXT_PUBLIC_API_MOCKING 하나다
  // (lib/api/session.ts의 isApiMockingEnabled()가 SSOT) — 아래 useEffect의
  // ensureBackendSession 분기와 lib/api/pixlate.ts의 인증 처리도 이미 같은
  // 기준을 쓴다. NODE_ENV로 판단하면 배포 환경에서 이 값을 'enabled'로 둬도
  // worker가 아예 시작되지 않으면서 인증 흐름은 이미 "mock이니 건너뛴다"고
  // 판단해 버려, 실제로는 아무도 요청을 가로채지 않는데 인증 토큰도 없이
  // 백엔드로 나가는 상태가 생긴다.
  if (!isApiMockingEnabled()) return Promise.resolve();
  if (typeof window === 'undefined') return Promise.resolve();
  if (mswReadyPromise) return mswReadyPromise;

  mswReadyPromise = (async () => {
    const { worker } = await import('@/lib/msw/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  })();
  return mswReadyPromise;
}

/**
 * 5단계 — `/api/jobs/.../status` 404 원인 조사 결과 반영.
 *
 * MSW는 Service Worker 등록이 끝나야 요청을 가로챌 수 있는데, enableMocking()을
 * useEffect(마운트 "이후")에서 비동기로 실행하는 동안 children(페이지 트리)은
 * 이미 렌더돼 있어 useQuery가 그 등록 완료 전에 fetch를 먼저 쏠 수 있다 — 그
 * 첫 요청은 MSW가 아니라 실제 Next dev 서버로 가서(해당 API 라우트가 없으므로)
 * 진짜 404가 난다. 이후 요청은 MSW가 이미 붙어 있어 정상 응답한다 — 그래서
 * 페이지 진입마다 딱 한 번만 보이는 404였다. N5뿐 아니라 가장 먼저 데이터를
 * 요청하는 화면이면 어디서든 같은 방식으로 재현될 수 있는 문제라(N2/N3/N4/N6
 * 공용 useJobStatusQuery가 진입 직후 첫 요청을 보낸다), 이 파일(공용 Providers)
 * 하나만 고치면 전체가 해결된다 — 개별 화면의 polling 로직은 건드리지 않는다.
 * mockingReady === false인 동안 children을 아예 마운트하지 않아 그 어떤 쿼리도
 * MSW 등록 전에 나가지 못하게 한다. isApiMockingEnabled()가 false면
 * enableMocking()이 즉시 resolve하므로 지연 자체가 거의 없다.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 실패 시 무한 재시도로 화면이 계속 로딩 상태에 머무는 것을 방지
            retry: 1,
            staleTime: 60 * 1000,
          },
        },
      }),
  );

  const [mockingReady, setMockingReady] = useState(false);

  // enableMocking()은 module-level Promise를 캐시해 두므로 여러 번(HMR 재마운트
  // 등) 불려도 안전하다 — 그래서 이 effect는 의존성 없이 마운트 시 한 번만
  // 실행하면 된다. 실백엔드 모드에서는 그 직후 개발용 JWT를 받아 둔다.
  useEffect(() => {
    enableMocking()
      .then(() => (isApiMockingEnabled() ? Promise.resolve() : ensureBackendSession()))
      .then(() => setMockingReady(true))
      .catch((err) => {
        console.error(err);
        setMockingReady(true); // 실패해도 앱이 영구히 빈 화면에 머물지 않게 한다
      });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {mockingReady ? children : null}
    </QueryClientProvider>
  );
}
