import { marked } from 'marked';

/**
 * Convert a markdown string to HTML for use in LimeSurvey text fields.
 *
 * - Block content (multiple paragraphs, lists, etc.) is returned as full HTML.
 * - Single-paragraph content has its outer <p>…</p> stripped so that short
 *   labels remain inline strings rather than block elements.
 * - Block elements are joined without newlines (`<p>a</p><p>b</p><ul>…`).
 *   The TSV serializer turns every newline into `<br />`, which on top of
 *   the paragraph/list margins would double the spacing (#225). A newline
 *   remains only for a single line break inside a paragraph (and inside
 *   `<pre>`).
 * - Empty / non-string input is returned as-is.
 */
export function markdownToHtml(text: string): string {
  if (!text) return text;

  const html = keepBracesInHrefs(
    joinBlocks((marked.parse(text) as string).trim()),
  );

  // Strip the wrapping <p>…</p> only when the output is a single paragraph
  // (i.e. exactly one <p> tag). Multi-paragraph output keeps its structure.
  if (
    html.startsWith('<p>') &&
    html.endsWith('</p>') &&
    (html.match(/<p>/g) || []).length === 1
  ) {
    return html.slice(3, -4);
  }

  return html;
}

const BLOCK_TAG =
  /\n*(<\/?(?:p|ul|ol|li|h[1-6]|blockquote|hr|table|thead|tbody|tr|th|td)\b[^>]*>)\n*/g;

/** Drop the newlines `marked` puts around block tags, except inside `<pre>`. */
function joinBlocks(html: string): string {
  return html
    .split(/(<pre>[\s\S]*?<\/pre>)/)
    .map((part, i) => (i % 2 ? part : part.replace(BLOCK_TAG, '$1')))
    .join('')
    .replace(/(<\/pre>)\n+/g, '$1')
    .replace(/\n+(<pre>)/g, '$1');
}

/**
 * `marked` percent-encodes `{` and `}` in link targets. Put them back, so that
 * `${name}` references and LimeSurvey placeholders such as `{SAVEDID}` in a URL
 * are converted and piped like the same text outside a link (#219).
 */
function keepBracesInHrefs(html: string): string {
  return html.replace(
    /href="([^"]*)"/g,
    (_, href: string) =>
      `href="${href.replace(/%7B/gi, '{').replace(/%7D/gi, '}')}"`,
  );
}

/**
 * Convert HTML back to markdown — inverting what `markdownToHtml` produces,
 * for the subset of HTML constructs `marked` generates.
 *
 * Heuristic: applies automatically when the string looks like it contains HTML
 * markup. This means authored HTML (non-markdown) will also be reversed,
 * which is the desired behavior for the reverse path.
 *
 * Supported inversions:
 *   <strong>x</strong>  → **x**
 *   <em>x</em>          → _x_
 *   <a href="u">t</a>   → [t](u)
 *   <code>x</code>       → `x`
 *   <p>x</p>            → x  (or \n\n between <p> blocks)
 *   <h1>-<h6>           → # - ######
 *   <ul>/<ol>/<li>      → lists
 *   <blockquote>        → >
 *   <hr>                → ---
 *   <pre><code>        → ```...```
 */
export function htmlToMarkdown(html: string): string {
  if (!html || typeof html !== 'string') return html;

  let md = html;

  // Line breaks. Older TSVs joined blocks with `<br />` (`</p><br /><p>`);
  // drop a `<br />` next to a block boundary, turn the rest into newlines.
  md = md.replace(
    /(<\/(?:p|ul|ol|h[1-6]|blockquote|pre)>|<hr\s*\/?>)(?:\s*<br\s*\/?>)+/gi,
    '$1',
  );
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // <a href="...">text</a> → [text](...)
  md = md.replace(
    /<a\s+href="([^"]+)">([^<]*)<\/a>/g,
    (_, href, text) => `[${text}](${href})`,
  );

  // <strong>x</strong> and <b>x</b> → **x** and <em>x</em> and <i>x</i> → _x_
  md = md.replace(/<(strong|b)>([^<]*)<\/(strong|b)>/g, '**$2**');
  md = md.replace(/<(em|i)>([^<]*)<\/(em|i)>/g, '_$2_');

  // <h1>-<h6> → # - ######
  md = md.replace(/<h([1-6])>/g, (_, n) => `\n\n${'#'.repeat(Number(n))} `);
  md = md.replace(/<\/h[1-6]>/g, '\n\n');

  // <hr> → ---
  md = md.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // <pre><code>...</code></pre> → ```...``` (before inline <code> handler)
  md = md.replace(
    /<pre><code>([\s\S]*?)\n?<\/code><\/pre>/g,
    '\n\n```\n$1\n```\n\n',
  );

  // <code>x</code> → `x`
  md = md.replace(/<code>([^<]*)<\/code>/g, '`$1`');

  // <ul>/<ol>...</ul/ol> — collect <li> items and prefix with - or numbers
  md = md.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, content: string) => {
    const items = (content.match(/<li>([\s\S]*?)<\/li>/g) || []) as string[];
    return `\n\n${items.map((item) => `- ${item.replace(/<\/?li>/g, '')}`).join('\n')}\n\n`;
  });
  md = md.replace(/<ol>([\s\S]*?)<\/ol>/g, (_, content: string) => {
    const items = (content.match(/<li>([\s\S]*?)<\/li>/g) || []) as string[];
    const lines = items.map(
      (item: string, i: number) => `${i + 1}. ${item.replace(/<\/?li>/g, '')}`,
    );
    return `\n\n${lines.join('\n')}\n\n`;
  });

  // <p>...</p> → ... (blank line between blocks)
  md = md.replace(/<p>([\s\S]*?)<\/p>/gi, (_, content: string) => {
    const stripped = content.trim();
    return stripped ? `\n\n${stripped}\n\n` : '';
  });

  // <blockquote>…</blockquote> → "> " on every line (after <p> is resolved)
  md = md.replace(
    /<blockquote>([\s\S]*?)<\/blockquote>/gi,
    (_, content: string) =>
      `\n\n${content
        .trim()
        .split('\n')
        .map((l) => (l.trim() ? `> ${l}` : '>'))
        .join('\n')}\n\n`,
  );

  // Collapse runs of internal whitespace within lines, trim final whitespace
  md = md
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();

  // Collapse multiple blank lines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md;
}
