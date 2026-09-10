/**
 * Pixate N1~N6 API DTO 타입 정의
 *
 * - 백엔드와 확정된 값은 union type으로 좁혔습니다.
 * - 아직 협의 중인 값은 string으로 열어두고 TODO를 달았습니다.
 */

import type { VerdictStatus, VerdictType } from '@/lib/n3/verdict';

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
 * 섹션 경고 뱃지 코드 (Day 6 확정).
 * TODO: 현재 DTO에 대응 필드가 없음 (UI가 hasFailed/needsReview 등 boolean 조합으로
 * 파생 표시 중). 필드 연결은 백엔드 계약 확정 후 별도 진행.
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

/** 텍스트 블록 역할. 번역 톤·규제 검증 강도가 이 값에 따라 달라짐 */
export type BlockRole = 'title' | 'body' | 'caption' | 'price' | 'caution';

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
 * 텍스트 블록 처리 상태.
 * TODO: 백엔드 text_block.block_status 컬럼 기준 확정 후 union으로 좁힐 것.
 * ProcessingStatus와 의미는 겹치지만, N5 응답 시점 특성상 'running'이 실제로
 * 쓰이는지 불확실해 아직 ProcessingStatus를 적용하지 않음.
 * 후보: 'pending' | 'done' | 'failed'
 */
export type BlockStatus = string;

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
  /** verdictStatus에서만 파생된다. lib/n3/verdict.ts의 getVerdictType() 참고 */
  verdictType: VerdictType;
  verdictStatus: VerdictStatus;
  /**
   * policy(채널 정책) 판정에서만 의미를 가진다.
   * - true: 배지만 표시. section을 exclude 대상으로 보내지 않는다.
   * - false: 실제 채널 정책 판정. 기본 exclude 대상.
   * regulated/conditional/irrelevant/needs_fix에서는 사용하지 않는다.
   */
  isTeaser: boolean;
  problemText: string;
  basis: string;
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

export interface TranslationCandidate {
  candidateId: string;
  translatedText: string;
  isSelected: boolean;
}

export interface TextBlock {
  blockId: string;
  sectionId: string;
  sourceText: string;
  translatedText: string;
  translationStatus: TranslationStatus;
  role: BlockRole;
  /** TODO: 백엔드 text_block.block_status 확정 후 union으로 좁힐 것 */
  blockStatus: BlockStatus;
  needsReview: boolean;
  /** TODO: 백엔드 규제 DB 기준 코드값 확정 후 union으로 좁힐 것 */
  complianceFlags: ComplianceFlag[];
  /** 번역 결과가 영역을 초과해 자동 축소됐는지 여부 */
  autoAdjust: boolean;
  /** 로컬라이징 근거. 읽기 전용 */
  basis: string;
  /**
   * 소속 section 내부 local 좌표 (원본 픽셀 기준). section 자신의 원본 절대
   * 위치가 아니다 — 절대 Y가 필요하면 section.topOffset(원본 절대용)
   * 또는 section.displayTop(N5 표시용)과 더해서 구한다.
   * (좌표계 기준: Pix/ate FE↔BE 구현 기준 v3.3.3)
   */
  bbox: BoundingBox;
  /**
   * "다른 번역 보기" 기능용 후보 목록.
   * TODO: 생성 개수·기준 백엔드와 협의 필요.
   */
  candidates: TranslationCandidate[];
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
  /** 수동 수정 시 사용 */
  translatedText?: string;
  /** "다른 번역 보기"에서 선택 시 사용 */
  candidateId?: string;
}

/**
 * PATCH /api/text-blocks/:blockId/translation 응답.
 * 전체 TextBlock이 아닌 업데이트된 필드만 반환합니다.
 */
export interface UpdateTranslationResponse {
  blockId: string;
  translatedText: string;
  translationStatus: TranslationStatus;
  candidates: TranslationCandidate[];
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
