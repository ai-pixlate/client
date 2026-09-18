import type { NextConfig } from "next";

// FE와 같은 오리진으로 들어오는 백엔드 API 요청을 실제 백엔드로 프록시한다.
// 프로덕션(next start)에서는 MSW가 꺼지므로, 이 rewrites 가 없으면 API 요청이
// 갈 곳이 없다. rewrites 는 afterFiles(기본)로 동작해 실제 페이지 라우트
// (예: /jobs/[jobId])와 충돌하지 않고, 페이지가 없는 API 하위경로만 프록시한다.
// 백엔드 주소는 docker 네트워크상의 컨테이너명(pixlate-api)이 기본이며,
// 빌드 시 BACKEND_ORIGIN 환경변수로 덮어쓸 수 있다.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://pixlate-api:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/auth/:path*", destination: `${BACKEND_ORIGIN}/v1/auth/:path*` },
      { source: "/consents", destination: `${BACKEND_ORIGIN}/v1/consents` },
      { source: "/brands/:path*", destination: `${BACKEND_ORIGIN}/v1/brands/:path*` },
      { source: "/master/:path*", destination: `${BACKEND_ORIGIN}/v1/master/:path*` },
      { source: "/jobs/:path*", destination: `${BACKEND_ORIGIN}/v1/jobs/:path*` },
      { source: "/library", destination: `${BACKEND_ORIGIN}/v1/library` },
    ];
  },
};

export default nextConfig;
