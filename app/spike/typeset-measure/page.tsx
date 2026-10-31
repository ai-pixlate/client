import { notFound } from 'next/navigation';

import { TypesetMeasureHarness } from './_components/harness';

/**
 * N5 조판 브라우저 측정 엔진(lib/n5/typeset-measurement.ts) 검증 harness.
 * e2e/n5-typeset-measurement.spec.ts 가 window.__pixlateTypeset 로 엔진을 호출한다.
 * 개발 전용 화면이며 production 빌드에서는 404 처리한다. N5 제품 화면과 연결하지 않는다.
 */
export default function Page() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  return <TypesetMeasureHarness />;
}
