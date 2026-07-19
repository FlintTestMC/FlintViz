import type {
  FailurePayload,
  ReplayResponse,
  ServerConfig,
  TestDetail,
  TestSummary,
} from "./types";
import { subscribeEvents, type EventsListener } from "./events";
import { decodeFailurePayload, encodeFailurePayload } from "./failurePayload";
import {
  isStandalone,
  setStandalone,
  standaloneCreateTest,
  standaloneDecodeFailure,
  standaloneEncodeFailure,
  standaloneGetTest,
  standaloneListTests,
  standaloneReplay,
  standaloneSaveTest,
  standaloneSubscribeEvents,
} from "./standalone";

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; aborted: boolean; err: string };

export { setStandalone };

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
    if (isStandalone()) {
      return Promise.resolve({
        ok: true,
        status: 200,
        body: standaloneListTests(),
      });
    }
    return request<TestSummary[]>("/api/tests", { signal });
  },

  getTest(id: string, signal?: AbortSignal): Promise<ApiResult<TestDetail>> {
    if (isStandalone()) {
      return Promise.resolve({
        ok: true,
        status: 200,
        body: standaloneGetTest(id),
      });
    }
    return request<TestDetail>(`/api/tests/${encodeId(id)}`, { signal });
  },

  async replay(
    source: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ReplayResponse>> {
    if (isStandalone()) {
      return Promise.resolve({
        ok: true,
        status: 200,
        body: await standaloneReplay(source),
      });
    }
    const result = await request<ReplayResponse>("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: source,
      signal,
    });
    if (!result.ok && !result.aborted) {
      try {
        return {
          ok: true,
          status: 200,
          body: await standaloneReplay(source),
        };
      } catch {
        return result;
      }
    }
    return result;
  },

  async saveTest(
    id: string,
    source: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<null>> {
    if (isStandalone()) {
      standaloneSaveTest(id, source);
      return Promise.resolve({ ok: true, status: 204, body: null });
    }
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
    if (isStandalone()) {
      const result = standaloneCreateTest(id, source);
      if (!result.ok) {
        return Promise.resolve({
          ok: false,
          status: result.status,
          aborted: false,
          err: result.err,
        });
      }
      return Promise.resolve({ ok: true, status: 201, body: null });
    }
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
    if (isStandalone()) {
      return standaloneSubscribeEvents(onEvent);
    }
    return subscribeEvents(onEvent);
  },

  async decodeFailure(
    encoded: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<FailurePayload>> {
    if (isStandalone()) {
      const result = await standaloneDecodeFailure(encoded);
      if (!result.ok) {
        return {
          ok: false,
          status: 400,
          aborted: false,
          err: result.err,
        };
      }
      return { ok: true, status: 200, body: result.body };
    }
    const result = await request<FailurePayload>("/api/failure/decode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encoded }),
      signal,
    });
    if (!result.ok && !result.aborted) {
      try {
        const payload = await decodeFailurePayload(encoded);
        return { ok: true, status: 200, body: payload };
      } catch {
        return result;
      }
    }
    return result;
  },

  async encodeFailure(payload: FailurePayload): Promise<string> {
    if (isStandalone()) {
      return standaloneEncodeFailure(payload);
    }
    return encodeFailurePayload(payload);
  },
};
