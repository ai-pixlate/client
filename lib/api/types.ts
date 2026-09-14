/**
 * Pixate N1~N6 API DTO 타입 정의
 *
 * - 백엔드와 확정된 값은 union type으로 좁혔습니다.
 * - 아직 협의 중인 값은 string으로 열어두고 TODO를 달았습니다.
 */

import type { SectionVerdictStatus, VerdictType } from '@/lib/n3/verdict';

// ─────────────────────────────────────────────
// 확정 가능한 union type
// ─────────────────────────────────────────────

/** 현재 사용자가 머물고 있는 화면 단계 */
export type JobCurrentStep = 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'N6';

/** DB 작업 상태값 (Day 6 확정) */
export type JobDbStatus = 'draft' | 'processing' | 'review' | 'done' | 'failed' | 'archived';

/** 업로드 원본 이미지 유형. single 파이프라인은 미확정이므로 N2 이후 동작 단정 안 함 */
export type ImageType = 'multi_section' | 'single';

/** ImageType 런타임 목록. 화면에서 선택지를 순회할 때 이 상수를 재사용한다 */
export const IMAGE_TYPES = ['multi_section', 'single'] as const satisfies readonly ImageType[];

/** 섹션 포함/제외 상태. ERD 기준 문자열 (boolean 사용 안 함) */
export type SectionBucket = 'include' | 'exclude';

/**
 * 섹션 자동/수동 제외 사유 코드 (Day 6 확정).
 * 화면 표시 문구는 이 코드값을 그대로 노출하지 않고 label 매핑을 거친다.
 * (lib/api/labels.ts의 EXCLUSION_REASON_LABELS 참고)
 */
export type ExclusionReasonCode =
  | 'auto_regulatory'
  | 'auto_channel'
  | 'auto_local_irrelevant'
  | 'user_manual'
  | 'restored_by_user';

/**
 * 비동기 처리 항목 상태 (Day 6 확정).
 * TODO: TextBlock.blockStatus에는 적용하지 않음 — N5 응답 시점엔 이미 완료된
 * 블록만 내려오는 구조라 'running'이 실제로 쓰이는지 백엔드 확인 필요.
 */
export type ProcessingStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * 섹션 경고 뱃지 코드 (Day 6 확정, v3.4.1에서 Section.warningBadge로 연결).
 * 처리 파이프라인 문제 신호이며, section.verdicts(규제/현지화 판정)와는
 * 다른 축이다 — 둘을 하나로 합쳐 파생하지 않는다.
 */
export type SectionWarningBadge = 'processing_failed' | 'quality_warning';

/**
 * 산출물 이미지 용도 구분 (Day 6 확정).
 * TODO: Deliverable에 대응 필드 없음. 9월 MVP는 detail만 다루므로 필드 추가는 보류.
 */
export type DeliverableUsageType = 'detail' | 'thumbnail_main' | 'thumbnail_sub';

/**
 * 검증 적용 범위 (Day 6 확정).
 * TODO: ValidationItem/ValidationResult에 대응 필드 없음. 필드 추가는 보류.
 */
export type ValidationScope = 'detail' | 'thumbnail_main' | 'thumbnail_sub' | 'all';

/**
 * 텍스트 블록 역할. 번역 톤·규제 검증 강도가 이 값에 따라 달라짐.
 * product_label(v3.4.1 추가): 제품 용기/패키지 사진 안에 인쇄된 글자 —
 * 번역·인페인팅 대상에서 제외하고 원본 상태로 남긴다. 처리 파이프라인은
 * 이번 작업 범위 밖이며, FE는 타입 수용·표시만 맞춘다.
 *
 * product_label의 "제외"는 section.bucket(섹션 단위 포함/제외)과는 다른 축이다
 * — role=product_label은 text block 단위 번역·인페인팅 제외를 뜻하고, 그 판단은
 * role 자체가 정본이다(TextBlock에 별도 is_excluded류 API 필드는 없다). 향후
 * N5에서 block 단위 제외 표시가 필요해지면 role === 'product_label'을 정본으로
 * 삼는다 — section.bucket에서 파생시키지 않는다.
 */
export type BlockRole = 'title' | 'body' | 'caption' | 'price' | 'caution' | 'product_label';

/** BlockRole 런타임 목록. 화면에서 선택지를 순회하거나 fixture를 만들 때 이 상수를 재사용한다 */
export const BLOCK_ROLES = [
  'title',
  'body',
  'caption',
  'price',
  'caution',
  'product_label',
] as const satisfies readonly BlockRole[];

/** 번역 상태 */
export type TranslationStatus = 'machine' | 'userEdited';

