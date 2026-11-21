import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdown } from './markdown.ts';

test('markdown escapes HTML in text, inline code and code blocks', () => {
  const html = markdown('<img src=x onerror=alert(1)> `<b>` \n```\n<script>\n```', 'tok');
  assert.doesNotMatch(html, /<img src=x|<b>|<script>/);
  assert.match(html, /&lt;img src=x/);
});

test('markdown shows images only from attachments and links only to http and https', () => {
  const html = markdown('![a](attachments/0123456789abcdef.png) ![b](http://x/y.png) [ok](https://e.com) [no](javascript:alert(1))', 'a b');
  assert.match(html, /<img class="md-img" alt="a" src="\/api\/attachments\/0123456789abcdef\.png\?t=a%20b">/);
  assert.doesNotMatch(html, /src="http:\/\/x/);
  assert.match(html, /<a href="https:\/\/e\.com"/);
  assert.doesNotMatch(html, /href="javascript/);
});
