import type {
  FailurePayload,
  ReplayResponse,
  ServerConfig,
  TestDetail,
  TestSummary,
} from "./types";
import { subscribeEvents, type EventsListener } from "./events";

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; aborted: boolean; err: string };

function encodeId(id: string): string {
  return id.split("/").map(encodeURIComponent).join("/");
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

async function request<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    // Network failure or abort — no HTTP status is available, so use 0.
    return {
      ok: false,
      status: 0,
      aborted: isAbort(err),
      err: err instanceof Error ? err.message : String(err),
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      aborted: false,
      err: body || `HTTP ${res.status}`,
    };
  }
  try {
    const body = (await res.json()) as T;
    return { ok: true, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      aborted: false,
      err: `failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const api = {
  getConfig(signal?: AbortSignal): Promise<ApiResult<ServerConfig>> {
    return request<ServerConfig>("/api/config", { signal });
  },

  listTests(signal?: AbortSignal): Promise<ApiResult<TestSummary[]>> {
    return request<TestSummary[]>("/api/tests", { signal });
  },

  getTest(id: string, signal?: AbortSignal): Promise<ApiResult<TestDetail>> {
    return request<TestDetail>(`/api/tests/${encodeId(id)}`, { signal });
  },

  replay(
    source: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ReplayResponse>> {
    return request<ReplayResponse>("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: source,
      signal,
    });
  },

  async saveTest(
    id: string,
    source: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<null>> {
    let res: Response;
    try {
      res = await fetch(`/api/tests/${encodeId(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: source,
        signal,
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        aborted: isAbort(err),
        err: err instanceof Error ? err.message : String(err),
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        aborted: false,
        err: text || `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, body: null };
  },

  async createTest(
    id: string,
    source: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<null>> {
    let res: Response;
    try {
      res = await fetch(`/api/tests/${encodeId(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: source,
        signal,
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        aborted: isAbort(err),
        err: err instanceof Error ? err.message : String(err),
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        aborted: false,
        err: text || `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, body: null };
  },

  events(onEvent: EventsListener): () => void {
    return subscribeEvents(onEvent);
  },

  decodeFailure(
    encoded: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<FailurePayload>> {
    return request<FailurePayload>("/api/failure/decode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encoded }),
      signal,
    });
  },
};
