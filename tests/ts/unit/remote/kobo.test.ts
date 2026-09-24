/** KoboToolbox client: auth, pagination, origin guard, error hygiene. */
import { describe, expect, test } from 'vitest';

import { KoboClient } from '../../../../src/remote/kobo.js';

const SERVER = 'https://kf.example.org';
const TOKEN = 'secret-token-123';

interface Call {
  url: string;
  auth: string | null;
}

/** A fetch stub serving `routes` (path+query → body) and recording calls. */
function fakeFetch(routes: Record<string, unknown>, status = 200) {
  const calls: Call[] = [];
  const impl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      url: url.pathname + url.search,
      auth: new Headers(init?.headers).get('authorization'),
    });
    const body = routes[url.pathname + url.search];
    if (body === undefined)
      return new Response('nope', { status: 404, statusText: 'Not Found' });
    if (body instanceof Uint8Array) return new Response(body, { status });
    return new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? 'OK' : 'Unauthorized',
    });
  }) as typeof fetch;
  return { impl, calls };
}

const client = (f: typeof fetch, serverUrl = SERVER + '/') =>
  new KoboClient({ token: TOKEN, serverUrl, fetch: f });

describe('KoboClient', () => {
  test('refuses to run without a token', () => {
    expect(() => new KoboClient({ token: '' })).toThrow(/KOBO_API_TOKEN/);
  });

  test('sends the token header and follows pagination', async () => {
    const { impl, calls } = fakeFetch({
      '/api/v2/assets/aX1/data/?format=json': {
        results: [{ a: 1 }, { a: 2 }],
        next: `${SERVER}/api/v2/assets/aX1/data/?format=json&start=2`,
      },
      '/api/v2/assets/aX1/data/?format=json&start=2': {
        results: [{ a: 3 }],
        next: null,
      },
    });
    const rows = await client(impl).getSubmissions('aX1');
    expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth === `Token ${TOKEN}`)).toBe(true);
  });

  test('lists assets across pages', async () => {
    const { impl } = fakeFetch({
      '/api/v2/assets/': {
        results: [{ uid: 'a1', name: 'A' }],
        next: `${SERVER}/api/v2/assets/?page=2`,
      },
      '/api/v2/assets/?page=2': { results: [{ uid: 'b2', name: 'B' }] },
    });
    expect((await client(impl).listAssets()).map((a) => a.uid)).toEqual([
      'a1',
      'b2',
    ]);
  });

  test('never sends the token to another origin', async () => {
    const { impl, calls } = fakeFetch({
      '/api/v2/assets/': {
        results: [],
        next: 'https://evil.example.com/steal',
      },
    });
    await expect(client(impl).listAssets()).rejects.toThrow(
      /refusing to send the Kobo token/,
    );
    expect(calls).toHaveLength(1);
  });

  test('HTTP errors name the status, not the token', async () => {
    const { impl } = fakeFetch(
      { '/api/v2/assets/aX1/': { detail: 'no' } },
      401,
    );
    const err = await client(impl)
      .getAsset('aX1')
      .catch((e: Error) => e);
    expect(String(err)).toMatch(/401/);
    expect(String(err)).not.toContain(TOKEN);
  });

  test('downloads the XLSForm bytes from the .xls endpoint', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
    const { impl } = fakeFetch({ '/api/v2/assets/aX1.xls': bytes });
    expect(await client(impl).downloadXlsform('aX1')).toEqual(bytes);
  });

  test('rejects uids that would change the request path', async () => {
    const { impl, calls } = fakeFetch({});
    await expect(client(impl).getAsset('../users')).rejects.toThrow(
      /invalid Kobo asset uid/,
    );
    expect(calls).toHaveLength(0);
  });
});