/** polling failedItems 항목 유형 */
export type FailedItemType = 'section' | 'textBlock';

// ─────────────────────────────────────────────
// 협의 필요 — 현재 string으로 열어둠
// ─────────────────────────────────────────────

/**
 * 비동기 처리 세부 단계.
 * TODO: 백엔드 파이프라인 명세 확정 후 union으로 좁힐 것.
 * N2 후보: 'ocr' | 'section_decomposition' | 'verdict'
 * N4 후보: 'inpainting' | 'translation' | 'compliance_check' | 'render'
 */
export type ProcessingSubStep = string;

/**
 * 텍스트 블록 편집 상태 (v3.4.1 확정).
 * 'failed'는 이 필드에 없다 — blockStatus는 편집 상태만 표현하고,
 * 번역 실패 여부는 TextBlock.translationFailed가 정본이다. 두 축을 다시
 * 합치지 않는다(번역이 실패해도 편집 자체는 완료된 상태일 수 있다).
 */
export type BlockStatus = 'machine' | 'edited';

/**
 * 규제 위반 플래그 코드.
 * TODO: 백엔드 규제 DB 규격 확정 후 union으로 좁힐 것.
 * 후보: 'PROHIBITED_EXPRESSION' | 'UNVERIFIED_CLAIM' 등
 */
export type ComplianceFlag = string;

/**
 * 규격 유형.
 * TODO: 9월 MVP는 'original'만 활성. 사이트별·커스텀은 비활성.
 */
export type SpecType = string;

// ─────────────────────────────────────────────
// N2 / N4 / N6 polling 공용 — GET /api/jobs/:jobId/status
// ─────────────────────────────────────────────

export interface FailedItem {
  id: string;
  type: FailedItemType;
  reason: string;
  /**
   * TODO(백엔드 v1.4 계약 대기): 개별/일괄 재시도 API와 함께 taskId(재시도
   * 대상 비동기 task 식별자), retryable(boolean, 재시도 가능 여부)이 추가될
   * 예정이다. v1.4 계약 확정 전까지는 타입·런타임 어느 쪽에도 반영하지 않는다.
   */
}

export interface JobStatusResponse {
  jobId: string;
  currentStep: JobCurrentStep;
  dbStatus: JobDbStatus;
  /** 0~100 전체 진행률 */
  progress: number;
  /** 현재 세부 처리 단계. N2/N4/N6마다 다른 값 사용 */
  processingSubStep: ProcessingSubStep;
  /** N4 병렬 처리 중 활성 서브스텝 목록 (N4 전용, N2/N6에서는 빈 배열) */
  activeSubSteps: ProcessingSubStep[];
  hasFailed: boolean;
  failedItems: FailedItem[];
}

// ─────────────────────────────────────────────
// N1 — job 생성 관련
// ─────────────────────────────────────────────

export interface SourceImageMeta {
  fileId: string;
  order: number;
  imageType: ImageType;
}

export interface CreateJobRequest {
  brandId: string;
  sourceImages: SourceImageMeta[];
  targetCountry: string;
  targetLanguage: string;
  /** TODO: 허용 분류값 목록 백엔드 확정 필요 */
  regulatoryClass: string;
  specId: string;
  displayCategory: string;
  keywords: string[];
}

export interface CreateJobResponse {
  jobId: string;
}

// ─────────────────────────────────────────────
// N3 — 섹션 확인
// ─────────────────────────────────────────────

export interface SectionVerdict {
  verdictId: string;
  /**
   * 서버/generated column의 정본 (v3.4.1). verdictStatus로부터 파생하지
   * 않는다 — FE 화면과 export에서 별도로 다시 계산하지 않고 API가 내려준
   * 6값 union을 그대로 사용한다. (lib/n3/verdict.ts 참고)
   */
  verdictType: VerdictType;
  /**
   * verdict_status 전체 어휘(7종) 중 실제로 판정 행을 만드는 5종만 받는다.
   * allowed/cultural은 판정 행 자체를 만들지 않으므로 여기 올 수 없다.
   * (lib/n3/verdict.ts의 SectionVerdictStatus 참고)
   */
  verdictStatus: SectionVerdictStatus;
  problemText: string;
  basis: string;
  /**
   * 대체 가능한 표현 제안 (v3.4.1). verdictType='regulatory_replaceable'처럼
   * 대체 표현이 존재하는 판정에서만 값이 있고, 그 외에는 null이다.
   */
  alternativeExpression: string | null;
  /** 판정 근거의 출처/증빙 링크 (v3.4.1). 없으면 null. */
  evidenceUrl: string | null;
}

