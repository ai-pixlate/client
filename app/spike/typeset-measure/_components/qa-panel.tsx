'use client';

import { useEffect, useMemo, useState } from 'react';

import { TypesetBlock } from '@/app/_components/typeset/typeset-block';
import {
  type TypesetFontReadiness,
  type TypesetMeasureResult,
  type TypesetMeasurer,
  openTypesetMeasurer,
} from '@/lib/n5/typeset-measurement';
import {
  type FinalOutputImageSize,
  type FinalOutputLayout,
  type TypesetEvaluation,
  buildFinalSectionOffsets,
  evaluateTypesetBlock,
} from '@/lib/n5/typeset-final-output';
import { type TypesetRenderModel, toTypesetMeasureInput } from '@/lib/n5/typeset-render-model';
import { type OverflowSides, TYPESET_COMMON } from '@/lib/n5/typeset-rules';

import { QA_BLOCKS, QA_IMAGE_WIDTH, QA_MISSING_FONT_FAMILY, QA_SECTIONS } from './qa-fixtures';

type FontState =
  | { status: 'checking' }
  | { status: 'ready'; measurer: TypesetMeasurer }
  | { status: 'failed'; fonts: Extract<TypesetFontReadiness, { ok: false }> };

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function sidesLabel(sides: OverflowSides): string {
  const list = (['left', 'right', 'top', 'bottom'] as const).filter((side) => sides[side]);
  return list.length > 0 ? list.join(', ') : 'none';
}

function rectLabel(rect: Rect | null): string {
  return rect ? `L ${rect.left} · T ${rect.top} · R ${rect.right} · B ${rect.bottom}` : '-';
}

function Overlay({ rect, className, testId }: { rect: Rect; className: string; testId: string }) {
  return (
    <div
      data-testid={testId}
      className={`pointer-events-none absolute ${className}`}
      style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }}
    />
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="break-all text-black">{value}</dd>
    </>
  );
}

function BlockReport({
  model,
  result,
  evaluation,
}: {
  model: TypesetRenderModel;
  result: TypesetMeasureResult | null;
  evaluation: TypesetEvaluation | null;
}) {
  const bbox = toTypesetMeasureInput(model).bbox;
  const measured = result?.ok ? result : null;
  return (
    <article
      data-testid={`typeset-qa-block-${model.blockId}`}
      data-state={evaluation?.finalOutputState ?? ''}
      data-failure={result && !result.ok ? result.reason : ''}
      data-font-px={measured?.fontPx ?? ''}
      data-line-count={measured?.lines.length ?? ''}
      data-block-overflow={evaluation ? sidesLabel(evaluation.blockOverflow) : ''}
      data-image-boundary={evaluation ? sidesLabel(evaluation.imageBoundaryViolation) : ''}
      data-final-y={evaluation?.finalBlockY ?? ''}
      data-dom-bounds={measured?.domBounds ? JSON.stringify(measured.domBounds) : ''}
      data-active-bbox={JSON.stringify(bbox)}
      className="border border-[#EAEAEA] p-3 text-xs"
    >
      <h3 className="mb-2 font-semibold text-black">
        #{model.blockId} · {model.role} · S{model.sectionId} · {evaluation?.finalOutputState ?? '측정 안 됨'}
      </h3>
      {result && !result.ok && <p className="mb-2 font-semibold text-[#C4320A]">측정 실패: {result.reason} — {result.detail}</p>}
      <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
        <Field label="Block overflow" value={evaluation ? sidesLabel(evaluation.blockOverflow) : '-'} />
        <Field label="Image boundary" value={evaluation ? sidesLabel(evaluation.imageBoundaryViolation) : '-'} />
        <Field label="Font px" value={measured ? String(measured.fontPx) : '-'} />
        <Field label="User scale" value={String(model.userFontScale)} />
        <Field label="Line count" value={measured ? String(measured.lines.length) : '-'} />
        <Field label="Final Y" value={evaluation?.finalBlockY != null ? String(evaluation.finalBlockY) : '-'} />
        <Field label="Active bbox" value={`x ${bbox.x} · y ${bbox.y} · w ${bbox.width} · h ${bbox.height}`} />
        <Field label="DOM bounds" value={rectLabel(measured?.domBounds ?? null)} />
        <Field label="Ink bounds" value={rectLabel(measured?.ink ?? null)} />
      </dl>
    </article>
  );
}

