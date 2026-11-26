'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { pixlateKeys, useCancelJobMutation } from '@/lib/queries/pixlate';

import { S0ExitDialog, type ExitDestination } from './s0-exit-dialog';

// ─────────────────────────────────────────────────────────────────
// N1~N6 공통 작업 나가기(PRD v3.6.4 F-JOB-07 · 화면정의서 S0 · HD) — 12월에는 ✕ 가 없고, 나가기는 앱 안의 브라우저 뒤로 가기와
// 상단 메뉴(로고 · [브랜드 관리] · [로그아웃])다. 어느 길로 나가도 같은 확인을 거친다.
//
// - 작업이 아직 없는 N1(jobId 없음): 미저장 확인 → [나가기]. 서버 요청 없음.
// - 작업이 있는 N1~N6: 삭제 대상을 열거한 작업 취소 확인 → DELETE /jobs/{jobId}. 확인 전에는 요청하지 않는다.
//   성공해야 이동한다 — 뒤로 가기는 보관함(M1), 상단 메뉴는 누른 곳, 로그아웃은 취소가 끝난 뒤에만 로그아웃한다.
//   실패하면 작업과 화면, 확인창을 그대로 두어 다시 시도할 수 있다.
// - 완료된 작업(N6 서버 job.isSaved=true)은 묻지 않고 그대로 이동한다. FE 가 isSaved 를 만들지 않는다(다운로드 뒤에는 서버 값을 다시 받기만 한다).
// - 상태를 모르는 동안(조회 중)은 나가기를 통과시키지도, 취소하지도 않는다 — 누른 목적지를 잡아 두었다가 조회가 끝나면
//   진행 중(active)이면 확인을 열고, 완료(saved)·없는 작업(not-found)이면 취소 요청 없이 그 목적지로 간다.
// - 조회 실패(error)는 저장된 N6 인지 알 수 없어 DELETE 를 보내지도, 조용히 보내 주지도 않는다. 같은 확인창을 「상태를 확인하지
//   못함」으로 열어 실패를 알리고 [계속하기](머묾) · [다시 확인](재조회 결과로 다시 판단 — active 면 그때 작업 취소 확인으로 바꾼다) ·
//   [작업 남기고 나가기](취소 없이 누른 곳으로 — 작업이 취소되지 않는다고 밝힌다) 중에서 고르게 한다. 상태가 뒤에서 바뀌어도 창의
//   종류는 사용자가 [다시 확인]을 눌렀을 때만 바뀐다(누르려던 버튼이 [작업 취소]로 바뀌지 않게).
// - 새로고침 · 탭 닫기 · 사이트 밖으로 나가는 이동은 확인을 띄울 수 없어 막지 않고, 취소도 하지 않는다(beforeunload 없음).
//
// 가로채는 방법 — App Router 에는 이동 전 이벤트가 없어 두 길을 직접 잡는다(브랜드 화면 use-unsaved-navigation-guard 와 같은 방식).
// - 앱 안 링크(로고 · [브랜드 관리] 등): document capture 단계에서 같은 출처 <a> 클릭을 막는다. next/link 처리보다 먼저 돈다.
// - 브라우저 뒤로 가기: 같은 URL 의 history 항목을 하나 더 쌓아 두고, popstate 가 오면 다시 쌓은 뒤 확인을 연다.
//   history.state 를 그대로 넘기므로 Next 라우터의 화면 전환이 일어나지 않는다. 항목은 조회 중에도 쌓는다. 나중에 완료·없는 작업으로
//   밝혀지면 뒤로 가기가 그 항목을 꺼낸 순간 묻지 않고 보관함으로 보내 한 번 눌러 나가게 한다.
//   확인 뒤 이동은 router.replace 로 그 항목을 대신한다 — 취소한 작업 화면으로 뒤로 가기가 곧장 돌아오지 않게.
// - 취소에 성공해 화면을 떠나면 그 작업의 query cache 를 지운다 — 나중에 그 URL 로 돌아와도 지운 작업을 cache 로 그리지 않고 서버에 다시 묻는다.
// - 로그아웃은 링크가 아니라 버튼이라 requestLogout 으로 실행 함수를 받아 확인 뒤에 부른다(JobHeader onLogoutRequest).
//
// 작업 안의 자동 단계 전환(N2→N3 · N4→N5 등)은 같은 URL 안의 상태 변화이고, N1 [다음]·N6 [저장] 뒤 이동은 router 가 하는
// 이동이라 어느 쪽도 가로채지 않는다. 페이지에서 한 번만 써서(단계 화면 밖) 자동 전환에도 확인창과 진행 중인 DELETE 가 유지된다.
// F-JOB-08 처리 중단은 작업을 남기는 다른 동작이라 여기서 다루지 않는다.
// ─────────────────────────────────────────────────────────────────

