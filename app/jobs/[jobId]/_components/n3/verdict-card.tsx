import type { ApiSectionVerdict, ApiVerdictType } from '@/lib/api/n3-schema';
import { getN3VerdictBadgeLabel } from '@/lib/n3/verdict';

// ─────────────────────────────────────────────────────────────────
// N3 — 판정 배지 + 카드 (Figma 540:3119의 Badge/판정 카드 실측 반영).
//
// 색상 톤은 Figma Badge 컴포넌트를 그대로 옮겼다(실제 dot SVG를 받아
// hex를 확인함):
//   - regulatory(규제위반) → red(#e5484d)
//   - channel_policy(채널정책) → orange(#ff6a38)
//   - 나머지(현지 무의미/현지 기준 수정 필요/조건부 규제) → 중립(흰 배경 +
//     회색 테두리), 다만 dot 색만 현지 무의미는 orange, 나머지는 gray로
//     갈린다 — chrome은 같지만 시급도만 dot으로 구분하는 Figma 실측 그대로.
//
// regulatory_replaceable(규제 표현)은 Figma에 표본이 없는 variant라
// 4단계에서 근거를 다시 확인했다. Figma Badge/Status Chip 디자인시스템
// 컴포넌트(별도 컴포넌트, 상태칩 전용)에는 이 값에 대응하는 variant가
// 없고, 대신 scripts/verify-n3-verdict-contract.mjs(이 프로젝트의 verdict
// 계약 검증 스크립트, v3.4.1)가 명시한 기본 bucket 기대값에서 결정적
// 근거를 찾았다: regulatory는 exclude(자동 제외)인 반면
// regulatory_replaceable은 regulatory_conditional·needs_fix와 같은
// include(대체 표현이 있어 바로 차단하지 않음)다. 즉 이 프로젝트 자체가
// regulatory_replaceable을 "그대로 두면 안 되는 하드 위반"이 아니라
// "대체 가능해서 include로 두는 나머지 중립 판정군"과 같은 급으로
// 다루고 있다 — 그래서 red가 아니라 neutral 톤을 쓴다.
// ─────────────────────────────────────────────────────────────────

type BadgeTone = 'red' | 'orange' | 'neutral';

const TONE_BY_VERDICT_TYPE: Record<ApiVerdictType, BadgeTone> = {
  regulatory: 'red',
  regulatory_replaceable: 'neutral',
  regulatory_conditional: 'neutral',
  local_irrelevant: 'neutral',
  needs_fix: 'neutral',
  channel_policy: 'orange',
};

const NEUTRAL_ORANGE_DOT_TYPES = new Set<ApiVerdictType>(['local_irrelevant']);

const TONE_CHROME: Record<BadgeTone, { bg: string; border: string; text: string }> = {
  red: { bg: 'bg-[#fcebec]', border: 'border-[#e5484d]', text: 'text-[#e5484d]' },
  orange: { bg: 'bg-[#fff0eb]', border: 'border-[#ff6a38]', text: 'text-[#ff6a38]' },
  neutral: { bg: 'bg-white', border: 'border-[#eaeaea]', text: 'text-[#171717]' },
};

function dotColorFor(type: ApiVerdictType, tone: BadgeTone): string {
  if (tone === 'red') return '#e5484d';
  if (tone === 'orange') return '#ff6a38';
  return NEUTRAL_ORANGE_DOT_TYPES.has(type) ? '#ff6a38' : '#707070';
}

function BadgeShell({
  bg,
  border,
  children,
}: {
  bg: string;
  border: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex shrink-0 flex-col items-start rounded-[6px] border px-2 py-1 ${bg} ${border}`}>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

export function VerdictBadge({ type }: { type: ApiVerdictType }) {
  const tone = TONE_BY_VERDICT_TYPE[type] ?? 'neutral';
  const chrome = TONE_CHROME[tone];
  const dot = dotColorFor(type, tone);
  return (
    <BadgeShell bg={chrome.bg} border={chrome.border}>
      <span className="size-[6px] shrink-0 rounded-full" style={{ backgroundColor: dot }} />
      <span className={`whitespace-nowrap text-[12px] tracking-[-0.02em] ${chrome.text}`}>
        {getN3VerdictBadgeLabel(type)}
      </span>
    </BadgeShell>
  );
}

/** verdictType이 없는 일반 정보 배지(예: 섹션 자동 제외 사유) — 중립 톤 고정 */
export function InfoBadge({ label }: { label: string }) {
  return (
    <BadgeShell bg="bg-white" border="border-[#eaeaea]">
      <span className="size-[6px] shrink-0 rounded-full bg-[#707070]" />
      <span className="whitespace-nowrap text-[12px] tracking-[-0.02em] text-[#171717]">{label}</span>
    </BadgeShell>
  );
}

/**
 * 판정 카드. Figma는 제목/설명/근거 3단이고, 실제 계약(ApiSectionVerdict)도
 * problemText/reason/basisArticle 3개 필드로 나뉘어 있어(구 계약은
 * problemText/basis 2개뿐이라 설명 줄을 근거에 합쳐 썼었다) 이제 그대로
 * 3단으로 대응시킨다. 각 줄은 값이 없으면(계약상 전부 nullable) 생략한다 —
 * 빈 문자열을 억지로 그리지 않는다.
 */
export function VerdictCard({ verdict }: { verdict: ApiSectionVerdict }) {
  if (!verdict.verdictType) return null;

  return (
    <div className="flex w-full flex-col items-start gap-3 rounded-[8px] bg-white px-5 py-3">
      <VerdictBadge type={verdict.verdictType} />
      <div className="flex w-full flex-col gap-1.5">
        {verdict.problemText && (
          <p className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">{verdict.problemText}</p>
        )}
        {verdict.reason && <p className="text-[14px] tracking-[-0.01em] text-[#171717]">{verdict.reason}</p>}
        {verdict.basisArticle && (
          <p className="text-[12px] font-light tracking-[-0.04em] text-[#707070]">{verdict.basisArticle}</p>
        )}
      </div>
    </div>
  );
}
