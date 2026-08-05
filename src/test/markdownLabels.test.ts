import { describe, test, expect } from 'vitest';
import { markdownToHtml, htmlToMarkdown } from '../utils/markdownRenderer';
import { convertAndParse, findRowByName, findRowsByClass } from './helpers';

// ==============================================================
// Unit tests for the markdownToHtml utility
// ==============================================================

describe('markdownToHtml utility', () => {
  test('plain text passes through unchanged', () => {
    expect(markdownToHtml('Hello world')).toBe('Hello world');
  });

  test('bold converts to <strong>', () => {
    expect(markdownToHtml('**bold**')).toBe('<strong>bold</strong>');
  });

  test('italic converts to <em>', () => {
    expect(markdownToHtml('_italic_')).toBe('<em>italic</em>');
  });

  test('link converts to <a>', () => {
    expect(markdownToHtml('[Visit us](https://example.com)')).toBe(
      '<a href="https://example.com">Visit us</a>',
    );
  });

  test('inline code converts to <code>', () => {
    expect(markdownToHtml('use `npm install`')).toBe(
      'use <code>npm install</code>',
    );
  });

  test('single paragraph has <p> wrapper stripped', () => {
    const result = markdownToHtml('Just a sentence.');
    expect(result).toBe('Just a sentence.');
    expect(result).not.toContain('<p>');
  });

  test('multiple paragraphs keep <p> wrappers', () => {
    const result = markdownToHtml('Para one.\n\nPara two.');
    expect(result).toContain('<p>Para one.</p>');
    expect(result).toContain('<p>Para two.</p>');
  });

  test('empty string returns empty string', () => {
    expect(markdownToHtml('')).toBe('');
  });

  test('combined formatting in a label', () => {
    const result = markdownToHtml(
      'Please provide your **full name** or [contact us](https://example.com)',
    );
    expect(result).toContain('<strong>full name</strong>');
    expect(result).toContain('<a href="https://example.com">contact us</a>');
    expect(result).not.toContain('<p>');
  });
});

// ==============================================================
// Integration tests: markdown in converter pipeline
// ==============================================================

describe('Markdown label conversion in converter pipeline', () => {
  describe('question text (label field)', () => {
    test('bold in question label converts to <strong>', async () => {
      const survey = [
        { type: 'text', name: 'q1', label: 'Enter your **full name**' },
      ];
      const rows = await convertAndParse(survey);
      expect(findRowByName(rows, 'q1')?.text).toBe(
        'Enter your <strong>full name</strong>',
      );
    });

    test('link in question label converts to <a>', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'See [our site](https://example.com)',
        },
      ];
      const rows = await convertAndParse(survey);
      expect(findRowByName(rows, 'q1')?.text).toContain(
        '<a href="https://example.com">our site</a>',
      );
    });

    test('plain text label is unchanged', async () => {
      const survey = [
        { type: 'text', name: 'q1', label: 'What is your name?' },
      ];
      const rows = await convertAndParse(survey);
      expect(findRowByName(rows, 'q1')?.text).toBe('What is your name?');
    });
  });

  describe('hint text (help field)', () => {
    test('bold in hint converts to <strong>', async () => {
      const survey = [
        { type: 'text', name: 'q1', label: 'Q', hint: 'Use **full name**' },
      ];
      const rows = await convertAndParse(survey);
      expect(findRowByName(rows, 'q1')?.help).toBe(
        'Use <strong>full name</strong>',
      );
    });

    test('link in hint converts to <a>', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Q',
          hint: '[Help](https://example.com)',
        },
      ];
      const rows = await convertAndParse(survey);
      expect(findRowByName(rows, 'q1')?.help).toContain(
        '<a href="https://example.com">Help</a>',
      );
    });

    test('multi-paragraph hint keeps <p> blocks', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Q',
          hint: 'Step one.\n\nStep two.',
        },
      ];
      const rows = await convertAndParse(survey);
      const help = findRowByName(rows, 'q1')?.help ?? '';
      expect(help).toContain('<p>Step one.</p>');
      expect(help).toContain('<p>Step two.</p>');
    });
  });

  describe('group labels', () => {
    test('bold in group label converts to <strong>', async () => {
      const survey = [
        { type: 'begin_group', name: 'grp', label: '**Important** Section' },
        { type: 'text', name: 'q1', label: 'Q' },
        { type: 'end_group' },
      ];
      const rows = await convertAndParse(survey);
      const grp = findRowsByClass(rows, 'G')[0];
      expect(grp?.name).toBe('<strong>Important</strong> Section');
    });
  });

  describe('answer / subquestion labels', () => {
    test('bold in select_one answer label converts to <strong>', async () => {
      const survey = [{ type: 'select_one yesno', name: 'q1', label: 'Q' }];
      const choices = [
        { list_name: 'yesno', name: 'yes', label: '**Yes**' },
        { list_name: 'yesno', name: 'no', label: 'No' },
      ];
      const rows = await convertAndParse(survey, choices);
      const yesAnswer = rows.find((r) => r.class === 'A' && r.name === 'yes');
      expect(yesAnswer?.text).toBe('<strong>Yes</strong>');
      expect(rows.find((r) => r.class === 'A' && r.name === 'no')?.text).toBe(
        'No',
      );
    });

    test('bold in select_multiple subquestion label converts to <strong>', async () => {
      const survey = [
        { type: 'select_multiple colors', name: 'q1', label: 'Q' },
      ];
      const choices = [
        { list_name: 'colors', name: 'red', label: '_Red_' },
        { list_name: 'colors', name: 'blue', label: 'Blue' },
      ];
      const rows = await convertAndParse(survey, choices);
      const redSQ = rows.find((r) => r.class === 'SQ' && r.name === 'red');
      expect(redSQ?.text).toBe('<em>Red</em>');
    });
  });

  describe('welcome and end note labels', () => {
    test('markdown in welcome note converts to HTML in SL row', async () => {
      const survey = [
        {
          type: 'note',
          name: 'welcome',
          label: '**Welcome!** Please [read this](https://example.com) first.',
        },
        { type: 'text', name: 'q1', label: 'Q' },
      ];
      const rows = await convertAndParse(
        survey,
        [],
        [{ form_title: 'T', default_language: 'en' }],
      );
      const welcomeRow = findRowsByClass(rows, 'SL').find(
        (r) => r.name === 'surveyls_welcometext',
      );
      expect(welcomeRow?.text).toContain('<strong>Welcome!</strong>');
      expect(welcomeRow?.text).toContain(
        '<a href="https://example.com">read this</a>',
      );
    });

    test('multi-paragraph end note keeps HTML structure', async () => {
      const survey = [
        { type: 'text', name: 'q1', label: 'Q' },
        {
          type: 'note',
          name: 'end',
          label: 'Thank you!\n\nYour response has been saved.',
        },
      ];
      const rows = await convertAndParse(
        survey,
        [],
        [{ form_title: 'T', default_language: 'en' }],
      );
      const endRow = findRowsByClass(rows, 'SL').find(
        (r) => r.name === 'surveyls_endtext',
      );
      expect(endRow?.text).toContain('<p>Thank you!</p>');
      expect(endRow?.text).toContain('<p>Your response has been saved.</p>');
    });
  });

  describe('multilingual labels', () => {
    test('markdown is converted per language', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: { en: '**Name** please', de: 'Bitte **Name**' },
        },
      ];
      const rows = await convertAndParse(
        survey,
        [],
        [{ form_title: 'T', default_language: 'en' }],
      );
      const enRow = rows.find((r) => r.name === 'q1' && r.language === 'en');
      const deRow = rows.find((r) => r.name === 'q1' && r.language === 'de');
      expect(enRow?.text).toBe('<strong>Name</strong> please');
      expect(deRow?.text).toBe('Bitte <strong>Name</strong>');
    });
  });
});

