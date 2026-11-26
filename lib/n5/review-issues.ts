/**
 * N5 [저장하러 가기] 전 확인 항목(F-CFM-09, Figma 1313:12384) — 순수 함수(scripts/verify-n5-review-issues.mjs).
 *
 * PRD 확인 대상: 미해결 규제 경고(번역문에 남은 금지·조건부 — 미적용 강제 용어는 세지 않는다) · 검사 실패 블록 ·
 * 번역 실패로 번역문이 빈 블록 · 제외하지 않은 실행 실패 섹션. 여기에 [확인]으로 저장하지 않은 번역문 초안을 별도 묶음으로 더한다
 * (PRD v3.6.4 F-CFM-09 — 그 칸은 자동 저장하지 않고 서버에 저장된 이전 문장으로 확정된다 · 빈 번역과 뜻이 달라 합치지 않는다).
 * 넣지 않는 것: 일반 넘침 · 미리보기 갱신 실패 · N2 원문 판정 · 미적용 강제 용어(mandatory_term_unapplied) · 인페인팅 잔존율 품질 주의.
 * 계약 한계: 금지·조건부 판정 구분 필드가 없어 둘 다 prohibited_expression 하나로 센다. 제외한 섹션은 어느 항목도 세지 않는다.
 */

import type { BlockTaskFailures, BlockViewModel, PreviewSectionViewModel, SectionStatusViewModel } from './adapter';

export type N5ReviewIssueKind =
  | 'regulatory-warning'
  | 'verification-failed'
  | 'empty-translation'
  | 'execution-failed'
  | 'unsaved-translation';

export interface N5ReviewIssue {
  kind: N5ReviewIssueKind;
  sectionId: number;
  sectionOrder: number;
  blockId?: number;
  /** section 안 번호(우측 패널·canvas 배지와 같은 값) */
  blockOrder?: number;
  /** 실행 실패 단계 표시 이름 */
  stageLabel?: string;
  message: string;
}

export interface N5ReviewIssueGroup {
  kind: N5ReviewIssueKind;
  title: string;
  /** 제목·점 색. 규제 경고만 Warning이다(Figma 1313:12384) */
  isWarning: boolean;
  issues: N5ReviewIssue[];
}

const GROUP_ORDER: { kind: N5ReviewIssueKind; title: string; isWarning: boolean }[] = [
  { kind: 'regulatory-warning', title: '규제 경고', isWarning: true },
  { kind: 'verification-failed', title: '검사 실패', isWarning: false },
  { kind: 'empty-translation', title: '번역문 비어 있음', isWarning: false },
  { kind: 'execution-failed', title: '실행 실패', isWarning: false },
  { kind: 'unsaved-translation', title: '저장되지 않은 번역문', isWarning: false },
];

export function buildN5ReviewIssues(input: {
  sections: readonly Pick<PreviewSectionViewModel, 'id' | 'sectionOrder' | 'bucket'>[];
  blocks: readonly Pick<BlockViewModel, 'id' | 'sectionId' | 'translatedText' | 'badges'>[];
  sectionStatusById: ReadonlyMap<number, Pick<SectionStatusViewModel, 'failedStages'>>;
  blockTaskFailuresById: ReadonlyMap<number, Pick<BlockTaskFailures, 'verifyFailed'>>;
  /** [확인]으로 저장하지 않은(저장 실패 포함) 서버값과 다른 번역문 초안이 있는 block */
  unsavedDraftBlockIds: ReadonlySet<number>;
  /** 화면에 보이는 블록의 섹션 안 번호(패널·캔버스 번호와 같은 값). 없거나 빠진 블록은 섹션 안 순서로 센다 */
  blockOrderById?: ReadonlyMap<number, number>;
}): N5ReviewIssue[] {
  const issues: N5ReviewIssue[] = [];
  for (const section of input.sections) {
    if (section.bucket === 'exclude') continue;
    const location = { sectionId: section.id, sectionOrder: section.sectionOrder };

    for (const stage of input.sectionStatusById.get(section.id)?.failedStages ?? []) {
      issues.push({
        ...location,
        kind: 'execution-failed',
        stageLabel: stage === 'render' ? '렌더링' : '인페인팅',
        message: stage === 'render' ? '원본 이미지가 그대로 결과물에 사용됩니다.' : '원본 이미지 위에 번역문을 조판해 결과물에 사용합니다.',
      });
    }

    const sectionBlocks = input.blocks.filter((block) => block.sectionId === section.id);
    sectionBlocks.forEach((block, index) => {
      const at = { ...location, blockId: block.id, blockOrder: input.blockOrderById?.get(block.id) ?? index + 1 };
      for (const badge of block.badges) {
        if (badge.code === 'prohibited_expression') {
          issues.push({ ...at, kind: 'regulatory-warning', message: badge.reason ?? '규제 경고를 확인해 주세요.' });
        }
      }
      if (input.blockTaskFailuresById.get(block.id)?.verifyFailed) {
        issues.push({ ...at, kind: 'verification-failed', message: '번역문 검사를 완료하지 못했습니다.' });
      }
      if (block.translatedText === '' && block.badges.some((badge) => badge.code === 'translation_failed')) {
        issues.push({ ...at, kind: 'empty-translation', message: '이대로 저장하면 해당 문장이 결과물에서 빠질 수 있습니다.' });
      }
      if (input.unsavedDraftBlockIds.has(block.id)) {
        issues.push({ ...at, kind: 'unsaved-translation', message: '저장 이전 문장으로 들어갑니다' });
      }
    });
  }
  return issues;
}

/** 항목이 있는 묶음만 정해진 순서로 돌려준다 */
export function groupN5ReviewIssues(issues: readonly N5ReviewIssue[]): N5ReviewIssueGroup[] {
  return GROUP_ORDER.flatMap((group) => {
    const matched = issues.filter((issue) => issue.kind === group.kind);
    return matched.length > 0 ? [{ ...group, issues: matched }] : [];
  });
}

/** Figma 1657:10490 — 「섹션 3 -2」(block, 앞자리 0 없음 · - 뒤 공백 없음) · 「섹션 1 렌더링」(section 실행 실패) */
export function formatN5ReviewIssueLocation(issue: N5ReviewIssue): string {
  if (issue.blockOrder != null) return `섹션 ${issue.sectionOrder} -${issue.blockOrder}`;
  return `섹션 ${issue.sectionOrder}${issue.stageLabel ? ` ${issue.stageLabel}` : ''}`;
}
