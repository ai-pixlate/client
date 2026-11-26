'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppHeader } from '@/app/_components/app-header/app-header';
import {
  canSaveM2,
  getM2NameErrors,
  getM2Status,
  isM2LogoFileAllowed,
  listM2Changes,
  type M2BrandFormValue,
  type M2Mode,
} from '@/lib/brand/m2-form';
import type { ApiBrand, ApiBrandLogo } from '@/lib/api/brand-schema';
import { ApiRequestError } from '@/lib/api/pixlate';
import { M2_EMPTY_FORM, resolveM2BrandTarget, toM2BrandFormValue } from '@/lib/brand/m2-adapter';
import { useBrandLogosQuery, useBrandQuery, useBrandsQuery } from '@/lib/queries/pixlate';

import { M2Button } from './m2-button';
import { M2LogoPanel } from './m2-logo-panel';
import { M2UnsavedDialog } from './m2-unsaved-dialog';
import { useM2BrandCreate, type M2CreateState } from './use-m2-brand-create';
import { useM2BrandSave, type M2SaveState, type M2SaveTarget } from './use-m2-brand-save';
import { useUnsavedNavigationGuard, type BlockedNavigation } from './use-unsaved-navigation-guard';

// ─────────────────────────────────────────────────────────────────
// M2 브랜드 정보 (Figma 743:6039, 기준 frame 1920×1080 — 2026-11 최신본)
//
//   공통 헤더(1809:37847)  0/0/1920/72 — AppHeader work 변형 · 화면명 「브랜드 정보」. 이전 back 버튼·큰 제목·설명·Divider 는 최신본에 없다.
//   왼쪽 폼(1102:12496)    x120 y96, w972 — 섹션 gap 36 · 섹션 제목(18 Medium)→내용 16 · 라벨→입력 2. 섹션 사이 Divider 없음
//   오른쪽 로고(753:6373)  x1232 y96, w568 — 폼과 간격 140, 오른쪽 여백 120
//   가로 비율             1680 = 폼 972 + 간격 140 + 로고 568. 좁은 화면에서는 모두 같은 배율로 줄어든다(세로·글자는 그대로)
//   하단                  브랜드 삭제(743:6121) x120 · 아래 54 · 94×30 / 안내+버튼 묶음(753:6362) w688 · 오른쪽 120 · 아래 52
//
// 편집 상태: 최신 Figma 에는 [정보수정]·읽기 전용 보기가 없다 — 기존 브랜드도 처음부터 편집 상태다(2026-11 결정).
//   [취소]는 서버 값(baseline)으로 되돌리고, [변경사항 저장]은 변경이 있을 때만 켜진다. 미저장 이탈 확인(링크·뒤로가기·헤더 로그아웃)은 그대로다.
//
// ★ Brand API 연결: GET /brands/{brandId} + GET /brands/{brandId}/logos 가 화면 정본(baseline)이다.
//   [변경사항 저장]은 PATCH(바뀐 항목만) → 로고 DELETE·POST → 로고 목록 다시 받기(use-m2-brand-save.ts). 서버 응답으로만
//   baseline 을 바꾸고, 실패하면 draft 를 그대로 둔다. Mock(MSW)도 같은 API·Adapter 를 탄다. 저장 성공 toast를 두지 않는다.
//   brandId: ?brandId= 가 있으면 그것, 없으면 GET /brands 가 하나일 때만 그 브랜드(m2-adapter resolveM2BrandTarget).
//
// Figma에 있지만 넣지 않은 것: 부가 정보(담당자·소속·사업장 주소·제조사 — Brand API 계약에 필드가 없다, F-BRD-08), 로고 카드 체크박스(의미 미확정).
// [브랜드 삭제]·[로고 변경]은 후속 범위라 Figma 모습만 보여 주고 "3차 구현 예정" 툴팁을 단다(DELETE /brands/{brandId} 계약 없음).
//
// ★ 신규 등록(create mode): 별도 Figma frame 이 없어 같은 M2 레이아웃을 그대로 쓴다(view · edit · create).
//   진입: /brand?mode=create&from=home|brands (H0 [새 브랜드 등록] · M0 [브랜드 추가]) · /brand?mode=create&next=n1 (M1 작업 시작, 브랜드 0개)
//         · GET /brands 가 [] 인 /brand. 셀러 1:N(F-ACC-02)이라 브랜드가 이미 있어도 등록 화면을 연다.
//   [취소]·이탈 목적지: from=home → H0 · from=brands → M0 · next=n1 → 전체 보관함(/) · 그 밖 → M0.
//   ?brandId 없이 /brand 로 왔는데 브랜드가 여러 개면 고르지 않고 M0 로 보낸다.
//   [브랜드 등록] = POST /brands 1회(use-m2-brand-create.ts) → 응답 Brand.id 로 로고 POST(use-m2-brand-save.ts).
//   완료하면 next=n1 은 /jobs/new?brandId={id}, 그 밖은 /brand?brandId={id}. next 는 'n1' 만 받는다(임의 URL 이동 없음).
//   등록 뒤 로고만 실패하면 같은 화면에 남고, 다시 저장은 그 brandId 의 로고만 보낸다(POST /brands 를 다시 보내지 않는다).
// 헤더 [삭제]는 현재 범위인 로고 삭제지만 대상을 고르는 체크박스가 없어 미연결이고, 실제 로컬 삭제는 카드의 삭제 버튼이 맡는다.
// 빈 개요·고객층 placeholder는 Figma에 없어 F-TRN-02b(비면 중립 톤) 근거로 보완했다.
// ─────────────────────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full rounded-[6px] border bg-white text-[14px] tracking-[-0.14px] text-[#171717] outline-none placeholder:text-[#707070] read-only:cursor-default';