/**
 * 조판 QA 화면(dev 전용). 제품 UI 가 아니라 Figma 대상이 아니며, 예시 데이터로 표시·측정·평가 흐름 전체를 눈으로 확인한다.
 * 측정은 측정기의 숨은 요소에서 하고, 화면의 TypesetBlock 은 같은 typesetBlockStyle 로 그린다.
 * 측정기가 DOM 을 나눠 baseline 을 재므로 React 가 소유한 노드는 직접 재지 않는다. 두 결과가 같은지는 e2e 가 확인한다.
 */
export function TypesetQaPanel() {
  const [excludedSections, setExcludedSections] = useState<ReadonlySet<number>>(() => new Set());
  const [userFontScale, setUserFontScale] = useState(1);
  const [useAdjusted, setUseAdjusted] = useState(false);
  const [fontFamily, setFontFamily] = useState<string>(TYPESET_COMMON.fontFamily);
  const [font, setFont] = useState<FontState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    let opened: TypesetMeasurer | null = null;
    void openTypesetMeasurer({ fontFamily }).then((result) => {
      if (cancelled) {
        if (result.ok) result.measurer.dispose();
        return;
      }
      if (result.ok) {
        opened = result.measurer;
        setFont({ status: 'ready', measurer: result.measurer });
      } else {
        setFont({ status: 'failed', fonts: result.fonts });
      }
    });
    return () => {
      cancelled = true;
      opened?.dispose();
    };
  }, [fontFamily]);

  const sections = useMemo(
    () =>
      QA_SECTIONS.map((section) => ({
        ...section,
        bucket: excludedSections.has(section.id) ? ('exclude' as const) : ('include' as const),
      })),
    [excludedSections],
  );
  const ordered = useMemo(() => [...sections].sort((a, b) => a.sectionOrder - b.sectionOrder), [sections]);
  const layout: FinalOutputLayout = useMemo(() => buildFinalSectionOffsets(sections), [sections]);
  const image: FinalOutputImageSize = { width: QA_IMAGE_WIDTH, height: layout.totalHeight };

  const models = useMemo(
    () =>
      QA_BLOCKS.map((block) => ({
        ...block,
        userFontScale,
        adjustedBBox: useAdjusted ? block.adjustedBBox : null,
      })),
    [userFontScale, useAdjusted],
  );

  // 측정기는 자기 숨은 요소만 바꾸므로 화면 상태에 영향이 없다
  const measurer = font.status === 'ready' ? font.measurer : null;
  const results = useMemo(
    () => (measurer ? models.map((model) => measurer.measure(toTypesetMeasureInput(model))) : null),
    [measurer, models],
  );

  const reports = models.map((model, index) => {
    const result = results?.[index] ?? null;
    return { model, result, evaluation: result?.ok ? evaluateTypesetBlock(result, model, layout, image) : null };
  });

  // N5 화면 스택은 제외 섹션 자리도 유지한다(n5-viewport). 최종 출력 좌표와 다르다는 것을 보여주는 참고값이다
  const sectionRows = ordered.map((section, index) => ({
    section,
    screenTop: ordered.slice(0, index).reduce((sum, previous) => sum + previous.height, 0),
    finalOffset: layout.offsets.get(section.id),
  }));

  return (
    <section data-testid="typeset-qa" className="border-t border-[#EAEAEA] pt-6 text-black">
      <h2 className="text-lg font-semibold">조판 QA</h2>
      <p className="mt-1 text-sm text-gray-500">
        예시 데이터이며 API 와 연결되지 않습니다. 위 빈 영역은 자동 테스트가 쓰는 측정 영역입니다.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          User font scale
          <input
            data-testid="typeset-qa-scale"
            type="number"
            min={0.05}
            step={0.05}
            value={userFontScale}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (next > 0) setUserFontScale(next);
            }}
            className="w-20 border border-[#EAEAEA] px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2">
          <input data-testid="typeset-qa-adjusted" type="checkbox" checked={useAdjusted} onChange={(event) => setUseAdjusted(event.currentTarget.checked)} />
          #104 조정 박스 사용
        </label>
        <label className="flex items-center gap-2">
          <input
            data-testid="typeset-qa-missing-font"
            type="checkbox"
            checked={fontFamily === QA_MISSING_FONT_FAMILY}
            onChange={(event) => {
              setFont({ status: 'checking' });
              setFontFamily(event.currentTarget.checked ? QA_MISSING_FONT_FAMILY : TYPESET_COMMON.fontFamily);
            }}
          />
          없는 폰트로 측정(실패 확인)
        </label>
      </div>

      <div data-testid="typeset-qa-font" data-status={font.status} className="mt-3 text-sm font-semibold">
        {font.status === 'checking' && 'Font: 확인 중'}
        {font.status === 'ready' && 'Font: Pretendard 400 · 600 ready'}
        {font.status === 'failed' && (
          <span className="text-[#C4320A]">
            font-not-ready — 측정하지 않습니다 ({font.fonts.family}:{' '}
            <span data-testid="typeset-qa-font-missing">{font.fonts.missing.map((item) => `${item.weight} ${item.problem}`).join(', ')}</span>)
          </span>
        )}
      </div>

      <table className="mt-4 w-full max-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#EAEAEA] text-gray-500">
            <th className="py-1 font-normal">Section</th>
            <th className="py-1 font-normal">Height</th>
            <th className="py-1 font-normal">최종 출력 포함</th>
            <th className="py-1 font-normal">finalOutputOffset</th>
            <th className="py-1 font-normal">N5 화면 스택(참고)</th>
          </tr>
        </thead>
        <tbody>
          {sectionRows.map(({ section, screenTop, finalOffset }) => (
            <tr key={section.id} data-testid={`typeset-qa-section-${section.id}`} data-final-offset={finalOffset ?? ''} className="border-b border-[#EAEAEA]">
              <td className="py-1">S{section.sectionOrder}</td>
              <td className="py-1">{section.height}</td>
              <td className="py-1">
                <input
                  aria-label={`S${section.sectionOrder} 최종 출력 포함`}
                  data-testid={`typeset-qa-include-${section.id}`}
                  type="checkbox"
                  checked={section.bucket === 'include'}
                  onChange={() =>
                    setExcludedSections((current) => {
                      const next = new Set(current);
                      if (!next.delete(section.id)) next.add(section.id);
                      return next;
                    })
                  }
                />
              </td>
              <td className="py-1">{finalOffset ?? '제외'}</td>
              <td className="py-1 text-gray-500">{screenTop}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p data-testid="typeset-qa-final-height" data-height={layout.totalHeight} className="mt-2 text-sm">
        최종 이미지: {image.width} × {image.height}
      </p>

      <p className="mt-4 flex flex-wrap gap-x-4 text-xs text-gray-500">
        <span><span className="text-[#FF6A38]">━</span> bbox</span>
        <span><span className="text-[#2563EB]">┅</span> DOM bounds</span>
        <span><span className="text-[#16A34A]">━</span> ink bounds</span>
        <span><span className="text-black">━</span> 최종 이미지</span>
      </p>

      <div className="mt-2 flex items-start gap-10">
        <div
          data-testid="typeset-qa-final-image"
          className="relative shrink-0 bg-white outline outline-1 outline-black"
          style={{ width: image.width, height: image.height }}
        >
          {sectionRows.map(({ section, finalOffset }) =>
            finalOffset === undefined ? null : (
              <div
                key={section.id}
                data-testid={`typeset-qa-stack-${section.id}`}
                className="absolute left-0 w-full border-b border-dashed border-gray-300"
                style={{ top: finalOffset, height: section.height }}
              >
                <span className="absolute right-1 top-1 text-[10px] text-gray-400">S{section.sectionOrder}</span>
                {reports
                  .filter(({ model }) => model.sectionId === section.id && !model.excluded)
                  .map(({ model, result }) => {
                    const bbox = toTypesetMeasureInput(model).bbox;
                    const measured = result?.ok ? result : null;
                    return (
                      <div key={model.blockId}>
                        <TypesetBlock model={model} />
                        <Overlay
                          testId={`typeset-qa-bbox-${model.blockId}`}
                          className="outline outline-1 outline-[#FF6A38]"
                          rect={{ left: bbox.x, top: bbox.y, right: bbox.x + bbox.width, bottom: bbox.y + bbox.height }}
                        />
                        {measured?.domBounds && (
                          <Overlay testId={`typeset-qa-dom-${model.blockId}`} className="outline outline-1 outline-dashed outline-[#2563EB]" rect={measured.domBounds} />
                        )}
                        {measured?.ink && <Overlay testId={`typeset-qa-ink-${model.blockId}`} className="outline outline-1 outline-[#16A34A]" rect={measured.ink} />}
                      </div>
                    );
                  })}
              </div>
            ),
          )}
        </div>

        <div className="grid min-w-0 flex-1 gap-3">
          {reports.map(({ model, result, evaluation }) => (
            <BlockReport key={model.blockId} model={model} result={result} evaluation={evaluation} />
          ))}
        </div>
      </div>
    </section>
  );
}
