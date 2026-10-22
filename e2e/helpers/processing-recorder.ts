import { expect, type Page } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N2/N4 처리 화면을 사용자 눈 기준으로 시간 순서대로 기록한다.
// - dom: DOM 이 바뀔 때마다 h1·표시 %·5단계 행·GIF caption·status tag·LOG 제목·LOG 설명 줄·progress 안내
//   (연속 중복 제거)
// - polls: GET /jobs/{jobId}/tasks 응답마다 서버가 보낸 값
// 두 기록 모두 페이지의 Date.now() 기준이라 같은 시계로 비교할 수 있다. exposeFunction 으로
// Node 쪽 배열에 쌓기 때문에 page.goto 로 다시 들어가도(같은 context 두 번 실행) 이어서 기록된다.
// ─────────────────────────────────────────────────────────────────

/** 5단계 행 상태를 한 글자씩 — A 진행 중 · D 완료 · P 대기 (예: 'DDDAA') */
export type RowCode = string;

export interface DomSnap {
  t: number;
  h1: string;
  pct: number | null;
  rows: RowCode;
  cap: string;
  /** 패널 좌상단 상태 태그(진행중·완료·분석 실패) */
  tag: string;
  /** LOG 제목(지금 처리하는 일 · 분석 완료 …) */
  heading: string;
  line: string;
  /** progress bar 아래 안내 문구 */
  hint: string;
}

export interface PollSnap {
  t: number;
  currentStep: string;
  jobStatus: string;
  progress: number;
  stages: string;
  ap: string | null;
}

export interface ProcessingRecord {
  dom: DomSnap[];
  polls: PollSnap[];
}

/**
 * 처리 중 표시 % 가 연속한 두 DOM 기록 사이에서 오를 수 있는 최대 폭.
 * 화면 tick(150ms)마다 최대 0.8 이 오르므로 정수 표시는 tick 당 1 이하로 바뀐다 — 렌더가 몰리는
 * 브라우저 부하를 감안해 3 까지 허용한다. 단계가 바뀌는 순간 다음 구간 floor 로 뛰는 것(이전 정책의 20 단위
 * 점프)은 이 값으로 잡힌다.
 */
export const MAX_DISPLAY_JUMP = 3;

export async function recordProcessing(page: Page): Promise<ProcessingRecord> {
  const record: ProcessingRecord = { dom: [], polls: [] };
  await page.exposeFunction('__pixlateRecDom', (e: DomSnap) => record.dom.push(e));
  await page.exposeFunction('__pixlateRecPoll', (e: PollSnap) => record.polls.push(e));
  await page.addInitScript((jobId) => {
    const w = window as unknown as {
      __pixlateRecDom: (e: unknown) => void;
      __pixlateRecPoll: (e: unknown) => void;
    };
    const code: Record<string, string> = { '진행 중': 'A', 완료: 'D', 대기: 'P' };
    let last = '';
    const snap = () => {
      const h1 = document.querySelector('h1')?.textContent?.trim() ?? '';
      const bar = document.querySelector('[role="progressbar"]');
      const rowEls = Array.from(document.querySelectorAll('p')).filter((p) => /^0[1-5]\s/.test(p.textContent ?? ''));
      const rows = rowEls.length === 5 ? rowEls.map((p) => code[(p.nextElementSibling?.textContent ?? '').trim()] ?? '?').join('') : '';
      const cap = Array.from(document.querySelectorAll('p')).find((p) => p.className.includes('text-[#ff6a38]'))?.textContent?.trim() ?? '';
      const line = document.querySelector('[data-testid="processing-log-description"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const tag = document.querySelector('div[class*="bg-[#f5f5f5]"] > p')?.textContent?.trim() ?? '';
      const heading = document.querySelector('h2')?.textContent?.trim() ?? '';
      const hint = bar?.nextElementSibling?.textContent?.trim() ?? '';
      const entry = { h1, pct: bar ? Number(bar.getAttribute('aria-valuenow')) : null, rows, cap, tag, heading, line, hint };
      const key = JSON.stringify(entry);
      if (key === last) return;
      last = key;
      w.__pixlateRecDom({ ...entry, t: Date.now() });
    };
    const start = () =>
      new MutationObserver(snap).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-valuenow'],
      });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (new RegExp(`/jobs/${jobId}/tasks(\\?|$)`).test(url)) {
        const t = Date.now();
        res
          .clone()
          .json()
          .then((b) => {
            const ap = b.analysisProgress;
            w.__pixlateRecPoll({
              t,
              currentStep: b.currentStep,
              jobStatus: b.jobStatus,
              progress: b.progress,
              stages: (b.stages ?? []).map((s: { key: string; status: string }) => `${s.key}:${s.status}`).join(','),
              ap: ap ? `${ap.phase}/${ap.status}/${ap.activity ?? '-'}/src${ap.current?.sourceIndex ?? '-'}` : null,
            });
          })
          .catch(() => undefined);
      }
      return res;
    };
  }, MOCK_JOB_ID);
  return record;
}

