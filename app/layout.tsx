import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "pix/ate",
  description: "pix/ate",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/*
          pix/ate 전체 기본 폰트 = Pretendard(N1 Figma 925:2529 등 모든 화면
          text style이 Pretendard 지정). 프로젝트에 Pretendard 패키지나
          로컬 폰트 asset이 없어(package.json/공용 폰트 디렉터리 확인 완료)
          웹폰트 CDN을 쓴다 — 화면마다 각자 <link>를 넣지 않도록 root
          layout 한 곳에서만 로드한다. 실제 적용(font-family 우선순위)은
          globals.css의 body에서 한다.
        */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
