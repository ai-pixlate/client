import type { NextConfig } from "next";

// FE와 같은 오리진으로 들어오는 백엔드 API 요청을 실제 백엔드로 프록시한다.
// 프로덕션(next start)에서는 MSW가 꺼지므로, 이 rewrites 가 없으면 API 요청이
// 갈 곳이 없다. 백엔드 주소는 docker 네트워크상의 컨테이너명(pixate-api)이
// 기본이며, 빌드 시 BACKEND_ORIGIN 환경변수로 덮어쓸 수 있다.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://pixate-api:8000";

// rewrites()가 배열을 반환하면 Next.js는 이를 afterFiles로 취급하는데,
// afterFiles는 "비동적(non-dynamic) 페이지"보다는 뒤지만 "동적 라우트"보다는
// 앞에서 매칭된다(Next 공식 문서 rewrites.md 확인). /jobs/new(비동적)는
// 안 걸리지만 /jobs/[jobId](동적 페이지 라우트)는 afterFiles 시점엔 아직
// 확인되지 않은 상태라 이 규칙에 먼저 잡혀 그대로 백엔드로 프록시되어
// 버렸다 — 실제로 pixate-api가 해석되지 않는 로컬 환경에서 N2~N6 진입이
// 전부 500이 나는 걸로 재현·확인했다(조사: fix/jobs-rewrite-conflict-investigation).
//
// /jobs/{jobId}는 페이지 라우트와 API(getJob 등)가 완전히 같은 경로를
// 공유해서, 경로 패턴만으로는 "이게 페이지 navigation인지 API fetch인지"
// 구분할 수 없다. 그래서 이 앱의 API 요청에만 lib/api/pixate.ts의
// apiFetch/withProxyHeader가 내부 식별 헤더(API_PROXY_HEADER)를 붙이고,
// 이 rewrite는 그 헤더가 있을 때만 매칭되게 한다 — 브라우저가 보내는 페이지
// navigation 요청에는 이 헤더가 있을 수 없으므로 rewrite를 타지 않고
// 그대로 app/jobs/[jobId]/page.tsx로 간다.
//
// auth/consents/brands/master/library 하위엔 대응하는 Next 페이지 라우트가
// 없어(app/ 디렉터리에 해당 세그먼트 페이지 없음) 이 충돌 자체가 없다 —
// 그 규칙들은 그대로 두고 /jobs만 고친다(불필요한 범위 확장 금지).
const API_PROXY_HEADER = "x-pixate-api-proxy";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/auth/:path*", destination: `${BACKEND_ORIGIN}/v1/auth/:path*` },
      { source: "/consents", destination: `${BACKEND_ORIGIN}/v1/consents` },
      { source: "/brands/:path*", destination: `${BACKEND_ORIGIN}/v1/brands/:path*` },
      { source: "/master/:path*", destination: `${BACKEND_ORIGIN}/v1/master/:path*` },
      {
        source: "/jobs/:path*",
        has: [{ type: "header", key: API_PROXY_HEADER }],
        destination: `${BACKEND_ORIGIN}/v1/jobs/:path*`,
      },
      { source: "/library", destination: `${BACKEND_ORIGIN}/v1/library` },
    ];
  },
};

export default nextConfig;
