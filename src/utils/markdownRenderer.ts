import { marked } from 'marked';

/**
 * Convert a markdown string to HTML for use in LimeSurvey text fields.
 *
 * - Block content (multiple paragraphs, lists, etc.) is returned as full HTML.
 * - Single-paragraph content has its outer <p>…</p> stripped so that short
 *   labels remain inline strings rather than block elements.
 * - Empty / non-string input is returned as-is.
 */
export function markdownToHtml(text: string): string {
  if (!text) return text;

  const html = (marked.parse(text) as string).trim();

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

  // <a href="...">text</a> → [text](...)
  md = md.replace(
    /<a\s+href="([^"]+)">([^<]*)<\/a>/g,
    (_, href, text) => `[${text}](${href})`,
  );

  // <strong>x</strong> and <b>x</b> → **x** and <em>x</em> and <i>x</i> → _x_
  md = md.replace(/<(strong|b)>([^<]*)<\/(strong|b)>/g, '**$2**');
  md = md.replace(/<(em|i)>([^<]*)<\/(em|i)>/g, '_$2_');

  // <h1>-<h6> → # - ######
  md = md.replace(/<h([1-6])>/g, (_, n) => `${'#'.repeat(Number(n))} `);
  md = md.replace(/<\/h[1-6]>/g, '');

  // <blockquote> → >
  md = md.replace(/<blockquote>/gi, '> ');
  md = md.replace(/<\/blockquote>/gi, '');

  // <hr> → ---
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // <pre><code>...</code></pre> → ```...``` (before inline <code> handler)
  md = md.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, '```\n$1\n```');

  // <code>x</code> → `x`
  md = md.replace(/<code>([^<]*)<\/code>/g, '`$1`');

  // <ul>/<ol>...</ul/ol> — collect <li> items and prefix with - or numbers
  md = md.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, content: string) => {
    const items = (content.match(/<li>([\s\S]*?)<\/li>/g) || []) as string[];
    return items.map((item) => `- ${item.replace(/<\/?li>/g, '')}`).join('\n');
  });
  md = md.replace(/<ol>([\s\S]*?)<\/ol>/g, (_, content: string) => {
    const items = (content.match(/<li>([\s\S]*?)<\/li>/g) || []) as string[];
    return items
      .map(
        (item: string, i: number) =>
          `${i + 1}. ${item.replace(/<\/?li>/g, '')}`,
      )
      .join('\n');
  });

  // <p>...</p> → ... (double newline between blocks for paragraphs)
  md = md.replace(/<p>([\s\S]*?)<\/p>/gi, (_, content: string) => {
    const stripped = content.trim();
    if (!stripped) return '';
    // If already starts with markdown block char, keep as block
    if (/^[-#>`]/.test(stripped)) return `\n\n${stripped}`;
    return stripped;
  });

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