// ==============================================================
// Unit tests for htmlToMarkdown (reverse of markdownToHtml)
// ==============================================================

describe('htmlToMarkdown utility', () => {
  test('plain text passes through unchanged', () => {
    expect(htmlToMarkdown('Hello world')).toBe('Hello world');
  });

  test('<strong>bold</strong> → **bold**', () => {
    expect(htmlToMarkdown('<strong>bold</strong>')).toBe('**bold**');
  });

  test('<b>bold</b> → **bold**', () => {
    expect(htmlToMarkdown('<b>bold</b>')).toBe('**bold**');
  });

  test('<em>italic</em> → _italic_', () => {
    expect(htmlToMarkdown('<em>italic</em>')).toBe('_italic_');
  });

  test('<i>italic</i> → _italic_', () => {
    expect(htmlToMarkdown('<i>italic</i>')).toBe('_italic_');
  });

  test('<a href="...">text</a> → [text](url)', () => {
    expect(htmlToMarkdown('<a href="https://example.com">Visit us</a>')).toBe(
      '[Visit us](https://example.com)',
    );
  });

  test('<code>inline code</code> → `inline code`', () => {
    expect(htmlToMarkdown('<code>npm install</code>')).toBe('`npm install`');
  });

  test('<h1>-<h6> headings → # to ######', () => {
    expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
    expect(htmlToMarkdown('<h3>Subtitle</h3>')).toBe('### Subtitle');
    expect(htmlToMarkdown('<h6>Smallest</h6>')).toBe('###### Smallest');
  });

  test('<blockquote> → >', () => {
    expect(htmlToMarkdown('<blockquote>A quote</blockquote>')).toBe(
      '> A quote',
    );
  });

  test('<hr> → ---', () => {
    expect(htmlToMarkdown('before<hr>after')).toBe('before\n---\nafter');
  });

  test('<pre><code> block → ``` block', () => {
    expect(htmlToMarkdown('<pre><code>code block</code></pre>')).toBe(
      '```\ncode block\n```',
    );
  });

  test('<ul><li> list → bullet list', () => {
    const html = '<ul><li>Item one</li><li>Item two</li></ul>';
    expect(htmlToMarkdown(html)).toBe('- Item one\n- Item two');
  });

  test('<ol><li> list → numbered list', () => {
    const html = '<ol><li>First</li><li>Second</li></ol>';
    expect(htmlToMarkdown(html)).toBe('1. First\n2. Second');
  });

  test('round-trips what markdownToHtml produces (forward → backward)', () => {
    const examples = [
      'Hello world',
      '**bold text**',
      '_italic text_',
      'Use `code` here',
      '[link](https://example.com)',
      'Para one.\n\nPara two.',
    ];
    for (const md of examples) {
      const html = markdownToHtml(md);
      const reversed = htmlToMarkdown(html);
      // Normalize whitespace for comparison since rendering can differ slightly
      const normalized = (s: string) => s.replace(/\s+/g, ' ').trim();
      expect(normalized(reversed)).toBe(normalized(md));
    }
  });
});
