'use client';

import { useEffect, useRef } from 'react';

import {
  type OpenTypesetMeasurerResult,
  type TypesetMeasureInput,
  type TypesetMeasureResult,
  type TypesetMeasurer,
  checkTypesetFontReady,
  openTypesetMeasurer,
} from '@/lib/n5/typeset-measurement';

export interface TypesetHarnessApi {
  fontReadiness: typeof checkTypesetFontReady;
  /** 측정기를 열지 못하면 실패 결과를 그대로 돌려준다(폰트 미준비 경로 검증용 family 지정 가능) */
  open(fontFamily?: string): Promise<Exclude<OpenTypesetMeasurerResult, { ok: true }> | { ok: true }>;
  /** 보이는 1:1 host 에 그리고 잰다. 그린 블록은 다음 measure 까지 남아 촬영할 수 있다 */
  measure(input: TypesetMeasureInput): TypesetMeasureResult;
}

declare global {
  interface Window {
    __pixlateTypeset?: TypesetHarnessApi;
  }
}

/** harness 전용 — 측정 결과와 실제 픽셀을 비교할 수 있도록 host 를 화면에 1:1 로 보여준다 */
export function TypesetMeasureHarness() {
  const hostRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let measurer: TypesetMeasurer | null = null;
    window.__pixlateTypeset = {
      fontReadiness: checkTypesetFontReady,
      async open(fontFamily) {
        measurer?.dispose();
        measurer = null;
        const opened = await openTypesetMeasurer({ host: hostRef.current!, fontFamily });
        if (!opened.ok) return opened;
        measurer = opened.measurer;
        return { ok: true };
      },
      measure(input) {
        if (!measurer) return { ok: false, reason: 'measurer-disposed', detail: 'open() 먼저 호출' };
        return measurer.measure(input);
      },
    };
    // 준비 표시는 DOM 에 직접 둔다(spec 이 data-ready 를 기다린다)
    statusRef.current!.dataset.ready = 'true';
    return () => {
      measurer?.dispose();
      delete window.__pixlateTypeset;
    };
  }, []);

  return (
    <main className="p-10">
      <p ref={statusRef} className="mb-6 text-sm text-gray-500" data-testid="typeset-harness-status">
        조판 측정 harness(dev 전용)
      </p>
      <div ref={hostRef} data-testid="typeset-host" className="bg-white" />
    </main>
  );
}
