/**
 * KoboToolbox API v2 client — the fetch half of `formtransform kobo`.
 *
 * Ported from survey2ddi's `kobo2ddi/client.py`. Pure `fetch`, no filesystem:
 * the CLI command (`koboCommand.ts`) owns writing files. Node-only by
 * convention like `cli.ts` — never re-exported from `src/index.ts`, so the
 * browser bundle does not ship an HTTP client.
 *
 * The token is sent only to `serverUrl`: pagination `next` links are followed
 * only when they stay on that origin, and no error message includes it.
 */

export const KOBO_DEFAULT_SERVER = 'https://eu.kobotoolbox.org';

/** Kobo asset summary as returned by `GET /api/v2/assets/`. */
export interface KoboAsset {
  uid: string;
  name: string;
  has_deployment?: boolean;
  [key: string]: unknown;
}

export interface KoboClientOptions {
  token: string;
  /** Default {@link KOBO_DEFAULT_SERVER}. */
  serverUrl?: string;
  /** Per-request timeout in ms. Default 60 000. */
  timeoutMs?: number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

interface Page<T> {
  results: T[];
  next?: string | null;
}

/** Asset UIDs are alphanumeric; anything else would change the request path. */
function checkUid(uid: string): string {
  if (!/^[A-Za-z0-9]+$/.test(uid)) {
    throw new Error(`invalid Kobo asset uid: ${JSON.stringify(uid)}`);
  }
  return uid;
}

export class KoboClient {
  readonly serverUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KoboClientOptions) {
    if (!options.token) {
      throw new Error(
        'Kobo API token required: pass --token or set KOBO_API_TOKEN',
      );
    }
    this.token = options.token;
    this.serverUrl = (options.serverUrl || KOBO_DEFAULT_SERVER).replace(
      /\/+$/,
      '',
    );
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Resolve `pathOrUrl` against the server, refusing other origins. */
  private url(pathOrUrl: string): URL {
    const url = new URL(pathOrUrl, this.serverUrl + '/');
    if (url.origin !== new URL(this.serverUrl).origin) {
      throw new Error(
        `refusing to send the Kobo token to ${url.origin} (server is ${this.serverUrl})`,
      );
    }
    return url;
  }

  private async get(pathOrUrl: string): Promise<Response> {
    const url = this.url(pathOrUrl);
    const resp = await this.fetchImpl(url, {
      headers: { Authorization: `Token ${this.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!resp.ok) {
      const hint =
        resp.status === 401 || resp.status === 403
          ? ' (check the token and that it can access this asset)'
          : '';
      throw new Error(
        `Kobo API ${resp.status} ${resp.statusText} for ${url.pathname}${hint}`,
      );
    }
    return resp;
  }

  /** Follow `next` links, concatenating every page's `results`. */
  private async getAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null | undefined = path;
    while (next) {
      const page = (await (await this.get(next)).json()) as Page<T>;
      if (!Array.isArray(page.results)) {
        throw new Error(`Kobo API returned no "results" array for ${path}`);
      }
      out.push(...page.results);
      next = page.next;
    }
    return out;
  }

  /** Every asset (survey/form) the token can see. */
  listAssets(): Promise<KoboAsset[]> {
    return this.getAll<KoboAsset>('/api/v2/assets/');
  }

  /** Full asset detail (name, settings, content). */
  async getAsset(uid: string): Promise<KoboAsset> {
    const resp = await this.get(`/api/v2/assets/${checkUid(uid)}/`);
    return (await resp.json()) as KoboAsset;
  }

  /**
   * Every submission of an asset, keyed `group/name` with space-joined
   * `select_multiple` values — the shape `buildDataCsv` reads directly.
   */
  getSubmissions(uid: string): Promise<Record<string, unknown>[]> {
    return this.getAll(`/api/v2/assets/${checkUid(uid)}/data/?format=json`);
  }

  /** The asset's XLSForm. Kobo serves xlsx bytes from the `.xls` endpoint. */
  async downloadXlsform(uid: string): Promise<Uint8Array> {
    const resp = await this.get(`/api/v2/assets/${checkUid(uid)}.xls`);
    return new Uint8Array(await resp.arrayBuffer());
  }
}
