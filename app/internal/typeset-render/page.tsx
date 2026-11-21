import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { isInternalRenderRequestAllowed } from '@/lib/internal-render/access';

import { RenderHost } from './_components/render-host';

export const metadata: Metadata = {
  title: 'pix/ate internal render',
  robots: { index: false, follow: false },
};

/**
 * BE 렌더러 전용 내부 경로 — N6 최종 이미지를 N5 와 같은 FE HTML/CSS 조판 코드로 만든다.
 * proxy.ts 가 먼저 차단하지만, matcher 가 바뀌어도 열리지 않도록 여기서도 같은 판정을 한다.
 * 사용자 화면·N5/N6 화면과 연결하지 않는다. 사용법은 render-host.tsx 주석을 본다.
 */
export default async function Page() {
  if (!isInternalRenderRequestAllowed(await headers())) notFound();
  return <RenderHost />;
}