/**
 * Section.originalVerdict 배열 원소 (v3.4.1, DB original_verdict JSONB 원소
 * 구조). 되살리기 시점에 스냅샷된 판정 한 건을 나타내며, live SectionVerdict와는
 * 별도 타입이다 — verdictId 같은 live 전용 필드는 없고, 스냅샷 고유 필드
 * (basisArticle/reason/dictionaryId/capturedAt)를 갖는다.
 */
export interface OriginalVerdictSnapshot {
  /** 스냅샷 시점의 판정 유형. (SectionVerdict.verdictType과 같은 6종 계약) */
  verdictType: VerdictType;
  /** 스냅샷 시점의 판정 상태. (SectionVerdict.verdictStatus와 같은 5종 계약) */
  verdictStatus: SectionVerdictStatus;
  /** 스냅샷 시점의 문제 표현 원문. */
  problemText: string;
  /** 판정 근거가 된 규정 조항. 조항 인용이 없는 판정은 null. */
  basisArticle: string | null;
  /** 판정 근거의 출처/증빙 링크. 없으면 null. */
  evidenceUrl: string | null;
  /** 판정 사유 설명. */
  reason: string;
  /** 판정이 참조한 규제 사전(dictionary) 항목 id. 사전 미매칭 판정은 null. */
  dictionaryId: string | null;
  /** 스냅샷을 뜬 시각 (ISO 8601). */
  capturedAt: string;
}

/**
 * 사각형 bbox (모듈 좌표 사용 안 함).
 * 좌표 기준(원본 이미지 절대 좌표 vs 소속 요소 내부 local 좌표)은
 * 사용하는 필드(Section.bbox / TextBlock.bbox)의 주석을 따른다 — 이 타입 자체는
 * x/y/width/height 형태만 정의한다.
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Section {
  sectionId: string;
  sourceImageId: string;
  /**
   * 섹션 순번.
   * TODO: job 전체 기준인지 sourceImage 기준인지 백엔드와 협의 필요.
   */
  sectionOrder: number;
  thumbnailUrl: string;
  /**
   * 섹션 원본 이미지 식별자 (v3.4.1, DB section.image_key 그대로 camelCase).
   * thumbnailUrl(목록 표시용 축소 미리보기)과는 별개 — N3에서 처리 결과를
   * 원본과 나란히 비교할 때 쓰는 전체 크기 원본 이미지를 가리킨다.
   */
  imageKey: string;
  /**
   * 섹션 렌더(번역·인페인팅 처리) 결과 이미지 식별자 (v3.4.1, DB
   * section.render_image_key 그대로 camelCase). imageKey와 짝을 이뤄
   * 원본/처리 결과 비교에 쓰인다.
   */
  renderImageKey: string;
  bucket: SectionBucket;
  /** 사용자가 직접 입력하지 않음. 시스템 또는 자동 판정으로 설정 */
  exclusionReason: ExclusionReasonCode | null;
  /**
   * 어느 단계에서 제외됐는지. N1~N6 중 실제로는 N3 / N5만 쓰임.
   * - 'N3': N3에서 제외됨 — N5에 표시되지 않음
   * - 'N5': N5에서 제외됨 — N5에 회색으로 표시됨
   * - null: 제외되지 않음 또는 포함 상태
   */
  excludedStage: JobCurrentStep | null;
  /** 원본 이미지 기준 bbox */
  bbox: BoundingBox;
  verdicts: SectionVerdict[];
  /**
   * 처리 파이프라인 경고 뱃지 (v3.4.1). section.verdicts(규제/현지화 판정)와는
   * 다른 축 — AI 처리 자체의 실패/품질 신호다. 경고가 없으면 null
   * (SectionWarningBadge에는 "정상" 값이 없으므로 nullable로 표현한다).
   */
  warningBadge: SectionWarningBadge | null;
  /**
   * 되살리기(exclude → include) 시점의 판정 스냅샷 배열 (v3.4.1, DB
   * section.original_verdict JSONB). 컬럼명은 단수지만 실제로는 판정 행
   * 여러 개를 담는 배열이라 단일 VerdictType으로 축약하지 않는다 —
   * SectionVerdict가 아니라 Section 필드다. 되살리기가 없었으면 null이고,
   * 판정 행이 없는 상태에서 되살렸다면 빈 배열([])일 수 있다.
   * TODO: 되살리기 UI/API가 아직 없어 실제로 채워지는 시점은 미확정.
   */
  originalVerdict: OriginalVerdictSnapshot[] | null;
}

export interface SectionsResponse {
  sections: Section[];
}

export interface UpdateSectionBucketRequest {
  bucket: SectionBucket;
}

