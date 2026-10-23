import { notFound } from 'next/navigation';

import { LongPagePerfHarness } from './_components/harness';

/**
 * 3일차 long-page 성능 baseline 측정 harness.
 * 개발 전용 화면이며 production 빌드에서는 404 처리한다.
 */
export default function Page() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  return <LongPagePerfHarness />;
}
