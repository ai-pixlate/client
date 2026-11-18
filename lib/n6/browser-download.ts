/**
 * N6 산출물 — 브라우저 기본 다운로드.
 *
 * 계약(API-FIN-04·05): POST /jobs/{jobId}/export → artifactId → GET /jobs/{jobId}/exports/{artifactId}/download
 * → { url(presigned, 5분 만료), fileName, expiresAt }. 받은 presigned URL 을 그대로 브라우저에 넘겨 내려받는다.
 * FE 가 파일을 fetch 하거나 로컬 폴더(File System Access API)에 쓰지 않고, URL 을 가공·저장하지 않는다.
 * presigned URL 은 서명이 인증이라 pix/ate Authorization header 를 붙이지 않는다.
 */

/**
 * 임시 <a download>를 만들어 누르고 곧바로 지운다(화면에 남는 버튼이 없다).
 * 다른 출처(presigned) 주소는 download 속성이 무시될 수 있어, 파일 이름·저장 방식은 서버 응답(Content-Disposition)을 따른다.
 * url 이 비어 있으면 아무것도 하지 않는다 — 빈 링크를 누르지 않는다.
 */
export function startBrowserDownload(url: string | undefined, fileName: string | undefined, doc: Document | undefined = globalThis.document): void {
  if (!doc || !url) return;
  const link = doc.createElement('a');
  link.href = url;
  if (fileName) link.download = fileName;
  link.rel = 'noreferrer';
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
}