// ─────────────────────────────────────────────
// N5 — 검수
// ─────────────────────────────────────────────

/**
 * 번역 결과가 영역을 초과할 때 자동 조정된 내역 (구조체 계약, v3.4.1).
 * DB auto_adjust 컬럼(font_scale/line_break_applied)을 camelCase로 그대로 옮긴다.
 * fontScale=1이고 lineBreakApplied=false여도 "조정 시도는 했으나 변화 없음"과
 * "조정 자체가 없었음"을 구분할 수 없으므로, 실제 조정 발생 여부는 객체
 * 존재만으로 판단하지 않고 fontScale !== 1 || lineBreakApplied로 판단한다.
 */
export interface AutoAdjust {
  fontScale: number;
  lineBreakApplied: boolean;
}

export interface TextBlock {
  blockId: string;
  sectionId: string;
  sourceText: string;
  /**
   * 번역문. DB text_block.trans_1 컬럼을 그대로 담는다 — 9월 MVP는 trans_1만
   * 런타임에 매핑한다. trans_2(12월 예정)는 이번 계약 범위 밖이라 타입·런타임
   * 어느 쪽에도 반영하지 않는다.
   * TODO(12월): trans_2 계약이 확정되면 별도 필드로 추가한다. 번역 후보 선택
   * UI(candidates)는 v3.2.1부터 계약 자체가 폐기됐으므로 다시 만들지 않는다 —
   * trans_2는 후보 목록이 아니라 별개 목적의 컬럼으로 다룬다.
   */
  translatedText: string;
  translationStatus: TranslationStatus;
  role: BlockRole;
  /** TODO: 백엔드 text_block.block_status 확정 후 union으로 좁힐 것 */
  blockStatus: BlockStatus;
  /**
   * 번역 실패 신호 (v3.4.1). blockStatus==='failed'를 대체한다 — blockStatus는
   * 편집 상태만 표현하고, 번역 성공/실패는 이 필드가 정본이다. true면
   * translatedText가 비어 있을 수 있고 UI는 직접 입력을 요구해야 한다.
   */
  translationFailed: boolean;
  needsReview: boolean;
  /** TODO: 백엔드 규제 DB 기준 코드값 확정 후 union으로 좁힐 것 */
  complianceFlags: ComplianceFlag[];
  /**
   * 자동 조정 내역. DB 컬럼이 nullable이라 조정이 필요 없었던 블록은 null이다.
   * "조정이 실제 발생했는가"는 객체 존재만으로 판정하지 않는다 — 필요하면
   * fontScale !== 1 || lineBreakApplied로 판단한다. (AutoAdjust 참고)
   */
  autoAdjust: AutoAdjust | null;
  /** 로컬라이징 근거. 읽기 전용 */
  basis: string;
  /**
   * 소속 section 내부 local 좌표 (원본 픽셀 기준). section 자신의 원본 절대
   * 위치가 아니다 — 절대 Y가 필요하면 section.topOffset(원본 절대용)
   * 또는 section.displayTop(N5 표시용)과 더해서 구한다.
   * (좌표계 기준: Pix/ate FE↔BE 구현 기준 v3.3.3)
   */
  bbox: BoundingBox;
}

/**
 * N5 좌측 뷰어 프리뷰 이미지의 원본/표시 크기.
 * scaleX = previewWidth / originalWidth, scaleY = previewHeight / originalHeight로
 * block.bbox(원본 픽셀 기준)를 화면 표시 좌표로 변환할 때 쓴다.
 * 원본/번역 프리뷰는 같은 크기를 공유한다 (ReviewSourceImage당 하나).
 */
export interface ReviewPreview {
  originalWidth: number;
  originalHeight: number;
  previewWidth: number;
  previewHeight: number;
}

/** N5 검수 화면의 소스 이미지 단위 미리보기 */
export interface ReviewSourceImage {
  sourceImageId: string;
  /** 원문(원본 텍스트 포함) 미리보기 */
  originalPreviewUrl: string;
  /** 번역 결과 합성 미리보기 */
  translatedPreviewUrl: string;
  /** 원본/번역 프리뷰가 공유하는 크기·배율 계산용 값 */
  preview: ReviewPreview;
}

