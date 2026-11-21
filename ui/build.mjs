// Builds the viewer into 1 HTML file with inline CSS and JavaScript: internal/web/dist/index.html.
// The Go binary embeds that file. The page has no other files, so every request carries the token
// in the URL of the page only.
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'internal', 'web', 'dist', 'index.html');

const result = await esbuild.build({
  entryPoints: [join(here, 'src', 'main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  outdir: 'out',
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});

const pick = (ext) => {
  const file = result.outputFiles.find((f) => f.path.endsWith(ext));
  if (!file) throw new Error(`esbuild did not produce a ${ext} file`);
  return file.text;
};
const js = pick('.js');
const css = pick('.css');
if (js.includes('</script')) throw new Error('The bundle contains "</script", which would end the inline script.');

const template = await readFile(join(here, 'index.html'), 'utf8');
// A function replacer, so that "$" in the bundle is not read as a replacement pattern.
const page = template.replace('/*CSS*/', () => css).replace('/*JS*/', () => js);
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, page);
console.log(`wrote ${outFile} (${(page.length / 1024).toFixed(1)} KiB)`);
