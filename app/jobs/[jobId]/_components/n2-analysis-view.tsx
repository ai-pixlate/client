import Link from 'next/link';

import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { StepNav } from './step-nav';

// ─────────────────────────────────────────────────────────────────
// N2 — 분석중 (Figma node 660:4139 기준)
//
// 좌측 StepNav 레일 + 본문(좌: 분석 비주얼 · 우: ANALYSIS LOG) 2단 구조.
// page.tsx가 이 화면일 때는 공용 header bar를 숨기므로(N3/N5/N6와 동일
// 패턴) 여기서 헤더·나가기 버튼까지 전부 자체적으로 그린다.
//
// stages[]/progress는 GET /jobs/:jobId/tasks(JobTaskStatus) 응답을 그대로
// 쓴다 — 몇 개가 오든, 어떤 label이 오든 그대로 순서대로 렌더한다(하드코딩
// 없음). Figma는 5단계·특정 문구를 보여주지만 그건 그 시점의 mock 데이터일
// 뿐, 실제 단계 구성(N2는 계약상 ocr→section→verify 3단계)은 서버가 정한다.
// ─────────────────────────────────────────────────────────────────

const HEADLINE_FALLBACK = '상세페이지의 구조와 문맥을 읽고 있습니다.';
const AUTO_ADVANCE_NOTICE = '분석이 끝나면 섹션 확인 단계로 자동 이동합니다.';

type StageStatus = 'pending' | 'running' | 'done' | 'failed';

