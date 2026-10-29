'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  useCreateJobMutation,
  useAnalyzeJobMutation,
  useCancelJobMutation,
  useMasterCategoriesQuery,
  usePatchJobMutation,
} from '@/lib/queries/pixlate';
import type { ApiRegulatoryClass } from '@/lib/api/job-schema';
import { N1ExitDialog } from './_components/n1-exit-dialog';
import { RegulatoryClassDropdown, type RegulatoryClassOption } from './_components/regulatory-class-dropdown';
import { SourceImageUploadStatus } from './_components/source-image-upload-status';
import {
  buildCategoryTree,
  findCategoryPath,
  formatCategoryPath,
  isCategoryLeaf,
  type CategoryNode,
} from './_lib/category-tree';
import { isN1Ready, requiresOtcType } from './_lib/n1-readiness';
import { useSourceImageUploads } from './_lib/use-source-image-uploads';
import { StepNav } from '../[jobId]/_components/step-nav';

// ─────────────────────────────────────────────────────────────────
// UI용 임시 상수 — 실제 백엔드 연결 시 API 데이터로 교체할 것
// ─────────────────────────────────────────────────────────────────

// TODO: 백엔드 국가 목록 API 연결 시 교체
const COUNTRY_OPTIONS = [
  { value: 'US', label: '미국 (US)' },
  { value: 'JP', label: '일본 (JP)' },
  { value: 'CN', label: '중국 (CN)' },
  { value: 'DE', label: '독일 (DE)' },
  { value: 'FR', label: '프랑스 (FR)' },
];

// TODO: 백엔드 언어 목록 API 연결 시 교체
const LANGUAGE_OPTIONS = [
  { value: 'en', label: '영어' },
  { value: 'ja', label: '일본어' },
  { value: 'zh', label: '중국어 간체' },
  { value: 'de', label: '독일어' },
  { value: 'fr', label: '프랑스어' },
];

/**
 * 국가 → 추천 언어. N1 Figma 재정합(3단계) 조사 결과, 이 관계를 일반적으로
 * 정의한 매핑(맵/API)이 백엔드·설계 문서 어디에도 없다 — 오히려
 * docs/reference/pixate-frontend-data-spec.md는 "국가와 언어는 독립 축이며
 * 자유 조합을 허용한다"고 명시한다. 실제 데이터로 뒷받침되는 조합은
 * lib/mock-api/n5-fixtures.ts의 mockN5Job(targetCountry:'US',
 * targetLanguage:'en')과 Figma(525:3023)가 직접 보여준 "미국→영어" 하나뿐이라,
 * 그 조합만 담는다. JP→ja, CN→zh, DE→de, FR→fr 같은 나머지 조합은 실제
 * 데이터 근거가 없어 임의로 추가하지 않았다 — 관계가 정의되면 이 맵에 추가한다.
 */
const COUNTRY_RECOMMENDED_LANGUAGE: Partial<Record<string, string>> = {
  US: 'en',
};

// 규제 분류 — 미국 MVP 4종. 값은 OpenAPI RegulatoryClass enum 그대로 보내고, 라벨은 Figma(525:3023
// dropdown open 1502:21358) 표기다. 화면 문자열을 API 값으로 보내지 않는다.
// TODO: GET /master/regulatory-classes?country= 연결 시 교체
const REGULATORY_CLASS_OPTIONS: RegulatoryClassOption[] = [
  { value: 'cosmetic', label: '화장품' },
  { value: 'otc', label: 'OTC 화장품' },
  { value: 'combination', label: '화장품+OTC 복합' },
  { value: 'unknown', label: '잘모름' },
];

/**
 * 선택값별 검사 기준 안내 (helper text). 복합 문구는 PRD v3.5.10 F-LNG-03 한계 고지(★초안) 그대로다 —
 * PRD는 이 고지를 복합에만 두고 OTC 의약품에는 두지 않는다. Figma(525:3023) 문구와 다르면 PRD를 따른다.
 */
const REGULATORY_CLASS_HELPER: Partial<Record<ApiRegulatoryClass, string[]>> = {
  unknown: ['잘 모름을 선택하면 화장품 기준으로 검사됩니다.'],
  combination: [
    '복합 제품은 고른 OTC 종류와 같은 기준으로 검사합니다(화장품 규칙 포함).',
    '제품이 그 OTC 기준(성분 · 함량 · 시험)을 실제로 충족하는지는 확인하지 않습니다.',
  ],
};

/**
 * OTC 종류 — PRD v3.5.10 F-LNG-03 · 용어집 「OTC 종류(monograph_key)」 미국 4종. 값은 용어집의 열쇠,
 * 라벨은 Figma(525:3023) 태그 표기(한글 이름은 PRD v3.5.10 「비듬·지루성 피부염·건선」).
 * BLOCKED — DATA CONTRACT: OpenAPI v3.4.2 JobPatch에 OTC 종류 필드가 없어 화면 선택만 하고 서버로 보내지 않는다.
 */
const OTC_TYPE_OPTIONS = [
  { value: 'M020', label: '선크림 (Sunscreen)' },
  { value: 'M006', label: '여드름 (Acne)' },
  { value: 'M032', label: '비듬·지루성 피부염·건선 (Dandruff · Seborrheic Dermatitis · Psoriasis)' },
  { value: 'M016', label: '피부보호제 (Skin Protectant)' },
];

/** PRD v3.5.10 F-ACC-04 동의 체크 문구 — 고지를 겸하므로 고지 문장을 따로 두지 않는다. 줄바꿈 위치는 Figma(1170:6002) */
const RESPONSIBILITY_CONSENT_LINES = [
  '결과물에 쓰는 인증·시험 결과, 광고 문구, 인증 로고의 사용 권한과 그 책임이 사용자에게 있으며,',
  '규제·현지 검사 결과는 참고용 권고이며, 올린 이미지와 문구가 외부 AI 서비스로 전송됨을 확인했습니다.',
];

/** PRD v3.5.10 F-SRC-08 툴팁 두 줄 — 버튼 상태와 관계없이 같다 */
const CERTIFICATION_TOOLTIP_LINES = [
  '사이즈 변경을 고르면 인증 마크를 올릴 수 있어요.',
  '인증 및 시험 정보의 적용 가능 여부는 사용자가 최종 확인해야 합니다.',
];

// ─────────────────────────────────────────────────────────────────
// 공용 아이콘 — Figma glyph는 7일 만료 원격 asset이라 커밋 코드에 하드링크하지
// 않는다(N5 X 아이콘과 같은 방식). 최소한의 inline SVG만 쓴다.
// ─────────────────────────────────────────────────────────────────

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 5.5L7 9L10.5 5.5" stroke="#707070" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="#707070" strokeWidth="1.3" />
      <path d="M12 12L9.5 9.5" stroke="#707070" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4V20M4 12H20" stroke="#171717" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Figma(929:7386 "Icon Button" Circle/XXS/Secondary) 실측: Glyph는 12px
// 아이콘 박스 안에서 inset-1/4(사방 25%=3px)만큼 들여 그려진다 — 즉 실제
// 선은 12px 전체가 아니라 가운데 6×6 영역(3~9) 안에만 있다. 색상도 이
// 노드에 등록된 3색(#fff bg / #eaeaea border / #707070) 중 유일하게 남는
// text/secondary #707070이다(검정 #171717이 아니다).
function CloseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 3L9 9M9 3L3 9" stroke="#707070" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// Figma Card/Utility/Info 20(53:1759) — Glyph 박스 inset 15%(3~17) 안의 원 + i
function InfoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="#171717" strokeWidth="1.25" />
      <path d="M10 9V13.5" stroke="#171717" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="10" cy="6.75" r="0.75" fill="#171717" />
    </svg>
  );
}