function borderClass(editable: boolean, hasError: boolean) {
  if (hasError) return 'border-[#e5484d]';
  return editable ? 'border-[#eaeaea] focus:border-[#ff6a38]' : 'border-[#eaeaea]';
}

/** 조회 단계 — 어느 브랜드인지 정하고 브랜드·로고를 받은 뒤에만 편집 화면을 그린다 */
export default function M2BrandView() {
  const searchParams = useSearchParams();
  const queryBrandId = searchParams.get('brandId');
  const isCreateRoute = searchParams.get('mode') === 'create';
  const next: M2CreateNext = searchParams.get('next') === 'n1' ? 'n1' : null;
  // 등록 경로(mode=create)도 먼저 GET /brands 를 본다 — 목록을 받기 전·실패하면 등록 화면을 열지 않는다(실패를 0개로 보지 않는다)
  const brandsQuery = useBrandsQuery(isCreateRoute || queryBrandId == null || queryBrandId === '');
  const target = resolveM2BrandTarget(isCreateRoute ? null : queryBrandId, brandsQuery.data ?? null);
  // 등록 화면은 목록을 받은 뒤 한 번 정하고 고정한다 — 등록 뒤 목록이 다시 오더라도(로고 저장 실패로 남은 경우 등) 화면을 갈아치우지 않는다.
  // 등록 경로(mode=create)는 브랜드 수와 관계없이 연다(1:N). ?brandId 없는 /brand 는 브랜드가 0개일 때만 등록 화면이다
  const [createEntered, setCreateEntered] = useState(false);
  if (!createEntered && brandsQuery.isSuccess && (isCreateRoute || target?.kind === 'none')) setCreateEntered(true);
  // 등록을 마치고 특정 브랜드(?brandId=)로 옮겨 가면 등록 화면 고정을 푼다
  if (createEntered && !isCreateRoute && queryBrandId) setCreateEntered(false);
  const brandId = !isCreateRoute && target?.kind === 'id' ? target.brandId : null;
  const brandQuery = useBrandQuery(brandId);
  const logosQuery = useBrandLogosQuery(brandId);

  if (createEntered) {
    return <M2BrandEditor key="create" create={{ next, cancelHref: resolveCreateCancelHref(searchParams.get('from'), next) }} />;
  }
  // ?brandId 없이 왔는데 브랜드가 여러 개 — FE 가 고르지 않고 M0(브랜드 선택)로 보낸다
  if (!isCreateRoute && target?.kind === 'ambiguous') return <M2Redirect href="/brand/select" />;

  const isNotFound = (error: unknown) => error instanceof ApiRequestError && error.status === 404;
  let message: { state: string; text: string } | null = null;
  if (brandsQuery.isError) message = { state: 'error', text: '브랜드 정보를 불러오지 못했습니다.' };
  else if (target?.kind === 'none') message = { state: 'none', text: '등록된 브랜드가 없습니다.' };
  // 여러 브랜드 — 고르지 않고, 지우거나 새로 만들지도 않는다. 문의 경로는 제품에 없어 안내만 둔다
  else if (target?.kind === 'invalid-query' || isNotFound(brandQuery.error) || isNotFound(logosQuery.error))
    message = { state: 'not-found', text: '브랜드를 찾을 수 없습니다.' };
  else if (brandQuery.isError || logosQuery.isError) message = { state: 'error', text: '브랜드 정보를 불러오지 못했습니다.' };

  if (message || brandId == null || !brandQuery.data || !logosQuery.data) {
    return <M2LoadState state={message?.state ?? 'loading'} text={message?.text ?? '브랜드 정보를 불러오는 중입니다.'} />;
  }
  return <M2BrandEditor key={brandId} existing={{ brandId, brand: brandQuery.data, logos: logosQuery.data }} />;
}

