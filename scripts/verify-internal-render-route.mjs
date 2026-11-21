/**
 * 내부 렌더 경로 production 검증 — `npm run build` 뒤에 실행한다.
 *
 *  1) next start 를 runtime env 토큰과 함께 띄워 정상 200 / 없음·틀림·X-Amzn-Trace-Id 404
 *  2) 같은 빌드를 env 없이 띄워 토큰을 보내도 404(토큰이 빌드에 굳지 않고 runtime env 에서만 읽힌다)
 *  3) .next/static(client 번들)에 env 이름 PIXLATE_INTERNAL_RENDER_TOKEN 이 0건, 검증용 토큰 값은 .next 전체에 0건
 *
 * 토큰은 매 실행 무작위로 만들고 출력하지 않는다. 실제 secret 을 쓰지 않는다.
 * 실행: NEXT_PUBLIC_PIXLATE_FE_REVISION=$(git rev-parse HEAD) npm run build && NEXT_PUBLIC_PIXLATE_FE_REVISION=$(git rev-parse HEAD) node scripts/verify-internal-render-route.mjs
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = '/internal/typeset-render';
const HEADER = 'x-pixlate-internal-render';
const PORT = Number(process.env.VERIFY_INTERNAL_RENDER_PORT ?? 3217);
const TOKEN = `verify-${randomBytes(16).toString('hex')}`;

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

if (!existsSync('.next/BUILD_ID')) {
  console.error('.next 빌드가 없다 — npm run build 를 먼저 실행한다');
  process.exit(1);
}

async function withServer(env, fn) {
  const childEnv = { ...process.env, ...env, PORT: String(PORT) };
  if (!('PIXLATE_INTERNAL_RENDER_TOKEN' in env)) delete childEnv.PIXLATE_INTERNAL_RENDER_TOKEN;
  const child = spawn('npx', ['next', 'start', '-p', String(PORT)], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/`);
        break;
      } catch {
        if (Date.now() > deadline) throw new Error(`next start 가 뜨지 않았다\n${log}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    await fn();
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
  if (log.includes(TOKEN)) check('서버 로그에 토큰 값이 없다', false);
}

const status = async (headers = {}) => (await fetch(`http://127.0.0.1:${PORT}${ROUTE}`, { headers, redirect: 'manual' })).status;

console.log('\n[1] runtime env 토큰이 있는 서버');
await withServer({ PIXLATE_INTERNAL_RENDER_TOKEN: TOKEN }, async () => {
  check('정상 토큰 → 200', (await status({ [HEADER]: TOKEN })) === 200);
  check('토큰 없음 → 404', (await status()) === 404);
  check('틀린 토큰 → 404', (await status({ [HEADER]: `${TOKEN}x` })) === 404);
  check('정상 토큰 + X-Amzn-Trace-Id → 404', (await status({ [HEADER]: TOKEN, 'X-Amzn-Trace-Id': 'Root=1-verify' })) === 404);
  const res = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`, { headers: { [HEADER]: TOKEN } });
  const html = await res.text();
  check('응답 HTML 에 토큰 값이 없다', !html.includes(TOKEN));
  check('Cache-Control no-store', (res.headers.get('cache-control') ?? '').includes('no-store'));
});

console.log('\n[2] env 없는 서버(같은 빌드)');
await withServer({}, async () => {
  check('env 없음 + 토큰 → 404', (await status({ [HEADER]: TOKEN })) === 404);
  check('env 없음 + 빈 토큰 → 404', (await status({ [HEADER]: '' })) === 404);
});
await withServer({ PIXLATE_INTERNAL_RENDER_TOKEN: '' }, async () => {
  check('env 빈 문자열 + 빈 토큰 → 404', (await status({ [HEADER]: '' })) === 404);
});

console.log('\n[3] 빌드 산출물');
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const grep = (dir, needle) => {
  const hits = [];
  for (const file of walk(dir)) if (readFileSync(file).includes(needle)) hits.push(file);
  return hits;
};
const nameHits = grep('.next/static', 'PIXLATE_INTERNAL_RENDER_TOKEN');
check('.next/static 에 PIXLATE_INTERNAL_RENDER_TOKEN 0건', nameHits.length === 0, nameHits.join(', '));
const valueHits = grep('.next', TOKEN);
check('.next 전체에 검증 토큰 값 0건', valueHits.length === 0, valueHits.join(', '));
const revision = process.env.NEXT_PUBLIC_PIXLATE_FE_REVISION;
if (revision) {
  const revisionHits = grep('.next/static', revision);
  check(`client 번들에 NEXT_PUBLIC_PIXLATE_FE_REVISION(${revision}) 포함`, revisionHits.length > 0);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
