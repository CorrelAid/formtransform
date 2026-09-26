/** Traversals of an {@link Instrument}'s item tree. */
import type { Item, QuestionItem } from './types.js';

/** Every item, pre-order (a group before its children): survey order. */
export function allItems(items: Item[]): Item[] {
  return items.flatMap((item) =>
    item.kind === 'group' ? [item, ...allItems(item.children)] : [item],
  );
}

/** Every question, in survey order. */
export function allQuestions(items: Item[]): QuestionItem[] {
  return allItems(items).filter(
    (i): i is QuestionItem => i.kind === 'question',
  );
}
