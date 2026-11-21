import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFormat, type FormatName, type TextState } from './textedit.ts';

// Each row: format, text with the selection marked by [ and ], expected text with the new selection marked.
const rows: [FormatName, string, string][] = [
  ['bold', 'a [b] c', 'a **[b]** c'],
  ['bold', 'a [] c', 'a **[bold text]** c'],
  ['code', '[x\ny]', '```\n[x\ny]\n```'],
  ['link', '[site]', '[site]([url])'],
  ['quote', 'one\n[two\nthree]', 'one\n> two\n> three[]'],
  ['heading', 'ti[]tle', '### ti[]tle'],
];

const parse = (s: string): TextState => {
  const start = s.indexOf('[');
  const end = s.indexOf(']') - 1;
  return { value: s.replace('[', '').replace(']', ''), start, end };
};
const show = ({ value, start, end }: TextState) => value.slice(0, start) + '[' + value.slice(start, end) + ']' + value.slice(end);

for (const [format, input, expected] of rows) {
  test(`applyFormat ${format}: ${JSON.stringify(input)} becomes ${JSON.stringify(expected)}`, () => {
    assert.equal(show(applyFormat(parse(input), format)), expected);
  });
}