/** 나가기 판단에 쓰는 실제 조회 상태 — 화면이 서버 응답으로 정한다 */
export type ExitGuardStatus = 'loading' | 'active' | 'saved' | 'not-found' | 'error';

type DialogMode = 'confirm' | 'unknown';

type ExitTarget =
  | { kind: 'href'; href: string; destination: ExitDestination }
  | { kind: 'history-back'; destination: 'library' }
  | { kind: 'logout'; destination: 'logout'; run: () => Promise<void> };

function destinationOf(pathname: string): ExitDestination {
  if (pathname === '/') return 'library';
  if (pathname === '/brand' || pathname.startsWith('/brand/')) return 'brand';
  return 'other';
}

/** 페이지가 한 번 부르고, requestLogout 은 JobHeader 에, dialog 는 페이지 안에 그대로 둔다 */
export function useJobExitGuard({
  jobId,
  status,
  locked = false,
  recheck,
}: {
  /** 서버 작업 id. 없으면 작업이 아직 없는 N1 이다 */
  jobId: string | null;
  /**
   * loading: 단계·완료 여부 조회 중(나가기를 잡아 두고 기다린다) · active: 진행 중 작업(확인) · saved: 서버 isSaved=true 완료 작업 ·
   * not-found: 없는 작업(404) · error: 조회 실패(완료 여부를 몰라 취소하지 않고, 「상태를 확인하지 못함」 창을 연다).
   * saved·not-found 는 묻지 않고 이동한다
   */
  status: ExitGuardStatus;
  /** 눌러도 안 되는 동안(N1 POST /jobs 응답 전 — 나간 뒤 작업이 생겨 남는 것을 막는다). 이동만 막고 확인창은 열지 않는다 */
  locked?: boolean;
  /** 조회 실패 창의 [다시 확인] — 상태를 다시 받고 그 결과 상태를 돌려준다(없으면 버튼을 두지 않는다) */
  recheck?: () => Promise<ExitGuardStatus>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [target, setTargetState] = useState<ExitTarget | null>(null);
  // 열린 목적지를 이벤트 처리기에서 바로 읽는다(같은 틱에 두 번 열려도 처음 것을 유지)
  const targetRef = useRef<ExitTarget | null>(null);
  const setTarget = useCallback((next: ExitTarget | null) => {
    targetRef.current = next;
    setTargetState(next);
  }, []);
  const [mode, setMode] = useState<DialogMode>('confirm');
  const [recheckState, setRecheckState] = useState<'idle' | 'running' | 'failed'>('idle');
  const [isLeaving, setIsLeaving] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const hasGuardEntry = useRef(false);
  // 조회 중에 누른 목적지 — 상태가 정해지면 확인을 열거나 그대로 간다
  const pendingRef = useRef<ExitTarget | null>(null);
  const cancelledRef = useRef(false);
  const { mutateAsync: cancelJob, reset: resetCancelJob, isPending, isError } = useCancelJobMutation();
  const isBusy = isPending || isLeaving || recheckState === 'running';
  // 나가기를 가로채는 동안 — 진행 중 · 아직 모름 · 조회 실패
  const guarding = (status === 'active' || status === 'loading' || status === 'error') && !isLeaving;

  // 이벤트 처리기는 최신 값을 ref 로 읽는다(등록을 다시 하지 않아 history 항목이 흔들리지 않게)
  const stateRef = useRef({ status, locked, isLeaving });
  useEffect(() => {
    stateRef.current = { status, locked, isLeaving };
  }, [status, locked, isLeaving]);

  const open = useCallback(
    (next: ExitTarget, nextMode: DialogMode) => {
      // 이미 열려 있으면 처음 연 목적지·창 종류를 유지한다(확인창을 연 채 뒤로 가기를 또 눌러도 바뀌지 않는다)
      if (stateRef.current.locked || targetRef.current) return;
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMode(nextMode);
      setTarget(next);
    },
    [setTarget],
  );

  // 취소 없이 목적지로 간다(완료·없는 작업 · 조회 실패에서 [작업 남기고 나가기]). 조회 중에 누른 뒤로 가기는 뒤로 가기의 목적지인 보관함으로 간다
  const leaveWithoutCancel = useCallback(
    (exit: ExitTarget) => {
      if (exit.kind === 'logout') {
        void exit.run();
        return;
      }
      router.replace(exit.kind === 'href' ? exit.href : '/');
    },
    [router],
  );

  // 진행 중이면 작업 취소 확인, 조회 실패면 「상태를 확인하지 못함」 창, 아직 모르면 잡아 두고, 완료·없는 작업은 묻지 않고 간다
  const route = useCallback(
    (next: ExitTarget, current: ExitGuardStatus) => {
      if (current === 'active') open(next, 'confirm');
      else if (current === 'error') open(next, 'unknown');
      else if (current === 'loading') pendingRef.current ??= next;
      else leaveWithoutCancel(next);
    },
    [open, leaveWithoutCancel],
  );
  const request = useCallback(
    (next: ExitTarget) => {
      const { status: current, locked: isLocked } = stateRef.current;
      if (isLocked) return;
      route(next, current);
    },
    [route],
  );

  // 조회가 끝나면 잡아 둔 목적지를 처리한다
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || status === 'loading') return;
    pendingRef.current = null;
    request(pending);
  }, [status, request]);

  // 뒤로 가기를 받을 같은 URL 항목 — 가로채는 동안 한 번만 쌓는다
  useEffect(() => {
    if (!guarding || hasGuardEntry.current) return;
    window.history.pushState(window.history.state, '', window.location.href);
    hasGuardEntry.current = true;
  }, [guarding]);

  // 화면을 떠날 때 취소한 작업의 cache 를 지운다(다시 열면 서버에 새로 묻는다). 떠난 뒤라 지운 query 를 다시 받는 observer 가 없다
  useEffect(
    () => () => {
      if (cancelledRef.current && jobId) queryClient.removeQueries({ queryKey: pixlateKeys.job(jobId) });
    },
    [jobId, queryClient],
  );

  useEffect(() => {
    if (!hasGuardEntry.current && !guarding) return;

    const onPopState = () => {
      // 쌓은 항목이 없으면 이 popstate 는 이미 다른 화면으로 나간 것이다 — 건드리지 않는다
      if (!hasGuardEntry.current) return;
      const { status: current, locked: isLocked, isLeaving: leaving } = stateRef.current;
      if (leaving) return;
      if (isLocked || current === 'active' || current === 'loading' || current === 'error') {
        // 항목을 다시 쌓아 화면에 머문다(잠금 중에는 그대로 막는다)
        window.history.pushState(window.history.state, '', window.location.href);
        request({ kind: 'history-back', destination: 'library' });
        return;
      }
      // 완료·없는 작업으로 밝혀졌다 — 쌓아 둔 항목만 꺼낸 상태라 묻지 않고 뒤로 가기의 목적지(보관함)로 간다.
      // 여기서 history.back() 을 한 번 더 부르면 Next 라우터가 방금 꺼낸 항목을 복원하며 URL 을 되돌리는 경합이 있어
      // 라우터 큐를 타는 replace 로 간다(꺼낸 원래 작업 항목을 보관함으로 바꾼다)
      hasGuardEntry.current = false;
      leaveWithoutCancel({ kind: 'history-back', destination: 'library' });
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      request({ kind: 'href', href: `${url.pathname}${url.search}${url.hash}`, destination: destinationOf(url.pathname) });
    };

    // 쌓은 항목이 남아 있으면 가로채지 않는 동안에도 popstate 는 받는다(위 묻지 않고 보관함으로)
    window.addEventListener('popstate', onPopState);
    if (guarding) document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
    };
  }, [guarding, request, leaveWithoutCancel]);

  const requestLogout = useCallback(
    (runLogout: () => Promise<void>) => request({ kind: 'logout', destination: 'logout', run: runLogout }),
    [request],
  );

  const closeDialog = useCallback(() => {
    if (isBusy) return;
    setTarget(null);
    setRecheckState('idle');
    resetCancelJob();
  }, [isBusy, resetCancelJob, setTarget]);

  // [다시 확인] — 돌려받은 상태로 다시 판단한다. 여전히 실패면 창에 알리고 머문다
  const handleRecheck = () => {
    if (!target || !recheck) return;
    const exit = target;
    setRecheckState('running');
    recheck()
      .catch((): ExitGuardStatus => 'error')
      .then((next) => {
        if (next === 'error') {
          setRecheckState('failed');
          return;
        }
        setRecheckState('idle');
        setTarget(null);
        // 창 안의 [다시 확인]이 아니라 처음 연 요소로 포커스를 돌려준다
        const focusBack = returnFocusRef.current;
        if (next === 'active') {
          open(exit, 'confirm');
          returnFocusRef.current = focusBack;
        } else if (next === 'loading') {
          pendingRef.current = exit;
        } else {
          setIsLeaving(true);
          leaveWithoutCancel(exit);
        }
      });
  };

  const leave = (exit: ExitTarget) => {
    setIsLeaving(true);
    if (exit.kind === 'logout') {
      // 로그아웃은 G1 이동까지 logout() 이 맡는다
      void exit.run();
      return;
    }
    // 쌓아 둔 같은 URL 항목을 목적지로 바꾼다 — 취소한 작업 화면으로 뒤로 가기가 돌아오지 않게 push 가 아니라 replace 다
    router.replace(exit.kind === 'href' ? exit.href : '/');
  };

  const handleConfirm = () => {
    if (!target) return;
    // 조회 실패 창 — 취소하지 않고 누른 곳으로 간다(작업은 서버에 남는다)
    if (mode === 'unknown') {
      setIsLeaving(true);
      leaveWithoutCancel(target);
      return;
    }
    if (!jobId) {
      leave(target);
      return;
    }
    cancelJob(jobId)
      .then(() => {
        cancelledRef.current = true;
        leave(target);
      })
      .catch(() => {
        // 실패는 isError 로 창 안에 보여 주고 화면과 작업을 그대로 둔다
      });
  };

  const dialog = target ? (
    <S0ExitDialog
      hasJob={jobId !== null}
      statusUnknown={mode === 'unknown'}
      destination={target.destination}
      isBusy={isBusy}
      cancelFailed={isError}
      recheckState={recheckState}
      onRecheck={recheck ? handleRecheck : undefined}
      onDismiss={closeDialog}
      onConfirm={handleConfirm}
      returnFocusRef={returnFocusRef}
    />
  ) : null;

  /** guarding — 지금 나가기를 가로채는지(화면 루트 data-exit-guard 로 둔다 — 조회 중·진행 중·조회 실패 on, 완료·없는 작업 off) */
  return { requestLogout, dialog, guarding };
}
