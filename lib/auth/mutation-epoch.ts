import { QueryClient, type MutationFunctionContext, type MutationOptions } from '@tanstack/query-core';

import { AuthSessionChangedError } from './authorized-request.ts';
import { getAuthEpoch } from './session-store.ts';

/**
 * mutation 결과의 계정 격리(F-ACC-01).
 *
 * 요청 계층(fetchWithSessionRecovery)은 응답 본문까지 받은 뒤 세대를 확인한다. 그래도 API Promise 가 resolve 된 뒤
 * TanStack 이 onSuccess 를 부르기까지 몇 번의 microtask 가 남는다. 그 사이 계정 경계(다른 탭 로그인·로그아웃)가 생기면
 * 이전 계정 결과가 onSuccess → setQueryData 로 새 세션 cache 에 다시 들어갈 수 있다.
 *
 * 그래서 모든 mutation 의 onMutate 에서 시작 세대를 기록하고, onSuccess 를 부르기 직전(같은 동기 흐름 안)에 현재 세대와 비교한다.
 * 다르면 onSuccess 를 부르지 않고 AuthSessionChangedError 로 끝낸다 — 요청 계층이 이미 쓰는 「응답 폐기」 오류와 같다.
 * 이 오류는 자동 재시도하지 않고(query-retry), mutate 호출부의 onSuccess·mutateAsync 성공 흐름도 실행되지 않는다.
 *
 * 시작 세대는 TanStack 이 한 번의 실행 동안 onMutate·mutationFn·onSuccess 에 같은 객체로 넘기는 MutationFunctionContext 에 묶는다.
 * 원래 onSuccess 가 await 뒤에 cache 를 쓰면 그 뒤쪽은 이 확인 밖이다 — 현재 mutation 의 onSuccess 는 모두 동기로 쓴다.
 */
const startedEpochs = new WeakMap<MutationFunctionContext, number>();

// TanStack 의 defaultMutationOptions 시그니처(MutationOptions<any, …>)를 그대로 따른다
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMutationOptions = MutationOptions<any, any, any, any>;

export function guardMutationOptions<T extends AnyMutationOptions>(options: T): T {
  const { onMutate, onSuccess } = options;
  return {
    ...options,
    onMutate: (variables: unknown, context: MutationFunctionContext) => {
      startedEpochs.set(context, getAuthEpoch());
      return onMutate?.(variables, context);
    },
    onSuccess: (data: unknown, variables: unknown, onMutateResult: unknown, context: MutationFunctionContext) => {
      const started = startedEpochs.get(context);
      // 실행 도중 계정·세션이 바뀌었다 — 이전 계정 결과를 어떤 cache·화면 상태에도 쓰지 않는다
      if (started !== undefined && started !== getAuthEpoch()) throw new AuthSessionChangedError();
      return onSuccess?.(data, variables, onMutateResult, context);
    },
  };
}

/**
 * 앱 QueryClient. useMutation(MutationObserver)과 mutationCache.build 가 모두 defaultMutationOptions 를 거치므로
 * 여기 한 곳에서 모든 mutation 에 세대 확인을 붙인다. 이미 기본값이 적용된 옵션(_defaulted)은 다시 감싸지 않는다.
 */
export class AuthEpochQueryClient extends QueryClient {
  override defaultMutationOptions<T extends AnyMutationOptions>(options?: T): T {
    if (options?._defaulted) return super.defaultMutationOptions(options);
    return guardMutationOptions(super.defaultMutationOptions(options));
  }
}