// Figma Card/Action/Check 16(53:1166) — Glyph 박스 inset 30%/22.5% 안의 체크
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.6 8.2L6.6 11.1L12.4 4.9" stroke="#ff6a38" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5.5 3.5L9 7L5.5 10.5" stroke="#999" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * POST /jobs Idempotency-Key. OpenAPI상 권장(optional) 헤더라 만들 수 없으면 키 없이 생성한다.
 * crypto.randomUUID는 secure context(HTTPS·localhost)에서만 존재한다 — 일반 HTTP 호스트·LAN IP에서는
 * undefined라 그대로 호출하면 작업 생성 자체가 막힌다.
 */
function createIdempotencyKey(): string | null {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null;
}

// ─────────────────────────────────────────────────────────────────
// 필드 레이블 — Figma 기준(필수: text-[#171717] + orange *, 선택: text-[#707070])
// ─────────────────────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p className={`text-[16px] tracking-[-0.03em] ${required ? 'text-[#171717]' : 'text-[#707070]'}`}>
      {children}
      {required && <span className="ml-1 text-[#ff6a38]">*</span>}
    </p>
  );
}

// 필수값 오류 — Figma에 입력 오류 상태가 없어 프로젝트의 오류 문구 패턴(text-red-500 12px 한 줄)을 쓴다.
// 문구로 알리므로 색만으로 상태를 전달하지 않는다. 해당 필드를 한 번 건드린 뒤에만 보인다.
function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-[12px] tracking-[-0.01em] text-red-500">
      {children}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────
// 카테고리 선택 모달 (Figma 381:6293 "카테고리 선택")
//
// Figma 프레임은 흰 카드(drop-shadow) + 검색 입력 + 단별 목록뿐이다. 목록은
// GET /master/categories 트리이고 대분류·중분류·소분류 3단으로 보인다. PRD v3.5.10
// F-SRC-04는 9월에 [선택하기] 트리 창 + [확인]이고 검색칸은 12월이라, 검색
// 입력은 숨기고 [취소]·[확인]을 기존 Button 스타일로 보완했다. leaf(하위 없음 —
// isCategoryLeaf)를 골라야만 [확인]이 열린다. leaf를 눌러도
// 창 안의 선택만 바뀌고, [확인]을 눌러야 N1 값이 바뀐다. 취소·바깥 클릭·Esc는
// 선택 전 값을 그대로 둔다. backdrop은 화면을 어둡게 가리지 않는(Figma에 없음)
// 투명 캐처다. 불러오는 중·실패는 Figma에 없어 프로젝트 공통 한 줄 문구로 보완했다
// (실패는 서버 재시도 여부와 무관하게 같은 GET을 다시 부르는 [다시 시도]만 둔다).
// ─────────────────────────────────────────────────────────────────

function CategoryColumn({
  heading,
  items,
  selectedId,
  onSelect,
  showChevron,
}: {
  heading: string;
  items: CategoryNode[];
  selectedId: number | null;
  onSelect: (node: CategoryNode) => void;
  showChevron: boolean;
}) {
  return (
    // 대분류 11종이 낮은 창에서 넘치면 단마다 따로 스크롤한다
    <div className="flex min-h-0 w-[277px] shrink-0 flex-col items-start overflow-y-auto">
      <div className="flex w-full shrink-0 items-center px-4 py-2">
        <p className="text-[12px] font-light tracking-[-0.04em] text-[#999]">{heading}</p>
      </div>
      {items.map((item) => {
        const isSelected = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            aria-pressed={isSelected}
            className={`flex w-full shrink-0 items-center justify-between px-4 py-[18px] text-left text-[14px] tracking-[-0.01em] transition-colors ${
              isSelected ? 'bg-[#f5f5f5] text-[#ff6a38]' : 'text-[#707070] hover:bg-gray-50'
            }`}
          >
            <span>{item.name}</span>
            {showChevron && !isCategoryLeaf(item) && <ChevronRightIcon />}
          </button>
        );
      })}
    </div>
  );
}

const CATEGORY_COLUMN_HEADINGS = ['대분류', '중분류', '소분류'];

