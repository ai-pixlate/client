'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { TypesetBlock } from '@/app/_components/typeset/typeset-block';
import type { ApiPreviewRenderBlock } from '@/lib/api/n5-schema';
import { apiBboxToBoundingBox } from '@/lib/n5/adapter';
import { toTypesetServerStyle } from '@/lib/n5/preview-state';
import {
  type TypesetFontReadiness,
  type TypesetMeasureSuccess,
  type TypesetMeasurer,
  checkTypesetFontReady,
  openTypesetMeasurer,
} from '@/lib/n5/typeset-measurement';
import { toTypesetMeasureInput, type TypesetRenderModel } from '@/lib/n5/typeset-render-model';

/**
 * 내부 렌더 host — BE 렌더러(headless Chromium)가 N6 최종 섹션 이미지를 N5 와 같은 조판 코드로 만든다.
 *
 *   window.__pixlateRender.render({ sectionId, width, height, backgroundUrl, blocks })
 *     blocks[] = /preview renderInput.blocks[] 그대로(blockId·revision·text·box{x,y,w,h}·style 8키)
 *   → toTypesetServerStyle(N5 와 같은 style 검증·변환) → TypesetRenderModel(N5 local-typeset 과 같은 필드)
 *   → TypesetBlock 으로 [data-render-section] 안에 그림 + openTypesetMeasurer().measure() 로 같은 입력을 잰다.
 *
 * 줄바꿈·측정 로직을 새로 만들지 않는다. N5 편집·저장 경로와는 독립이다(세션 초안이 없으므로 renderInput 값만 쓴다).
 * 성공 응답을 받은 뒤에만 [data-render-section] 을 촬영한다. 실패하면 섹션을 지워 이전 섹션이 촬영되지 않게 한다.
 * 한 번에 한 요청만 처리한다 — 진행 중에 들어온 요청은 busy 로 돌려준다(섹션끼리 섞이지 않게).
 */

export type InternalRenderFailureReason =
  | 'busy'
  | 'invalid-input'
  | 'style-invalid'
  | 'background-failed'
  | 'font-not-ready'
  | 'measurer-failed';

export interface InternalRenderInput {
  sectionId: number;
  width: number;
  height: number;
  backgroundUrl: string;
  blocks: ApiPreviewRenderBlock[];
}

export interface InternalRenderBlockResult {
  blockId: number;
  measure: TypesetMeasureSuccess;
  /** 같은 규칙으로 줄바꿈한 글 전체 높이(원본 px, measureTextHeight). 글이 비어 있으면 null */
  textHeightPx: number | null;
}

export type InternalRenderResult =
  | { ok: true; fonts: TypesetFontReadiness[]; blocks: InternalRenderBlockResult[]; ms: number }
  | { ok: false; reason: InternalRenderFailureReason; detail: string };

export interface InternalRenderApi {
  render(input: unknown): Promise<InternalRenderResult>;
}

declare global {
  interface Window {
    __pixlateRender?: InternalRenderApi;
  }
}

