/**
 * N6 "선택 항목 내보내기" — 로컬 폴더 직접 저장(File System Access API) 보조 함수.
 *
 * Progressive Enhancement 다. HTTPS(secure context) + showDirectoryPicker 를 지원하는
 * 브라우저에서만 폴더 저장을 쓰고, 그 밖(HTTP, Firefox, Safari 등)에서는 호출부가 기존
 * 다운로드 링크 흐름을 그대로 쓴다. 이 파일은 API 계약(POST /export → artifactId →
 * GET /exports/{artifactId}/download)을 알지 못한다 — 받은 presigned URL 을 내려받아
 * 고른 폴더에 쓰는 일만 한다.
 *
 * TypeScript DOM lib 에는 FileSystemDirectoryHandle 등은 있지만 window.showDirectoryPicker
 * 선언이 없어, 쓰는 범위만큼만 최소 타입을 둔다.
 */

export type DirectoryPicker = (options?: {
  id?: string;
  mode?: 'read' | 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

interface WindowWithDirectoryPicker {
  isSecureContext: boolean;
  showDirectoryPicker?: unknown;
}

/** 폴더 저장을 쓸 수 있으면 picker 함수를, 아니면 null 을 돌려준다. */
export function getDirectoryPicker(win: WindowWithDirectoryPicker | undefined = globalThis.window): DirectoryPicker | null {
  if (!win || win.isSecureContext !== true) return null;
  const picker = win.showDirectoryPicker;
  if (typeof picker !== 'function') return null;
  return (options) => (picker as DirectoryPicker).call(win, options);
}

/** 사용자가 폴더 선택 창을 닫았을 때(취소) — 오류로 다루지 않는다. */
export function isDirectoryPickerAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/**
 * 저장할 파일 이름. 서버 DownloadResponse.fileName 을 우선 쓰고, 없으면 presigned URL 경로의
 * 마지막 조각을 쓴다. 폴더 밖으로 나가는 경로 구분자는 지운다(getFileHandle 은 이름만 받는다).
 */
export function resolveSaveFileName(download: { url?: string; fileName?: string }, fallback: string): string {
  const fromUrl = (() => {
    if (!download.url) return '';
    try {
      const path = new URL(download.url, 'http://localhost').pathname;
      return decodeURIComponent(path.split('/').pop() ?? '');
    } catch {
      return '';
    }
  })();
  const raw = download.fileName || fromUrl || fallback;
  const safe = raw.replace(/[\\/]/g, '_').trim();
  return safe && safe !== '.' && safe !== '..' ? safe : fallback;
}

/**
 * presigned URL 을 FE 가 직접 내려받는다. S3 CORS 가 허용되지 않으면 여기서 실패한다 —
 * 호출부는 이때 기존 다운로드 링크로 돌아간다(산출물 생성은 이미 성공한 상태).
 */
export async function fetchPresignedFile(url: string): Promise<Blob> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`presigned 다운로드 실패: HTTP ${response.status}`);
  return response.blob();
}

/** 고른 폴더에 파일 하나를 만든다(같은 이름이 있으면 덮어쓴다). 실패하면 쓰던 파일을 버린다. */
export async function writeFileToDirectory(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  data: Blob,
): Promise<void> {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}
