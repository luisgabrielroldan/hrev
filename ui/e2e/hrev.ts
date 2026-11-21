// Test helpers: a throwaway git repository, diffs made by git, and hrev sessions run by the real binary.
import { test as base, expect, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CoverageReport } from 'monocart-coverage-reports';
import { coverageEnabled, coverageOptions } from './coverage';

const BIN = fileURLToPath(new URL('../../hrev', import.meta.url));

/** numbered returns n lines "line 1 of <name>" … as file text. */
export const numbered = (name: string, n: number): string[] => Array.from({ length: n }, (_, i) => `line ${i + 1} of ${name}`);

/** A git repository with 1 commit of `before`. write() changes the working tree without a commit. */
export class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'hrev-e2e-repo-'));

  constructor(before: Record<string, string[]>) {
    this.git('init', '-q', '-b', 'main');
    this.write(before);
    this.git('add', '.');
    this.git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base');
  }

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8' });
  }

  write(files: Record<string, string[]>): void {
    for (const [name, lines] of Object.entries(files)) {
      execFileSync('mkdir', ['-p', join(this.dir, name, '..')]);
      writeFileSync(join(this.dir, name), lines.join('\n') + '\n');
    }
  }

  /** diff writes the diff of HEAD against the working tree to a file, the way the skill does. */
  diff(context = 200): string {
    this.git('add', '-N', '.');
    const file = join(this.dir, '..', `${this.dir.split('/').pop()}-${Date.now()}.diff`);
    writeFileSync(file, this.git('diff', '--no-ext-diff', '--no-color', `-U${context}`, 'HEAD'));
    return file;
  }
}

/** A review session served by the real hrev binary. */
export class Session {
  id = '';
  url = '';
  private proc?: ChildProcess;
  private readonly env = { ...process.env, HREV_HOME: mkdtempSync(join(tmpdir(), 'hrev-e2e-home-')), HREV_NO_BROWSER: '1' };

  async open(diffFile: string, title: string): Promise<this> {
    const dir = mkdtempSync(join(tmpdir(), 'hrev-e2e-sessions-'));
    this.proc = spawn(BIN, ['open', diffFile, '--dir', dir, '--title', title, '--source', 'test'], { env: this.env });
    const head: Record<string, string> = {};
    for await (const line of createInterface({ input: this.proc.stdout! })) {
      const [k, v] = line.split(': ');
      if (k && v) head[k] = v;
      if (head.id && head.url) break;
    }
    this.id = head.id!;
    this.url = head.url!;
    return this;
  }

  /** cli runs an hrev command against this session's home folder. */
  cli(...args: string[]): string {
    return execFileSync(BIN, args, { env: this.env, encoding: 'utf8', input: '', timeout: 15_000 });
  }

  /** stop ends the server with SIGTERM and waits for its exit, so that a coverage build writes its data. */
  async stop(): Promise<void> {
    const p = this.proc;
    if (!p || p.exitCode !== null) return;
    const exited = new Promise((done) => p.once('exit', done));
    p.kill('SIGTERM');
    await exited;
  }
}

/**
 * The test fixtures. `hrev.open(diff, title)` starts a session that stops after the test. With HREV_JS_COVERAGE set
 * (make coverage), each page records the coverage of the viewer script.
 */
export const test = base.extend<{ hrev: { open: (diff: string, title?: string) => Promise<Session> } }>({
  page: async ({ page }, use) => {
    if (!coverageEnabled) return use(page);
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    const entries = await page.coverage.stopJSCoverage();
    await new CoverageReport(coverageOptions()).add(entries.filter((e) => e.url.startsWith('http://127.0.0.1')));
  },
  hrev: async ({}, use) => {
    const sessions: Session[] = [];
    await use({
      open: async (diff, title = 'E2E') => {
        const s = await new Session().open(diff, title);
        sessions.push(s);
        return s;
      },
    });
    await Promise.all(sessions.map((s) => s.stop()));
  },
});

export { expect };

/** card returns the file card of a path. */
export const card = (page: Page, path: string) => page.locator(`#file-${path.replace(/[^a-zA-Z0-9]/g, '_')}`);

/** shownNewLines lists the new-side line numbers that show in a file card. */
export const shownNewLines = (page: Page, path: string) =>
  card(page, path)
    .locator('.num[data-side="new"]')
    .evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.line)));

/** foldLabels lists the texts of the fold rows of a file card. */
export const foldLabels = (page: Page, path: string) => card(page, path).locator('.fold-label').allTextContents();
