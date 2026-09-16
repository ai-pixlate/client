'use client';

import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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

// TODO: 백엔드 규제 분류 목록 API 연결 시 교체
const REGULATORY_CLASS_OPTIONS = [
  { value: 'cosmetics', label: '화장품' },
  { value: 'food', label: '식품' },
  { value: 'health_supplement', label: '건강기능식품' },
  { value: 'medical_device', label: '의료기기' },
  { value: 'general', label: '일반 상품' },
];

// TODO: 백엔드 카테고리 목록 API 연결 시 교체
const CATEGORY_OPTIONS = [
  { value: 'skincare', label: '스킨케어' },
  { value: 'haircare', label: '헤어케어' },
  { value: 'makeup', label: '메이크업' },
  { value: 'supplements', label: '건강기능식품' },
  { value: 'electronics', label: '전자제품' },
  { value: 'fashion', label: '패션' },
  { value: 'food_beverage', label: '식품·음료' },
  { value: 'other', label: '기타' },
];

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
// N1 페이지 (Figma node 525:3023 "N1 이미지 정보 입력" 기준)
// ─────────────────────────────────────────────────────────────────

export default function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { brandId: rawBrandId } = use(searchParams);
  const brandId = typeof rawBrandId === 'string' ? rawBrandId : '';

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
  const selectedLanguageLabel = LANGUAGE_OPTIONS.find((o) => o.value === targetLanguage)?.label ?? null;

  // ── 렌더링 ──────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-full bg-white">
      <StepNav currentStep="N1" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {/* 헤더 — Figma(525:3023, node 608:1434 "보관함으로 나가기")는 N5와
            동일하게 닫기(X) 아이콘이다. 단, N1은 입력 중인 폼/업로드가
            날아갈 수 있어 기존 나가기 확인 모달은 그대로 유지한다. */}
        <div className="shrink-0 px-10 pt-10 pb-6">
          <button
            type="button"
            onClick={() => setShowExitConfirm(true)}
            aria-label="보관함으로 나가기"
            className="mb-6 flex size-10 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <div className="flex items-center gap-4">
            <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#171717]">이미지 입력</h1>
            <p className="text-[14px] tracking-[-0.01em] text-[#707070]">
              번역할 원본 이미지를 등록하고 작업 조건을 설정합니다.
            </p>
          </div>

          {!brandId && (
            <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
              브랜드를 먼저 선택해 주세요. URL에 <code className="font-mono text-xs">?brandId=</code> 파라미터가 필요합니다.
            </div>
          )}

          {/* 국가선택 / 언어선택 — Figma 두 필드를 한 줄에 배치 */}
          <div className="mt-6 flex items-center justify-between gap-10">
            <div className="flex flex-1 items-center gap-5">
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

            <div className="flex flex-1 items-center gap-5">
              <p className="shrink-0 text-[12px] tracking-[-0.02em] text-[#707070]">언어선택</p>
              {selectedLanguageLabel && (
                <span className="flex h-7 shrink-0 items-center justify-center rounded-[6px] border border-[#ff6a38] bg-white px-2 text-[12px] text-[#ff6a38]">
                  {selectedLanguageLabel}
                </span>
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

        {/* 본문: 좌 FileUploader + 우 필드 패널 */}
        <div className="flex min-h-0 flex-1 gap-6 px-10 pb-6">
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
          <div className="flex w-[505px] shrink-0 flex-col gap-8 overflow-y-auto rounded-[8px] border border-[#eaeaea] p-5">
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

              {/* 카테고리 — Figma는 "검색하기" 입력 + "선택하기" 버튼 2단 조합으로
                  보여주지만, 그 조합의 실제 동작(검색 결과 목록·선택 흐름)이
                  확인되지 않아 추측해 만들지 않는다. 기존에 이미 동작하는
                  단일 select(카테고리 상태·옵션 목록)를 그대로 쓰고, 검색
                  아이콘만 Figma 톤에 맞춰 얹었다. */}
              <div className="flex flex-col gap-1">
                <FieldLabel>카테고리</FieldLabel>
                <div className="relative">
                  <select
                    value={displayCategory}
                    onChange={(e) => setDisplayCategory(e.target.value)}
                    className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white px-[14px] py-[10px] text-[14px] tracking-[-0.01em] text-[#707070] outline-none focus:border-[#ff6a38]"
                  >
                    <option value="">검색 하기</option>
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2">
                    <SearchIcon />
                  </div>
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
              <p className="text-center text-[12px] font-light tracking-[-0.04em] text-[#707070]">
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