/** 처리 화면(h1)이 떠 있고 5행이 그려진 기록 */
export const onScreen = (dom: DomSnap[], title: string) => dom.filter((d) => d.h1 === title && d.rows.length === 5 && d.pct !== null);

/** 실제 완료(다음 step 응답) 전, 처리 중으로 그린 기록 */
export function processingSnaps(rec: ProcessingRecord, title: string, nextStep: string, from = 0): DomSnap[] {
  const doneAt = rec.polls.find((p) => p.t >= from && p.currentStep === nextStep)?.t ?? Infinity;
  return onScreen(rec.dom, title).filter((d) => d.t >= from && d.t < doneAt);
}

/** 사용자가 본 흐름을 사람이 읽을 수 있게(실패 메시지·관측 로그용) */
export function formatTimeline(rec: ProcessingRecord, from = 0, until = Infinity): string {
  const t0 = from || Math.min(rec.dom[0]?.t ?? 0, rec.polls[0]?.t ?? 0);
  const rows = [
    ...rec.polls.filter((p) => p.t >= from && p.t <= until).map((p) => ({ t: p.t, s: `POLL ${p.currentStep} ${p.jobStatus} p=${p.progress} [${p.stages}] ${p.ap ?? ''}` })),
    ...rec.dom
      .filter((d, i, all) => d.t >= from && d.t <= until && (d.pct !== null || d.h1 !== all[i - 1]?.h1))
      .map((d) => ({ t: d.t, s: d.pct !== null ? `  ${d.h1} ${d.pct}% ${d.rows} [${d.tag}] "${d.cap}" ${d.heading}: ${d.line} / ${d.hint}` : `  → 화면: ${d.h1 || '(h1 없음)'}` })),
  ].sort((a, b) => a.t - b.t);
  return rows.map((r) => `${((r.t - t0) / 1000).toFixed(2).padStart(6)}s ${r.s}`).join('\n');
}

/** 처리 중: 100 없음 · 감소 없음 · 한 번에 큰 점프 없음 */
export function expectSmoothProcessing(snaps: DomSnap[], context: string) {
  expect(snaps.length, context).toBeGreaterThan(0);
  for (const s of snaps) expect(s.pct!, `처리 중 100% 금지\n${context}`).toBeLessThan(100);
  for (let i = 1; i < snaps.length; i += 1) {
    const diff = snaps[i].pct! - snaps[i - 1].pct!;
    expect(diff, `표시 % 감소 (${snaps[i - 1].pct} → ${snaps[i].pct})\n${context}`).toBeGreaterThanOrEqual(0);
    expect(diff, `표시 % 점프 (${snaps[i - 1].pct} → ${snaps[i].pct})\n${context}`).toBeLessThanOrEqual(MAX_DISPLAY_JUMP);
  }
}

