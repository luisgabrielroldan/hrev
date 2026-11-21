/** Code shows 1 line of code. The server sends html with syntax color spans for known languages; other lines are plain text. */
export function Code({ text, html }: { text: string; html?: string }) {
  return html ? <span class="code" dangerouslySetInnerHTML={{ __html: html }} /> : <span class="code">{text}</span>;
}
