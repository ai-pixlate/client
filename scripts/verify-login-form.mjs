/**
 * G1 로그인 입력 검증과 개발용 자동 로그인 제외 경로 순수 함수 검증.
 *
 * 실행: npm run verify:login-form
 */

import { shouldBootstrapBackendSession } from '../lib/api/session.ts';
import { validateLoginForm } from '../lib/auth/login-form.ts';
import {
  LOGIN_GIF_GRAPHEME_ORANGE_RATIO,
  computeCoverMapping,
  graphemeSamplePoints,
  isGraphemeOnOrange,
  isLoginGifOrangePixel,
  shouldDarkenGrapheme,
  splitGraphemes,
} from '../lib/auth/login-gif-contrast.ts';

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

console.log('\n[1] 입력 검증');
const ok = { email: 'seller@example.com', password: 'x' };
check('정상 → 오류 없음', Object.keys(validateLoginForm(ok)).length === 0);
check('이메일 빈 값', validateLoginForm({ ...ok, email: '' }).email === '이메일을 입력해주세요.');
check('이메일 공백만 → 빈 값', validateLoginForm({ ...ok, email: '   ' }).email === '이메일을 입력해주세요.');
for (const email of ['seller', 'seller@', '@example.com', 'seller@example', 'sel ler@example.com', 'a@b@c.com']) {
  check(`형식 오류: ${email}`, validateLoginForm({ ...ok, email }).email === '올바른 이메일 형식으로 입력해주세요.');
}
check('앞뒤 공백은 형식 오류로 보지 않음', validateLoginForm({ ...ok, email: ' seller@example.com ' }).email === undefined);
check('비밀번호 빈 값', validateLoginForm({ ...ok, password: '' }).password === '비밀번호를 입력해주세요.');
check('비밀번호 정책 없음(한 글자·공백 통과)', !validateLoginForm({ ...ok, password: 'a' }).password && !validateLoginForm({ ...ok, password: ' ' }).password);
const both = validateLoginForm({ email: '', password: '' });
check('두 필드 동시 오류', both.email && both.password);

console.log('\n[2] 개발용 자동 로그인 제외 경로');
check('/login 만 제외', shouldBootstrapBackendSession('/login') === false);
for (const path of ['/', '/brand', '/jobs/new', '/jobs/1', '/login-help']) {
  check(`${path} 는 유지`, shouldBootstrapBackendSession(path) === true);
}

console.log('\n[3] 주황 판별 — pixlate_login.gif 실측 색');
check('검정 → false', !isLoginGifOrangePixel(0, 0, 0));
check('어두운 번짐(43,17,8) → false', !isLoginGifOrangePixel(43, 17, 8));
check('대비 전환점 아래(135,56,29) → false', !isLoginGifOrangePixel(135, 56, 29));
check('대비 전환점(148,60,33) → true', isLoginGifOrangePixel(148, 60, 33));
check('GIF 대표 주황(254,105,55) → true', isLoginGifOrangePixel(254, 105, 55));
check('GIF 최대값(255,107,58) → true', isLoginGifOrangePixel(255, 107, 58));
check('흰색 → false', !isLoginGifOrangePixel(255, 255, 255));
check('회색 → false', !isLoginGifOrangePixel(153, 153, 153));
check('따뜻한 밝은 회색(200,190,180) → false', !isLoginGifOrangePixel(200, 190, 180));
check('노란색(254,229,0) → false', !isLoginGifOrangePixel(254, 229, 0));
check('빨강(255,0,0) → false(G>B 아님)', !isLoginGifOrangePixel(255, 0, 0));

console.log('\n[4] 글자 전환 기준');
check('기준 0.5', LOGIN_GIF_GRAPHEME_ORANGE_RATIO === 0.5);
check('0/9 → normal', !shouldDarkenGrapheme(0, 9));
check('4/9 → normal', !shouldDarkenGrapheme(4, 9));
check('5/9 → dark', shouldDarkenGrapheme(5, 9));
check('9/9 → dark', shouldDarkenGrapheme(9, 9));
check('샘플 없음 → normal', !shouldDarkenGrapheme(0, 0));

console.log('\n[5] grapheme');
check('한글 음절 단위', splitGraphemes('검수합니다.').join('|') === '검|수|합|니|다|.');
check('공백·쉼표 유지, 이어 붙이면 원문', splitGraphemes('필요한 순간, 당신').join('') === '필요한 순간, 당신');
check('조합형 한글(ᄒ+ᅡ+ᆫ)은 한 글자', splitGraphemes('\u1112\u1161\u11ab').length === 1);
check('이모지 결합은 한 글자', splitGraphemes('👩‍💻').length === 1);

