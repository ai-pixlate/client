"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * 서버에서 가져오는 모든 데이터는 TanStack Query를 통해서만 다룹니다.
 * QueryClient는 재렌더링될 때마다 새로 생기지 않도록 useState로 한 번만 생성합니다.
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

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
