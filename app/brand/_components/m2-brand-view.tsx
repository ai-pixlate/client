'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ArrowLeftGlyph16 } from '@/app/_components/library/library-controls';
import {
  canSaveM2,
  getM2NameErrors,
  getM2Status,
  isM2LogoFileAllowed,
  listM2Changes,
  normalizeM2Form,
  type M2BrandFormValue,
  type M2Mode,
} from '@/lib/brand/m2-form';
import { M2_BRAND_MOCK } from '@/lib/mock-api/m2-brand-fixtures';

import { M2LogoPanel } from './m2-logo-panel';
import { M2UnsavedDialog } from './m2-unsaved-dialog';
import { useUnsavedNavigationGuard, type BlockedNavigation } from './use-unsaved-navigation-guard';

// ─────────────────────────────────────────────────────────────────
// M2 브랜드 정보 (Figma 743:6039, 기준 frame 1920×1080)
//
//   back Icon Button   x39 y39, 40×40
//   헤더(753:6364)     x119 y79, w1680 — 제목 32 Bold / 설명 14, gap 12
//   Divider            y186
//   왼쪽 폼(1102:12496) x119 y219, 972×700, 넘칠 때만 세로 스크롤
//   오른쪽 로고         y219, w568, 폼과 간격 120(1211~1779)
//   가로 비율           1680 = 폼 972 + 간격 120 + 로고 568 + 오른쪽 안쪽 20. 좁은 화면에서는 모두 같은 배율로 줄어든다(세로·글자는 그대로)
//   하단(753:6362)     w688, 오른쪽 끝 1799(Divider와 같은 선), 아래 끝 1027
//   Figma CSS의 right·bottom은 프레임 테두리 1px 안쪽 기준이라, 화면 기준으로는 각각 2px씩 더 안쪽이다.
//
// ★ M2 API를 아직 연결하지 않았다. 저장은 화면 안의 baseline을 바꾸는 local mock persistence뿐이고
//   서버 저장은 없다 — 새로고침하거나 화면을 나가면 fixture 값으로 돌아간다. 저장 성공 toast를 두지 않는다.
//
// Figma에 있지만 넣지 않은 것: 부가 정보(F-BRD-08, PRD v3.5.10 이후 범위), [새 브랜드 추가]·[브랜드 삭제](M0 12월).
// 빈 개요·고객층 placeholder는 Figma에 없어 F-TRN-02b(비면 중립 톤) 근거로 보완했다.
// ─────────────────────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full rounded-[6px] border bg-white text-[14px] tracking-[-0.14px] text-[#171717] outline-none placeholder:text-[#707070] read-only:cursor-default';

function borderClass(editable: boolean, hasError: boolean) {
  if (hasError) return 'border-[#e5484d]';
  return editable ? 'border-[#eaeaea] focus:border-[#ff6a38]' : 'border-[#eaeaea]';
}

