// Folds and refresh on a diff with 200 lines of context: x.txt has 300 lines, lines 150 and 160 change.
// The refresh adds 1 line at the top of x.txt, so every line below moves down by 1.
import { card, expect, foldLabels, numbered, Repo, shownNewLines, test, type Session } from './hrev';

function foldRepo(): { repo: Repo; diff: string; refresh: (s: Session) => void } {
  const x = numbered('x', 300);
  const repo = new Repo({ 'x.txt': x });
  const changed = [...x];
  changed[149] = 'changed 150';
  changed[159] = 'changed 160';
  repo.write({ 'x.txt': changed });
  const diff = repo.diff();
  const refresh = (s: Session) => {
    repo.write({ 'x.txt': ['new top line', ...changed] });
    s.cli('refresh', s.id, repo.diff());
  };
  return { repo, diff, refresh };
}

test('folds show 3 lines around each change and open upward, downward or all at once', async ({ page, hrev }) => {
  const s = await hrev.open(foldRepo().diff);
  await page.goto(s.url);
  expect(await foldLabels(page, 'x.txt')).toEqual(['146 hidden lines', '3 hidden lines', '137 hidden lines']);
  expect((await shownNewLines(page, 'x.txt')).join(',')).toBe('147,148,149,150,151,152,153,157,158,159,160,161,162,163');
  const rows = card(page, 'x.txt').locator('.fold-row');
  await expect(rows.nth(0).locator('button[aria-label="Show 20 more lines below"]')).toHaveCount(0);
  await expect(rows.nth(2).locator('button[aria-label="Show 20 more lines above"]')).toHaveCount(0);
  await rows.nth(0).locator('button[aria-label="Show 20 more lines above"]').click();
  await card(page, 'x.txt').locator('.fold-row').nth(1).locator('.fold-btn').click();
  expect(await foldLabels(page, 'x.txt')).toEqual(['126 hidden lines', '137 hidden lines']);
  await card(page, 'x.txt').locator('.fold-row').nth(1).locator('button[aria-label="Show 20 more lines below"]').click();
  expect(await foldLabels(page, 'x.txt')).toEqual(['126 hidden lines', '117 hidden lines']);
  await card(page, 'x.txt').locator('.fold-label').first().click();
  expect(await foldLabels(page, 'x.txt')).toEqual(['117 hidden lines']);
  expect((await shownNewLines(page, 'x.txt'))[0]).toBe(1);
});

test('a comment on an opened fold line keeps its line after a refresh, and the folds close again', async ({ page, hrev }) => {
  const f = foldRepo();
  const s = await hrev.open(f.diff);
  await page.goto(s.url);
  await card(page, 'x.txt').locator('.fold-row').nth(0).locator('button[aria-label="Show 20 more lines above"]').click();
  await card(page, 'x.txt').locator('.num[data-side="new"][data-line="130"]').click();
  const draft = page.locator('.thread.draft');
  await draft.locator('textarea').fill('A comment on an opened line.');
  await draft.locator('button', { hasText: 'Comment' }).click();
  const thread = page.locator('.thread', { hasText: 'A comment on an opened line.' });
  await expect(thread.locator('.meta').first()).toContainText('Line 130');
  f.refresh(s);
  await expect(thread.locator('.meta').first()).toContainText('Line 131');
  const shown = await shownNewLines(page, 'x.txt');
  expect(shown).toContain(131);
  expect(shown).not.toContain(140);
});

test('the split view shows the folds and puts a thread under its side', async ({ page, hrev }) => {
  const s = await hrev.open(foldRepo().diff);
  s.cli('comment', s.id, 'x.txt', '--lines', '150', 'On the new side.');
  await page.goto(s.url);
  await page.locator('button[aria-label="Settings"]').click();
  await page.locator('.menu-item', { hasText: 'Split' }).click();
  await expect(card(page, 'x.txt').locator('.rows.split')).toBeVisible();
  expect(await foldLabels(page, 'x.txt')).toEqual(['146 hidden lines', '3 hidden lines', '137 hidden lines']);
  await expect(card(page, 'x.txt').locator('.tslot.split-new', { hasText: 'On the new side.' })).toBeVisible();
  await card(page, 'x.txt').locator('.fold-row').nth(2).locator('button[aria-label="Show 20 more lines below"]').click();
  expect(await foldLabels(page, 'x.txt')).toEqual(['146 hidden lines', '3 hidden lines', '117 hidden lines']);
});

test('a refresh that moves the threads keeps the focus, the caret and the Preview tab', async ({ page, hrev }) => {
  const f = foldRepo();
  const s = await hrev.open(f.diff);
  s.cli('comment', s.id, 'x.txt', '--lines', '150', 'first thread');
  s.cli('comment', s.id, 'x.txt', '--lines', '160', 'second thread');
  await page.goto(s.url);
  const t1 = page.locator('.thread', { hasText: 'first thread' });
  const t2 = page.locator('.thread', { hasText: 'second thread' });
  await t2.locator('.reply-open').click();
  await t2.locator('textarea').fill('**preview me**');
  await t2.locator('.editor-tab', { hasText: 'Preview' }).click();
  await t1.locator('.reply-open').click();
  const ta = t1.locator('textarea');
  await ta.fill('hello world');
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 5));
  f.refresh(s);
  await expect(t1.locator('.meta').first()).toContainText('Line 151');
  await expect(t1.locator('textarea')).toBeFocused();
  expect(await t1.locator('textarea').evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([5, 5]);
  await expect(t2.locator('.editor-preview strong')).toHaveText('preview me');
  await page.keyboard.type('X');
  await expect(t1.locator('textarea')).toHaveValue('helloX world');
});
