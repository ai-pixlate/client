/**
 * M2 브랜드 정보 화면 로직(lib/brand/m2-form.ts) 자동 검증 — dirty 판정·필수값·변경 항목 열거·로고 파일 형식.
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

const logo = (id) => ({ id, name: id, src: `/${id}.png` });
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

console.log(`\nverify-m2-form: ${pass}건 통과`);
