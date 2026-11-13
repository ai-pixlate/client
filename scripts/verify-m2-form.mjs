/**
 * M2 브랜드 정보 화면 로직(lib/brand/m2-form.ts)·Brand API Adapter(lib/brand/m2-adapter.ts) 자동 검증
 * — dirty 판정·필수값·변경 항목 열거·로고 파일 형식 · DTO→ViewModel · 바뀐 항목만 PATCH · 로고 추가/삭제 계획 · 저장 뒤 정합 · 브랜드 선택.
 *
 * 실행:  npm run verify:m2-form
 */

import assert from 'node:assert/strict';

import {
  canSaveM2,
  getM2NameErrors,
  getM2Status,
  isM2Dirty,
  isM2LogoFileAllowed,
  listM2Changes,
  normalizeM2Form,
} from '../lib/brand/m2-form.ts';
import {
  planM2LogoChanges,
  reconcileM2AfterSave,
  resolveM2BrandTarget,
  toM2BrandFormValue,
  toM2BrandUpdate,
  toM2Logos,
} from '../lib/brand/m2-adapter.ts';

const logo = (id, serverId = null) => ({ id, name: id, src: `/${id}.png`, serverId });
const base = { nameKo: '픽슬레이트', nameEn: 'Pixlate', overview: '개요', targetCustomer: '고객', logos: [logo('a'), logo('b')] };

let pass = 0;
const test = (name, fn) => {
  fn();
  pass += 1;
  console.log(`  ok ${name}`);
};

test('같은 값이면 dirty가 아니고 저장할 수 없다', () => {
  assert.equal(isM2Dirty(base, { ...base, logos: [...base.logos] }), false);
  assert.equal(canSaveM2(base, base), false);
});

test('앞뒤 공백만 다르면 dirty가 아니다', () => {
  assert.equal(isM2Dirty(base, { ...base, nameEn: '  Pixlate ' }), false);
  assert.equal(normalizeM2Form({ ...base, overview: ' 개요 ' }).overview, '개요');
});

test('변경한 항목만 열거한다', () => {
  assert.deepEqual(listM2Changes(base, { ...base, nameEn: 'P', overview: '새 개요' }), ['영문 브랜드명', '브랜드 개요']);
  assert.deepEqual(listM2Changes(base, { ...base, nameKo: '가', targetCustomer: '' }), ['한글 브랜드명', '핵심 고객층']);
});

test('로고 추가·삭제는 개수와 함께 열거한다', () => {
  assert.deepEqual(listM2Changes(base, { ...base, logos: [logo('a'), logo('b'), logo('c'), logo('d')] }), ['로고 2개 추가']);
  assert.deepEqual(listM2Changes(base, { ...base, logos: [logo('a')] }), ['로고 1개 삭제']);
  assert.deepEqual(listM2Changes(base, { ...base, logos: [logo('a'), logo('c')] }), ['로고 1개 추가', '로고 1개 삭제']);
});

test('추가한 로고를 다시 지우면 깨끗해진다', () => {
  const withAdded = [...base.logos, logo('c')];
  assert.equal(isM2Dirty(base, { ...base, logos: withAdded }), true);
  assert.equal(isM2Dirty(base, { ...base, logos: withAdded.filter((item) => item.id !== 'c') }), false);
});

test('한글명·영문명은 trim 후 비면 저장할 수 없다', () => {
  assert.ok(getM2NameErrors({ ...base, nameKo: '   ' }).nameKo);
  assert.ok(getM2NameErrors({ ...base, nameEn: '' }).nameEn);
  assert.equal(canSaveM2(base, { ...base, nameKo: '' }), false);
  assert.equal(canSaveM2(base, { ...base, nameEn: '   ' }), false);
});

test('개요·고객층은 비어도 저장할 수 있다', () => {
  assert.equal(canSaveM2(base, { ...base, overview: '' }), true);
  assert.equal(canSaveM2(base, { ...base, targetCustomer: '   ' }), true);
});

test('상태는 view / edit-clean / edit-dirty 셋이다', () => {
  assert.equal(getM2Status('view', false), 'view');
  assert.equal(getM2Status('edit', false), 'edit-clean');
  assert.equal(getM2Status('edit', true), 'edit-dirty');
});

