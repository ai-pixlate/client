import { test, expect } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 번역문 편집 키 입력 회귀(F1 운영 검증 결함).
//
// 블록 행(role="button")의 키보드 선택 처리가 안쪽 textarea의 스페이스·Enter를
// preventDefault 해서 번역문에 띄어쓰기가 들어가지 않았다. 행 자신에 포커스가
// 있을 때만 선택으로 처리하도록 고친 뒤, 입력·저장·키보드 선택을 함께 확인한다.
//
// 한글 조합(IME) 입력은 Playwright가 실제 조합 이벤트를 만들지 못해 insertText로
// "공백이 들어간 한글 문자열이 그대로 저장되는지"만 본다 — 실제 조합 입력은 수동 확인 항목.
// ─────────────────────────────────────────────────────────────────

const EDITABLE_BLOCK = 9101;
const OTHER_BLOCK = 9102;

test('번역문 칸에서 스페이스·Enter가 입력되고 저장 요청 본문에 그대로 담긴다', async ({ page }) => {
  const patchBodies: { trans1: string }[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (req.method() === 'PATCH' && url.pathname === `/jobs/${MOCK_JOB_ID}/blocks/${EDITABLE_BLOCK}`) {
      patchBodies.push(JSON.parse(req.postData() ?? '{}'));
    }
  });

  await reachN5(page);

  const editor = page.getByTestId(`n5-block-editor-${EDITABLE_BLOCK}`);
  await editor.scrollIntoViewIfNeeded();
  await editor.click();
  await editor.press('ControlOrMeta+a');
  await editor.press('Delete');

  // 실제 키 이벤트(keydown→keypress→input)로 입력 — 스페이스가 행에서 막히면 공백이 빠진다
  await page.keyboard.type('Recommended for you');
  await expect(editor).toHaveValue('Recommended for you');

  // Enter 는 textarea 기본 동작(줄바꿈) — 행 선택으로 바뀌지 않는다
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second line');
  await expect(editor).toHaveValue('Recommended for you\nSecond line');

  // 공백이 들어간 한글 문자열(조합 이벤트 없이 insertText)
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('보습 크림 50ml');
  const expected = 'Recommended for you\nSecond line\n보습 크림 50ml';
  await expect(editor).toHaveValue(expected);

  await page.getByTestId(`n5-block-save-${EDITABLE_BLOCK}`).click();
  await expect.poll(() => patchBodies.length).toBe(1);
  expect(patchBodies[0].trans1).toBe(expected);
  // 저장 뒤에도 화면 값이 공백·줄바꿈을 그대로 유지한다(재조회로 덮여도 같은 값)
  await expect(editor).toHaveValue(expected);
});

test('행에 포커스가 있을 때 Enter·Space로 블록을 선택하고, 확인 버튼은 키보드로 저장된다', async ({ page }) => {
  const patchBodies: { trans1: string }[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (req.method() === 'PATCH' && url.pathname === `/jobs/${MOCK_JOB_ID}/blocks/${EDITABLE_BLOCK}`) {
      patchBodies.push(JSON.parse(req.postData() ?? '{}'));
    }
  });

  await reachN5(page);

  const otherRow = page.getByTestId(`n5-block-row-${OTHER_BLOCK}`);
  await otherRow.scrollIntoViewIfNeeded();
  await otherRow.focus();
  await page.keyboard.press('Space');
  await expect(otherRow).toHaveAttribute('aria-pressed', 'true');

  const editableRow = page.getByTestId(`n5-block-row-${EDITABLE_BLOCK}`);
  await editableRow.scrollIntoViewIfNeeded();
  await editableRow.focus();
  await page.keyboard.press('Enter');
  await expect(editableRow).toHaveAttribute('aria-pressed', 'true');

  // 확인 버튼 키보드 활성화(행 처리에 막히지 않는다)
  const editor = page.getByTestId(`n5-block-editor-${EDITABLE_BLOCK}`);
  await editor.click();
  await editor.press('End');
  await page.keyboard.type(' edited');
  const save = page.getByTestId(`n5-block-save-${EDITABLE_BLOCK}`);
  await save.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => patchBodies.length).toBe(1);
  expect(patchBodies[0].trans1.endsWith(' edited')).toBe(true);
});