/** 이미 있는 브랜드로 연결한다(이력에 등록 화면을 남기지 않는다) */
function M2Redirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return <M2LoadState state="redirect" text="등록된 브랜드로 이동하는 중입니다." />;
}

/** 조회 중·실패 — Figma 표본이 없어 공통 헤더 아래 콘텐츠 시작 자리에 안내 한 줄만 둔다(새 레이아웃을 만들지 않는다) */
function M2LoadState({ state, text }: { state: string; text: string }) {
  return (
    <div className="relative flex h-screen min-h-[640px] flex-col bg-white">
      <AppHeader variant="work" title="브랜드 정보" scope="M2" />
      <main data-testid="m2-brand" data-m2-load={state} className="ml-[120px] flex flex-col gap-3 pt-6">
        <h1 className="sr-only">브랜드 정보</h1>
        <p role={state === 'loading' ? 'status' : 'alert'} data-testid="m2-load-message" className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
          {text}
        </p>
      </main>
    </div>
  );
}

/** 저장 실패 안내 — 입력은 그대로 남아 있다는 것을 함께 알린다 */
function saveErrorText(state: M2SaveState, afterCreate: boolean): string | null {
  if (state.kind !== 'error') return null;
  if (state.reason === 'duplicate') return '같은 셀러에 같은 이름의 브랜드가 있어 저장하지 않았습니다. 한글명·영문명을 확인해 주세요.';
  if (state.reason === 'conflict') return '다른 브랜드와 이름이 겹쳐 저장하지 못했습니다. 입력한 내용은 그대로 있으니 확인 후 다시 저장해주세요.';
  if (state.reason === 'precheck-failed') return '브랜드 이름 중복을 확인하지 못해 저장하지 않았습니다. 잠시 뒤 다시 저장해주세요.';
  if (state.brandFailed) return '브랜드 정보를 저장하지 못했습니다. 입력한 내용은 그대로 있으니 다시 저장해주세요.';
  if (afterCreate) return '브랜드는 등록됐지만 일부 로고를 저장하지 못했습니다. 남은 로고를 확인하고 다시 저장해주세요.';
  return '일부 로고를 저장하지 못했습니다. 남은 변경을 확인하고 다시 저장해주세요.';
}

/** 등록 안내 — 자동 재시도하지 않고, 입력은 그대로 남는다 */
function createErrorText(state: M2CreateState): string | null {
  if (state.kind === 'verifying') return '등록 결과를 확인하는 중입니다.';
  if (state.kind === 'verify-failed') return '등록 결과를 확인하지 못했습니다. 다시 등록하지 말고 먼저 결과를 확인해 주세요.';
  if (state.kind === 'verified-empty') return '등록된 브랜드를 확인하지 못했습니다. 입력한 내용으로 다시 등록할 수 있습니다.';
  if (state.kind === 'duplicate') return '같은 셀러에 같은 이름의 브랜드가 있어 등록하지 않았습니다. 한글명·영문명을 확인해 주세요.';
  if (state.kind === 'unconfirmed')
    return '등록 결과를 확인하지 못했습니다. 같은 이름의 브랜드가 있지만 이번 요청으로 만들어졌는지 알 수 없어 로고·정보를 이어 저장하지 않았습니다.';
  if (state.kind === 'precheck-failed') return '브랜드 정보를 확인하지 못해 등록하지 않았습니다. 잠시 뒤 다시 시도해 주세요.';
  if (state.kind !== 'error') return null;
  if (state.reason === 'conflict') return '이미 등록된 브랜드와 겹쳐 등록하지 못했습니다. 입력한 내용은 그대로 있으니 확인 후 다시 시도해주세요.';
  if (state.reason === 'validation') return '브랜드 정보를 확인해주세요. 한글명과 영문명은 필수입니다.';
  return '브랜드를 등록하지 못했습니다. 입력한 내용은 그대로 있으니 다시 시도해주세요.';
}

