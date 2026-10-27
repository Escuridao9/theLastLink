import type { DatabaseSync } from "node:sqlite";
export interface FetchReply {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export type Fetcher = (
  url: string,
  options: { headers: Record<string, string> },
) => Promise<FetchReply>;
/** Cache only response bodies and resource paths. Tokens never enter SQLite, logs or exports. */
export class TmdbClient {
  private lastRequest = 0;
  private db: DatabaseSync;
  private token: string;
  private request: Fetcher;
  private pause: (ms: number) => Promise<void>;
  private now: () => number;
  constructor(
    db: DatabaseSync,
    token: string,
    request: Fetcher = fetch,
    pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  ) {
    this.db = db;
    this.token = token;
    this.request = request;
    this.pause = pause;
    this.now = now;
    if (!token.trim())
      throw Error(
        "Set TMDB_READ_TOKEN privately on your own computer. Never paste it into chat or public config.",
      );
  }
  async get(resource: string, refresh = false): Promise<unknown> {
    if (
      !/^\/(movie\/\d+(?:\/credits)?|discover\/movie|configuration\/jobs)(\?|$)/.test(
        resource,
      )
    )
      throw Error("invalid_tmdb_resource");
    const cached = this.db
      .prepare("select body,fetched_at from request_cache where resource=?")
      .get(resource);
    if (
      !refresh &&
      cached &&
      this.now() - Date.parse(cached["fetched_at"] as string) < 30 * 86400000
    )
      return JSON.parse(cached["body"] as string);
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.pause(Math.max(0, 250 - (this.now() - this.lastRequest)));
      this.lastRequest = this.now();
      let response: FetchReply;
      try {
        response = await this.request(
          `https://api.themoviedb.org/3${resource}`,
          {
            headers: {
              Authorization: `Bearer ${this.token}`,
              Accept: "application/json",
            },
          },
        );
      } catch {
        if (attempt === 4) throw Error("tmdb_network_error");
        await this.pause(1000 * 2 ** attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get("retry-after");
        const ms = retry
          ? /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : Math.max(0, Date.parse(retry) - this.now())
          : 1000 * 2 ** attempt;
        // A long server backoff stops the resumable run rather than ignoring Retry-After.
        if (ms > 60000)
          throw Error("tmdb_backoff: retry later; progress is saved");
        await this.pause(Number.isFinite(ms) ? ms : 1000);
        continue;
      }
      if (!response.ok) throw Error(`tmdb_http_${response.status}`);
      const body = await response.json();
      this.db
        .prepare(
          "insert into request_cache values(?,?,?) on conflict(resource) do update set fetched_at=excluded.fetched_at,body=excluded.body",
        )
        .run(
          resource,
          new Date(this.now()).toISOString(),
          JSON.stringify(body),
        );
      return body;
    }
    throw Error("tmdb_retry_budget_exceeded");
  }
}