/**
 * 실제 완료(nextStep 응답) 뒤: 그 응답 전에는 100 이 없고, 응답 뒤 처리 화면에서 100 이 실제로 그려지고 잠시
 * 유지된 다음 다음 화면으로 넘어간다. 응답을 받은 뒤 처리 화면을 오래 붙잡지도 않는다.
 */
export function expectCompletionPresentation(rec: ProcessingRecord, title: string, nextStep: string, context: string, from = 0) {
  const donePoll = rec.polls.find((p) => p.t >= from && p.currentStep === nextStep);
  expect(donePoll, `${nextStep} 응답\n${context}`).toBeDefined();
  const screen = onScreen(rec.dom, title).filter((d) => d.t >= from);
  const first100 = screen.find((d) => d.pct === 100);
  expect(first100, `${nextStep} 응답 뒤 100% 가 화면에 그려져야 한다\n${context}`).toBeDefined();
  expect(first100!.t, `100% 는 ${nextStep} 응답 뒤에만\n${context}`).toBeGreaterThanOrEqual(donePoll!.t);
  const left = rec.dom.find((d) => d.t > first100!.t && d.h1 !== title);
  expect(left, `완료 표시 뒤 다음 화면으로 넘어가야 한다\n${context}`).toBeDefined();
  // 100% 를 눈으로 확인할 시간이 있다(완료 확인 유지)
  expect(left!.t - first100!.t, `100% 유지 시간\n${context}`).toBeGreaterThanOrEqual(150);
  // 완료 응답 뒤 처리 화면을 붙잡는 시간은 완료 표시(약 0.8초) 정도다 — 그보다 길게 기다리지 않는다
  expect(left!.t - donePoll!.t, `완료 응답 → 다음 화면\n${context}`).toBeLessThan(1_600);
  return { donePollAt: donePoll!.t, first100At: first100!.t, leftAt: left!.t };
}

/**
 * 완료 표시 문구 정합 — 실제 완료(nextStep 응답) 전에는 완료 문구가 없고, 응답 뒤 처리 화면에 남아 있는 동안
 * (100% 를 그린 순간부터) 상태 태그·LOG·안내가 모두 완료를 말한다. 완료 표시 중 '진행중' 태그가 남지 않는다.
 */
export function expectCompletionCopy(
  rec: ProcessingRecord,
  title: string,
  nextStep: string,
  copy: { heading: string; line: string; hint: string },
  context: string,
  from = 0,
) {
  const donePollAt = rec.polls.find((p) => p.t >= from && p.currentStep === nextStep)!.t;
  const screen = onScreen(rec.dom, title).filter((d) => d.t >= from);
  const before = screen.filter((d) => d.t < donePollAt);
  const during = screen.filter((d) => d.t >= donePollAt);
  expect(before.length, context).toBeGreaterThan(0);
  for (const d of before) {
    expect(d.tag, `완료 전 상태 태그\n${context}`).not.toBe('완료');
    expect(d.heading, `완료 전 LOG 제목\n${context}`).not.toBe(copy.heading);
    expect(d.rows, `완료 전 5행 전부 완료 금지\n${context}`).not.toBe('DDDDD');
  }
  const at100 = during.filter((d) => d.pct === 100);
  expect(at100.length, `완료 표시 중 100%\n${context}`).toBeGreaterThan(0);
  for (const d of during) {
    expect(d.tag, `완료 표시 중 상태 태그\n${context}`).toBe('완료');
    expect(d.rows, `완료 표시 중 5행\n${context}`).toBe('DDDDD');
    expect(d.heading, `완료 표시 중 LOG 제목\n${context}`).toBe(copy.heading);
    expect(d.line, `완료 표시 중 LOG 설명\n${context}`).toBe(copy.line);
    expect(d.hint, `완료 표시 중 안내\n${context}`).toBe(copy.hint);
  }
}