/** 등록 완료 뒤 갈 곳 — 'n1' 하나만 받는다(쿼리의 임의 URL 로 이동하지 않는다) */
type M2CreateNext = 'n1' | null;

/** 등록 화면 [취소]·이탈 목적지 — from 은 정해진 값만 받는다(쿼리의 임의 URL 로 이동하지 않는다) */
function resolveCreateCancelHref(from: string | null, next: M2CreateNext): string {
  if (next === 'n1') return '/';
  if (from === 'home') return '/home';
  return '/brand/select';
}

type M2EditorProps =
  | { existing: { brandId: number; brand: ApiBrand; logos: ApiBrandLogo[] }; create?: undefined }
  | { existing?: undefined; create: { next: M2CreateNext; cancelHref: string } };

function M2BrandEditor({ existing, create }: M2EditorProps) {
  const router = useRouter();
  const isCreate = create != null;

  // 최신 Figma 에는 읽기 전용 보기가 없다 — 기존 브랜드도 처음부터 편집 상태다
  const mode: M2Mode = isCreate ? 'create' : 'edit';
  // 화면 정본 = 서버 응답(브랜드 + 로고 목록). 저장도 이 값을 바꾸지 않고 query cache 를 서버 응답으로 바꾼다
  const existingBrand = existing?.brand;
  const existingLogos = existing?.logos;
  const serverBaseline = useMemo(
    () => (existingBrand && existingLogos ? toM2BrandFormValue(existingBrand, existingLogos) : M2_EMPTY_FORM),
    [existingBrand, existingLogos],
  );
  // 신규 등록: POST /brands 가 성공하면 그 응답이 대상 브랜드다. 이후 저장은 이 brandId 로만 간다
  const [created, setCreated] = useState<M2SaveTarget | null>(null);
  const [createdBaseline, setCreatedBaseline] = useState<M2BrandFormValue | null>(null);
  const baseline = createdBaseline ?? serverBaseline;
  const existingBrandId = existing?.brandId;
  const saveTarget = useMemo<M2SaveTarget | null>(
    () => (existingBrandId != null && existingBrand ? { brandId: existingBrandId, brand: existingBrand } : created),
    [existingBrandId, existingBrand, created],
  );
  const [draft, setDraft] = useState<M2BrandFormValue>(baseline);
  const saver = useM2BrandSave(saveTarget);
  const creator = useM2BrandCreate();
  const submittingRef = useRef(false);
  const isSaving = saver.state.kind === 'saving' || creator.state.kind === 'creating' || creator.state.kind === 'verifying';
  // 결과 불명 — 확인 전에는 등록 버튼 대신 [다시 확인](목록 재조회만)을 보인다
  const needsVerification = creator.state.kind === 'verify-failed' || creator.state.kind === 'verifying';
  const [invalidFiles, setInvalidFiles] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<M2PendingLeave | null>(null);
  // 등록 화면은 빈 칸에서 시작한다 — 손대기 전에는 필수 오류를 빨갛게 보이지 않는다(검증 규칙은 같다)
  const [touchedNames, setTouchedNames] = useState({ nameKo: !isCreate, nameEn: !isCreate });

  const editable = true;
  const value = draft;
  const changes = listM2Changes(baseline, draft);
  const dirty = changes.length > 0;
  const draftNameErrors = getM2NameErrors(draft);
  const nameErrors = {
    nameKo: touchedNames.nameKo ? draftNameErrors.nameKo : null,
    nameEn: touchedNames.nameEn ? draftNameErrors.nameEn : null,
  };
  const canSubmit =
    isCreate && !created
      ? !draftNameErrors.nameKo && !draftNameErrors.nameEn
      : canSaveM2(baseline, draft);
  const leaveHref = created ? `/brand?brandId=${created.brandId}` : (create?.cancelHref ?? '/');

  const closeDialog = useCallback(() => setPendingNavigation(null), []);
  const guard = useUnsavedNavigationGuard(dirty, setPendingNavigation);

  // ── 포커스 ─────────────────────────────────────────────────────
  // 확인창이 닫힌 뒤 돌아갈 곳 — 화면 제목(시각적으로 숨김, Tab 순서 밖)
  const titleRef = useRef<HTMLHeadingElement>(null);
  const nameKoRef = useRef<HTMLInputElement>(null);
  // 등록 화면은 첫 입력칸에서 시작한다
  useEffect(() => {
    if (isCreate) nameKoRef.current?.focus();
  }, [isCreate]);

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
    if (field === 'nameKo' || field === 'nameEn') touchName(field);
  };
  const touchName = (field: 'nameKo' | 'nameEn') => setTouchedNames((current) => (current[field] ? current : { ...current, [field]: true }));

  const addLogoFiles = (files: File[]) => {
    if (files.length === 0) return;
    const allowed = files.filter(isM2LogoFileAllowed);
    setInvalidFiles(allowed.length < files.length);
    if (allowed.length === 0) return;
    const added = allowed.map((file) => {
      const src = URL.createObjectURL(file);
      blobUrls.current.add(src);
      nextLogoId.current += 1;
      return { id: `local-logo-${nextLogoId.current}`, name: file.name, src, serverId: null, file };
    });
    setDraft((current) => ({ ...current, logos: [...current.logos, ...added] }));
  };

  const removeLogo = (logoId: string) => {
    setDraft((current) => ({ ...current, logos: current.logos.filter((logo) => logo.id !== logoId) }));
  };

  /** [취소] — 서버 값으로 되돌린다. 편집 상태는 그대로다 */
  const resetToBaseline = () => {
    setDraft(baseline);
    setInvalidFiles(false);
    setTouchedNames({ nameKo: true, nameEn: true });
    saver.reset();
  };

  const handleSave = async () => {
    const outcome = await saver.save(baseline, draft);
    if (!outcome) return; // 이미 저장 중
    setDraft(outcome.draft);
    if (outcome.complete) setInvalidFiles(false);
  };

  /**
   * 신규 등록 — POST /brands(처음 한 번) → 응답 brandId 로 로고 POST. 화면 전체를 ref 로 한 번만 돌린다(연속 클릭 · state 반영 전 클릭).
   * 등록이 이미 성공했으면 POST /brands 를 다시 보내지 않고 그 브랜드의 남은 변경(로고)만 저장한다.
   */
  const handleCreate = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      let target = created;
      let base = baseline;
      if (!target) {
        const result = await creator.create(draft);
        if (!result) return; // 실패·중복·결과 불명 — 입력 그대로, 등록 화면 유지
        target = { brandId: result.brandId, brand: result.brand };
        base = toM2BrandFormValue(result.brand, []);
        setCreated(target);
        setCreatedBaseline(base);
      }
      const outcome = await saver.save(base, draft, target);
      if (!outcome) return;
      setCreatedBaseline(outcome.baseline);
      setDraft(outcome.draft);
      if (!outcome.complete) return; // 로고 일부 실패 — 남은 로고 draft 를 두고 같은 화면에 남는다
      leaveTo(target.brandId);
    } finally {
      submittingRef.current = false;
    }
  };

  /** 등록이 끝난 새 브랜드로 — next=n1 이면 그 브랜드의 N1, 아니면 그 브랜드의 M2(브랜드별 M1 은 계약 대기) */
  const leaveTo = (id: number) => {
    guard.release();
    router.replace(create?.next === 'n1' ? `/jobs/new?brandId=${id}` : `/brand?brandId=${id}`);
  };

  /** [다시 확인] — 목록 재조회만 한다. POST /brands 를 보내지 않는다 */
  const handleVerify = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      // 결과만 확인한다 — 같은 이름의 브랜드가 보여도 이번 요청 결과로 단정하지 않고 이어 저장하지 않는다(use-m2-brand-create.ts)
      await creator.verify();
    } finally {
      submittingRef.current = false;
    }
  };

  const requestLeave = (href: string) => {
    if (isSaving) return; // 서버 요청 중에는 나가지 않는다
    if (dirty) setPendingNavigation({ kind: 'href', href });
    else router.push(href);
  };

  /** 헤더 [로그아웃] — 변경이 있으면 확인창을 거친다. 버리면 그때 로그아웃한다 */
  const requestLogout = useCallback(
    (runLogout: () => Promise<void>) => {
      if (isSaving) return;
      if (dirty) setPendingNavigation({ kind: 'logout', run: runLogout });
      else void runLogout();
    },
    [dirty, isSaving],
  );

  const discardAndLeave = () => {
    const navigation = pendingNavigation;
    guard.release();
    setPendingNavigation(null);
    if (!isCreate) resetToBaseline();
    if (navigation?.kind === 'logout') {
      void navigation.run();
    } else if (navigation?.kind === 'href') {
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

  const errorText = createErrorText(creator.state) ?? saveErrorText(saver.state, created != null);
  // 중복·결과 미확인 안내에 붙이는 이동 경로 — 기존(또는 후보) 브랜드의 M2, 후보가 여럿이면 M0
  const errorLink: { href: string; label: string } | null =
    creator.state.kind === 'duplicate'
      ? { href: `/brand?brandId=${creator.state.existing.brandId}`, label: `기존 브랜드 「${creator.state.existing.name}」 보기` }
      : creator.state.kind === 'unconfirmed'
        ? creator.state.candidate
          ? { href: `/brand?brandId=${creator.state.candidate.brandId}`, label: `「${creator.state.candidate.name}」 확인하기` }
          : { href: '/brand/select', label: '브랜드 목록에서 확인하기' }
        : saver.state.kind === 'error' && saver.state.reason === 'duplicate' && saver.state.existing
          ? { href: `/brand?brandId=${saver.state.existing.brandId}`, label: `기존 브랜드 「${saver.state.existing.name}」 보기` }
          : null;

  return (
    <div className="relative flex h-screen min-h-[640px] flex-col bg-white">
      <AppHeader variant="work" title="브랜드 정보" scope="M2" onLogoutRequest={requestLogout} />
    <main
      data-testid="m2-brand"
      data-m2-status={getM2Status(mode, dirty)}
      data-persistence="api"
      data-save-state={saver.state.kind}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      <div className="ml-[120px] flex min-h-0 w-[calc(100%-240px)] max-w-[1680px] flex-1 flex-col pt-6">
        <h1 ref={titleRef} tabIndex={-1} className="sr-only">
          브랜드 정보
        </h1>

        {/* 열 폭을 Figma 값 비율로 직접 정한다. 1680 폭에서는 1fr 이 정확히 1px 이다 */}
        <div
          data-testid="m2-columns"
          className="grid min-h-0 flex-1 grid-cols-[minmax(0,972fr)_minmax(0,140fr)_minmax(0,568fr)] grid-rows-[minmax(0,1fr)]"
        >
          <div className="col-start-1 min-w-0">
            {/* 스크롤은 그대로 되고 막대만 보이지 않는다. Figma 에서 막대가 두 열 사이 구분선처럼 보이지 않도록 한다 */}
            <div data-testid="m2-form" className="n3-scroll-hidden flex h-full flex-col gap-9 overflow-x-hidden overflow-y-auto">
              <section aria-labelledby="m2-name-title" className="flex shrink-0 flex-col gap-4">
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
                    onBlur={() => touchName('nameKo')}
                  />
                  <NameField
                    className="col-start-3"
                    id="m2-name-en"
                    label="영문명"
                    value={value.nameEn}
                    editable={editable}
                    error={nameErrors.nameEn}
                    onChange={(next) => updateField('nameEn', next)}
                    onBlur={() => touchName('nameEn')}
                  />
                </div>
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

      {/* Figma 브랜드 삭제(743:6121 — x120, 아래 54). 등록 화면에는 두지 않는다 */}
      {!isCreate && (
        <div className="absolute bottom-[54px] left-[120px]">
          <M2Button variant="danger" size="sm" label="브랜드 삭제" future testId="m2-delete-brand" />
        </div>
      )}

      {/* Figma 688px 묶음(안내 + 버튼, 753:6362) — 오른쪽 120 · 아래 52 */}
      <footer
        data-testid="m2-footer"
        className="mt-[19px] mr-[120px] mb-[52px] ml-auto flex min-h-[37px] w-[688px] max-w-[calc(100%-240px)] shrink-0 items-center justify-between gap-4"
      >
        {/* 저장 실패 안내는 Figma 표본이 없어 같은 안내 자리에 오류 색으로 바꿔 보인다(새 배치·toast 없음) */}
        {errorText ? (
          // 안내가 길면 줄바꿈한다(평소 높이 37 은 그대로). 중복·결과 미확인이면 기존(후보) 브랜드로 가는 링크를 붙인다
          <p role="alert" data-testid="m2-save-error" className="min-w-0 text-right text-[12px] leading-[16px] tracking-[-0.12px] text-[#e5484d]">
            {errorText}
            {errorLink && (
              <>
                {' '}
                <Link
                  href={errorLink.href}
                  data-testid="m2-error-link"
                  className="whitespace-nowrap text-[#171717] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
                >
                  {errorLink.label}
                </Link>
              </>
            )}
          </p>
        ) : (
          <p data-testid="m2-apply-notice" className="min-w-0 text-right text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-nowrap text-[#ff6a38]">
            변경한 브랜드 정보는 새로 시작하는 작업부터 적용되며, 이미 완료된 작업에는 자동 반영되지 않습니다.
          </p>
        )}
        {editable && (
          // Button MD(708:5827) — px 20 + label px 8, 14 Medium −0.42 · 높이 37
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={isCreate ? () => requestLeave(leaveHref) : resetToBaseline}
              disabled={isSaving}
              data-testid="m2-cancel"
              className="flex h-[37px] items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-[27px] text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717] hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40"
            >
              취소
            </button>
            {/* 등록 화면의 주 버튼은 [변경사항 저장]과 같은 자리·모습이다(별도 Figma 없음). 등록 뒤 로고만 남으면 [다시 저장] */}
            {isCreate && needsVerification ? (
              // 결과 불명 — 같은 자리·모습의 [다시 확인]. 목록 재조회만 한다(POST /brands 없음)
              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={isSaving}
                aria-busy={isSaving || undefined}
                data-testid="m2-create-verify"
                className="flex h-[37px] items-center justify-center rounded-[6px] bg-[#171717] px-7 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                다시 확인
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void (isCreate ? handleCreate() : handleSave())}
                disabled={isSaving || !canSubmit}
                aria-busy={isSaving || undefined}
                data-testid={isCreate ? 'm2-create' : 'm2-save'}
                className="flex h-[37px] items-center justify-center rounded-[6px] bg-[#171717] px-7 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isCreate ? (created ? '다시 저장' : '브랜드 등록') : '변경사항 저장'}
              </button>
            )}
          </div>
        )}
      </footer>

      {pendingNavigation && (
        <M2UnsavedDialog changes={changes} onStay={closeDialog} onDiscard={discardAndLeave} returnFocusRef={titleRef} />
      )}
    </main>
    </div>
  );
}

/** 미저장 확인창을 연 이유 — 링크·뒤로가기(가드) 또는 헤더 로그아웃 */
type M2PendingLeave = BlockedNavigation | { kind: 'logout'; run: () => Promise<void> };

function NameField({
  className = '',
  id,
  label,
  value,
  editable,
  error,
  onChange,
  onBlur,
  inputRef,
}: {
  className?: string;
  id: string;
  label: string;
  value: string;
  editable: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${className}`}>
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
        onBlur={onBlur}
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
    <section aria-labelledby={titleId} className="flex shrink-0 flex-col gap-4">
      <h2 id={titleId} className="text-[18px] leading-[21px] font-medium tracking-[-0.54px] text-[#171717]">
        {title}
      </h2>
      <div className="flex flex-col gap-0.5">
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
    </section>
  );
}