export default function M2BrandView() {
  const router = useRouter();

  const [mode, setMode] = useState<M2Mode>('view');
  const [baseline, setBaseline] = useState<M2BrandFormValue>(M2_BRAND_MOCK);
  const [draft, setDraft] = useState<M2BrandFormValue>(M2_BRAND_MOCK);
  const [invalidFiles, setInvalidFiles] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<BlockedNavigation | null>(null);

  const editable = mode === 'edit';
  const value = editable ? draft : baseline;
  const changes = editable ? listM2Changes(baseline, draft) : [];
  const dirty = changes.length > 0;
  const nameErrors = editable ? getM2NameErrors(draft) : { nameKo: null, nameEn: null };

  const closeDialog = useCallback(() => setPendingNavigation(null), []);
  const guard = useUnsavedNavigationGuard(dirty, setPendingNavigation);

  // ── 모드 전환 포커스 ─────────────────────────────────────────────
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const nameKoRef = useRef<HTMLInputElement>(null);
  const previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    (mode === 'edit' ? nameKoRef : editButtonRef).current?.focus();
  }, [mode]);

  // ── 고른 파일의 blob: URL 정리 — baseline과 draft 어디에도 없으면 해제한다 ──
  const blobUrls = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set([...baseline.logos, ...draft.logos].map((logo) => logo.src));
    for (const url of blobUrls.current) {
      if (live.has(url)) continue;
      URL.revokeObjectURL(url);
      blobUrls.current.delete(url);
    }
  }, [baseline, draft]);
  useEffect(() => {
    const urls = blobUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // ── 폼 동작 ─────────────────────────────────────────────────────
  const nextLogoId = useRef(0);

  const updateField = (field: 'nameKo' | 'nameEn' | 'overview' | 'targetCustomer', next: string) => {
    setDraft((current) => ({ ...current, [field]: next }));
  };

  const addLogoFiles = (files: File[]) => {
    if (files.length === 0) return;
    const allowed = files.filter(isM2LogoFileAllowed);
    setInvalidFiles(allowed.length < files.length);
    if (allowed.length === 0) return;
    const added = allowed.map((file) => {
      const src = URL.createObjectURL(file);
      blobUrls.current.add(src);
      nextLogoId.current += 1;
      return { id: `local-logo-${nextLogoId.current}`, name: file.name, src };
    });
    setDraft((current) => ({ ...current, logos: [...current.logos, ...added] }));
  };

  const removeLogo = (logoId: string) => {
    setDraft((current) => ({ ...current, logos: current.logos.filter((logo) => logo.id !== logoId) }));
  };

  const resetToBaseline = () => {
    setDraft(baseline);
    setInvalidFiles(false);
    setMode('view');
  };

  /** local mock persistence — 서버 요청 없이 draft를 화면의 baseline으로 올린다. */
  const saveLocally = () => {
    const saved = normalizeM2Form(draft);
    setBaseline(saved);
    setDraft(saved);
    setInvalidFiles(false);
    setMode('view');
  };

  const handleBack = () => {
    if (dirty) setPendingNavigation({ kind: 'href', href: '/' });
    else router.push('/');
  };

  const discardAndLeave = () => {
    const navigation = pendingNavigation;
    guard.release();
    setPendingNavigation(null);
    resetToBaseline();
    if (navigation?.kind === 'href') {
      // 쌓아 둔 history 항목을 목적지로 교체한다
      router.replace(navigation.href);
    } else if (window.history.length >= 3) {
      // 쌓아 둔 항목과 M2 자신을 건너 이전 화면으로 간다
      window.history.go(-2);
    } else {
      // M2를 새 탭에서 바로 열어 돌아갈 곳이 없다
      router.replace('/');
    }
  };

  return (
    <main
      data-testid="m2-brand"
      data-m2-status={getM2Status(mode, dirty)}
      data-persistence="local-mock"
      className="relative flex h-screen min-h-[640px] flex-col bg-white"
    >
      <button
        ref={backButtonRef}
        type="button"
        onClick={handleBack}
        aria-label="뒤로 가기"
        data-testid="m2-back"
        className="absolute top-[39px] left-[39px] flex size-10 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white hover:bg-[#f5f5f5]"
      >
        <ArrowLeftGlyph16 />
      </button>

      <div className="ml-[119px] flex min-h-0 w-[calc(100%-240px)] max-w-[1680px] flex-1 flex-col pt-[79px]">
        <header className="flex shrink-0 items-center justify-between">
          <div className="flex flex-col gap-3">
            <h1 className="text-[32px] leading-[38px] font-bold tracking-[-0.64px] text-[#171717]">브랜드 정보</h1>
            <p className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
              번역과 이미지 처리에 공통으로 사용되는 브랜드 기준을 관리합니다.
            </p>
          </div>
          {!editable && (
            <button
              ref={editButtonRef}
              type="button"
              onClick={() => setMode('edit')}
              data-testid="m2-edit"
              className="rounded-[4px] bg-white px-5 py-2 text-[12px] leading-[normal] tracking-[-0.24px] whitespace-nowrap text-[#171717] hover:bg-[#f5f5f5]"
            >
              정보 수정
            </button>
          )}
        </header>

        <div data-testid="m2-header-divider" className="mt-10 h-px shrink-0 bg-[#eaeaea]" />

        {/* 열 폭을 Figma 값 비율로 직접 정한다. 1680 폭에서는 1fr 이 정확히 1px 이다 */}
        <div
          data-testid="m2-columns"
          className="mt-8 grid max-h-[700px] min-h-0 flex-1 grid-cols-[minmax(0,972fr)_minmax(0,120fr)_minmax(0,568fr)_minmax(0,20fr)] grid-rows-[minmax(0,1fr)]"
        >
          <div className="col-start-1 min-w-0">
            <div data-testid="m2-form" className="flex h-full flex-col gap-8 overflow-x-hidden overflow-y-auto">
              <section aria-labelledby="m2-name-title" className="flex shrink-0 flex-col gap-3">
                <h2 id="m2-name-title" className="flex gap-1 text-[18px] leading-[21px] font-medium tracking-[-0.54px] text-[#171717]">
                  브랜드명 <span className="text-[#ff6a38]" aria-hidden="true">*</span>
                </h2>
                {/* 405 : 162 : 405. 입력창은 Text Input 최소 폭 160 아래로 줄지 않는다 */}
                <div className="grid grid-cols-[minmax(160px,405fr)_minmax(16px,162fr)_minmax(160px,405fr)] items-start">
                  <NameField
                    id="m2-name-ko"
                    label="한글명"
                    inputRef={nameKoRef}
                    value={value.nameKo}
                    editable={editable}
                    error={nameErrors.nameKo}
                    onChange={(next) => updateField('nameKo', next)}
                  />
                  <NameField
                    className="col-start-3"
                    id="m2-name-en"
                    label="영문명"
                    value={value.nameEn}
                    editable={editable}
                    error={nameErrors.nameEn}
                    onChange={(next) => updateField('nameEn', next)}
                  />
                </div>
                <div className="h-px shrink-0 bg-[#eaeaea]" />
              </section>

              <TextSection
                id="m2-overview"
                title="브랜드 톤"
                description="브랜드 정체성과 보이스를 입력하면 번역에 반영됩니다."
                heightClass="h-[132px]"
                value={value.overview}
                editable={editable}
                onChange={(next) => updateField('overview', next)}
              />
              <TextSection
                id="m2-target-customer"
                title="핵심 고객층"
                description="주요 고객의 특성을 입력하면 어조와 표현 선택에 반영됩니다."
                heightClass="h-[112px]"
                value={value.targetCustomer}
                editable={editable}
                onChange={(next) => updateField('targetCustomer', next)}
              />
            </div>
          </div>

          <M2LogoPanel
            logos={value.logos}
            editable={editable}
            invalidFiles={invalidFiles}
            onAddFiles={addLogoFiles}
            onRemove={removeLogo}
          />
        </div>
      </div>

      <footer className="mt-6 mr-[121px] mb-[53px] ml-auto flex h-[37px] w-[688px] max-w-[calc(100%-240px)] shrink-0 items-center justify-between gap-4">
        <p data-testid="m2-apply-notice" className="min-w-0 text-[12px] leading-[normal] font-light tracking-[-0.48px] text-[#ff6a38]">
          변경한 브랜드 정보는 새로 시작하는 작업부터 적용되며, 이미 완료된 작업에는 자동 반영되지 않습니다.
        </p>
        {editable && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={resetToBaseline}
              data-testid="m2-cancel"
              className="flex h-[37px] items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-7 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717] hover:bg-[#f5f5f5]"
            >
              취소
            </button>
            <button
              type="button"
              onClick={saveLocally}
              disabled={!canSaveM2(baseline, draft)}
              data-testid="m2-save"
              className="flex h-[37px] items-center justify-center rounded-[6px] bg-[#171717] px-7 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              변경사항 저장
            </button>
          </div>
        )}
      </footer>

      {pendingNavigation && (
        <M2UnsavedDialog changes={changes} onStay={closeDialog} onDiscard={discardAndLeave} returnFocusRef={backButtonRef} />
      )}
    </main>
  );
}

