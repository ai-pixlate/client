'use client';

import { useEffect, useMemo, useState } from 'react';

import { N3HarnessView } from './n3-harness-view';
import { N5HarnessView } from './n5-harness-view';
import type { PerfManifestProduct, PerfManifestResponse } from '@/lib/perf/manifest-types';

// ─────────────────────────────────────────────────────────────────
// 3일차 long-page 성능 baseline harness — 시나리오 정의
// ─────────────────────────────────────────────────────────────────

type N3ScenarioId = 'N3-10' | 'N3-30' | 'N3-50' | 'N3-100' | 'N3-150';
type N5ScenarioId = 'N5-A' | 'N5-B' | 'N5-C';
type ScenarioId = N3ScenarioId | N5ScenarioId;

const N3_SCENARIOS: { id: N3ScenarioId; sectionCount: number }[] = [
  { id: 'N3-10', sectionCount: 10 },
  { id: 'N3-30', sectionCount: 30 },
  { id: 'N3-50', sectionCount: 50 },
  { id: 'N3-100', sectionCount: 100 },
  { id: 'N3-150', sectionCount: 150 },
];

// Case A/B/C에 사용할 제품 폴더명(alias 매핑은 완료 보고 참고: P-02=A000000139063 등)
const N5_SCENARIOS: { id: N5ScenarioId; productIds: string[]; textBlockCount: number; label: string }[] = [
  { id: 'N5-A', productIds: ['A000000139063'], textBlockCount: 30, label: 'Case A — P-02 단일 제품' },
  {
    id: 'N5-B',
    productIds: ['A000000198090', 'A000000139063', 'A000000174309'],
    textBlockCount: 90,
    label: 'Case B — P-05·P-02·P-03 (짧음/중간/긴)',
  },
  {
    id: 'N5-C',
    productIds: ['A000000128529', 'A000000139063', 'A000000174309', 'A000000186779', 'A000000198090'],
    textBlockCount: 300,
    label: 'Case C — 제품 5개 전체',
  },
];

function isN3(id: ScenarioId): id is N3ScenarioId {
  return id.startsWith('N3-');
}

// ─────────────────────────────────────────────────────────────────
// 간단한 render 시간 측정 (mount → 다음 프레임)
// 참고용 수치이며, 최종 판단은 Chrome DevTools Performance를 사용한다.
// ─────────────────────────────────────────────────────────────────

function useSimpleRenderTiming(dependencyKey: string) {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    setMs(null);
    const markStart = `perf-harness-start-${dependencyKey}`;
    const markEnd = `perf-harness-end-${dependencyKey}`;
    performance.mark(markStart);

    const raf = requestAnimationFrame(() => {
      performance.mark(markEnd);
      try {
        const measure = performance.measure(
          `perf-harness-${dependencyKey}`,
          markStart,
          markEnd,
        );
        setMs(measure.duration);
      } catch {
        // measure 실패는 참고 수치이므로 무시
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [dependencyKey]);

  return ms;
}

function useDomCounts(dependencyKey: string) {
  const [counts, setCounts] = useState<{ img: number; textarea: number } | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setCounts({
        img: document.querySelectorAll('img').length,
        textarea: document.querySelectorAll('textarea').length,
      });
    });
    return () => cancelAnimationFrame(raf);
    // dependencyKey가 바뀔 때마다(=scenario 전환) 재측정
  }, [dependencyKey]);

  return counts;
}