interface SectionJob {
  requestId: number;
  sectionId: number;
  width: number;
  height: number;
  backgroundUrl: string;
  models: TypesetRenderModel[];
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPositive = (value: unknown): value is number => isFiniteNumber(value) && value > 0;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 입력 형식만 확인한다. style 값 검증은 N5 와 같은 toTypesetServerStyle 이 한다 */
function validateInput(raw: unknown): { ok: true; input: InternalRenderInput } | { ok: false; detail: string } {
  if (!isObject(raw)) return { ok: false, detail: 'input 이 객체가 아니다' };
  const { sectionId, width, height, backgroundUrl, blocks } = raw;
  if (!Number.isSafeInteger(sectionId)) return { ok: false, detail: `sectionId=${String(sectionId)}` };
  if (!isPositive(width) || !isPositive(height)) return { ok: false, detail: `width=${String(width)} height=${String(height)}` };
  if (typeof backgroundUrl !== 'string' || backgroundUrl === '') return { ok: false, detail: 'backgroundUrl 이 비어 있다' };
  if (!Array.isArray(blocks)) return { ok: false, detail: 'blocks 가 배열이 아니다' };
  const seen = new Set<number>();
  for (const [i, block] of blocks.entries()) {
    if (!isObject(block)) return { ok: false, detail: `blocks[${i}] 가 객체가 아니다` };
    const { blockId, revision, text, box, style } = block;
    if (!Number.isSafeInteger(blockId)) return { ok: false, detail: `blocks[${i}].blockId=${String(blockId)}` };
    if (seen.has(blockId as number)) return { ok: false, detail: `blockId ${String(blockId)} 중복` };
    seen.add(blockId as number);
    if (!isFiniteNumber(revision)) return { ok: false, detail: `blockId ${String(blockId)} revision=${String(revision)}` };
    if (typeof text !== 'string') return { ok: false, detail: `blockId ${String(blockId)} text 가 문자열이 아니다` };
    if (!isObject(box) || ![box.x, box.y, box.w, box.h].every(isFiniteNumber)) {
      return { ok: false, detail: `blockId ${String(blockId)} box=${JSON.stringify(box)}` };
    }
    if (!isObject(style)) return { ok: false, detail: `blockId ${String(blockId)} style 이 객체가 아니다` };
  }
  return { ok: true, input: raw as unknown as InternalRenderInput };
}

const errorText = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

export function RenderHost() {
  const [job, setJob] = useState<SectionJob | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let busy = false;
    let requestSeq = 0;
    let unmounted = false;
    // 글꼴 family 별 측정기 — 폰트 확인·host 생성을 요청마다 반복하지 않는다
    const measurers = new Map<string, TypesetMeasurer>();

    const clearSection = () => {
      if (!unmounted) flushSync(() => setJob(null));
    };

    const run = async (raw: unknown): Promise<InternalRenderResult> => {
      const startedAt = performance.now();
      clearSection();

      const validated = validateInput(raw);
      if (!validated.ok) return { ok: false, reason: 'invalid-input', detail: validated.detail };
      const { input } = validated;

      // N5 local-typeset 과 같은 모델 — 세션 초안이 없으므로 renderInput 값만 쓴다(n5-viewport.tsx typesetModelsBySection)
      const models: TypesetRenderModel[] = [];
      for (const block of input.blocks) {
        const serverStyle = toTypesetServerStyle(block.style);
        if (!serverStyle) return { ok: false, reason: 'style-invalid', detail: `blockId ${block.blockId} style=${JSON.stringify(block.style)}` };
        models.push({
          blockId: block.blockId,
          sectionId: input.sectionId,
          revision: block.revision,
          text: block.text,
          // 서버 style 이 있으면 역할은 그리기에 쓰이지 않는다(N5 와 같은 값)
          role: 'body',
          originalBBox: apiBboxToBoundingBox(block.box),
          adjustedBBox: null,
          sourceImageWidth: input.width,
          userFontScale: serverStyle.fontScale,
          textAlign: serverStyle.align,
          serverStyle,
          excluded: false,
        });
      }

      // 폰트 — 측정기 기본 weight(400/600)와 블록이 쓰는 weight 가 모두 실제 FontFace 로 로드돼야 한다. fallback 으로 그리지 않는다
      const weightsByFamily = new Map<string, Set<number>>();
      for (const model of models) {
        const style = model.serverStyle!;
        const weights = weightsByFamily.get(style.fontFamily) ?? new Set<number>();
        weights.add(style.fontWeight);
        weightsByFamily.set(style.fontFamily, weights);
      }
      const fonts: TypesetFontReadiness[] = [];
      for (const [family, weights] of weightsByFamily) {
        if (!measurers.has(family)) {
          const opened = await openTypesetMeasurer({ fontFamily: family });
          if (!opened.ok) return { ok: false, reason: 'font-not-ready', detail: JSON.stringify(opened.fonts) };
          measurers.set(family, opened.measurer);
        }
        const readiness = await checkTypesetFontReady(document, family, [...weights].sort((a, b) => a - b));
        if (!readiness.ok) return { ok: false, reason: 'font-not-ready', detail: JSON.stringify(readiness) };
        fonts.push(readiness);
      }

      // 그리기 — flushSync 로 DOM 반영을 끝낸 뒤 배경 decode 를 기다린다
      const requestId = ++requestSeq;
      flushSync(() =>
        setJob({ requestId, sectionId: input.sectionId, width: input.width, height: input.height, backgroundUrl: input.backgroundUrl, models }),
      );
      const image = imageRef.current;
      if (!image) return { ok: false, reason: 'background-failed', detail: '<img> 가 없다' };
      try {
        await image.decode();
      } catch (error) {
        clearSection();
        return { ok: false, reason: 'background-failed', detail: errorText(error) };
      }
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
        clearSection();
        return { ok: false, reason: 'background-failed', detail: `naturalSize=${image.naturalWidth}x${image.naturalHeight}` };
      }
      const section = sectionRef.current;
      const drawn = section?.querySelectorAll('[data-typeset-render]').length ?? 0;
      if (!section || section.dataset.renderRequest !== String(requestId) || drawn !== models.length) {
        clearSection();
        return { ok: false, reason: 'measurer-failed', detail: `그린 블록 ${drawn}/${models.length}` };
      }

      // 측정 — N5 와 같은 측정기. 실패를 fallback 결과로 바꾸지 않는다
      const blocks: InternalRenderBlockResult[] = [];
      for (const model of models) {
        const measurer = measurers.get(model.serverStyle!.fontFamily)!;
        const measureInput = toTypesetMeasureInput(model);
        const measure = measurer.measure(measureInput);
        if (!measure.ok) {
          clearSection();
          return { ok: false, reason: 'measurer-failed', detail: `blockId ${model.blockId} ${measure.reason}: ${measure.detail}` };
        }
        blocks.push({ blockId: model.blockId, measure, textHeightPx: measurer.measureTextHeight(measureInput) });
      }

      section.dataset.renderState = 'ready';
      return { ok: true, fonts, blocks, ms: performance.now() - startedAt };
    };

