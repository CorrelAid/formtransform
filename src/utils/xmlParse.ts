/**
 * A small XML reader for DDI input (#154): elements, attributes, text,
 * CDATA and the predefined and numeric entities. Comments, processing
 * instructions and a DOCTYPE are skipped. Plain TypeScript with no
 * dependency, so it runs the same in Node and in a browser (no DOMParser).
 *
 * Element names keep no namespace prefix (`ddi:var` → `var`); attribute
 * names keep theirs (`xml:lang`). Several top-level elements are allowed, so
 * a fragment (`<var>…</var><var>…</var>`) parses too.
 */
import { ConversionError } from '../diagnostics.js';

export interface XmlNode {
  /** Local name. */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** The element's own text (its children's not included), entities decoded. */
  text: string;
  /** Text and child elements in document order. */
  content: Array<string | XmlNode>;
}

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decode(raw: string): string {
  return raw.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
    (m: string, ref: string) => {
      if (ref[0] === '#') {
        const code =
          ref[1] === 'x'
            ? parseInt(ref.slice(2), 16)
            : parseInt(ref.slice(1), 10);
        return String.fromCodePoint(code);
      }
      return ENTITIES[ref] ?? m;
    },
  );
}

const localName = (qname: string) => qname.slice(qname.indexOf(':') + 1);

class Reader {
  private i = 0;
  constructor(private readonly src: string) {}

  private fail(message: string): never {
    throw new ConversionError(
      'ddi-invalid',
      `Not well-formed XML: ${message} at position ${this.i}`,
    );
  }

  /** Skip `<?…?>`, `<!--…-->` and `<!DOCTYPE …>`; true if one was skipped. */
  private skipMarkup(): boolean {
    const rest = (s: string) => this.src.startsWith(s, this.i);
    const close = (end: string) => {
      const at = this.src.indexOf(end, this.i);
      if (at < 0) this.fail(`missing ${end}`);
      this.i = at + end.length;
      return true;
    };
    if (rest('<?')) return close('?>');
    if (rest('<!--')) return close('-->');
    if (rest('<!DOCTYPE')) return close('>');
    return false;
  }

  /** Every top-level element. */
  document(): XmlNode[] {
    const out: XmlNode[] = [];
    while (this.i < this.src.length) {
      const lt = this.src.indexOf('<', this.i);
      if (lt < 0) break;
      this.i = lt;
      if (this.skipMarkup()) continue;
      out.push(this.element());
    }
    return out;
  }

  private element(): XmlNode {
    const open = /^<([^\s/>]+)/.exec(this.src.slice(this.i, this.i + 256));
    if (!open) this.fail('expected an element');
    const qname = open[1];
    this.i += open[0].length;
    const attrs: Record<string, string> = {};
    const attrRe = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
    for (;;) {
      attrRe.lastIndex = this.i;
      const m = attrRe.exec(this.src);
      if (!m) break;
      attrs[m[1]] = decode(m[3] ?? m[4] ?? '');
      this.i = attrRe.lastIndex;
    }
    const end = /\s*(\/?)>/y;
    end.lastIndex = this.i;
    const closing = end.exec(this.src);
    if (!closing) this.fail(`unclosed start tag <${qname}>`);
    this.i = end.lastIndex;
    const node: XmlNode = {
      name: localName(qname),
      attrs,
      children: [],
      text: '',
      content: [],
    };
    if (closing[1] === '/') return node;
    this.content(node, qname);
    return node;
  }

  private content(node: XmlNode, qname: string): void {
    for (;;) {
      const lt = this.src.indexOf('<', this.i);
      if (lt < 0) this.fail(`missing </${qname}>`);
      this.addText(node, decode(this.src.slice(this.i, lt)));
      this.i = lt;
      if (this.src.startsWith('<![CDATA[', this.i)) {
        const at = this.src.indexOf(']]>', this.i);
        if (at < 0) this.fail('unclosed CDATA');
        this.addText(node, this.src.slice(this.i + 9, at));
        this.i = at + 3;
      } else if (this.src.startsWith('</', this.i)) {
        const close = this.src.indexOf('>', this.i);
        const name = this.src.slice(this.i + 2, close).trim();
        if (name !== qname) this.fail(`</${name}> closes <${qname}>`);
        this.i = close + 1;
        return;
      } else if (!this.skipMarkup()) {
        const child = this.element();
        node.children.push(child);
        node.content.push(child);
      }
    }
  }

  private addText(node: XmlNode, text: string): void {
    if (!text) return;
    node.text += text;
    node.content.push(text);
  }
}

/** Parse XML text into its top-level elements. Throws `ddi-invalid`. */
export function parseXml(xml: string): XmlNode[] {
  const text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  return new Reader(text).document();
}

/** An element's text including its descendants' (XHTML inside `qstnLit`). */
export function textContent(node: XmlNode): string {
  return node.content
    .map((part) => (typeof part === 'string' ? part : textContent(part)))
    .join('');
}

/** The direct children named `name`. */
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

/** The first direct child named `name`. */
export function childNamed(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}
