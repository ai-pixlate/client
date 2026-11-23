import type { ApiSectionVerdict, ApiVerdictType } from '@/lib/api/n3-schema';
import { getN3VerdictBadgeLabel } from '@/lib/n3/verdict';

// ─────────────────────────────────────────────────────────────────
// N3 — 판정 배지 + 카드 (Figma 1759:11529 「N3 섹션 확인 / 디폴트 수정」의 Badge 반영).
//
// Badge(px8 · py4 · radius 6 · dot 6 · gap 6 · 12 Regular) 톤:
//   - regulatory(규제 위반) · channel_policy(채널 정책) · local_irrelevant(현지 수정 필수)
//     · needs_fix(현지 확인 필요) → orange subtle(bg #fff0eb · border/text #ff6a38)
//   - regulatory_replaceable(규제 표현) · regulatory_conditional(조건부 규제)
//     → neutral(bg white · border #eaeaea · text #171717)
// 예전 Figma의 red(#e5484d · #fcebec) 규제 위반 톤은 최신 Figma에 없어 쓰지 않는다.
// verdictType의 의미(bucket 기본값 등)는 바꾸지 않고 시각 매핑만 맞춘다.
// ─────────────────────────────────────────────────────────────────

type BadgeTone = 'orange' | 'neutral';

const TONE_BY_VERDICT_TYPE: Record<ApiVerdictType, BadgeTone> = {
  regulatory: 'orange',
  regulatory_replaceable: 'neutral',
  regulatory_conditional: 'neutral',
  local_irrelevant: 'orange',
  needs_fix: 'orange',
  channel_policy: 'orange',
};

const TONE_CHROME: Record<BadgeTone, { bg: string; border: string; text: string }> = {
  orange: { bg: 'bg-[#fff0eb]', border: 'border-[#ff6a38]', text: 'text-[#ff6a38]' },
  neutral: { bg: 'bg-white', border: 'border-[#eaeaea]', text: 'text-[#171717]' },
};

function dotColorFor(tone: BadgeTone): string {
  if (tone === 'orange') return '#ff6a38';
  return '#707070';
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
  const dot = dotColorFor(tone);
  return (
    <BadgeShell bg={chrome.bg} border={chrome.border}>
      <span className="size-[6px] shrink-0 rounded-full" style={{ backgroundColor: dot }} />
      <span className={`whitespace-nowrap text-[12px] tracking-[-0.02em] ${chrome.text}`}>
        {getN3VerdictBadgeLabel(type)}
      </span>
    </BadgeShell>
  );
}

/**
 * 판정 카드. Figma는 제목/설명/근거 3단이고, 실제 계약(ApiSectionVerdict)도
 * problemText/reason/basisArticle 3개 필드로 나뉘어 있어(구 계약은
 * problemText/basis 2개뿐이라 설명 줄을 근거에 합쳐 썼었다) 이제 그대로
 * 3단으로 대응시킨다. 각 줄은 값이 없으면(계약상 전부 nullable) 생략한다 —
 * 빈 문자열을 억지로 그리지 않는다.
 *
 * 근거 줄의 [보기]는 서버가 준 evidenceUrl이 있을 때만 그린다 — basisArticle로
 * URL을 만들지 않는다. PRD의 「국가 + 규정 이름」은 계약에 규정 이름이 없어 아직 그리지 않는다.
 */
export function VerdictCard({ verdict }: { verdict: ApiSectionVerdict }) {
  if (!verdict.verdictType) return null;

  return (
    // Figma 1759:11546 — px8 · py12 · 배지와 본문 사이 16 · 본문 줄 간격 6
    <div className="flex w-full shrink-0 flex-col items-start gap-4 rounded-[8px] bg-white px-2 py-3">
      <VerdictBadge type={verdict.verdictType} />
      <div className="flex w-full flex-col gap-1.5">
        {verdict.problemText && (
          <p className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">{verdict.problemText}</p>
        )}
        {verdict.reason && <p className="text-[14px] tracking-[-0.01em] text-[#171717]">{verdict.reason}</p>}
        {(verdict.basisArticle || verdict.evidenceUrl) && (
          <p className="flex items-start gap-1 text-[12px] font-light tracking-[-0.04em] text-[#707070]">
            {verdict.basisArticle && <span>{verdict.basisArticle}</span>}
            {verdict.evidenceUrl && (
              <a
                href={verdict.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="n3-verdict-evidence-link"
                aria-label={verdict.basisArticle ? `${verdict.basisArticle} 근거 보기(새 창)` : '근거 보기(새 창)'}
                className="underline hover:text-[#171717]"
              >
                [보기]
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
