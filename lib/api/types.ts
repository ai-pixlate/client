/**
 * Pixate N1~N6 API DTO 타입 정의
 *
 * - 백엔드와 확정된 값은 union type으로 좁혔습니다.
 * - 아직 협의 중인 값은 string으로 열어두고 TODO를 달았습니다.
 */

// ─────────────────────────────────────────────
// 확정 가능한 union type
// ─────────────────────────────────────────────

/** 현재 사용자가 머물고 있는 화면 단계 */
export type JobCurrentStep = 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'N6';

/** 업로드 원본 이미지 유형. thumbnail 파이프라인은 미확정이므로 N2 이후 동작 단정 안 함 */
export type ImageType = 'detail' | 'thumbnail';

/** 섹션 포함/제외 상태. ERD 기준 문자열 (boolean 사용 안 함) */
export type SectionBucket = 'include' | 'exclude';

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
 * DB 작업 상태값.
 * TODO: 백엔드 ERD 확정 후 union으로 좁힐 것.
 * 후보: 'draft' | 'processing' | 'review' | 'done' | 'failed' | 'archived'
 */
export type JobDbStatus = string;

/**
 * 비동기 처리 세부 단계.
 * TODO: 백엔드 파이프라인 명세 확정 후 union으로 좁힐 것.
 * N2 후보: 'ocr' | 'section_decomposition' | 'verdict'
 * N4 후보: 'inpainting' | 'translation' | 'compliance_check' | 'render'
 */
export type ProcessingSubStep = string;

/**
 * 섹션 판정 유형.
 * TODO: 백엔드 section_verdict 테이블 기준 확정 후 union으로 좁힐 것.
 * 후보: 'regulatory' | 'localization' | 'brand_guideline'
 */
export type VerdictType = string;

/**
 * 섹션 판정 상태.
 * TODO: 백엔드 section_verdict 테이블 기준 확정 후 union으로 좁힐 것.
 * 후보: 'passed' | 'warning' | 'failed'
 */
export type VerdictStatus = string;

/**
 * 텍스트 블록 처리 상태.
 * TODO: 백엔드 text_block.block_status 컬럼 기준 확정 후 union으로 좁힐 것.
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
  /** TODO: 백엔드 ERD 확정 후 JobDbStatus union으로 좁힐 것 */
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
  /** TODO: 백엔드 확정 후 union으로 좁힐 것 */
  verdictType: VerdictType;
  /** TODO: 백엔드 확정 후 union으로 좁힐 것 */
  verdictStatus: VerdictStatus;
  problemText: string;
  basis: string;
}

/** 원본 이미지 좌표 기준 bbox (모듈 좌표 사용 안 함) */
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
  exclusionReason: string | null;
  /**
   * 어느 단계에서 제외됐는지.
   * TODO: 백엔드 계약 확정 후 union으로 좁힐 것.
   * 후보: 'N3' | 'N5' | null
   * - 'N3': N3에서 제외됨 — N5에 표시되지 않음
   * - 'N5': N5에서 제외됨 — N5에 회색으로 표시됨
   * - null: 제외되지 않음 또는 포함 상태
   */
  excludedStage: string | null;
  /** 원본 이미지 기준 bbox */
  bbox: BoundingBox;
  verdicts: SectionVerdict[];
}

export interface SectionsResponse {
  sections: Section[];
}

export interface UpdateSectionBucketRequest {
  bucket: SectionBucket;
  /**
   * 어느 단계에서 bucket을 변경하는지.
   * Mock 검증용 임시 필드. 백엔드 계약 확정 전.
   * 'N3' | 'N5' — 제외 시 사용. 복구(include) 시 생략.
   */
  stage?: string;
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
  /** 원본 이미지 기준 bbox */
  bbox: BoundingBox;
  /**
   * "다른 번역 보기" 기능용 후보 목록.
   * TODO: 생성 개수·기준 백엔드와 협의 필요.
   */
  candidates: TranslationCandidate[];
}

/** N5 검수 화면의 소스 이미지 단위 미리보기 */
export interface ReviewSourceImage {
  sourceImageId: string;
  /** 원문(원본 텍스트 포함) 미리보기 */
  originalPreviewUrl: string;
  /** 번역 결과 합성 미리보기 */
  translatedPreviewUrl: string;
}

export interface ReviewSection {
  sectionId: string;
  sourceImageId: string;
  sectionOrder: number;
  bucket: SectionBucket;
  /**
   * N3에서 제외된 섹션은 review 응답에서 제외됨.
   * N5에서 제외된 섹션은 'N5' 값으로 전달됨.
   * TODO: 백엔드 계약 확정 후 union으로 좁힐 것.
   */
  excludedStage: string | null;
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
  /** TODO: 백엔드 확정 후 union으로 좁힐 것. 후보: 'pending' | 'done' | 'failed' */
  renderStatus: string;
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
  /** TODO: 백엔드 확정 후 union으로 좁힐 것. 후보: 'pending' | 'done' | 'failed' */
  renderStatus: string;
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