function CategoryModal({
  tree,
  status,
  onRetry,
  currentId,
  onClose,
  onConfirm,
}: {
  tree: CategoryNode[];
  status: 'pending' | 'error' | 'success';
  onRetry: () => void;
  currentId: number | null;
  onClose: () => void;
  onConfirm: (id: number) => void;
}) {
  // 창 안의 임시 경로 — [확인] 전에는 N1 값(categoryId)을 바꾸지 않는다
  const [path, setPath] = useState<CategoryNode[]>(() =>
    currentId !== null ? (findCategoryPath(tree, currentId) ?? []) : [],
  );
  const last = path.at(-1);
  const selectedLeaf = last && isCategoryLeaf(last) ? last : null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const columnItems = (depth: number) => (depth === 0 ? tree : (path[depth - 1]?.children ?? []));

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="카테고리 선택"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-1/2 left-1/2 flex w-[1203px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col items-start gap-3 rounded-[5px] bg-white px-7 py-5 drop-shadow-[2px_2px_12px_rgba(0,0,0,0.06)]"
      >
        {status === 'success' && tree.length > 0 ? (
          <div className="flex max-h-[min(680px,calc(100vh-160px))] w-full items-stretch gap-1.5 overflow-x-auto">
            {CATEGORY_COLUMN_HEADINGS.map((heading, depth) => (
              <Fragment key={heading}>
                {depth > 0 && <div className="w-px shrink-0 self-stretch bg-[#eaeaea]" />}
                <CategoryColumn
                  heading={heading}
                  items={columnItems(depth)}
                  selectedId={path[depth]?.id ?? null}
                  showChevron={depth < CATEGORY_COLUMN_HEADINGS.length - 1}
                  onSelect={(node) => setPath((prev) => [...prev.slice(0, depth), node])}
                />
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[120px] w-full items-center justify-center gap-3" data-testid="n1-category-status">
            {status === 'pending' && (
              <p role="status" className="text-[14px] tracking-[-0.01em] text-[#707070]">
                카테고리를 불러오는 중입니다.
              </p>
            )}
            {status === 'error' && (
              <>
                <p role="alert" className="text-[12px] text-red-500">
                  카테고리를 불러오지 못했습니다.
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-[6px] border border-[#eaeaea] bg-white px-4 py-2 text-[12px] font-medium text-[#171717] hover:bg-gray-50"
                >
                  다시 시도
                </button>
              </>
            )}
            {status === 'success' && (
              <p role="status" className="text-[14px] tracking-[-0.01em] text-[#707070]">
                선택할 수 있는 카테고리가 없습니다.
              </p>
            )}
          </div>
        )}

        <div className="flex w-full justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-[#eaeaea] bg-white px-5 py-2.5 text-[14px] font-medium tracking-[-0.03em] text-[#171717] hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => {
              if (!selectedLeaf) return;
              onConfirm(selectedLeaf.id);
              onClose();
            }}
            disabled={!selectedLeaf}
            className="rounded-[6px] bg-[#171717] px-5 py-2.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// N1 페이지 (Figma node 525:3023 "N1 이미지 정보 입력" 기준)
// ─────────────────────────────────────────────────────────────────

export default function NewJobPage() {
  // useSearchParams()는 정적 렌더링 시 이 컴포넌트를 Suspense 경계까지
  // client-only로 opt-in시킨다(Next.js 공식 요구사항) — fallback 없이 즉시
  // 그리는 얇은 wrapper로 감싼다.
  return (
    <Suspense fallback={null}>
      <NewJobPageInner />
    </Suspense>
  );
}

function NewJobPageInner() {
  // Client Component page에 Next.js가 넘겨주는 searchParams prop(Promise)은
  // 최초 진입(하드 로드)에서만 정확하고, 같은 경로에서 쿼리스트링만 바뀌는
  // 클라이언트 사이드(soft) 네비게이션에서는 갱신되지 않는다(Next.js 공식
  // 문서가 명시한 known caveat) — 이번 재현에서 실제 사용자는 앱 안에서
  // 링크를 타고 들어왔고(soft navigation), 그 결과 brandId가 URL엔 있는데
  // state는 빈 값으로 고정돼 있었다. 클라이언트 라우팅에도 반응하는
  // useSearchParams()로 바꿔 URL을 실제 source of truth로 삼는다.
  const searchParamsObj = useSearchParams();
  const brandId = searchParamsObj.get('brandId') ?? '';

  const router = useRouter();
  const createMutation = useCreateJobMutation();
  const patchMutation = usePatchJobMutation();
  const analyzeMutation = useAnalyzeJobMutation();
  const cancelJobMutation = useCancelJobMutation();

  // ── 폼 상태 ─────────────────────────────────────────────────────
  const [targetCountry, setTargetCountry] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('');
  const [regulatoryClass, setRegulatoryClass] = useState<ApiRegulatoryClass | ''>('');
  // OTC 종류 — 화면 선택 상태만 둔다(서버 저장 계약 없음, OTC_TYPE_OPTIONS 주석)
  const [otcType, setOtcType] = useState<string | null>(null);
  // F-ACC-04 동의 — FE 진행 조건으로만 쓴다. 동의 시각·consentId·/consents 호출은 두지 않는다(PM 결정)
  const [hasAcceptedResponsibility, setHasAcceptedResponsibility] = useState(false);
  // category_master id(leaf). PATCH /jobs/{jobId}의 categoryId로 그대로 보낸다
  const [categoryId, setCategoryId] = useState<number | null>(null);
  // 필수값 오류는 해당 필드를 한 번 건드린 뒤에만 보인다(처음부터 모든 칸을 오류로 칠하지 않는다)
  const [touched, setTouched] = useState({ productName: false, category: false, regulatoryClass: false });
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  // 원본 이미지 — 파일별 업로드 상태(idle/uploading/done/failed)와 서버 sourceImageId는 hook이 소유한다.
  const { images, notice: uploadNotice, isBusy: isUploadBusy, hasFailed: hasUploadFailed, addFiles, reorderImages, removeImage, uploadPending, retryImage, syncServerOrder } =
    useSourceImageUploads();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // productName/productCode — Figma(525:3023)에서 새로 보이는 입력 필드이자
  // 실제 OpenAPI(JobPatch/Job) 필드명 그대로(CLAUDE.md: productName 필수,
  // productCode 선택). PATCH /jobs/{jobId}로 보낸다.
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');

  const [isDragOver, setIsDragOver] = useState(false);

  // ── 나가기 확인 ─────────────────────────────────────────────────
  // ✕는 draft job 유무로 동작이 갈린다(N1ExitDialog 주석) — 작업이 있으면 DELETE /jobs/{jobId} 성공 뒤에만 나간다.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  const { reset: resetCancelJob, isPending: isCancellingJob } = cancelJobMutation;
  const closeExitConfirm = useCallback(() => {
    if (isCancellingJob) return;
    setShowExitConfirm(false);
    resetCancelJob();
  }, [isCancellingJob, resetCancelJob, setShowExitConfirm]);

  // ── 카테고리 선택 모달 (Figma 381:6293) ─────────────────────────
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const categoriesQuery = useMasterCategoriesQuery();
  const categoryTree = useMemo(() => buildCategoryTree(categoriesQuery.data ?? []), [categoriesQuery.data]);
  // 메인 필드에는 확정한 경로 전체를 보인다(예: 스킨케어 > 크림 > 아이크림)
  const selectedCategoryPath = categoryId !== null ? findCategoryPath(categoryTree, categoryId) : null;
  const selectedCategoryLabel = selectedCategoryPath ? formatCategoryPath(selectedCategoryPath) : null;

  // ── 키워드 ──────────────────────────────────────────────────────

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw || keywords.includes(kw)) return;
    setKeywords((prev) => [...prev, kw]);
    setKeywordInput('');
  };

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  // ── 이미지 업로드 ────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    // 같은 파일 재선택 허용을 위해 input 초기화
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 드래그 앤 드롭 — Figma FileUploader가 "파일을 이곳에 놓아주세요"를 보여주므로
  // 그 시각적 약속에 맞춰 최소한의 네이티브 drop 처리만 추가한다. 파일이
  // addFiles로 들어가는 이후 흐름(images state, 업로드 목록, 검증)은 클릭
  // 업로드와 완전히 동일하다 — 새 데이터 흐름이 아니라 같은 입력 경로를
  // 여는 것뿐이다.
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  // 썸네일 드래그 순서 변경(Figma 925:2529) — up/down 버튼은 이 Figma
  // 썸네일 카드에 없다(X 삭제만 있음), 드래그로 대체한다. 내부 재정렬
  // 드래그와 OS 파일 드래그(업로드)를 dataTransfer로 구분해야 하므로,
  // draggingLocalId가 채워져 있을 때만(=우리 쪽 썸네일 drag) preventDefault/
  // stopPropagation해서 상위 드롭존(파일 업로드용 onDrop)으로 번지지 않게
  // 막는다 — OS 파일 드래그는 그대로 버블시켜 기존 handleDrop이 처리한다.
  const [draggingLocalId, setDraggingLocalId] = useState<string | null>(null);
  const [dragOverLocalId, setDragOverLocalId] = useState<string | null>(null);

  // ── 유효성 검사 ──────────────────────────────────────────────────

  // 조건 정본은 _lib/n1-readiness.ts(isN1Ready) 한 곳이다.
  const isValid = isN1Ready({
    brandId,
    productName,
    targetCountry,
    targetLanguage,
    regulatoryClass,
    otcType,
    categoryId,
    hasAcceptedResponsibility,
    imageCount: images.length,
  });
  const showProductNameError = touched.productName && productName.trim() === '';
  const showCategoryError = touched.category && categoryId === null;
  const showRegulatoryClassError = touched.regulatoryClass && !regulatoryClass;
  const markRegulatoryClassTouched = () =>
    setTouched((prev) => (prev.regulatoryClass ? prev : { ...prev, regulatoryClass: true }));
  const regulatoryClassHelper = regulatoryClass ? REGULATORY_CLASS_HELPER[regulatoryClass] : undefined;

  // PRD F-LNG-03 ⑧ — 국가를 바꾸면 규제 분류와 OTC 종류를 다시 고른다
  const handleCountryChange = (value: string) => {
    setTargetCountry(value);
    setRegulatoryClass('');
    setOtcType(null);
  };

  const handleRegulatoryClassChange = (value: ApiRegulatoryClass | '') => {
    setRegulatoryClass(value);
    if (!requiresOtcType(value)) setOtcType(null);
  };

  // ── 제출 ────────────────────────────────────────────────────────
  //
  // draft-first (OpenAPI jobCreate): POST /jobs(brandId) → 원본 업로드 → PATCH
  // /jobs/{jobId}(N1 값) → (서버 순서가 화면과 다르면) reorder → analyze → N2.
  // 생성만으로 분석이 시작되지 않으며, 모든 파일이 업로드 완료되기 전에는
  // PATCH/analyze를 호출하지 않는다. 한 번 만든 draft는 재제출·개별 재시도에서
  // 계속 쓴다(PRD F-SRC-01 — 실패했다고 새 job을 만들지 않는다).

  const [draftJobId, setDraftJobId] = useState<string | null>(null);
  // POST /jobs 네트워크 중복 방지용. 같은 draft 생성 시도(성공 전 재요청)에서만 재사용한다.
  const idempotencyKeyRef = useRef<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 같은 task 안의 연속 클릭은 isSubmitting 리렌더 전에 들어온다(React가 갱신을 microtask로 미룬다) —
  // 그 사이에 POST /jobs가 여러 번 나가지 않도록 ref로 한 번 더 막는다.
  const submitInFlightRef = useRef(false);

  const handleSubmit = async () => {
    if (!isValid || isSubmitting || isUploadBusy || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      let jobId = draftJobId;
      if (!jobId) {
        idempotencyKeyRef.current ??= createIdempotencyKey();
        ({ jobId } = await createMutation.mutateAsync({ brandId, idempotencyKey: idempotencyKeyRef.current ?? undefined }));
        setDraftJobId(jobId);
      }

      // 실패한 파일이 남아 있으면 N1에 머문다 — 카드의 「다시 시도」 또는 삭제 후 다시 진행한다.
      const allUploaded = await uploadPending(jobId);
      if (!allUploaded) return;

      await patchMutation.mutateAsync({
        jobId,
        payload: {
          productName: productName.trim(),
          productCode: productCode.trim() || null,
          targetCountry,
          targetLanguage,
          regulatoryClass: regulatoryClass || null,
          // 9월 MVP: 결과물 규격은 원본 사이즈만, 이미지 유형은 다중 섹션만 지원한다(화면도 그 외 선택지를 비활성화).
          specType: 'original',
          imageType: 'multi_section',
          // GET /master/categories에서 고른 leaf id
          categoryId,
          // consentId/channelSpecId는 보내지 않는다(동의는 FE 진행 조건만 · 원본 규격은 채널 규격 없음).
          // OTC 종류도 JobPatch에 필드가 없어 보내지 않는다(BLOCKED — DATA CONTRACT, 화면에 안내).
          keywords,
        },
      });
      await syncServerOrder(jobId);
      await analyzeMutation.mutateAsync(jobId);
      router.push(`/jobs/${jobId}`);
    } catch (error) {
      setSubmitError(error);
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleExitConfirm = () => {
    // TODO: M1 보관함 route가 바뀌면 함께 교체
    if (!draftJobId) {
      router.push('/');
      return;
    }
    cancelJobMutation.mutate(draftJobId, { onSuccess: () => router.push('/') });
  };

  const handleRetryUpload = (localId: string) => {
    if (draftJobId) void retryImage(draftJobId, localId);
  };

  // 추천 태그는 targetLanguage(언어 select의 현재 선택값)가 아니라
  // targetCountry에서만 파생된다 — 국가를 바꿔도 이미 고른 언어 값은
  // 건드리지 않는다. 태그를 클릭했을 때만 setTargetLanguage가 호출된다.
  const recommendedLanguageValue = COUNTRY_RECOMMENDED_LANGUAGE[targetCountry];
  const recommendedLanguageOption = recommendedLanguageValue
    ? (LANGUAGE_OPTIONS.find((o) => o.value === recommendedLanguageValue) ?? null)
    : null;

  // ── 렌더링 ──────────────────────────────────────────────────────

  return (
    // 폰트는 app/layout.tsx(전역 1곳)에서 Pretendard를 로드하고
    // globals.css의 body font-family로 전체 화면에 적용한다 — N1에서
    // 별도로 <link>를 넣거나 font-family를 다시 걸지 않는다(body에서
    // 상속받는다).
    <div className="flex h-screen w-full bg-white">
      {/* N1 Figma 재정합(재수정) — Figma(525:3023) 실측: X 버튼(608:1434)
          x=40,y=40,w=40,h=40 → bottom=80. StepNav(608:1440) x=36,y=150,
          w=44,h=860(1080 프레임 기준). 이전 시도는 "top:calc(50%+40px)
          -translate-y-1/2"로 Figma의 1080-프레임 공식을 그대로 옮겼는데,
          이 공식은 뷰포트 높이가 1080보다 많이 작아지면(예: 800px) 계산된
          top이 X 버튼의 bottom(80)보다 작아져 1번 step이 X 버튼 뒤로
          들어가 버린다(실측 확인: 1440×800에서 겹침 재현). Figma의 860px
          자체를 억지로 재현하는 대신, X 버튼 bottom(80)+여유 20px=100px를
          "항상 지켜야 할 최소 상단 여백"으로 고정하고, 그 아래 남는 공간을
          모두 StepNav에 준다 — 뷰포트가 얼마나 짧아지든 1번 step은 X
          버튼보다 항상 아래에서 시작한다(공식이 아니라 고정 오프셋 + 남는
          공간 채우기라 음수가 될 수 없다). */}
      <div className="relative ml-9 h-full w-[44px] shrink-0">
        <button
          type="button"
          ref={exitButtonRef}
          onClick={() => setShowExitConfirm(true)}
          // [다음] 처리 중(POST /jobs 응답 전 포함)에는 막는다 — 나간 뒤 작업이 생겨 남는 것을 피한다
          disabled={isSubmitting}
          aria-label="보관함으로 나가기"
          className="absolute top-10 left-1/2 z-20 flex size-10 -translate-x-1/2 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {/* Figma(925:2530 "보관함으로 나가기") 실측: 16px Glyph 박스
              안에서 inset-1/4(사방 25%=4px)만큼 들여 그려진다 — 실제
              X선은 박스 전체가 아니라 가운데 8×8 영역(4~12)에만 있다. */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <div className="absolute inset-0 pt-[100px] pb-6">
          <StepNav currentStep="N1" />
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 헤더 — X 버튼이 좌측 rail로 옮겨가면서, 여기는 이제 제목/설명 행만
            남는다(N1 Figma 재정합 1단계). */}
        <div className="shrink-0 px-10 pt-10 pb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#171717]">이미지 입력</h1>
            <p className="text-[14px] tracking-[-0.01em] text-[#707070]">
              번역할 원본 이미지를 등록하고 작업 조건을 설정합니다.
            </p>
          </div>

          {/* 국가선택 / 언어선택 — Figma(525:3023, node 787:6016) 두 필드를
              한 줄에 배치. 각 필드 그룹은 w-[385px] 고정이고(늘어나 퍼지는
              구조가 아니다), 두 그룹 사이 gap은 40px다 — 예전엔 flex-1 +
              justify-between이라 뷰포트가 넓을수록 두 select가 거의 절반씩
              퍼졌다(N1 Figma 재정합 3단계). */}
          <div className="mt-6 flex items-center gap-10">
            <div className="flex w-[385px] shrink-0 items-center gap-5">
              <p className="shrink-0 text-[12px] tracking-[-0.02em] text-[#707070]">국가선택</p>
              <div className="relative flex-1">
                <select
                  value={targetCountry}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white px-[14px] py-[10px] text-[14px] tracking-[-0.01em] text-[#707070] outline-none focus:border-[#ff6a38]"
                >
                  <option value="">선택하세요</option>
                  {COUNTRY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2">
                  <ChevronDownIcon />
                </div>
              </div>
            </div>

            <div className="flex w-[385px] shrink-0 items-center gap-5">
              <p className="shrink-0 text-[12px] tracking-[-0.02em] text-[#707070]">언어선택</p>
              {/* 추천 태그 — 국가 선택에서 파생되는 별도 표시값이다.
                  targetLanguage(실제 선택값)를 그대로 되비추던 예전 로직과
                  분리했다: 국가만 바꿔도 언어 select는 그대로 두고, 이 태그를
                  "클릭"해야만 select 값이 바뀐다(N1 Figma 재정합 3단계). */}
              {recommendedLanguageOption && (
                <button
                  type="button"
                  onClick={() => setTargetLanguage(recommendedLanguageOption.value)}
                  aria-pressed={targetLanguage === recommendedLanguageOption.value}
                  className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-[6px] border border-[#ff6a38] bg-white px-2 text-[12px] leading-[14px] text-[#ff6a38] transition-colors hover:bg-[#faf3ed]"
                >
                  {recommendedLanguageOption.label}
                </button>
              )}
              <div className="relative flex-1">
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white px-[14px] py-[10px] text-[14px] tracking-[-0.01em] text-[#707070] outline-none focus:border-[#ff6a38]"
                >
                  <option value="">선택하세요</option>
                  {LANGUAGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2">
                  <ChevronDownIcon />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 본문: 좌 FileUploader + 우 열(필드 패널 · 동의 체크 · 버튼). Figma(525:3023)
            실측 — 업로더 x140~1324 · 우측 열 x1344(gap 20), 버튼 bottom 1010(아래 70),
            업로더 bottom 1000. 우측 열은 패널만 스크롤되고 동의 체크와 버튼은 늘 보인다. */}
        <div className="flex min-h-0 flex-1 gap-5 px-10 pb-[70px]">
          {/* 좌측 — 업로드 영역 */}
          <div
            data-testid="n1-image-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            // min-w-0 — 4열 그리드(1039px 고정)가 flex-1 아이템의 기본
            // min-width:auto(콘텐츠 크기) 때문에 부모 row를 밀어내 우측
            // 516px 패널이 뷰포트 밖으로 잘려나가는 걸 막는다(실측
            // 확인). 안쪽 스크롤 wrapper(overflow-auto)가 실제 스크롤을
            // 담당하고, 이 div는 그 스크롤 영역이 자기 폭보다 좁아지는
            // 걸 허용만 하면 된다.
            className={`mb-2.5 flex min-w-0 flex-1 flex-col items-center justify-center gap-10 rounded-[8px] border transition-colors ${
              isDragOver ? 'border-[#ff6a38] bg-[#faf3ed]' : 'border-[#eaeaea] bg-white'
            }`}
          >
            {images.length === 0 ? (
              <div className="flex flex-col items-center gap-10 px-6">
                <div className="flex flex-col items-center gap-5">
                  <div className="flex size-[72px] items-center justify-center rounded-full border border-[#eaeaea] bg-white">
                    <PlusIcon />
                  </div>
                  <div className="flex flex-col items-center gap-2 text-center">
                    <p className="text-[18px] font-medium tracking-[-0.03em] whitespace-nowrap text-[#171717]">
                      파일을 이곳에 놓아주세요.
                    </p>
                    <p className="text-[14px] tracking-[-0.01em] whitespace-nowrap text-[#707070]">또는 클릭해서 선택 · JPG, PNG</p>
                  </div>
                  <label
                    htmlFor="image-upload"
                    className="cursor-pointer rounded-[6px] bg-[#171717] px-8 py-3.5 text-[14px] font-medium tracking-[-0.03em] whitespace-nowrap text-white"
                  >
                    파일 선택
                  </label>
                </div>
                {/* 책임 고지는 하단 동의 체크(F-ACC-04)가 겸한다 — 여기에는 업로드 안내만 둔다 */}
                <p className="max-w-xl text-center text-[12px] font-light tracking-[-0.04em] text-[#999]">
                  최대 1GB · 여러 파일을 한 번에 업로드할 수 있습니다.
                </p>
              </div>
            ) : (
              // Figma(925:2529 "N1 이미지 업로드 썸네일") 실측 비율은
              // 244:320, gap은 21px(가로)/20px(세로, row1 bottom 522 →
              // row2 top 542), X 버튼은 24px 원(rounded-12) + top/right
              // 12px(=카드 폭의 4.92%) 오프셋 — 하지만 이 Figma 프레임 자체가
              // 1920px 루트라, 244px 절대값을 그대로 쓰면 1440px 뷰포트에서
              // 우측 516px 패널과 함께 4열이 가로 스크롤 없이 안 들어간다.
              // "4열×2행 한눈에 보기"가 우선이므로 카드 폭은 고정값이
              // 아니라 grid-template-columns: repeat(4, 1fr)로 부모 가용
              // 폭을 4등분한 값을 쓰고, 세로는 aspect-[244/320]로 자동
              // 계산한다(가로/세로를 따로 줄이지 않아 비율이 절대 안
              // 깨진다). 마지막 칸에 FileUploader(273:2103) 컴팩트
              // variant를 그대로 "파일 추가" 자리로 쓴다(Figma에 별도
              // "+이미지 추가" 헤더 버튼은 없다). up/down 버튼은 이 카드에
              // 없다(X만 있음) — 대신 드래그 재정렬로 대체한다.
              <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
                <p className="text-[14px] text-[#707070]">이미지 {images.length}개</p>
                <div className="grid grid-cols-4 gap-x-4 gap-y-5">
                  {images.map((img) => {
                    const isDragging = draggingLocalId === img.localId;
                    const isDragOverTarget = dragOverLocalId === img.localId && draggingLocalId !== img.localId;
                    return (
                      <div
                        key={img.localId}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', img.localId);
                          // 브라우저 기본 drag ghost가 카드 대신 내부 <img>만
                          // 원본 픽셀 크기로 캡처하는 경우가 있어(브라우저마다
                          // 다름) 카드 엘리먼트 자체를 drag image로 명시
                          // 지정한다. 카드 폭이 이제 뷰포트에 따라 달라지므로
                          // 절반 오프셋도 그 순간의 실제 렌더 크기에서
                          // 계산한다(고정 122/160 하드코딩 금지) — 어떤
                          // 뷰포트에서도 244×320 비율·object-contain 여백이
                          // 그대로 유지된 채 드래그된다.
                          const rect = e.currentTarget.getBoundingClientRect();
                          e.dataTransfer.setDragImage(e.currentTarget, rect.width / 2, rect.height / 2);
                          setDraggingLocalId(img.localId);
                        }}
                        onDragEnd={() => {
                          setDraggingLocalId(null);
                          setDragOverLocalId(null);
                        }}
                        onDragOver={(e) => {
                          // draggingLocalId가 있을 때만 우리 쪽 썸네일 재정렬
                          // 드래그다 — 그 외(OS 파일 드래그)는 막지 않고
                          // 그대로 상위 드롭존으로 버블시킨다.
                          if (!draggingLocalId) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (draggingLocalId !== img.localId) setDragOverLocalId(img.localId);
                        }}
                        onDrop={(e) => {
                          if (!draggingLocalId) return;
                          e.preventDefault();
                          e.stopPropagation();
                          reorderImages(draggingLocalId, img.localId);
                          setDraggingLocalId(null);
                          setDragOverLocalId(null);
                        }}
                        className={`relative aspect-[244/320] w-full max-w-[244px] cursor-grab overflow-hidden bg-[#eee] transition-opacity ${
                          isDragging ? 'opacity-50' : ''
                        } ${isDragOverTarget ? 'ring-2 ring-[#ff6a38]' : ''}`}
                      >
                        {/* object-contain — 원본 비율 유지, crop/stretch
                            없음. 카드 배경이 이미 #eee라 이미지가 축소
                            표시될 때 생기는 여백은 그대로 카드 배경색이
                            채운다(세로형은 좌우, 가로형은 상하 letterbox). */}
                        {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 blob: objectURL이라 next/image 최적화 대상이 아니다 */}
                        <img src={img.previewUrl} alt={img.file.name} className="h-full w-full object-contain" />
                        <SourceImageUploadStatus
                          fileName={img.file.name}
                          upload={img.upload}
                          onRetry={() => handleRetryUpload(img.localId)}
                          retryDisabled={isSubmitting || !draftJobId}
                        />
                        <button
                          type="button"
                          onClick={() => void removeImage(draftJobId, img.localId)}
                          // 업로드 중에는 삭제할 수 없다(서버 결과를 기다린다). 업로드 완료 파일은 서버 DELETE 후 지운다.
                          disabled={img.upload.status === 'uploading' || img.deleting || isSubmitting}
                          aria-label={`${img.file.name} 삭제`}
                          // top/right를 %로 둬서(12px÷244px≈4.92%) 카드가
                          // 축소돼도 여백 비율이 그대로 유지된다 — 버튼
                          // 자체 크기(24px)는 클릭 타겟 확보를 위해 고정.
                          className="absolute top-[4.92%] right-[4.92%] flex size-6 items-center justify-center rounded-full border border-[#eaeaea] bg-white hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    );
                  })}

                  <div className="flex aspect-[244/320] w-full max-w-[244px] flex-col items-center justify-center gap-5 rounded-[8px] border border-[#eaeaea] bg-white px-6 py-8">
                    <div className="flex size-10 items-center justify-center rounded-full border border-[#eaeaea] bg-white">
                      <PlusIcon size={16} />
                    </div>
                    <div className="flex flex-col items-center gap-2 text-center">
                      <p className="text-[16px] font-medium tracking-[-0.03em] whitespace-nowrap text-[#171717]">
                        파일을 드래그하거나 선택
                      </p>
                      <p className="text-[12px] tracking-[-0.01em] whitespace-nowrap text-[#707070]">JPG, PNG · 최대 1GB</p>
                    </div>
                    {/* 기존 빈 상태와 동일한 label 패턴 — htmlFor로 숨은
                        input#image-upload를 직접 연다(accessible name이
                        타일 전체 텍스트로 뭉개지지 않도록 label을 이
                        버튼 텍스트에만 좁게 건다). */}
                    <label
                      htmlFor="image-upload"
                      className="cursor-pointer rounded-[6px] bg-[#171717] px-5 py-2.5 text-[14px] font-medium tracking-[-0.03em] whitespace-nowrap text-white hover:opacity-90"
                    >
                      파일 선택
                    </label>
                  </div>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              id="image-upload"
            />
          </div>

          {/* 우측 — 필드 패널 */}
          {/* 우측 필드 패널 — Figma(643:5942) 폭 516px. get_metadata로 4개
              블록(상품명~규제분류 묶음/토글/결과물규격/핵심키워드)의 실제
              y좌표를 각각 다시 쟀다: 643:5913 bottom=305 → 673:7820
              top=359.67(gap 54.67), 673:7820 bottom=401.67 → 643:5914
              top=456.33(gap 54.66), 643:5914 bottom=616.33 → 643:5924
              top=671(gap 54.67) — 네 간격이 모두 54.6~54.7px로 사실상
              같은 값이라 gap-[55px] 하나로도 Figma 실측과 맞는다(블록마다
              다른 값을 억지로 만들지 않았다 — 실제로 같다).
              패널 자체 높이(770)는 Figma의 1080 프레임 기준이라, 그보다
              낮은 실제 브라우저 창에서는 자연 높이(~757)가 남는 공간을
              넘어설 수 있다 — 이전엔 고정 height 없이 그대로 뒀더니
              부모 flex-1 row가 패널을 눌러 압축했고, 핵심 키워드가 패널
              테두리 밖으로 그대로 흘러나와 다음 버튼과 겹쳤다(1440×800
              실측 재현). overflow-y-auto를 다시 두되, 이번엔 "필요 이상
              공간을 만들어 생기는" 스크롤이 아니라 "실제 콘텐츠가 진짜
              가용 공간보다 클 때만" 나오는 안전장치다 — 평소 뷰포트에서는
              나타나지 않는다. 블록 간격은 최신 Figma(1170:7877) gap 52 · 첫 묶음 안 gap 16. */}
          <div className="flex min-h-0 w-[516px] shrink-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-[52px] overflow-y-auto rounded-[8px] border border-[#eaeaea] p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <FieldLabel required>상품명</FieldLabel>
                  <input
                    type="text"
                    aria-label="상품명"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    onBlur={() => setTouched((prev) => ({ ...prev, productName: true }))}
                    aria-invalid={showProductNameError || undefined}
                    aria-describedby={showProductNameError ? 'n1-product-name-error' : undefined}
                    placeholder="상품 이름을 입력해주세요"
                    className="w-full rounded-[6px] border border-[#eaeaea] px-4 py-2.5 text-[14px] tracking-[-0.01em] text-[#171717] outline-none placeholder:text-[#707070] focus:border-[#ff6a38]"
                  />
                  {showProductNameError && <FieldError id="n1-product-name-error">상품명을 입력해 주세요.</FieldError>}
                </div>

                <div className="flex flex-col gap-1">
                  <FieldLabel>상품코드</FieldLabel>
                  <input
                    type="text"
                    aria-label="상품코드"
                    value={productCode}
                    onChange={(e) => setProductCode(e.target.value)}
                    placeholder="상품 코드를 입력해주세요"
                    className="w-full rounded-[6px] border border-[#eaeaea] px-4 py-2.5 text-[14px] tracking-[-0.01em] text-[#171717] outline-none placeholder:text-[#707070] focus:border-[#ff6a38]"
                  />
                </div>

                {/* 카테고리 — Figma(1170:7877)는 「검색하기」 필드 + 「선택하기」 버튼이 한
                    행에 있다. 텍스트 검색은 12월(PRD F-SRC-04)이라, 두 요소 모두 같은
                    카테고리 트리 창(381:6293)을 연다. 값은 창의 [확인]으로만 바뀐다. */}
                <div className="flex flex-col gap-1">
                  <FieldLabel required>카테고리</FieldLabel>
                  {/* Figma Frame 62 — 행 폭 447(입력 323 · gap 16 · 버튼 108), 패널 content 474보다 좁다 */}
                  <div className="flex w-[447px] max-w-full items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setCategoryModalOpen(true)}
                      aria-haspopup="dialog"
                      aria-label={`카테고리${selectedCategoryLabel ? `: ${selectedCategoryLabel}` : ''}`}
                      aria-describedby={showCategoryError ? 'n1-category-error' : undefined}
                      data-testid="n1-category-field"
                      className="flex h-[39px] min-w-0 flex-1 items-center justify-between gap-2 rounded-[6px] border border-[#eaeaea] bg-white px-[14px] py-[10px] text-left outline-none hover:bg-gray-50 focus-visible:border-[#ff6a38]"
                    >
                      <span
                        title={selectedCategoryLabel ?? undefined}
                        className={`truncate text-[14px] tracking-[-0.01em] ${
                          selectedCategoryLabel ? 'text-[#171717]' : 'text-[#707070]'
                        }`}
                      >
                        {selectedCategoryLabel ?? '검색하기'}
                      </span>
                      <SearchIcon />
                    </button>
                    {/* h-[37px]를 고정한 채 py-2.5(=line-height 21px과 합쳐 41px)를
                        그대로 두면 실제 필요한 높이(41px)가 선언한 높이(37px)를
                        넘어서 텍스트가 세로 중앙에서 어긋나 보였다(실측: 다른
                        버튼과 달리 이 버튼만 고정 height를 썼는데 flex 정렬이
                        없었다) — Figma 치수(w-108/h-37/py-10)는 그대로 두고
                        flex items-center justify-center로 항상 정중앙에 오게
                        고쳤다. */}
                    <button
                      type="button"
                      onClick={() => setCategoryModalOpen(true)}
                      className="flex h-[37px] w-[108px] shrink-0 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-5 py-2.5 text-[14px] font-medium tracking-[-0.03em] text-[#171717] hover:bg-gray-50"
                    >
                      선택하기
                    </button>
                  </div>
                  {showCategoryError && <FieldError id="n1-category-error">카테고리를 선택해 주세요.</FieldError>}
                </div>

                {/* 규제 분류 — Figma(1170:7877 Field / 규제 분류): 라벨 아래 안내(12 Light #999) →
                    select(gap 8) → OTC 종류 태그(gap 12). 안내 문구는 PRD 정본. */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                      <FieldLabel required>규제 분류</FieldLabel>
                      {regulatoryClassHelper && (
                        <p data-testid="n1-regulatory-helper" className="text-left text-[12px] font-light tracking-[-0.04em] text-[#999]">
                          {regulatoryClassHelper.map((line, i) => (
                            <Fragment key={line}>
                              {i > 0 && <br />}
                              {line}
                            </Fragment>
                          ))}
                        </p>
                      )}
                    </div>
                    <RegulatoryClassDropdown
                      options={REGULATORY_CLASS_OPTIONS}
                      value={regulatoryClass}
                      onChange={handleRegulatoryClassChange}
                      onClose={markRegulatoryClassTouched}
                      invalid={showRegulatoryClassError}
                      describedBy={showRegulatoryClassError ? 'n1-regulatory-class-error' : undefined}
                    />
                    {showRegulatoryClassError && (
                      <FieldError id="n1-regulatory-class-error">규제 분류를 선택해 주세요.</FieldError>
                    )}
                  </div>

                  {/* OTC 종류 — OTC 의약품·복합일 때만(PRD F-LNG-03). Tag / flexible(406:6648) 단일 선택 —
                      Selected는 orange border·text. 서버 저장 필드가 없어 아래 안내로 알린다. */}
                  {requiresOtcType(regulatoryClass) && (
                    <div className="flex flex-col gap-2">
                      <div role="radiogroup" aria-label="OTC 종류" className="flex flex-wrap gap-1" data-testid="n1-otc-type">
                        {OTC_TYPE_OPTIONS.map((o) => {
                          const selected = otcType === o.value;
                          return (
                            <button
                              key={o.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setOtcType(o.value)}
                              className={`flex h-7 items-center justify-center rounded-[6px] border bg-white px-2 text-[12px] leading-[14px] transition-colors ${
                                selected ? 'border-[#ff6a38] text-[#ff6a38]' : 'border-[#eaeaea] text-[#171717] hover:bg-gray-50'
                              }`}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                      <p data-testid="n1-otc-type-notice" className="text-[12px] font-light tracking-[-0.04em] text-[#999]">
                        OTC 종류는 아직 작업에 저장되지 않습니다. 저장 기능이 준비되면 반영됩니다.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* 이미지 연속 여부 토글 — 9월 MVP는 이 입력 유형 선택 자체가 아직
                  없다(12월 예정, imageType='multi_section' 고정 — 기존 결정
                  유지). Figma는 이 토글을 필수(*) 입력으로 보여주는데 아직
                  실제로 값을 바꿀 수 없는 상태라 디자인과 현재 계약이 충돌한다
                  — 그대로 숨기지 않고, "출력 규격"의 나머지 옵션과 같은 방식
                  (보여주되 비활성)으로 처리하고 보고에 남긴다. */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">
                    이미지 안에 여러 내용이 이어져 있나요?
                  </p>
                  <div
                    role="switch"
                    aria-checked={false}
                    aria-disabled="true"
                    title="9월 MVP는 다중 섹션 이미지 유형만 지원합니다."
                    className="flex h-5 w-9 shrink-0 cursor-not-allowed items-center rounded-full border border-[#eaeaea] bg-[#f5f5f5] p-0.5 opacity-60"
                  >
                    <div className="size-4 rounded-full bg-white shadow-sm" />
                  </div>
                  <span className="text-[18px] font-medium tracking-[-0.03em] text-[#ff6a38]">*</span>
                </div>
                {/* Figma(673:7819)는 이 helper text를 라벨/토글과 같은 좌측
                    기준선에 맞춘다 — 혼자 text-center로 떠 있던 것을 고쳤다. */}
                <p className="text-left text-[12px] font-light tracking-[-0.04em] text-[#707070]">
                  이미지 유형에 따라 분석 방식이 달라집니다.
                </p>
              </div>

              {/* 결과물 규격 — Figma 기본값은 "사이트 맞춤" 탭이 활성이지만, 9월
                  MVP는 원본 규격만 실제로 지원한다(기존 결정 유지, lib/api/types.ts
                  SpecType 주석 참고). 디자인과 계약이 다시 충돌해 Figma의 활성
                  탭을 그대로 베끼지 않고, 실제로 쓸 수 있는 "원본 사이즈"를
                  활성으로 두고 나머지 두 탭은 비활성으로 보여준다. */}
              <div className="flex flex-col gap-4">
                {/* Figma(925:2573-2575) — 이 라벨의 asterisk만 18px Medium이다
                    (다른 라벨의 asterisk는 16px 상속). FieldLabel 공용
                    컴포넌트의 기본 16px 상속 asterisk와 다르므로 이 자리만
                    직접 마크업한다. */}
                <div className="flex items-center gap-2">
                  <p className="text-[16px] tracking-[-0.03em] text-[#171717]">결과물 규격</p>
                  <span className="text-[18px] font-medium tracking-[-0.03em] text-[#ff6a38]">*</span>
                </div>
                <div className="flex h-8 w-full items-center">
                  <div className="flex-1 border-b border-[#eaeaea] pb-2 text-center">
                    <span className="text-[16px] tracking-[-0.03em] text-[#171717]">원본 사이즈</span>
                  </div>
                  <div className="flex-1 cursor-not-allowed pb-2 text-center" title="준비 중입니다.">
                    <span className="text-[16px] tracking-[-0.03em] text-[#999]">사이트 맞춤</span>
                  </div>
                  <div className="flex-1 cursor-not-allowed pb-2 text-center" title="준비 중입니다.">
                    <span className="text-[16px] tracking-[-0.03em] text-[#999]">커스텀</span>
                  </div>
                </div>
                <p className="text-[12px] font-light tracking-[-0.04em] text-[#999]">업로드된 이미지의 원본 크기를 유지합니다.</p>
              </div>

              <div className="flex flex-col gap-1">
                <FieldLabel>핵심 키워드</FieldLabel>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={handleKeywordKeyDown}
                    placeholder="키워드를 입력해주세요."
                    className="flex-1 rounded-[6px] border border-[#eaeaea] px-4 py-2.5 text-[14px] tracking-[-0.01em] text-[#171717] outline-none placeholder:text-[#707070] focus:border-[#ff6a38]"
                  />
                  <button
                    type="button"
                    onClick={addKeyword}
                    className="shrink-0 rounded-[6px] border border-[#eaeaea] px-4 py-2 text-[12px] font-medium text-[#171717] hover:bg-gray-50"
                  >
                    추가
                  </button>
                </div>
                <p className="text-[12px] font-light tracking-[-0.04em] text-[#707070]">
                  번역 중 강조할 표현을 태그로 추가합니다.
                </p>
                {keywords.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {keywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-1 rounded-[6px] border border-[#eaeaea] bg-[#f5f5f5] px-2.5 py-1 text-[12px] font-medium text-[#707070]"
                      >
                        {kw}
                        <button
                          type="button"
                          onClick={() => removeKeyword(kw)}
                          className="ml-0.5 text-[#999] hover:text-[#171717]"
                          aria-label={`${kw} 삭제`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {(submitError != null || hasUploadFailed || uploadNotice) && (
              <p role="alert" className="mt-3 shrink-0 text-sm text-red-500">
                {hasUploadFailed
                  ? '업로드에 실패한 파일이 있습니다. 다시 시도하거나 삭제한 뒤 진행해 주세요.'
                  : uploadNotice ??
                    (submitError instanceof Error ? submitError.message : '오류가 발생했습니다. 다시 시도해 주세요.')}
              </p>
            )}

            {/* 책임 동의 — PRD F-ACC-04, Figma Checkbox(1170:6002): 패널 아래 30 · [다음] 바로 위.
                Checkbox / Compact(1063:5156) 18px 박스, Checked는 orange border + check. */}
            <label className="mt-[30px] flex shrink-0 cursor-pointer items-center gap-2" data-testid="n1-consent">
              <span className="relative flex size-5 shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  checked={hasAcceptedResponsibility}
                  onChange={(e) => setHasAcceptedResponsibility(e.target.checked)}
                  className="peer size-[18px] cursor-pointer appearance-none rounded-[4px] border border-[#eaeaea] bg-white outline-offset-2 checked:border-[#ff6a38] focus-visible:outline-2 focus-visible:outline-[#ff6a38]"
                />
                <span className="pointer-events-none absolute hidden peer-checked:block">
                  <CheckIcon />
                </span>
              </span>
              <span className="text-[12px] leading-[normal] font-light tracking-[-0.04em] text-[#707070]">
                {RESPONSIBILITY_CONSENT_LINES[0]}
                <br />
                {RESPONSIBILITY_CONSENT_LINES[1]}
              </span>
            </label>

            {/* 하단 버튼 — Figma(1089:10035): 인증 마크 업로드(Secondary + info) · 다음(Primary 148), gap 8.
                인증 마크 업로드는 PRD F-SRC-08 12월 기능이고 9월은 원본 규격뿐이라 비활성이다(업로드 없음).
                툴팁은 버튼 상태와 관계없이 hover·focus에 두 줄(PRD). 키보드로도 닿도록 disabled 대신
                aria-disabled를 쓴다. 툴팁 위치는 Figma(1090:10048) — 버튼 왼쪽에서 64 · 버튼 위 3px 겹침, 화살표가 info를 가리킨다. */}
            <div className="mt-6 flex shrink-0 items-center justify-end gap-2">
              <div className="group relative">
                <button
                  type="button"
                  aria-disabled="true"
                  aria-describedby="n1-certification-tooltip"
                  onClick={(e) => e.preventDefault()}
                  data-testid="n1-certification-upload"
                  className="flex h-[45px] cursor-not-allowed items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white py-3.5 pr-6 pl-4 outline-none focus-visible:border-[#ff6a38]"
                >
                  <span className="flex items-center opacity-40">
                    <span className="-mr-1 px-3 text-[14px] font-medium tracking-[-0.03em] text-[#171717]">인증 마크 업로드 하기</span>
                    <InfoIcon />
                  </span>
                </button>
                <div
                  id="n1-certification-tooltip"
                  role="tooltip"
                  className="invisible absolute bottom-[calc(100%-3px)] left-16 z-10 flex w-[193px] flex-col gap-1 rounded-[8px] break-keep border border-[#ff6a38] bg-white p-2.5 text-[12px] leading-[normal] font-light tracking-[-0.04em] text-[#ff6a38] group-focus-within:visible group-hover:visible"
                >
                  {CERTIFICATION_TOOLTIP_LINES.map((line) => (
                    <p key={line}>- {line}</p>
                  ))}
                  <svg
                    width="12"
                    height="11"
                    viewBox="0 0 12 11"
                    fill="none"
                    aria-hidden="true"
                    className="absolute top-[calc(100%-1px)] left-[90px]"
                  >
                    <path d="M0.5 0.5L6 10L11.5 0.5" fill="white" stroke="#ff6a38" />
                    <path d="M1 0H11" stroke="white" strokeWidth="1.5" />
                  </svg>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!isValid || isSubmitting || isUploadBusy}
                title={!isValid ? '필수 항목을 모두 입력해 주세요.' : undefined}
                className="h-[45px] w-[148px] shrink-0 rounded-[6px] bg-[#171717] px-8 py-3.5 text-[14px] leading-[normal] font-medium tracking-[-0.03em] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting ? '생성 중...' : '다음'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 카테고리 선택 모달 (Figma 381:6293) */}
      {categoryModalOpen && (
        <CategoryModal
          tree={categoryTree}
          status={categoriesQuery.status}
          onRetry={() => void categoriesQuery.refetch()}
          currentId={categoryId}
          onClose={() => {
            setCategoryModalOpen(false);
            setTouched((prev) => ({ ...prev, category: true }));
          }}
          onConfirm={(id) => setCategoryId(id)}
        />
      )}

      {/* 나가기 / 작업 취소 확인 */}
      {showExitConfirm && (
        <N1ExitDialog
          hasDraftJob={draftJobId !== null}
          isCancelling={isCancellingJob}
          cancelFailed={cancelJobMutation.isError}
          onDismiss={closeExitConfirm}
          onConfirm={handleExitConfirm}
          returnFocusRef={exitButtonRef}
        />
      )}
    </div>
  );
}