function ExitIcon() {
  // Figma(849:7235 "보관함으로 나가기") glyph는 7일 만료 원격 asset이라
  // 커밋 코드에 하드링크하지 않는다 — N1이 이미 같은 위치·크기의 아이콘을
  // 이 inline SVG로 재구현해 뒀으므로 그 패턴을 그대로 재사용한다.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.5" y="1.5" width="2.2" height="9" rx="0.8" fill="#171717" />
      <rect x="7.3" y="1.5" width="2.2" height="9" rx="0.8" fill="#171717" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// ANALYSIS LOG 한 행 — done/running/pending마다 굵기·색·자간이 Figma에서
// 다르게 지정돼 있어(현재 단계만 SemiBold+색, 나머지는 Regular/Light+회색)
// 그 차이를 그대로 따른다. failed는 Figma에 없는 상태라 pending과 같은
// 저채도 표현으로 최소 보완하고, 실제 실패 내용은 기존 failedItems 배너가
// 담당한다(아래 N2AnalysisView 참고) — 이 행 자체에 새 색을 만들어 넣지 않는다.
// ─────────────────────────────────────────────────────────────────
function StageRow({ label, status }: { label: string; status: StageStatus }) {
  const dotColor = status === 'running' ? '#ff6a38' : status === 'done' ? '#171717' : '#eaeaea';
  const isCurrent = status === 'running';
  const isMuted = status === 'pending' || status === 'failed';

  const titleClass = isCurrent
    ? "font-['Pretendard:SemiBold'] text-[14px] text-[#171717]"
    : `font-['Pretendard:Regular'] text-[14px] tracking-[-0.01em] ${isMuted ? 'text-[#999]' : 'text-[#171717]'}`;

  const captionText = status === 'done' ? '완료' : status === 'running' ? '진행 중' : status === 'failed' ? '실패' : '대기';
  const captionClass = isCurrent
    ? "font-['Pretendard:Regular'] text-[12px] text-[#ff6a38]"
    : "font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]";

  return (
    <div className="flex h-[68px] w-full items-center gap-3.5">
      <div className="size-[10px] shrink-0 rounded-full" style={{ backgroundColor: dotColor }} aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className={titleClass}>{label}</p>
        <p className={captionClass}>{captionText}</p>
      </div>
    </div>
  );
}

export function N2AnalysisView({ status }: { status: ApiJobTaskStatus }) {
  const stages = status.stages ?? [];
  const progressPercent = Math.round((status.progress ?? 0) * 100);
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');

  return (
    <div className="flex h-full w-full bg-white">
      {/* 좌측 rail — N1과 같은 "보관함으로 나가기" 버튼 + StepNav 조합
          (Figma의 top:calc(50%+40px) 공식은 짧은 뷰포트에서 나가기 버튼과
          겹친다는 걸 N1에서 이미 확인했다 — 그 fix를 그대로 재사용한다). */}
      <div className="relative ml-9 h-full w-[44px] shrink-0">
        <Link
          href="/"
          aria-label="보관함으로 나가기"
          className="absolute top-10 left-1/2 z-20 flex size-10 -translate-x-1/2 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
        >
          <ExitIcon />
        </Link>
        <div className="absolute inset-0 pt-[100px] pb-6">
          <StepNav currentStep="N2" />
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 헤더 */}
        <div className="shrink-0 px-10 pt-10 pb-6">
          <div className="flex items-center gap-4">
            <h1 className="font-['Pretendard:SemiBold'] text-[20px] tracking-[-0.02em] text-[#171717]">이미지 분석</h1>
            <p className="font-['Pretendard:Regular'] text-[14px] tracking-[-0.01em] text-[#707070]">
              등록한 이미지의 텍스트와 구조를 분석하고 있습니다.
            </p>
          </div>
        </div>

        {/* 본문: N2 / Brand Analysis Stage 패널 */}
        <div className="min-h-0 flex-1 px-10 pb-10">
          <div className="flex h-full min-h-0 gap-10 overflow-y-auto rounded-[8px] bg-[#f5f5f5] px-10 py-[58px]">
            {/* 좌측 — 분석 비주얼 */}
            <div className="flex min-w-0 flex-1 flex-col gap-[54px]">
              <div className="flex max-w-[820px] flex-col gap-5">
                <div className="flex h-[26px] w-fit items-center justify-center rounded-[6px] bg-[#f5f5f5] px-2">
                  <p className="font-['Pretendard:Regular'] text-[12px] leading-[14px] text-[#171717]">진행중</p>
                </div>
                <div className="flex flex-col gap-3">
                  <p className="font-['Pretendard:SemiBold'] text-[28px] tracking-[-0.015em] text-[#171717]">
                    {HEADLINE_FALLBACK}
                  </p>
                  <p className="font-['Pretendard:Regular'] text-[14px] tracking-[-0.01em] text-[#999]">
                    텍스트만 추출하지 않고, 번역에 필요한 섹션과 판단 근거를 함께 정리합니다.
                  </p>
                </div>
              </div>

              {/* 공용 GIF — N2/N4가 같은 자산을 쓴다(별도 복사본 금지) */}
              <div className="relative h-[520px] w-full shrink-0 overflow-hidden rounded-[8px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- 애니메이션 보존을 위해 next/image 최적화 대상에서 제외(GIF) */}
                <img
                  src="/process/ai-processing.gif"
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 size-full object-cover opacity-[0.97]"
                />
                <p className="absolute top-7 left-6 font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-white/[58%]">
                  SCAN · STRUCTURE · CONTEXT
                </p>
                <div className="absolute right-6 bottom-6 flex max-w-[360px] flex-col items-end gap-2 text-right">
                  <p className="font-['Pretendard:Medium'] text-[13px] text-[#ff6a38]">제품 라벨 자동 제외</p>
                  <p className="font-['Pretendard:Regular'] text-[12px] text-white/[58%]">
                    제품 라벨로 인식된 영역은 번역 대상에서 자동으로 제외합니다.
                  </p>
                </div>
              </div>
            </div>

            {/* 구분선 */}
            <div className="w-px shrink-0 self-stretch bg-[#eaeaea]" />

            {/* 우측 — ANALYSIS LOG */}
            <div className="flex w-[403px] shrink-0 flex-col gap-[52px]">
              <div className="flex max-w-[370px] flex-col gap-6">
                <p className="font-['Pretendard:Regular'] text-[12px] tracking-[-0.02em] text-[#999]">ANALYSIS LOG</p>
                <div className="flex flex-col gap-3">
                  <h2 className="font-['Pretendard:SemiBold'] text-[20px] tracking-[-0.02em] text-[#171717]">
                    지금 처리하는 일
                  </h2>
                  <p className="font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]">
                    완료된 항목은 분리하고, 현재 판단만 선명하게 정리 중 입니다.
                  </p>
                </div>
              </div>

              <div className="flex flex-col">
                {stages.map((stage, i) => (
                  <StageRow
                    key={stage.key ?? i}
                    label={stage.label ?? ''}
                    status={(stage.status as StageStatus | undefined) ?? 'pending'}
                  />
                ))}
              </div>

              <div className="relative flex flex-col gap-6">
                <div>
                  <div className="flex items-baseline">
                    <span className="font-['Pretendard:SemiBold'] text-[58px] leading-[64px] text-[#171717]">
                      {progressPercent}
                    </span>
                    <span className="font-['Pretendard:Medium'] text-[18px] tracking-[-0.03em] text-[#999]">%</span>
                  </div>
                  <p className="font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]">전체 분석</p>
                </div>

                <div
                  className="h-[3px] w-full overflow-hidden rounded-full bg-[rgba(112,112,112,0.16)]"
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-[#ff6a38] transition-[width] duration-500 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <p className="font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]">
                  {AUTO_ADVANCE_NOTICE}
                </p>

                {/* Figma(918:7324)의 일시정지 아이콘 — 분석 중단 API가 계약에
                    없어(오늘 범위 밖) 클릭해도 아무 일도 하지 않는 버튼을
                    만들지 않는다. N1의 "이미지 연속 여부" 토글과 같은 방식
                    (보여주되 비활성 + 이유 설명)으로 최소 보완한다. */}
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="분석 중단 기능은 아직 제공되지 않습니다."
                  className="absolute top-[46px] right-0 flex size-7 shrink-0 cursor-not-allowed items-center justify-center rounded-[4px] border border-[#eaeaea] bg-white opacity-60"
                >
                  <PauseIcon />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 부분 실패 안내 — Figma엔 없는 상태다. 서버가 실패 task를 보고하면
            숨기지 않고 기존 배너 패턴(N4ProcessingView와 동일)으로 알린다. */}
        {failedItems.length > 0 && (
          <div className="shrink-0 px-10 pb-6">
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <p className="mb-2 text-sm font-medium text-orange-700">일부 항목을 처리하지 못했습니다</p>
              <ul className="space-y-1">
                {failedItems.map((item) => (
                  <li key={item.taskId} className="text-xs text-orange-600">
                    {item.unitType} #{item.unitId} — {item.errorCode ?? '알 수 없는 오류'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
