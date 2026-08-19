import { describe, it, expect } from 'vitest';
import { QUESTION_TYPES, APPEARANCES, TYPE_MAPPINGS } from '../../../src/index';

/**
 * The two generated catalogues are a public API: qwac renders type labels and
 * matrix previews from them, formulaid derives its question-type union from
 * them. These tests guard the shape consumers rely on, and the invariants that
 * would silently break a consumer if the registry lost an entry.
 */
describe('QUESTION_TYPES', () => {
  it('covers every type string TYPE_MAPPINGS knows, aliases included', () => {
    const catalogued = new Set<string>();
    for (const entry of Object.values(QUESTION_TYPES)) {
      if (entry.typeString) catalogued.add(entry.typeString);
      for (const alias of entry.aliases ?? []) catalogued.add(alias);
    }

    const missing = Object.keys(TYPE_MAPPINGS).filter(
      (t) => !catalogued.has(t),
    );
    expect(missing).toEqual([]);
  });

  it('gives every question and metadata row a label and guidance', () => {
    for (const [slug, entry] of Object.entries(QUESTION_TYPES)) {
      expect(entry.label, `${slug}.label`).not.toBe('');
      expect(entry.id, `${slug}.id`).toMatch(/^[a-z]+[A-Za-z]*:/);
      // Structural rows carry no useWhen in the registry; everything else must.
      if (entry.kind !== 'structural') {
        expect(entry.useWhen, `${slug}.useWhen`).not.toBe('');
      }
    }
  });

  it('resolves the variant → base relation to a catalogued type', () => {
    const variants = Object.entries(QUESTION_TYPES).filter(
      ([, e]) => e.isVariant,
    );
    expect(variants.length).toBeGreaterThan(0);

    for (const [slug, entry] of variants) {
      expect(entry.base, `${slug}.base`).toBeDefined();
      expect(QUESTION_TYPES[entry.base!], `base of ${slug}`).toBeDefined();
      // A variant is authored as its base type, so it repeats that type cell.
      expect(entry.typeString).toBe(QUESTION_TYPES[entry.base!].typeString);
    }

    expect(QUESTION_TYPES.select_one_other?.base).toBe('select_one');
    expect(QUESTION_TYPES.select_multiple_other?.base).toBe('select_multiple');
  });

  it('models a composite as spanning several types, with no single type cell', () => {
    const grid = QUESTION_TYPES.grid;
    expect(grid?.isComposite).toBe(true);
    // begin_group + select_one — a composite has no `base`, it has `bases`.
    expect(grid.bases).toEqual(['begin_group', 'select_one']);
    expect(grid.base).toBeUndefined();
    expect(grid.typeString).toBeUndefined();
    for (const base of grid.bases!) {
      expect(QUESTION_TYPES[base], `base ${base}`).toBeDefined();
    }
  });

  it('lists the metadata rows the transformer accepts but does not author', () => {
    const metadata = Object.entries(QUESTION_TYPES)
      .filter(([, e]) => e.kind === 'metadata')
      .map(([slug]) => slug);

    expect(metadata.sort()).toEqual(
      [
        'audit',
        'deviceid',
        'end',
        'hidden',
        'start',
        'today',
        'username',
      ].sort(),
    );
  });

  it('keeps per-key literal typeStrings, so consumers can derive unions', () => {
    // The runtime half of the guarantee. The type-level half cannot be asserted
    // here — widening leaves the payload identical — so it is enforced by
    // `LiteralTypeStringsPreserved` in the generated module, which `npm run
    // typecheck` compiles. This mirrors the derivation formulaid uses:
    type DerivedQuestionType = {
      [K in keyof typeof QUESTION_TYPES]: (typeof QUESTION_TYPES)[K] extends {
        kind: 'question';
        typeString: infer T;
      }
        ? T extends string
          ? T
          : never
        : never;
    }[keyof typeof QUESTION_TYPES];

    const selectOne: DerivedQuestionType = 'select_one';
    expect(selectOne).toBe(QUESTION_TYPES.select_one.typeString);

    // A composite carries `typeString: undefined`, so the derivation drops it
    // while the property stays reachable on every member.
    expect('typeString' in QUESTION_TYPES.grid).toBe(true);
    expect(QUESTION_TYPES.grid.typeString).toBeUndefined();
  });

  it('exposes the authoring constraints for types that impose them', () => {
    const selectOne = QUESTION_TYPES.select_one;
    expect(selectOne.constraints?.maxNameLength).toBe(20);
    expect(selectOne.constraints?.maxChoiceCodeLength).toBe(5);
    expect(selectOne.constraints?.namePattern).toBeTypeOf('string');
  });
});

describe('APPEARANCES', () => {
  it('is reachable from the package root with its data intact', () => {
    expect(Object.keys(APPEARANCES).length).toBeGreaterThan(0);
    for (const [name, spec] of Object.entries(APPEARANCES)) {
      expect(spec.behavior, `${name}.behavior`).toMatch(/^(handled|warn)$/);
      expect(spec.lsEffect, `${name}.lsEffect`).toBeTypeOf('string');
    }
  });

  it('marks the matrix header appearance as carrying no response', () => {
    // What a preview UI needs: `label` on a grid opens the matrix header, which
    // stores no answer of its own — `list-nolabel` rows below it do.
    expect(APPEARANCES.label?.carriesData).toBe(false);
    expect(APPEARANCES.label?.validForTypes).toContain('begin_group');
    expect(APPEARANCES['list-nolabel']?.carriesData).not.toBe(false);
  });

  it('restricts appearances to the types they are valid for', () => {
    const withTypes = Object.values(APPEARANCES).filter(
      (s) => s.validForTypes?.length,
    );
    expect(withTypes.length).toBeGreaterThan(0);

    for (const spec of withTypes) {
      for (const type of spec.validForTypes!) {
        expect(
          TYPE_MAPPINGS[type],
          `validForTypes entry ${type}`,
        ).toBeDefined();
      }
    }
  });
});
