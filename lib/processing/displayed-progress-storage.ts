/**
 * 처리 화면 표시 %(lib/processing/displayed-progress.ts)의 sessionStorage 보관.
 *
 * 새로고침해도 표시 % 가 처음으로 돌아가지 않도록 같은 탭 안에서만 남긴다(30분 지나면 버린다).
 * 화면이 다음 단계로 넘어가면 hook 이 지우고, 새 처리 실행을 시작하는 요청(analyze · sections/proceed)이
 * 성공하면 그 job 의 값을 지운다 — 페이지를 떠나면서 남은 이전 실행의 값(unmount 정리가 돌지 않는다)이
 * 같은 jobId 의 다음 실행 첫 화면에 이어지지 않게 하기 위해서다(mock 은 jobId 가 항상 같다).
 * 저장소를 쓸 수 없으면(사생활 보호 모드 등) 기록 없이 그대로 동작한다.
 */

const STORAGE_PREFIX = 'pixlate:displayed-progress:';
const STORAGE_TTL_MS = 30 * 60 * 1000;

export interface StoredDisplayedProgress {
  value: number;
  ceiling: number;
}

export const n2DisplayedProgressKey = (jobId: string | number) => `n2:v1:${jobId}`;
// v2 키를 그대로 쓴다 — 이전 형식({stageKey, maxShown})은 아래 검사에서 버려진다.
export const n4DisplayedProgressKey = (jobId: string | number) => `n4:v2:${jobId}`;

const storageKeyOf = (persistKey: string) => `${STORAGE_PREFIX}${persistKey}`;

export function readDisplayedProgress(persistKey: string, now: number): StoredDisplayedProgress | null {
  try {
    const raw = window.sessionStorage.getItem(storageKeyOf(persistKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDisplayedProgress & { savedAt: number }>;
    if (
      typeof parsed.value !== 'number' ||
      typeof parsed.ceiling !== 'number' ||
      typeof parsed.savedAt !== 'number' ||
      now - parsed.savedAt > STORAGE_TTL_MS
    ) {
      return null;
    }
    return { value: parsed.value, ceiling: parsed.ceiling };
  } catch {
    return null;
  }
}

export function writeDisplayedProgress(persistKey: string, stored: StoredDisplayedProgress): void {
  try {
    window.sessionStorage.setItem(storageKeyOf(persistKey), JSON.stringify({ ...stored, savedAt: Date.now() }));
  } catch {
    // 저장소를 쓸 수 없어도 화면 표시는 그대로 동작한다.
  }
}

export function clearDisplayedProgress(persistKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKeyOf(persistKey));
  } catch {
    // 위와 같은 이유로 무시한다.
  }
}
