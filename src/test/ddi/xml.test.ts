/** XML builder + minidom-compatible pretty-printer. */
import { describe, test, expect } from 'vitest';

import { XmlElement, escapeXml } from '../../ddi/xml.js';

describe('escapeXml', () => {
  test('escapes the five significant characters', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot;',
    );
  });

  test('escapes ampersand before other entities (no double-escaping)', () => {
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });

  test('leaves unicode untouched', () => {
    expect(escapeXml('Persönliche Größe')).toBe('Persönliche Größe');
  });
});

describe('XmlElement serialization', () => {
  test('emits the minidom XML declaration', () => {
    const doc = new XmlElement('root').toDocument();
    expect(doc.startsWith('<?xml version="1.0" ?>\n')).toBe(true);
    expect(doc.endsWith('\n')).toBe(true);
  });

  test('self-closes an empty element', () => {
    const el = new XmlElement('root');
    el.child('empty', { a: '1' });
    expect(el.toDocument()).toContain('<empty a="1"/>\n');
  });

  test('inlines a text-only element on one line', () => {
    const el = new XmlElement('root');
    el.textChild('titl', 'Hello');
    expect(el.toDocument()).toContain('  <titl>Hello</titl>\n');
  });

  test('indents nested element children by two spaces per level', () => {
    const root = new XmlElement('a');
    root.child('b').textChild('c', 'x');
    const doc = root.toDocument();
    expect(doc).toContain('<a>\n  <b>\n    <c>x</c>\n  </b>\n</a>\n');
  });

  test('preserves attribute insertion order', () => {
    const el = new XmlElement('var');
    el.setAttr('ID', 'V_x').setAttr('name', 'x').setAttr('intrvl', 'discrete');
    expect(el.toDocument()).toContain(
      '<var ID="V_x" name="x" intrvl="discrete"/>',
    );
  });

  test('escapes text and attribute values', () => {
    const el = new XmlElement('root');
    el.textChild('t', 'a < b', { note: 'x & y' });
    const doc = el.toDocument();
    expect(doc).toContain('note="x &amp; y"');
    expect(doc).toContain('>a &lt; b<');
  });

  test('keeps embedded newlines in text content', () => {
    const el = new XmlElement('root');
    el.textChild('preQTxt', 'line1\n\nline2');
    expect(el.toDocument()).toContain('<preQTxt>line1\n\nline2</preQTxt>');
  });
});
