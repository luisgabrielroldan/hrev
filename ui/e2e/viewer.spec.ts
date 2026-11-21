// Viewer rules on a normal diff (3 lines of context): src/app.go changes on lines 10 and 30, notes.txt is new.
import { card, expect, numbered, Repo, test } from './hrev';

function basicDiff(): string {
  const app = numbered('app', 40);
  const repo = new Repo({ 'src/app.go': app });
  const changed = [...app];
  changed[9] = 'changed 10';
  changed[29] = 'changed 30';
  repo.write({ 'src/app.go': changed, 'notes.txt': ['note 1', 'note 2', 'note 3'] });
  return repo.diff(3);
}

test('the viewer shows the session: title, files, threads and the pending count', async ({ page, hrev }) => {
  const s = await hrev.open(basicDiff(), 'Basic review');
  s.cli('comment', s.id, 'src/app.go', '--lines', '10', 'Why this change?');
  await page.goto(s.url);
  await expect(page.locator('.header h1')).toHaveText('Basic review');
  await expect(page).toHaveTitle('Basic review · hrev');
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.locator('.tree-list .node', { hasText: 'notes.txt' })).toBeVisible();
  await expect(card(page, 'src/app.go').locator('.msg .md.body')).toHaveText('Why this change?');
  await expect(page.locator('.pending-count strong')).toHaveText('1');
});

test('a comment renders Markdown and shows its HTML as text', async ({ page, hrev }) => {
  const s = await hrev.open(basicDiff());
  s.cli('comment', s.id, 'src/app.go', '--lines', '10', 'Why **this**? <script>alert(1)</script>\n- [x] done');
  await page.goto(s.url);
  const body = page.locator('.msg .md.body');
  await expect(body.locator('strong')).toHaveText('this');
  await expect(body.locator('input[type=checkbox][checked]')).toHaveCount(1);
  await expect(body.locator('script')).toHaveCount(0);
  await expect(body).toContainText('<script>alert(1)</script>');
});

test('a drag on line numbers opens a draft on the range, and Comment saves it as pending', async ({ page, hrev }) => {
  const s = await hrev.open(basicDiff());
  await page.goto(s.url);
  const app = card(page, 'src/app.go');
  const from = app.locator('.num[data-side="new"][data-line="9"]');
  const to = app.locator('.num[data-side="new"][data-line="11"]');
  await from.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 5, a.y + 5);
  await page.mouse.down();
  await page.mouse.move(b.x + 5, b.y + 5, { steps: 4 });
  await expect(app.locator('.row.sel')).toHaveCount(3);
  await page.mouse.up();
  const draft = page.locator('.thread.draft');
  await expect(draft.locator('.meta')).toContainText('Lines 9–11');
  await expect(draft.locator('textarea')).toBeFocused();
  await draft.locator('textarea').fill('Extract a function.');
  await draft.locator('button', { hasText: 'Comment' }).click();
  await expect(page.locator('.thread.draft')).toHaveCount(0);
  await expect(page.locator('.pending-count strong')).toHaveText('1');
});

test('Ask now sends the reply to hrev wait, and the agent reply shows without a reload', async ({ page, hrev }) => {
  const s = await hrev.open(basicDiff());
  s.cli('comment', s.id, 'src/app.go', '--lines', '10', 'Why this change?');
  await page.goto(s.url);
  const thread = page.locator('.thread', { hasText: 'Why this change?' });
  await thread.locator('.reply-open').click();
  await thread.locator('textarea').fill('Please answer now.');
  await thread.locator('button', { hasText: 'Ask now' }).click();
  await expect(thread.locator('.badge.b-sent').first()).toBeVisible();
  expect(s.cli('wait', s.id)).toContain('Please answer now.');
  s.cli('reply', s.id, 'c1', 'Because of the new rate.');
  await expect(thread.locator('.msg', { hasText: 'Because of the new rate.' }).locator('.who')).toHaveText('Agent');
});

test('a pending comment can be edited and deleted', async ({ page, hrev }) => {
  const s = await hrev.open(basicDiff());
  s.cli('comment', s.id, 'src/app.go', '--lines', '10', 'First text');
  await page.goto(s.url);
  const msg = page.locator('.msg', { hasText: 'First text' });
  await msg.locator('button', { hasText: 'Edit' }).click();
  const editor = page.locator('.msg').filter({ has: page.locator('textarea[id^="edit-"]') });
  await expect(editor.locator('textarea')).toHaveValue('First text');
  await editor.locator('textarea').fill('Second text');
  await editor.locator('button', { hasText: 'Save' }).click();
  await expect(page.locator('.msg .md.body')).toHaveText('Second text');
  await page.locator('.msg button', { hasText: 'Delete' }).click();
  await expect(page.locator('.msg')).toHaveCount(0);
  await expect(page.locator('.pending-count strong')).toHaveText('0');
});

test('a toolbar format changes the text at once, and Preview renders the Markdown', async ({ page, hrev }) => {
  const s = await hrev.open(basicDiff());
  await page.goto(s.url);
  await card(page, 'src/app.go').locator('button[aria-label="Comment on this file"]').click();
  const draft = page.locator('.thread.draft');
  const ta = draft.locator('textarea');
  await ta.fill('x');
  await draft.locator('button[aria-label="Bold"]').click();
  await expect(ta).toHaveValue('x**bold text**');
  await draft.locator('.editor-tab', { hasText: 'Preview' }).click();
  await expect(draft.locator('.editor-preview strong')).toHaveText('bold text');
  await draft.locator('.editor-tab', { hasText: 'Write' }).click();
  await expect(ta).toHaveValue('x**bold text**');
});

test('gap rows replace the hunk headers, and only a changed file gets the end mark', async ({ page, hrev }) => {
  const s = await hrev.open(basicDiff());
  await page.goto(s.url);
  const app = card(page, 'src/app.go');
  // git adds a section name to each hunk header; the gap row shows it after the count.
  await expect(app.locator('.gap-label')).toHaveText([/^6 lines not shown · /, /^13 lines not shown · /]);
  await expect(app.locator('.rows')).not.toContainText('@@');
  await expect(app.locator('.diff-end')).toHaveCount(1);
  await expect(card(page, 'notes.txt').locator('.diff-end')).toHaveCount(0);
});

test('a change in 1 file does not redraw another file', async ({ page, hrev }) => {
  const s = await hrev.open(basicDiff());
  await page.goto(s.url);
  await card(page, 'src/app.go').waitFor();
  const changesInApp = async (act: () => Promise<void>) => {
    await page.evaluate(() => {
      const w = window as unknown as { n: number; obs?: MutationObserver };
      w.n = 0;
      w.obs?.disconnect();
      w.obs = new MutationObserver((list) => (w.n += list.length));
      w.obs.observe(document.getElementById('file-src_app_go')!, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await act();
    await page.waitForTimeout(300);
    return page.evaluate(() => (window as unknown as { n: number }).n);
  };
  expect(await changesInApp(() => page.locator('.tree-list .node', { hasText: 'notes.txt' }).click())).toBe(0);
  expect(
    await changesInApp(async () => {
      s.cli('comment', s.id, 'notes.txt', '--lines', '2', 'A note on notes.');
      await expect(card(page, 'notes.txt').locator('.msg .md.body')).toHaveText('A note on notes.');
    }),
  ).toBe(0);
});