export interface ReviewSection {
  sectionId: string;
  sourceImageId: string;
  sectionOrder: number;
  bucket: SectionBucket;
  /**
   * N3에서 제외된 섹션은 review 응답에서 제외됨.
   * N5에서 제외된 섹션은 'N5' 값으로 전달됨.
   */
  excludedStage: JobCurrentStep | null;
  /**
   * 이 section이 원본 sourceImage 내부에서 실제로 위치한 절대 세로 좌표
   * (DB section.top_offset을 API가 그대로 전달). exclude 여부와 무관하게
   * 그 이미지 안에서의 진짜 위치를 가리킨다 — 원본 절대 block Y를 구하려면
   * topOffset + block.bbox.y를 쓴다.
   *
   * displayTop과 절대 혼동하지 않는다: topOffset은 "원본 이미지 crop 위치"용
   * (Before/After 비교 viewer가 preview 이미지에서 이 section에 해당하는
   * 부분을 잘라 보여줄 때 씀), displayTop은 "N5 표시 스택 위치"용(exclude
   * section 누적 제외)이다. section.height로부터 역산하지 않는다 — section이
   * sourceImage를 빈틈없이 나눈다는 보장이 계약에 없기 때문이다.
   */
  topOffset: number;
  /**
   * N5 좌측 뷰어에서 이 section이 시작하는 누적 top 위치 (원본 픽셀 기준).
   * DB 저장값(top_offset)이 아니라 API가 매 응답마다 계산해 내려주는 값이다.
   * include section만 높이를 누적하고, exclude section(N3/N5 무관)은 누적하지
   * 않는다 — 그래서 원본 절대 위치(topOffset)와 다를 수 있다.
   */
  displayTop: number;
  /** section 원본 픽셀 높이. displayTop 누적 계산과 crop 창 높이에 쓰인다 */
  height: number;
  textBlocks: TextBlock[];
}

export interface ReviewResponse {
  job: {
    jobId: string;
    targetCountry: string;
    targetLanguage: string;
  };
  /** 소스 이미지 단위 미리보기 (좌측 뷰어용) */
  sourceImages: ReviewSourceImage[];
  /** 섹션 단위 텍스트 블록 목록 (우측 패널용) */
  sections: ReviewSection[];
}

export interface UpdateTranslationRequest {
  /** 번역문 수동 수정 시 사용. 단일 번역문 수정만 허용한다 (v3.2.1부터 후보 계약 폐기) */
  translatedText: string;
}

/**
 * PATCH /api/text-blocks/:blockId/translation 응답.
 * 전체 TextBlock이 아닌 업데이트된 필드만 반환합니다.
 */
export interface UpdateTranslationResponse {
  blockId: string;
  translatedText: string;
  translationStatus: TranslationStatus;
}

// ─────────────────────────────────────────────
// N6 — 최종 저장
// ─────────────────────────────────────────────

export interface ValidationItem {
  /** 규칙 식별 코드. 9월: 'FORMAT_CHECK' | 'COLOR_SPACE_CHECK' */
  ruleId: string;
  name: string;
  passed: boolean;
  actualValue: string;
  violationReason: string | null;
}

export interface ValidationResult {
  passed: boolean;
  items: ValidationItem[];
}

/**
 * 화면에 표시할 실제 결과 이미지.
 * exportArtifacts(다운로드 파일)와 다른 개념.
 */
export interface Deliverable {
  deliverableId: string;
  sourceImageId: string;
  imageUrl: string;
  format: string;
  colorSpace: string;
  fileSizeBytes: number;
  renderStatus: ProcessingStatus;
  validationResult: ValidationResult;
}

/**
 * 사용자가 다운로드할 산출물 구성요소.
 * Deliverable(결과 이미지 표시)과 다른 개념.
 *
 * 9월 MVP 구성요소: 'images' | 'content_csv' | 'html'(should)
 * export_zip은 구성요소가 아니라 선택 항목을 묶어 받는 다운로드 동작 — exportZipUrl 사용.
 * manifest.json은 서버 내부용으로 이 목록에 포함하지 않음.
 * PSD는 12월 예정 — exportArtifacts에 포함하지 않고 UI에서 비활성으로만 표시.
 */
export interface ExportArtifact {
  /** 9월: 'images' | 'content_csv' | 'html'. export_zip/manifest/psd 제외. */
  type: string;
  downloadUrl: string;
  /** images 타입에만 존재 */
  fileCount?: number;
}

export interface JobResultResponse {
  jobId: string;
  renderStatus: ProcessingStatus;
  /** 화면에 보여줄 결과 이미지 목록 */
  deliverables: Deliverable[];
  /** 다운로드할 산출물 구성요소 목록 (images, content_csv, html) */
  exportArtifacts: ExportArtifact[];
  /**
   * 선택 구성요소를 ZIP으로 묶어 받는 URL.
   * TODO: 백엔드 확정 후 필드명·동작 방식 조율 필요.
   */
  exportZipUrl: string;
  saved: boolean;
}
