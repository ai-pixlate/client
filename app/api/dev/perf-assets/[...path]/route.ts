import { promises as fs } from 'fs';
import path from 'path';

/**
 * 개발 전용 raw 자산 스트리밍 route.
 *
 * perf-assets/long-pages/ 아래 실제 성능 테스트 이미지를 public/ 등으로
 * 복사하지 않고 그대로 브라우저에 전달하기 위한 harness 전용 route다.
 * 3일차 long-page 성능 baseline (app/perf/long-page)에서만 사용한다.
 *
 * 이 route는 개발 환경에서만 동작한다. production 빌드에서는 항상 404.
 */

const BASE_DIR = path.join(process.cwd(), 'perf-assets', 'long-pages');

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response(null, { status: 404 });
  }

  const { path: segments } = await params;

  if (!segments || segments.length === 0) {
    return new Response(null, { status: 404 });
  }

  // path traversal 방어: 각 세그먼트는 순수 파일/폴더명이어야 한다.
  // '..'·빈 문자열·구분자 포함 세그먼트는 모두 거부.
  const isSafeSegment = (seg: string) =>
    seg !== '' && seg !== '.' && seg !== '..' && !seg.includes('/') && !seg.includes('\\');

  if (!segments.every(isSafeSegment)) {
    return new Response(null, { status: 404 });
  }

  const ext = path.extname(segments[segments.length - 1]).toLowerCase();
  const contentType = ALLOWED_CONTENT_TYPES[ext];
  // gif 등 허용 목록 밖 포맷은 이번 baseline에서 제공하지 않는다.
  if (!contentType) {
    return new Response(null, { status: 404 });
  }

  const resolved = path.resolve(BASE_DIR, ...segments);

  // resolve 이후 실제로 BASE_DIR 하위에 있는지 다시 확인 (2중 방어)
  if (resolved !== BASE_DIR && !resolved.startsWith(BASE_DIR + path.sep)) {
    return new Response(null, { status: 404 });
  }

  try {
    const data = await fs.readFile(resolved);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(data.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