test('로고 파일은 SVG·PNG·JPG만 허용한다', () => {
  for (const [name, type] of [
    ['a.svg', 'image/svg+xml'],
    ['a.png', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.JPEG', 'image/jpeg'],
    ['a.png', ''],
  ]) {
    assert.equal(isM2LogoFileAllowed({ name, type }), true, `${name} ${type}`);
  }
  for (const [name, type] of [
    ['a.ai', 'application/postscript'],
    ['a.gif', 'image/gif'],
    ['a.pdf', 'application/pdf'],
    ['png', ''],
    ['a.png', 'image/gif'],
  ]) {
    assert.equal(isM2LogoFileAllowed({ name, type }), false, `${name} ${type}`);
  }
});

// ── Brand API Adapter ──────────────────────────────────────────
const brandDto = { id: 7, nameKo: '픽슬레이트', nameEn: 'Pixlate', overview: null, targetCustomer: '고객', createdAt: 'x', updatedAt: 'y' };
const logoDtos = [
  { id: 30, format: 'png', orderNo: 2, logoUrl: 'https://s3/b.png?sig' },
  { id: 10, format: 'svg', orderNo: 1, logoUrl: 'https://s3/a.svg?sig' },
];

test('Brand DTO → ViewModel: null 개요는 빈 칸, 이름은 그대로', () => {
  const vm = toM2BrandFormValue(brandDto, []);
  assert.deepEqual([vm.nameKo, vm.nameEn, vm.overview, vm.targetCustomer], ['픽슬레이트', 'Pixlate', '', '고객']);
});

test('로고는 서버 순서를 그대로 쓰고 다시 정렬하지 않는다 · id 는 logo-{id}', () => {
  const logos = toM2Logos(logoDtos);
  assert.deepEqual(logos.map((l) => l.serverId), [30, 10]);
  assert.deepEqual(logos.map((l) => l.id), ['logo-30', 'logo-10']);
  assert.equal(logos[0].src, 'https://s3/b.png?sig');
  assert.equal(logos[0].name, '브랜드 로고 1');
});

test('id·logoUrl 없는 로고 항목은 계약 밖이라 뺀다', () => {
  assert.equal(toM2Logos([{ format: 'png', orderNo: 1, logoUrl: '/a.png' }, { id: 1, format: 'png', orderNo: 2 }]).length, 0);
});

const sBase = { ...base, logos: [logo('logo-1', 1), logo('logo-2', 2)] };

test('PATCH 본문은 바뀐 항목만, 공백을 뺀 값으로 보낸다', () => {
  assert.equal(toM2BrandUpdate(sBase, { ...sBase, nameEn: ' Pixlate ' }), null);
  assert.deepEqual(toM2BrandUpdate(sBase, { ...sBase, nameEn: ' Pix ', targetCustomer: '새 고객' }), { nameEn: 'Pix', targetCustomer: '새 고객' });
});

test('비운 개요·고객층은 null 로 보낸다(읽을 때 null → 빈 칸과 대칭)', () => {
  assert.deepEqual(toM2BrandUpdate(sBase, { ...sBase, overview: '  ' }), { overview: null });
});

test('로고만 바뀌면 PATCH 하지 않는다', () => {
  assert.equal(toM2BrandUpdate(sBase, { ...sBase, logos: [sBase.logos[0]] }), null);
});

test('로고 계획: 빠진 서버 로고는 DELETE, 저장 전 로고는 POST', () => {
  const file = { name: 'n.svg' };
  const draft = { ...sBase, logos: [sBase.logos[1], { ...logo('local-logo-1'), file }] };
  const plan = planM2LogoChanges(sBase, draft);
  assert.deepEqual(plan.deletes, [1]);
  assert.deepEqual(plan.uploads, [{ localId: 'local-logo-1', file }]);
});

test('저장 성공: baseline·draft 모두 서버 응답', () => {
  const server = { ...sBase, nameEn: 'Server' };
  const r = reconcileM2AfterSave({ server, draft: { ...sBase, nameEn: 'Local' }, brandSaved: true, failedDeletes: [], failedUploadIds: [] });
  assert.equal(r.complete, true);
  assert.equal(r.baseline, server);
  assert.equal(r.draft.nameEn, 'Server');
});

test('일부 실패: 실패한 삭제는 계속 빠지고 실패한 추가는 남아 dirty 가 유지된다', () => {
  const failedLocal = { ...logo('local-logo-9'), file: {} };
  const draft = { ...sBase, logos: [failedLocal] }; // 1·2 삭제, 하나 추가
  const server = { ...sBase, logos: [logo('logo-2', 2)] }; // 1 은 지워졌고 2 는 삭제 실패
  const r = reconcileM2AfterSave({ server, draft, brandSaved: true, failedDeletes: [2], failedUploadIds: ['local-logo-9'] });
  assert.equal(r.complete, false);
  assert.deepEqual(r.draft.logos.map((l) => l.id), ['local-logo-9']);
  assert.equal(isM2Dirty(r.baseline, r.draft), true);
  assert.deepEqual(listM2Changes(r.baseline, r.draft), ['로고 1개 추가', '로고 1개 삭제']);
});

test('브랜드 저장 실패: 입력한 글을 그대로 둔다', () => {
  const r = reconcileM2AfterSave({ server: sBase, draft: { ...sBase, overview: '입력' }, brandSaved: false, failedDeletes: [], failedUploadIds: [] });
  assert.equal(r.draft.overview, '입력');
  assert.equal(r.complete, false);
});

test('브랜드 선택: ?brandId 우선 · 하나면 그것 · 없거나 여럿이면 고르지 않는다', () => {
  assert.deepEqual(resolveM2BrandTarget('12', null), { kind: 'id', brandId: 12 });
  assert.deepEqual(resolveM2BrandTarget('abc', null), { kind: 'invalid-query' });
  assert.equal(resolveM2BrandTarget(null, null), null);
  assert.deepEqual(resolveM2BrandTarget(null, [brandDto]), { kind: 'id', brandId: 7 });
  assert.deepEqual(resolveM2BrandTarget(null, []), { kind: 'none' });
  assert.deepEqual(resolveM2BrandTarget(null, [brandDto, { ...brandDto, id: 8 }]), { kind: 'ambiguous', count: 2 });
});

console.log(`\nverify-m2-form: ${pass}건 통과`);
