'use client';

import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useCreateJobMutation } from '@/lib/queries/pixate';
import type { ImageType } from '@/lib/api/types';

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
  { value: 'en', label: '영어 (en)' },
  { value: 'ja', label: '일본어 (ja)' },
  { value: 'zh', label: '중국어 간체 (zh)' },
  { value: 'de', label: '독일어 (de)' },
  { value: 'fr', label: '프랑스어 (fr)' },
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
  imageType: ImageType;
}

// ─────────────────────────────────────────────────────────────────
// 섹션 레이블 공통 컴포넌트
// ─────────────────────────────────────────────────────────────────

function SectionLabel({ step, title }: { step: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
        {step}
      </span>
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// N1 페이지
// ─────────────────────────────────────────────────────────────────

export default function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { brandId: rawBrandId } = use(searchParams);
  const brandId = typeof rawBrandId === 'string' ? rawBrandId : '';

  const router = useRouter();
  const mutation = useCreateJobMutation();

  // ── 폼 상태 ─────────────────────────────────────────────────────
  const [targetCountry, setTargetCountry] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('');
  const [regulatoryClass, setRegulatoryClass] = useState('');
  const [displayCategory, setDisplayCategory] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [images, setImages] = useState<LocalImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const newItems: LocalImage[] = files.map((file, i) => ({
      localId: `local_${Date.now()}_${i}`,
      file,
      imageType: 'detail' as ImageType,
    }));
    setImages((prev) => [...prev, ...newItems]);

    // 같은 파일 재선택 허용을 위해 input 초기화
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (localId: string) => {
    setImages((prev) => prev.filter((img) => img.localId !== localId));
  };

  const setImageType = (localId: string, imageType: ImageType) => {
    setImages((prev) =>
      prev.map((img) => (img.localId === localId ? { ...img, imageType } : img)),
    );
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
    !!targetCountry &&
    !!targetLanguage &&
    !!regulatoryClass &&
    !!displayCategory &&
    images.length > 0;

  // ── 제출 ────────────────────────────────────────────────────────

  const handleSubmit = () => {
    if (!isValid) return;

    const sourceImages = images.map((img, i) => ({
      fileId: `mock_file_${String(i + 1).padStart(3, '0')}`,
      order: i + 1,
      imageType: img.imageType,
    }));

    mutation.mutate(
      {
        brandId,
        targetCountry,
        targetLanguage,
        regulatoryClass,
        specId: 'spec_original',
        displayCategory,
        keywords,
        sourceImages,
      },
      {
        onSuccess: (data) => {
          router.push(`/jobs/${data.jobId}`);
        },
      },
    );
  };

  // ── 렌더링 ──────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* 상단 헤더 */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-white px-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
            N1
          </span>
          <span className="text-sm font-medium text-gray-700">신규 작업</span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowExitConfirm(true)}
          className="text-sm text-gray-400 transition-colors hover:text-gray-700"
        >
          보관함으로 나가기
        </button>
      </header>

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

      {/* 본문 */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">

        {/* 브랜드 없음 안내 */}
        {!brandId && (
          <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
            브랜드를 먼저 선택해 주세요. URL에 <code className="font-mono text-xs">?brandId=</code> 파라미터가 필요합니다.
          </div>
        )}

        {/* 브랜드 확인 칩 */}
        {brandId && (
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            브랜드: {brandId}
          </div>
        )}

        <div className="space-y-8">

          {/* ── 1. 번역 대상 ────────────────────────────────────── */}
          <section className="rounded-xl border bg-white p-6 shadow-sm">
            <SectionLabel step="1" title="번역 · 현지화 대상" />
            <div className="mt-5 grid grid-cols-2 gap-4">
              {/* 국가 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  대상 국가 <span className="text-red-400">*</span>
                </label>
                <select
                  value={targetCountry}
                  onChange={(e) => setTargetCountry(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                >
                  <option value="">선택하세요</option>
                  {COUNTRY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* 언어 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  대상 언어 <span className="text-red-400">*</span>
                </label>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                >
                  <option value="">선택하세요</option>
                  {LANGUAGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* 규제 분류 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  규제 분류 <span className="text-red-400">*</span>
                </label>
                <select
                  value={regulatoryClass}
                  onChange={(e) => setRegulatoryClass(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                >
                  <option value="">선택하세요</option>
                  {REGULATORY_CLASS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* 카테고리 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  상품 카테고리 <span className="text-red-400">*</span>
                </label>
                <select
                  value={displayCategory}
                  onChange={(e) => setDisplayCategory(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                >
                  <option value="">선택하세요</option>
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* ── 2. 원본 이미지 ─────────────────────────────────── */}
          <section className="rounded-xl border bg-white p-6 shadow-sm">
            <SectionLabel step="2" title="원본 이미지 업로드" />
            <p className="mt-1 text-xs text-gray-400">
              상세페이지 이미지를 순서대로 업로드하세요. 각 이미지의 유형을 지정하세요.
            </p>

            {/* 업로드 버튼 */}
            <div className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                id="image-upload"
              />
              <label
                htmlFor="image-upload"
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-600 hover:border-blue-400 hover:bg-blue-100"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                이미지 추가
              </label>
            </div>

            {/* 이미지 목록 */}
            {images.length > 0 && (
              <ul className="mt-4 space-y-2">
                {images.map((img, idx) => (
                  <li
                    key={img.localId}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5"
                  >
                    {/* 순번 */}
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                      {idx + 1}
                    </span>

                    {/* 파일명 */}
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-700" title={img.file.name}>
                      {img.file.name}
                    </span>

                    {/* imageType 선택 */}
                    <div className="flex shrink-0 gap-1">
                      {(['detail', 'thumbnail'] as ImageType[]).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setImageType(img.localId, type)}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            img.imageType === type
                              ? 'bg-blue-500 text-white'
                              : 'border border-gray-300 bg-white text-gray-500 hover:bg-gray-100'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>

                    {/* 순서 이동 */}
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveImage(img.localId, 'up')}
                        disabled={idx === 0}
                        className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-30"
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
                        className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-30"
                        aria-label="아래로 이동"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>

                    {/* 삭제 */}
                    <button
                      type="button"
                      onClick={() => removeImage(img.localId)}
                      className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-100 hover:text-red-500"
                      aria-label="삭제"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {images.length === 0 && (
              <p className="mt-4 text-center text-sm text-gray-400">
                이미지를 추가해 주세요. <span className="text-red-400">*</span>
              </p>
            )}
          </section>

          {/* ── 3. 핵심 키워드 ─────────────────────────────────── */}
          <section className="rounded-xl border bg-white p-6 shadow-sm">
            <SectionLabel step="3" title="핵심 키워드" />
            <p className="mt-1 text-xs text-gray-400">
              번역 품질 향상에 사용됩니다. Enter로 추가하세요.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={handleKeywordKeyDown}
                placeholder="키워드 입력 후 Enter"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={addKeyword}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                추가
              </button>
            </div>

            {keywords.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {keywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700"
                  >
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      className="ml-0.5 rounded-full text-blue-400 hover:text-blue-700"
                      aria-label={`${kw} 삭제`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* ── 4. 규격 ────────────────────────────────────────── */}
          <section className="rounded-xl border bg-white p-6 shadow-sm">
            <SectionLabel step="4" title="출력 규격" />
            <p className="mt-1 text-xs text-gray-400">
              9월 MVP 기준으로 원본 규격만 사용합니다.
            </p>
            <div className="mt-4 space-y-2">
              {/* 원본 규격 — 활성 */}
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <input
                  type="radio"
                  name="spec"
                  value="spec_original"
                  defaultChecked
                  readOnly
                  className="mt-0.5 accent-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-blue-800">원본 규격</p>
                  <p className="text-xs text-blue-600">업로드된 이미지의 원본 크기를 유지합니다.</p>
                </div>
              </label>

              {/* 사이트별 규격 — 비활성 */}
              <label className="flex cursor-not-allowed items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 opacity-40">
                <input type="radio" name="spec" disabled className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-500">사이트별 규격</p>
                  <p className="text-xs text-gray-400">준비 중입니다.</p>
                </div>
              </label>

              {/* 커스텀 규격 — 비활성 */}
              <label className="flex cursor-not-allowed items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 opacity-40">
                <input type="radio" name="spec" disabled className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-500">커스텀 규격</p>
                  <p className="text-xs text-gray-400">준비 중입니다.</p>
                </div>
              </label>
            </div>
          </section>

        </div>
      </main>

      {/* 하단 액션 바 — sticky */}
      <footer className="sticky bottom-0 border-t bg-white px-6 py-4 shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          {/* 에러 메시지 */}
          {mutation.isError && (
            <p className="flex-1 text-sm text-red-500">
              {mutation.error instanceof Error
                ? mutation.error.message
                : '오류가 발생했습니다. 다시 시도해 주세요.'}
            </p>
          )}
          {!mutation.isError && (
            <p className="flex-1 text-sm text-gray-400">
              {!isValid ? '필수 항목을 모두 입력해 주세요.' : '모든 항목이 입력됐습니다.'}
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || mutation.isPending}
            className="shrink-0 rounded-lg bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? '생성 중...' : '다음 →'}
          </button>
        </div>
      </footer>
    </div>
  );
}
