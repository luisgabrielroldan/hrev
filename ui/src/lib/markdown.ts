// A small Markdown renderer for comments. The text is escaped first, so a comment can never inject HTML.
// Images render only from the session attachments. Links open only http and https addresses.
import { esc } from './html.ts';

function inline(text: string, token: string): string {
  const codes: string[] = [];
  let t = text.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = esc(t);
  const q = encodeURIComponent(token);
  t = t.replace(
    /!\[([^\]]*)\]\((attachments\/[0-9a-f]{16}\.(?:png|jpg|gif|webp))\)/g,
    (_m, alt: string, src: string) =>
      `<a href="/api/${src}?t=${q}" target="_blank" rel="noopener"><img class="md-img" alt="${alt}" src="/api/${src}?t=${q}"></a>`,
  );
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${esc(codes[Number(i)])}</code>`);
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

/** markdown returns the HTML of a comment. token is the session token, for the image addresses. */
export function markdown(src: string, token: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, token)).join('<br>')}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]!); i++) code.push(lines[i]!);
      const body = esc(code.join('\n'));
      out.push(
        fence[1] === 'suggestion'
          ? `<div class="suggestion"><div class="suggestion-head">Suggested change</div><pre><code>${body || ' '}</code></pre></div>`
          : `<pre class="md-code"><code>${body}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      out.push(`<p class="md-h md-h${heading[1]!.length}">${inline(heading[2]!, token)}</p>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]!); i++) quote.push(lines[i]!.replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote>${markdown(quote.join('\n'), token)}</blockquote>`);
      continue;
    }

    const first = line.match(LIST_ITEM);
    if (first) {
      flush();
      const ordered = /\d/.test(first[1]!);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = lines[i]!.match(LIST_ITEM);
        if (!m || /\d/.test(m[1]!) !== ordered) break;
        const task = m[2]!.match(/^\[([ xX])\]\s+(.*)$/);
        items.push(
          task
            ? `<li class="md-task"><input type="checkbox" disabled ${task[1] === ' ' ? '' : 'checked'}> ${inline(task[2]!, token)}</li>`
            : `<li>${inline(m[2]!, token)}</li>`,
        );
      }
      i--;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return out.join('');
}