    window.__pixlateRender = {
      async render(raw) {
        if (busy) return { ok: false, reason: 'busy', detail: '이전 render 가 진행 중이다' };
        busy = true;
        try {
          return await run(raw);
        } catch (error) {
          // 예상하지 못한 예외도 숨기지 않고 실패로 돌려준다
          clearSection();
          return { ok: false, reason: 'measurer-failed', detail: `unexpected ${errorText(error)}` };
        } finally {
          busy = false;
        }
      },
    };
    const root = document.documentElement;
    const revision = process.env.NEXT_PUBLIC_PIXLATE_FE_REVISION;
    if (revision) root.dataset.feRevision = revision;
    root.dataset.internalRender = 'ready';

    return () => {
      unmounted = true;
      delete window.__pixlateRender;
      delete root.dataset.internalRender;
      delete root.dataset.feRevision;
      for (const measurer of measurers.values()) measurer.dispose();
      measurers.clear();
    };
  }, []);

  return (
    <main style={{ margin: 0, padding: 0 }}>
      {job && (
        <div
          key={job.requestId}
          ref={sectionRef}
          data-render-section={job.sectionId}
          data-render-request={job.requestId}
          data-render-state="drawing"
          style={{ position: 'relative', width: job.width, height: job.height, overflow: 'hidden', margin: 0, padding: 0 }}
        >
          {/* 배경은 섹션 원본 px 1:1 — 글자와 같은 좌표계(배율 없음) */}
          {/* eslint-disable-next-line @next/next/no-img-element -- presigned 원본을 변환 없이 1:1 로 그려야 한다 */}
          <img
            ref={imageRef}
            src={job.backgroundUrl}
            alt=""
            draggable={false}
            style={{ position: 'absolute', left: 0, top: 0, width: job.width, height: job.height, display: 'block', maxWidth: 'none' }}
          />
          {job.models.map((model) => (
            <TypesetBlock key={model.blockId} model={model} />
          ))}
        </div>
      )}
    </main>
  );
}
