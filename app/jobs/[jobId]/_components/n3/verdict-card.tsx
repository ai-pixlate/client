import type { SectionVerdict } from '@/lib/api/types';
import { SECTION_VERDICT_TYPE_LABELS } from '@/lib/api/labels';

// ─────────────────────────────────────────────────────────────────
// N3 — AI 판정/근거 카드
// Figma "Badge / Status Chip" + 제목 + 근거 캡션 구조를 따른다.
// Figma는 제목/설명/근거 3단이지만 데이터 계약(SectionVerdict)에는
// problemText·basis 2개 필드만 있어 설명 줄은 근거 캡션에 통합했다.
// ─────────────────────────────────────────────────────────────────

export function VerdictCard({ verdict }: { verdict: SectionVerdict }) {
  return (
    <div className="flex w-full flex-col items-start gap-3 rounded-[8px] bg-white p-5">
      <StatusChip label={SECTION_VERDICT_TYPE_LABELS[verdict.verdictType]} />
      <div className="flex w-full flex-col gap-1.5">
        <p className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">
          {verdict.problemText}
        </p>
        <p className="text-[12px] font-light tracking-[-0.04em] text-[#707070]">
          기준: {verdict.basis}
        </p>
      </div>
    </div>
  );
}

export function StatusChip({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-[14px] border border-[#eaeaea] bg-white px-3 py-[5px]">
      <span className="size-[6px] shrink-0 rounded-full bg-[#ff6a38]" />
      <span className="whitespace-nowrap text-[12px] tracking-[-0.02em] text-[#171717]">
        {label}
      </span>
    </div>
  );
}
