/**
 * Minimal XML element tree + pretty-printer.
 *
 * Serialization matches the layout of Python's `xml.dom.minidom.toprettyxml`
 * (2-space indent, `<?xml version="1.0" ?>` declaration, text-only elements
 * inline, empty elements self-closed) so DDI output is stable and diffable.
 */

/** Escape `&`, `<`, `>`, `"` — applied to both text and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/>/g, '&gt;');
}

/**
 * An XML element. Holds either text content or child elements (never both —
 * mirrors the DDI structures we emit).
 */
export class XmlElement {
  readonly tag: string;
  readonly attrs: [string, string][] = [];
  readonly children: XmlElement[] = [];
  text: string | null = null;

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tag = tag;
    for (const [k, v] of Object.entries(attrs)) {
      this.attrs.push([k, v]);
    }
  }

  /** Set an attribute, preserving insertion order. */
  setAttr(name: string, value: string): this {
    this.attrs.push([name, value]);
    return this;
  }

  /** Append a child element and return it. */
  child(tag: string, attrs: Record<string, string> = {}): XmlElement {
    const el = new XmlElement(tag, attrs);
    this.children.push(el);
    return el;
  }

  /** Append a child element carrying text content and return it. */
  textChild(
    tag: string,
    text: string,
    attrs: Record<string, string> = {},
  ): XmlElement {
    const el = this.child(tag, attrs);
    el.text = text;
    return el;
  }

  private openTag(): string {
    const attrs = this.attrs
      .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
      .join('');
    return `<${this.tag}${attrs}`;
  }

  private writeXml(indent: string, addindent: string, out: string[]): void {
    if (this.children.length === 0 && this.text === null) {
      out.push(`${indent}${this.openTag()}/>\n`);
      return;
    }
    if (this.children.length === 0) {
      // Text-only element — inline on a single line.
      out.push(
        `${indent}${this.openTag()}>${escapeXml(this.text ?? '')}</${this.tag}>\n`,
      );
      return;
    }
    out.push(`${indent}${this.openTag()}>\n`);
    for (const c of this.children) {
      c.writeXml(indent + addindent, addindent, out);
    }
    out.push(`${indent}</${this.tag}>\n`);
  }

  /** Serialize this element as a full document with XML declaration. */
  toDocument(): string {
    const out: string[] = ['<?xml version="1.0" ?>\n'];
    this.writeXml('', '  ', out);
    return out.join('');
  }
}