export function LongPagePerfHarness() {
  const [scenario, setScenario] = useState<ScenarioId>('N3-10');
  const [manifest, setManifest] = useState<PerfManifestProduct[] | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/dev/perf-assets')
      .then((res) => {
        if (!res.ok) throw new Error(`manifest 응답 오류: ${res.status}`);
        return res.json() as Promise<PerfManifestResponse>;
      })
      .then((data) => {
        if (!cancelled) setManifest(data.products);
      })
      .catch((err) => {
        if (!cancelled) setManifestError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const renderMs = useSimpleRenderTiming(scenario);
  const domCounts = useDomCounts(scenario);

  const n5Scenario = N5_SCENARIOS.find((s) => s.id === scenario);
  const n5Products = useMemo(() => {
    if (!manifest || !n5Scenario) return [];
    const byId = new Map(manifest.map((p) => [p.id, p]));
    return n5Scenario.productIds
      .map((id) => byId.get(id))
      .filter((p): p is PerfManifestProduct => Boolean(p));
  }, [manifest, n5Scenario]);

  const n5Stats = useMemo(() => {
    if (!n5Products.length) return null;
    return {
      productCount: n5Products.length,
      imageCount: n5Products.reduce((sum, p) => sum + p.images.length, 0),
      totalHeight: n5Products.reduce((sum, p) => sum + p.totalHeight, 0),
      totalBytes: n5Products.reduce((sum, p) => sum + p.totalSizeBytes, 0),
    };
  }, [n5Products]);

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      {/* 상단: 시나리오 선택 + baseline 정보 */}
      <header className="shrink-0 space-y-3 border-b bg-white px-6 py-4">
        <div>
          <h1 className="text-sm font-bold text-gray-800">
            long-page 성능 baseline harness (dev 전용 / 회색 박스 수준)
          </h1>
          <p className="text-xs text-gray-400">
            production에서는 접근 불가. 최적화(virtualization/lazy loading/memo 등) 미적용 baseline 측정용.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-wrap gap-1.5">
            <span className="mr-1 self-center text-xs font-medium text-gray-500">N3:</span>
            {N3_SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScenario(s.id)}
                className={`rounded border px-2.5 py-1 text-xs font-medium ${
                  scenario === s.id
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-300 bg-white text-gray-600'
                }`}
              >
                {s.id}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="mr-1 self-center text-xs font-medium text-gray-500">N5:</span>
            {N5_SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScenario(s.id)}
                className={`rounded border px-2.5 py-1 text-xs font-medium ${
                  scenario === s.id
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-300 bg-white text-gray-600'
                }`}
              >
                {s.id}
              </button>
            ))}
          </div>
        </div>

        {/* baseline 정보 표시 */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <span>
            시나리오: <b className="text-gray-800">{scenario}</b>
          </span>
          {isN3(scenario) ? (
            <span>
              section count:{' '}
              <b className="text-gray-800">
                {N3_SCENARIOS.find((s) => s.id === scenario)?.sectionCount}
              </b>
            </span>
          ) : n5Stats ? (
            <>
              <span>
                product count: <b className="text-gray-800">{n5Stats.productCount}</b>
              </span>
              <span>
                image count: <b className="text-gray-800">{n5Stats.imageCount}</b>
              </span>
              <span>
                total image height:{' '}
                <b className="text-gray-800">{n5Stats.totalHeight.toLocaleString()}px</b>
              </span>
              <span>
                total image bytes:{' '}
                <b className="text-gray-800">{(n5Stats.totalBytes / 1024 / 1024).toFixed(2)}MB</b>
              </span>
              <span>
                textBlock count:{' '}
                <b className="text-gray-800">{n5Scenario?.textBlockCount}</b>
              </span>
            </>
          ) : (
            <span className="text-gray-400">manifest 로딩 중...</span>
          )}
          <span>
            document img count: <b className="text-gray-800">{domCounts?.img ?? '측정 중...'}</b>
          </span>
          <span>
            document textarea count:{' '}
            <b className="text-gray-800">{domCounts?.textarea ?? '측정 중...'}</b>
          </span>
          <span>
            mount→paint (참고값):{' '}
            <b className="text-gray-800">{renderMs != null ? `${renderMs.toFixed(1)}ms` : '측정 중...'}</b>
          </span>
        </div>

        {manifestError && (
          <p className="text-xs text-red-500">manifest 로드 실패: {manifestError}</p>
        )}

        {/* 수동 측정 안내 */}
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer font-medium text-gray-600">
            Chrome DevTools 수동 측정 안내
          </summary>
          <ol className="mt-1 list-inside list-decimal space-y-0.5 pl-1">
            <li>새로고침</li>
            <li>Performance 탭에서 recording 시작</li>
            <li>페이지 처음부터 끝까지 스크롤</li>
            <li>recording 종료</li>
            <li>Memory 탭에서 heap 확인</li>
            <li>textarea 입력 시 React Profiler로 재렌더 범위 확인</li>
          </ol>
        </details>
      </header>

      {/* 본문: 시나리오별 harness */}
      <div className="flex flex-1 overflow-hidden">
        {isN3(scenario) ? (
          <div className="flex-1 overflow-y-auto">
            <N3HarnessView
              key={scenario}
              sectionCount={N3_SCENARIOS.find((s) => s.id === scenario)!.sectionCount}
            />
          </div>
        ) : manifest ? (
          <N5HarnessView key={scenario} products={n5Products} textBlockCount={n5Scenario!.textBlockCount} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {manifestError ? 'manifest를 불러오지 못했습니다.' : '성능 자산 manifest를 불러오는 중...'}
          </div>
        )}
      </div>
    </div>
  );
}