function NameField({
  className = '',
  id,
  label,
  value,
  editable,
  error,
  onChange,
  inputRef,
}: {
  className?: string;
  id: string;
  label: string;
  value: string;
  editable: boolean;
  error: string | null;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <label htmlFor={id} className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        readOnly={!editable}
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        data-testid={id}
        className={`${INPUT_CLASS} ${borderClass(editable, !!error)} h-10 px-4`}
      />
      {error && (
        <p id={errorId} data-testid={errorId} className="text-[12px] leading-[normal] tracking-[-0.12px] text-[#e5484d]">
          {error}
        </p>
      )}
    </div>
  );
}

function TextSection({
  id,
  title,
  description,
  heightClass,
  value,
  editable,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  heightClass: string;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  const titleId = `${id}-title`;
  return (
    <section aria-labelledby={titleId} className="flex shrink-0 flex-col gap-3">
      <h2 id={titleId} className="text-[18px] leading-[21px] font-medium tracking-[-0.54px] text-[#171717]">
        {title}
      </h2>
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
          {description}
        </label>
        <textarea
          id={id}
          value={value}
          readOnly={!editable}
          placeholder={editable ? '비워 두면 중립 톤으로 번역합니다.' : '입력된 내용이 없습니다.'}
          onChange={(event) => onChange(event.target.value)}
          data-testid={id}
          className={`${INPUT_CLASS} ${borderClass(editable, false)} ${heightClass} resize-none p-4 leading-[17px]`}
        />
      </div>
      <div className="h-px shrink-0 bg-[#eaeaea]" />
    </section>
  );
}
