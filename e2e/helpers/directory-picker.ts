import type { Page } from '@playwright/test';

/**
 * N6 "선택 항목 내보내기" 폴더 직접 저장 e2e 보조 함수.
 *
 * 실제 로컬 파일 시스템은 건드리지 않는다. File System Access API(showDirectoryPicker →
 * getFileHandle → createWritable → write → close)를 페이지 안에서 가짜로 바꾸고, 호출 순서와
 * 인자를 기록한다. 기록은 page.exposeFunction 으로 Node 쪽 배열에 바로 넣어, 네트워크 요청과
 * 같은 순서 축에서 비교할 수 있게 한다.
 */

export type FsEvent =
  | { op: 'showDirectoryPicker'; options: unknown }
  | { op: 'getFileHandle'; name: string; options: unknown }
  | { op: 'createWritable' }
  | { op: 'write'; size: number; text: string }
  | { op: 'close' }
  | { op: 'abort' };

/** 이 브라우저(Chromium)의 실제 showDirectoryPicker 를 없애 "미지원 환경"으로 만든다. */
export async function disableDirectoryPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true, writable: true });
  });
}

/** HTTP(ALB) 같은 insecure context 를 흉내 낸다 — localhost 는 브라우저가 secure context 로 본다. */
export async function forceInsecureContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });
  });
}

/**
 * 가짜 showDirectoryPicker 를 설치한다. behavior='cancel' 이면 사용자가 창을 닫은 것처럼
 * AbortError 로 끝난다. 반환 배열에 호출 기록이 쌓인다(order 배열에도 함께 넣는다).
 */
export async function installFakeDirectoryPicker(
  page: Page,
  order: string[],
  behavior: 'pick' | 'cancel' = 'pick',
): Promise<FsEvent[]> {
  const events: FsEvent[] = [];
  await page.exposeFunction('__pixlateRecordFsEvent', (event: FsEvent) => {
    events.push(event);
    order.push(`fs:${event.op}`);
  });
  await page.addInitScript((mode) => {
    const record = (event: unknown) =>
      (window as unknown as { __pixlateRecordFsEvent: (e: unknown) => Promise<void> }).__pixlateRecordFsEvent(event);

    const directoryHandle = {
      kind: 'directory',
      name: 'pixlate-test-folder',
      async getFileHandle(name: string, options: unknown) {
        await record({ op: 'getFileHandle', name, options });
        return {
          kind: 'file',
          name,
          async createWritable() {
            await record({ op: 'createWritable' });
            return {
              async write(data: Blob) {
                await record({ op: 'write', size: data.size, text: await data.text() });
              },
              async close() {
                await record({ op: 'close' });
              },
              async abort() {
                await record({ op: 'abort' });
              },
            };
          },
        };
      },
    };

    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      writable: true,
      value: async (options: unknown) => {
        await record({ op: 'showDirectoryPicker', options });
        if (mode === 'cancel') throw new DOMException('The user aborted a request.', 'AbortError');
        return directoryHandle;
      },
    });
  }, behavior);
  return events;
}