console.log('\n[6] object-fit: cover 좌표');
const source = { width: 1120, height: 1080 };
const same = computeCoverMapping(source, source);
check('1120×1080 → 1:1, crop 없음', same.scale === 1 && same.sourceX === 0 && same.sourceY === 0);
const laptop = computeCoverMapping({ width: 840, height: 900 }, source);
check('840×900 → 높이 기준 배율, 좌우 crop 56', Math.abs(laptop.scale - 900 / 1080) < 1e-9 && Math.abs(laptop.sourceX - 56) < 1e-9 && laptop.sourceY === 0);
const wide = computeCoverMapping({ width: 1120, height: 800 }, source);
check('1120×800 → 폭 기준 배율, 위아래 crop 140', wide.scale === 1 && wide.sourceX === 0 && wide.sourceY === 140);
check('샘플 3×3 = 9지점', graphemeSamplePoints({ left: 0, top: 0, width: 12, height: 18 }).length === 9);
check('샘플은 상자 안', graphemeSamplePoints({ left: 10, top: 20, width: 12, height: 18 }).every((p) => p.x > 10 && p.x < 22 && p.y > 20 && p.y < 38));
const ORANGE = [254, 105, 55];
const BLACK = [0, 0, 0];
const glyph = { left: 100, top: 100, width: 12, height: 18 };
check('전부 주황 → dark', isGraphemeOnOrange(glyph, same, () => ORANGE));
check('전부 검정 → normal', !isGraphemeOnOrange(glyph, same, () => BLACK));
check('왼쪽 1칸만 주황(3/9) → normal', !isGraphemeOnOrange(glyph, same, (x) => (x < 104 ? ORANGE : BLACK)));
check('왼쪽 2칸 주황(6/9) → dark', isGraphemeOnOrange(glyph, same, (x) => (x < 108 ? ORANGE : BLACK)));
const seen = [];
isGraphemeOnOrange({ left: 84, top: 0, width: 6, height: 6 }, laptop, (x, y) => {
  seen.push([x, y]);
  return BLACK;
});
check('cover crop 을 반영한 원본 좌표를 읽음', Math.abs(seen[0][0] - (56 + 85 / laptop.scale)) < 1e-9 && Math.abs(seen[0][1] - 1 / laptop.scale) < 1e-9);

console.log('\n[7] 문구별 글자 판정 — 작은 문구·보조 문구·하단 문구');
/** 한 줄을 글자 폭으로 나눈 패널 좌표 상자. orange 는 원본 좌표 x 범위 */
function darkGraphemes(text, line, glyphWidth, cover, orange) {
  const chars = splitGraphemes(text);
  const read = (x, y) => (orange && x >= orange.from && x < orange.to && y >= orange.top && y < orange.bottom ? ORANGE : BLACK);
  return chars.flatMap((ch, i) => {
    const rect = { left: line.left + i * glyphWidth, top: line.top, width: glyphWidth, height: line.height };
    return ch.trim() && isGraphemeOnOrange(rect, cover, read) ? [i] : [];
  });
}
const everywhere = { top: -1e6, bottom: 1e6 };
const LINES = [
  ['micro', 'AI LOCALIZATION WORKSPACE', { left: 60, top: 178.81, height: 13 }, 7],
  ['subcopy', 'AI가 분석하고 번역하고 검수합니다.', { left: 60, top: 433, height: 19 }, 13],
  ['footer', 'LOCALIZE · VERIFY · EXPORT', { left: 60, top: 1002, height: 14 }, 6],
];
for (const [name, text, line, glyph] of LINES) {
  check(`${name} 주황 없음 → 전부 normal`, darkGraphemes(text, line, glyph, same, null).length === 0);
  const from = line.left + 3 * glyph;
  const dark = darkGraphemes(text, line, glyph, same, { from, to: from + 3 * glyph, ...everywhere });
  const expectedDark = [3, 4, 5].filter((i) => splitGraphemes(text)[i].trim());
  check(`${name} 일부 주황 → 그 글자만 dark`, JSON.stringify(dark) === JSON.stringify(expectedDark), JSON.stringify(dark));
  check(`${name} 다른 세로 위치의 주황 → normal`, darkGraphemes(text, line, glyph, same, { from: 0, to: 1120, top: line.top + 200, bottom: line.top + 300 }).length === 0);
}
const footerOnLaptop = computeCoverMapping({ width: 1008, height: 885 }, source);
const footerText = 'LOCALIZE · VERIFY · EXPORT';
const footerLine = { left: 60, top: 885 - 64 - 14, height: 14 };
const footerSourceY = footerOnLaptop.sourceY + footerLine.top / footerOnLaptop.scale;
const footerFrom = footerOnLaptop.sourceX + (60 + 11 * 6) / footerOnLaptop.scale;
const footerDark = darkGraphemes(footerText, footerLine, 6, footerOnLaptop, { from: footerFrom, to: footerFrom + (2 * 6) / footerOnLaptop.scale, top: footerSourceY - 1, bottom: footerSourceY + 20 });
check('footer 는 bottom 기준 위치와 cover crop 을 반영한다', JSON.stringify(footerDark) === '[11,12]', JSON.stringify(footerDark));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
