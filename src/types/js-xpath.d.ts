declare module 'js-xpath' {
  interface XPathNode {
    id?: string;
    type?: string;
    args?: unknown[];
    left?: unknown;
    right?: unknown;
    steps?: Array<{
      name?: string;
      axis?: string;
    }>;
    value?:
      | {
          _?: string;
        }
      | string;
    valueDisplay?: string;
  }

  export function parse(expression: string): XPathNode;
}
