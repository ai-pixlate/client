'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useCreateJobMutation, useAnalyzeJobMutation } from '@/lib/queries/pixate';
import type { ImageType } from '@/lib/api/types';
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

// TODO: 백엔드 규제 분류 목록 API 연결 시 교체
const REGULATORY_CLASS_OPTIONS = [
  { value: 'cosmetics', label: '화장품' },
  { value: 'food', label: '식품' },
  { value: 'health_supplement', label: '건강기능식품' },
  { value: 'medical_device', label: '의료기기' },
  { value: 'general', label: '일반 상품' },
];

// ─────────────────────────────────────────────────────────────────
// 카테고리 계층 — Figma 카테고리 선택 모달(381:6293)이 실제로 보여준 값만
// 그대로 옮긴다. "화장품/향수 → 스킨케어 → 스킨/토너 → {토너,에센스 토너,패드}"
// 경로만 4단계 전부(세분류까지) 문서화돼 있다. 나머지 형제 항목(바디/헤어,
// 건강식품, 선케어, 팩/마스크, 클렌징, 에센스/세럼, 크림/젤/밤, 미스트)은
// Figma에 라벨만 보이고 그 하위 트리는 어디에도 없다 — 임의로 하위 항목을
// 지어내지 않는다. children이 없는 노드는 그 자체가 선택 가능한 leaf다
// (더 드릴다운할 데이터가 없으므로 클릭 즉시 선택으로 처리한다).
// TODO: 백엔드 카테고리 목록 API 연결 시 교체.
// ─────────────────────────────────────────────────────────────────

interface CategoryNode {
  value: string;
  label: string;
  children?: CategoryNode[];
}

const CATEGORY_TREE: CategoryNode[] = [
  {
    value: 'cosmetics_perfume',
    label: '화장품/향수',
    children: [
      {
        value: 'skincare',
        label: '스킨케어',
        children: [
          {
            value: 'toner_type',
            label: '스킨/토너',
            children: [
              { value: 'toner', label: '토너' },
              { value: 'essence_toner', label: '에센스 토너' },
              { value: 'pad', label: '패드' },
            ],
          },
          { value: 'essence_serum', label: '에센스/세럼' },
          { value: 'cream_gel_balm', label: '크림/젤/밤' },
          { value: 'mist', label: '미스트' },
        ],
      },
      { value: 'suncare', label: '선케어' },
      { value: 'pack_mask', label: '팩/마스크' },
      { value: 'cleansing', label: '클렌징' },
    ],
  },
  { value: 'body_hair', label: '바디/헤어' },
  { value: 'health_food', label: '건강식품' },
];

function findCategoryLabel(nodes: CategoryNode[], value: string): string | null {
  for (const node of nodes) {
    if (node.value === value) return node.label;
    if (node.children) {
      const found = findCategoryLabel(node.children, value);
      if (found) return found;
    }
  }
  return null;
}

