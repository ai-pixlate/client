import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

/**
 * 개발 전용 성능 자산 manifest route.
 *
 * perf-assets/long-pages/ 아래 제품 폴더 구조를 런타임에 fs로 읽어
 * 이미지 목록(경로·크기·바이트)을 반환한다. 파일명 목록을 코드에
 * 하드코딩하지 않기 위한 harness 전용 route다. production에서는 항상 404.
 *
 * 허용 포맷: jpg/jpeg/png/webp. gif·description.html·manifest.json·
 * .DS_Store 등은 목록에서 제외한다 (3일차 baseline은 GIF 제외 정책).
 */

const execFileAsync = promisify(execFile);

const BASE_DIR = path.join(process.cwd(), 'perf-assets', 'long-pages');
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

interface ManifestImage {
  path: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
}

interface ManifestProduct {
  id: string;
  images: ManifestImage[];
  totalHeight: number;
  totalSizeBytes: number;
}

// filename의 숫자 순서를 최대한 보존하는 natural sort.
// "detail_2.jpg" < "detail_10.jpg" 처럼 자릿수와 무관하게 정렬한다.
function naturalCompare(a: string, b: string): number {
  const chunk = (s: string) => s.match(/(\d+|\D+)/g) ?? [s];
  const chunksA = chunk(a);
  const chunksB = chunk(b);
  const len = Math.max(chunksA.length, chunksB.length);

  for (let i = 0; i < len; i += 1) {
    const x = chunksA[i] ?? '';
    const y = chunksB[i] ?? '';
    const bothNumeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (bothNumeric) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

async function walkImages(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkImages(full)));
    } else if (ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

// macOS 기본 sips로 픽셀 크기를 읽는다 (새 package 설치 없이 dev 로컬 환경 전용).
async function readPixelSize(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execFileAsync('sips', [
      '-g',
      'pixelWidth',
      '-g',
      'pixelHeight',
      filePath,
    ]);
    const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
    const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return new Response(null, { status: 404 });
  }

  let productDirNames: string[] = [];
  try {
    const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
    productDirNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return Response.json({ products: [] } satisfies { products: ManifestProduct[] });
  }

  const products: ManifestProduct[] = await Promise.all(
    productDirNames.map(async (productId): Promise<ManifestProduct> => {
      const productDir = path.join(BASE_DIR, productId);
      const filePaths = await walkImages(productDir);
      filePaths.sort((a, b) => naturalCompare(path.basename(a), path.basename(b)));

      const images: ManifestImage[] = [];
      for (const filePath of filePaths) {
        const size = await readPixelSize(filePath);
        // sips로 읽을 수 없는(손상된) 이미지는 목록에서 제외한다.
        if (!size) continue;
        const stat = await fs.stat(filePath);
        const relSegments = path.relative(BASE_DIR, filePath).split(path.sep);
        images.push({
          path: relSegments.join('/'),
          url: `/api/dev/perf-assets/${relSegments.map(encodeURIComponent).join('/')}`,
          width: size.width,
          height: size.height,
          sizeBytes: stat.size,
        });
      }

      return {
        id: productId,
        images,
        totalHeight: images.reduce((sum, img) => sum + img.height, 0),
        totalSizeBytes: images.reduce((sum, img) => sum + img.sizeBytes, 0),
      };
    }),
  );

  return Response.json({ products } satisfies { products: ManifestProduct[] });
}
