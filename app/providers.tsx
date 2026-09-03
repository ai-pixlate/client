"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * 서버에서 가져오는 모든 데이터는 TanStack Query를 통해서만 다룹니다.
 * QueryClient는 재렌더링될 때마다 새로 생기지 않도록 useState로 한 번만 생성합니다.
 */

// 모듈 수준 플래그 — React Strict Mode의 이중 실행과 HMR 시 중복 start를 막습니다.
let mswStarted = false;

async function enableMocking() {
  if (process.env.NODE_ENV !== 'development') return;
  if (typeof window === 'undefined') return;
  if (mswStarted) return;
  mswStarted = true;

  const { worker } = await import('@/lib/msw/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

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

  useEffect(() => {
    enableMocking().catch(console.error);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