function findCategoryPath(nodes: CategoryNode[], value: string, path: CategoryNode[] = []): CategoryNode[] | null {
  for (const node of nodes) {
    const nextPath = [...path, node];
    if (node.value === value) return nextPath;
    if (node.children) {
      const found = findCategoryPath(node.children, value, nextPath);
      if (found) return found;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// 로컬 이미지 항목 타입 (업로드 이전 브라우저 상태)
// ─────────────────────────────────────────────────────────────────

interface LocalImage {
  localId: string;
  file: File;
}

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

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4V20M4 12H20" stroke="#171717" strokeWidth="1.5" strokeLinecap="round" />
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

// ─────────────────────────────────────────────────────────────────
// 카테고리 선택 모달 (Figma 381:6293 "카테고리 선택")
//
// Figma 프레임 자체엔 backdrop 딤(어둡게 가리기)·제목/설명·확인/닫기 버튼이
// 보이지 않는다 — 흰 카드(drop-shadow) + 검색 입력 + 4단 목록뿐이다. 그
// 카드를 그대로 옮기고, "확인" 버튼 대신 leaf(더 하위 데이터가 없는 노드)를
// 클릭하면 즉시 선택·닫힘으로 처리했다 — Figma에 없는 버튼을 임의로 만들지
// 않기 위한 최소 보완이다. backdrop은 화면을 어둡게 가리진 않되(Figma에
// 없음), 바깥 영역 클릭 시 닫히는 투명 캐처로는 둔다.
// ─────────────────────────────────────────────────────────────────

function CategoryColumn({
  heading,
  items,
  selectedValue,
  onSelect,
  showChevron,
}: {
  heading: string;
  items: CategoryNode[];
  selectedValue: string | null;
  onSelect: (node: CategoryNode) => void;
  showChevron: boolean;
}) {
  return (
    <div className="flex w-[277px] shrink-0 flex-col items-start">
      <div className="flex w-full items-center px-4 py-2">
        <p className="text-[12px] font-light tracking-[-0.04em] text-[#999]">{heading}</p>
      </div>
      {items.length === 0 && <p className="px-4 py-[18px] text-[12px] text-[#999]">검색 결과가 없습니다.</p>}
      {items.map((item) => {
        const isSelected = item.value === selectedValue;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onSelect(item)}
            aria-pressed={isSelected}
            className={`flex w-full items-center justify-between px-4 py-[18px] text-left text-[14px] tracking-[-0.01em] transition-colors ${
              isSelected ? 'bg-[#f5f5f5] text-[#ff6a38]' : 'text-[#707070] hover:bg-gray-50'
            }`}
          >
            <span>{item.label}</span>
            {showChevron && item.children && <ChevronRightIcon />}
          </button>
        );
      })}
    </div>
  );
}

function CategoryModal({
  currentValue,
  onClose,
  onSelect,
}: {
  currentValue: string;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const initialPath = useMemo(() => findCategoryPath(CATEGORY_TREE, currentValue) ?? [], [currentValue]);
  const [selectedL1, setSelectedL1] = useState<CategoryNode | null>(initialPath[0] ?? null);
  const [selectedL2, setSelectedL2] = useState<CategoryNode | null>(initialPath[1] ?? null);
  const [selectedL3, setSelectedL3] = useState<CategoryNode | null>(initialPath[2] ?? null);
  const [search, setSearch] = useState('');

  const commit = (node: CategoryNode) => {
    onSelect(node.value);
    onClose();
  };

  const query = search.trim().toLowerCase();
  const filterItems = (nodes: CategoryNode[]) =>
    query ? nodes.filter((n) => n.label.toLowerCase().includes(query)) : nodes;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-label="카테고리 선택"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-1/2 left-1/2 flex w-[1203px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col items-start gap-3 rounded-[5px] bg-white px-7 py-5 drop-shadow-[2px_2px_12px_rgba(0,0,0,0.06)]"
      >
        {/* 다른 모든 텍스트 입력(상품명/상품코드/핵심키워드 등)과 같은 focus
            처리(Design Direction §8: "Focus에서 Orange Accent")를 그대로
            재사용한다 — 이 검색 입력만 border를 감싼 div에 올려두고
            focus 스타일을 빠뜨렸던 것을 다른 input들과 같은 패턴(직접
            border+focus:border-[#ff6a38])으로 맞췄다. */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="카테고리명 검색"
          className="w-[150px] rounded-[6px] border border-[#eaeaea] bg-white px-4 py-2.5 text-[14px] text-[#707070] outline-none placeholder:text-[#707070] focus:border-[#ff6a38]"
        />

        <div className="flex w-full items-stretch gap-1.5 overflow-x-auto">
          <CategoryColumn
            heading="대분류"
            items={filterItems(CATEGORY_TREE)}
            selectedValue={selectedL1?.value ?? null}
            showChevron
            onSelect={(node) => {
              if (node.children) {
                setSelectedL1(node);
                setSelectedL2(null);
                setSelectedL3(null);
              } else {
                commit(node);
              }
            }}
          />
          <div className="w-px shrink-0 self-stretch bg-[#eaeaea]" />
          <CategoryColumn
            heading="중분류"
            items={filterItems(selectedL1?.children ?? [])}
            selectedValue={selectedL2?.value ?? null}
            showChevron
            onSelect={(node) => {
              if (node.children) {
                setSelectedL2(node);
                setSelectedL3(null);
              } else {
                commit(node);
              }
            }}
          />
          <div className="w-px shrink-0 self-stretch bg-[#eaeaea]" />
          <CategoryColumn
            heading="소분류"
            items={filterItems(selectedL2?.children ?? [])}
            selectedValue={selectedL3?.value ?? null}
            showChevron
            onSelect={(node) => {
              if (node.children) setSelectedL3(node);
              else commit(node);
            }}
          />
          <div className="w-px shrink-0 self-stretch bg-[#eaeaea]" />
          <CategoryColumn
            heading="세분류"
            items={filterItems(selectedL3?.children ?? [])}
            selectedValue={null}
            showChevron={false}
            onSelect={(node) => commit(node)}
          />
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
  const analyzeMutation = useAnalyzeJobMutation();

  // ── 폼 상태 ─────────────────────────────────────────────────────
  const [targetCountry, setTargetCountry] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('');
  const [regulatoryClass, setRegulatoryClass] = useState('');
  const [displayCategory, setDisplayCategory] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [images, setImages] = useState<LocalImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // productName/productCode — Figma(525:3023)에서 새로 보이는 입력 필드이자
  // 실제 OpenAPI(JobCreate/Job) 필드명 그대로(CLAUDE.md: productName 필수,
  // productCode 선택). CreateJobRequest/POST /jobs 페이로드에 실어 보낸다
  // (이번 계약 보정 반영). productCode는 빈 문자열이면 아예 보내지 않는다
  // (trim 후 빈 값이면 undefined → JSON.stringify가 키 자체를 제거).
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');

  const [isDragOver, setIsDragOver] = useState(false);

  // ── 나가기 확인 ─────────────────────────────────────────────────
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // ── 카테고리 선택 모달 (Figma 381:6293) ─────────────────────────
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const selectedCategoryLabel = displayCategory ? findCategoryLabel(CATEGORY_TREE, displayCategory) : null;

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

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const newItems: LocalImage[] = files.map((file, i) => ({
      localId: `local_${Date.now()}_${i}`,
      file,
    }));
    setImages((prev) => [...prev, ...newItems]);
  };

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

  const removeImage = (localId: string) => {
    setImages((prev) => prev.filter((img) => img.localId !== localId));
  };

  const moveImage = (localId: string, direction: 'up' | 'down') => {
    setImages((prev) => {
      const idx = prev.findIndex((img) => img.localId === localId);
      if (idx < 0) return prev;
      const next = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  };

  // ── 유효성 검사 ──────────────────────────────────────────────────

  const isValid =
    !!brandId &&
    !!productName &&
    !!targetCountry &&
    !!targetLanguage &&
    !!regulatoryClass &&
    !!displayCategory &&
    images.length > 0;

  // ── 제출 ────────────────────────────────────────────────────────
  //
  // 오늘(N1→N6 happy path): 생성과 분석 시작을 분리한다(CLAUDE.md 원칙 —
  // 작업 생성만으로 분석이 자동 시작된다고 가정하지 않는다). createJob이
  // 성공한 jobId로 analyzeJob을 이어 호출한 뒤에만 N2로 이동한다. 이 폼이
  // 한 번에 보내는 입력값 payload 자체(실제 draft-first 다단계 계약과 다름)는
  // 오늘 범위가 아니라 그대로 뒀다.

  const handleSubmit = async () => {
    if (!isValid) return;

    // 9월 MVP: 입력 유형 선택 UI는 12월 예정 — imageType은 'multi_section' 고정
    const sourceImages = images.map((_img, i) => ({
      fileId: `mock_file_${String(i + 1).padStart(3, '0')}`,
      order: i + 1,
      imageType: 'multi_section' as ImageType,
    }));

    try {
      const created = await createMutation.mutateAsync({
        brandId,
        productName,
        productCode: productCode.trim() || undefined,
        targetCountry,
        targetLanguage,
        regulatoryClass,
        specId: 'spec_original',
        displayCategory,
        keywords,
        sourceImages,
      });
      await analyzeMutation.mutateAsync(created.jobId);
      router.push(`/jobs/${created.jobId}`);
    } catch {
      // createMutation/analyzeMutation의 isError·error가 그대로 하단 안내에 반영된다.
    }
  };

  const submitError = createMutation.error ?? analyzeMutation.error;
  const isSubmitting = createMutation.isPending || analyzeMutation.isPending;

  // 추천 태그는 targetLanguage(언어 select의 현재 선택값)가 아니라
  // targetCountry에서만 파생된다 — 국가를 바꿔도 이미 고른 언어 값은
  // 건드리지 않는다. 태그를 클릭했을 때만 setTargetLanguage가 호출된다.
  const recommendedLanguageValue = COUNTRY_RECOMMENDED_LANGUAGE[targetCountry];
  const recommendedLanguageOption = recommendedLanguageValue
    ? (LANGUAGE_OPTIONS.find((o) => o.value === recommendedLanguageValue) ?? null)
    : null;

  // ── 렌더링 ──────────────────────────────────────────────────────

  return (
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
          onClick={() => setShowExitConfirm(true)}
          aria-label="보관함으로 나가기"
          className="absolute top-10 left-1/2 z-20 flex size-10 -translate-x-1/2 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
                  onChange={(e) => setTargetCountry(e.target.value)}
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
                  className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-[6px] border border-[#ff6a38] bg-white px-2 text-[12px] text-[#ff6a38] transition-colors hover:bg-[#faf3ed]"
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

        {/* 본문: 좌 FileUploader + 우 필드 패널. 아래 pb는 Figma 실측
            (패널 bottom 932, 다음 버튼 top 965 → 33px)을 그대로 쓴다. */}
        <div className="flex min-h-0 flex-1 gap-6 px-10 pb-[33px]">
          {/* 좌측 — 업로드 영역 */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={`flex flex-1 flex-col items-center justify-center gap-10 rounded-[8px] border transition-colors ${
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
                <p className="max-w-xl text-center text-[12px] font-light tracking-[-0.04em] text-[#999]">
                  최대 1GB · 여러 파일을 한 번에 업로드할 수 있습니다.
                  <br />
                  인증·시험 정보의 적용 가능 여부를 사용자가 최종 확인해야 하며 문제 발생 시 플랫폼이 책임지지 않습니다.
                </p>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
                <div className="flex items-center justify-between">
                  <p className="text-[14px] text-[#707070]">이미지 {images.length}개</p>
                  <label
                    htmlFor="image-upload"
                    className="cursor-pointer rounded-[6px] border border-[#eaeaea] px-4 py-2 text-[12px] font-medium text-[#171717] hover:bg-gray-50"
                  >
                    + 이미지 추가
                  </label>
                </div>
                <ul className="flex flex-col gap-2">
                  {images.map((img, idx) => (
                    <li
                      key={img.localId}
                      className="flex items-center gap-3 rounded-[6px] border border-[#eaeaea] bg-white px-3 py-2.5"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[#eaeaea] text-xs font-medium text-[#707070]">
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-[#171717]" title={img.file.name}>
                        {img.file.name}
                      </span>
                      <div className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveImage(img.localId, 'up')}
                          disabled={idx === 0}
                          className="rounded p-1 text-[#999] hover:bg-gray-100 hover:text-[#171717] disabled:opacity-30"
                          aria-label="위로 이동"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImage(img.localId, 'down')}
                          disabled={idx === images.length - 1}
                          className="rounded p-1 text-[#999] hover:bg-gray-100 hover:text-[#171717] disabled:opacity-30"
                          aria-label="아래로 이동"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeImage(img.localId)}
                        className="shrink-0 rounded p-1 text-[#999] hover:bg-red-50 hover:text-red-500"
                        aria-label="삭제"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
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
              나타나지 않는다. */}
          <div className="flex min-h-0 w-[516px] shrink-0 flex-col gap-[55px] overflow-y-auto rounded-[8px] border border-[#eaeaea] p-5">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <FieldLabel required>상품명</FieldLabel>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="상품 이름을 입력해주세요"
                  className="w-full rounded-[6px] border border-[#eaeaea] px-4 py-2.5 text-[14px] tracking-[-0.01em] text-[#171717] outline-none placeholder:text-[#707070] focus:border-[#ff6a38]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <FieldLabel>상품코드</FieldLabel>
                <input
                  type="text"
                  value={productCode}
                  onChange={(e) => setProductCode(e.target.value)}
                  placeholder="상품 코드를 입력해주세요"
                  className="w-full rounded-[6px] border border-[#eaeaea] px-4 py-2.5 text-[14px] tracking-[-0.01em] text-[#171717] outline-none placeholder:text-[#707070] focus:border-[#ff6a38]"
                />
              </div>

              {/* 카테고리 — Figma(643:5824)는 검색 표시 입력(w-323) + "선택하기"
                  버튼(w-108) 두 요소가 한 행에 나란히 있다. 버튼을 누르면
                  카테고리 선택 모달(381:6293)이 뜬다 — 실제 값 변경은 모달의
                  leaf 클릭으로만 일어나고, 이 표시 필드 자체는 읽기 전용이다. */}
              <div className="flex flex-col gap-1">
                <FieldLabel>카테고리</FieldLabel>
                <div className="flex items-center gap-4">
                  <div className="flex h-[39px] flex-1 items-center justify-between rounded-[6px] border border-[#eaeaea] bg-white px-[14px] py-[10px]">
                    <span
                      className={`truncate text-[14px] tracking-[-0.01em] ${
                        selectedCategoryLabel ? 'text-[#171717]' : 'text-[#707070]'
                      }`}
                    >
                      {selectedCategoryLabel ?? '검색 하기'}
                    </span>
                    <SearchIcon />
                  </div>
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
                    className="flex h-[37px] w-[108px] shrink-0 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-5 py-2.5 text-[14px] font-medium tracking-[-0.42px] text-[#171717] hover:bg-gray-50"
                  >
                    선택하기
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <FieldLabel required>규제 분류</FieldLabel>
                <div className="relative">
                  <select
                    value={regulatoryClass}
                    onChange={(e) => setRegulatoryClass(e.target.value)}
                    className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white px-[14px] py-[10px] text-[14px] tracking-[-0.01em] text-[#707070] outline-none focus:border-[#ff6a38]"
                  >
                    <option value="">선택</option>
                    {REGULATORY_CLASS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2">
                    <ChevronDownIcon />
                  </div>
                </div>
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
                <p className="text-[16px] font-medium tracking-[-0.03em] text-[#171717]">
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
                <span className="text-[16px] font-medium text-[#ff6a38]">*</span>
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
              <div className="flex items-center gap-2">
                <FieldLabel required>결과물 규격</FieldLabel>
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
              <p className="text-[12px] text-[#999]">업로드된 이미지의 원본 크기를 유지합니다.</p>
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
                      className="inline-flex items-center gap-1 rounded-[6px] border border-[#eaeaea] bg-[#f5f5f5] px-2.5 py-1 text-xs font-medium text-[#707070]"
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
        </div>

        {/* 하단 — 에러 메시지 + 다음 버튼 (Figma는 버튼만 우하단에 둔다) */}
        <div className="flex shrink-0 items-center justify-end gap-4 px-10 pb-10">
          {submitError && (
            <p className="flex-1 text-sm text-red-500">
              {submitError instanceof Error ? submitError.message : '오류가 발생했습니다. 다시 시도해 주세요.'}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            title={!isValid ? '필수 항목을 모두 입력해 주세요.' : undefined}
            className="w-[148px] shrink-0 rounded-[6px] bg-[#171717] px-8 py-3.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? '생성 중...' : '다음'}
          </button>
        </div>
      </div>

      {/* 카테고리 선택 모달 (Figma 381:6293) */}
      {categoryModalOpen && (
        <CategoryModal
          currentValue={displayCategory}
          onClose={() => setCategoryModalOpen(false)}
          onSelect={(value) => setDisplayCategory(value)}
        />
      )}

      {/* 나가기 확인 오버레이 */}
      {showExitConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowExitConfirm(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-base font-semibold text-gray-900">나가기</h2>
            <p className="mb-6 text-sm leading-relaxed text-gray-500">
              현재 입력한 정보와 업로드한 이미지는 저장되지 않습니다.
              그래도 나가시겠습니까?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="flex-1 rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  // TODO: M1 보관함 구현 시 실제 보관함 route로 교체
                  router.push('/');
                }}
                className="flex-1 rounded-lg bg-gray-800 py-2.5 text-sm font-medium text-white hover:bg-gray-900"
              >
                나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
