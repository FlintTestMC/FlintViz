import type {
  FailurePayload,
  ReplayResponse,
  ServerConfig,
  TestDetail,
  TestSummary,
} from "./types";
import { subscribeEvents, type EventsListener } from "./events";
import { localReplay } from "./localEngine";
import { newTestTemplate } from "../panels/newTestTemplate";

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; aborted: boolean; err: string };

let isStandalone = false;

export function setStandalone(val: boolean) {
  isStandalone = val;
}

const STANDALONE_TESTS_KEY = "flint_viz_standalone_tests";
const SOURCE_PREFIX = "flint_viz_test_source:";

function getLocalTestIds(): string[] {
  try {
    const list = localStorage.getItem(STANDALONE_TESTS_KEY);
    if (list) return JSON.parse(list);
  } catch (e) {
    // ignore
  }
  // Pre-populate with default if empty
  const defaultId = "basic_example.json";
  try {
    localStorage.setItem(STANDALONE_TESTS_KEY, JSON.stringify([defaultId]));
    localStorage.setItem(SOURCE_PREFIX + defaultId, newTestTemplate("basic_example"));
  } catch (e) {
    // ignore
  }
  return [defaultId];
}

function saveLocalTestIds(ids: string[]) {
  try {
    localStorage.setItem(STANDALONE_TESTS_KEY, JSON.stringify(ids));
  } catch (e) {
    // ignore
  }
}

function getLocalTestSource(id: string): string {
  try {
    return localStorage.getItem(SOURCE_PREFIX + id) || "";
  } catch (e) {
    return "";
  }
}

function saveLocalTestSource(id: string, source: string) {
  try {
    localStorage.setItem(SOURCE_PREFIX + id, source);
  } catch (e) {
    // ignore
  }
}

const localListeners = new Set<EventsListener>();

function triggerLocalFileChanged(id: string) {
  for (const listener of localListeners) {
    try {
      listener({ id });
    } catch (e) {
      // ignore
    }
  }
}

async function decodeFailurePayload(encoded: string): Promise<FailurePayload> {
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const response = new Response(ds.readable);
  const decompressedBytes = await response.arrayBuffer();
  const decodedText = new TextDecoder().decode(decompressedBytes);
  return JSON.parse(decodedText) as FailurePayload;
}

async function encodeFailurePayload(payload: FailurePayload): Promise<string> {
  const jsonText = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(jsonText);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const response = new Response(cs.readable);
  const compressedBuffer = await response.arrayBuffer();
  const compressedBytes = new Uint8Array(compressedBuffer);

  let binaryString = "";
  for (let i = 0; i < compressedBytes.length; i++) {
    const byte = compressedBytes[i];
    if (byte !== undefined) {
      binaryString += String.fromCharCode(byte);
    }
  }
  const base64 = btoa(binaryString);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
    if (isStandalone) {
      const ids = getLocalTestIds();
      const summaries: TestSummary[] = ids.map((id) => {
        const source = getLocalTestSource(id);
        const name = id.replace(/\.json$/i, "");
        let tags: string[] = [];
        let parse_error: string | undefined = undefined;
        try {
          if (source) {
            const parsed = JSON.parse(source);
            tags = parsed.tags || [];
          }
        } catch (e: any) {
          parse_error = e.message || String(e);
        }
        return {
          id,
          path: `local://${id}`,
          name,
          tags,
          parse_error,
        };
      });
      return Promise.resolve({ ok: true, status: 200, body: summaries });
    }
    return request<TestSummary[]>("/api/tests", { signal });
  },

  getTest(id: string, signal?: AbortSignal): Promise<ApiResult<TestDetail>> {
    if (isStandalone) {
      const source = getLocalTestSource(id);
      let spec: any = null;
      let parse_error: string | null = null;
      try {
        if (source) {
          spec = JSON.parse(source);
        }
      } catch (e: any) {
        parse_error = e.message || String(e);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        body: { id, source, spec, parse_error },
      });
    }
    return request<TestDetail>(`/api/tests/${encodeId(id)}`, { signal });
  },

  replay(
    source: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ReplayResponse>> {
    if (isStandalone) {
      const response = localReplay(source);
      return Promise.resolve({ ok: true, status: 200, body: response });
    }
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
    if (isStandalone) {
      saveLocalTestSource(id, source);
      triggerLocalFileChanged(id);
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
    if (isStandalone) {
      const ids = getLocalTestIds();
      if (ids.includes(id)) {
        return Promise.resolve({
          ok: false,
          status: 409,
          aborted: false,
          err: "file already exists",
        });
      }
      ids.push(id);
      saveLocalTestIds(ids);
      saveLocalTestSource(id, source);
      triggerLocalFileChanged(id);
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
    if (isStandalone) {
      localListeners.add(onEvent);
      return () => {
        localListeners.delete(onEvent);
      };
    }
    return subscribeEvents(onEvent);
  },

  async decodeFailure(
    encoded: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<FailurePayload>> {
    if (isStandalone) {
      try {
        const payload = await decodeFailurePayload(encoded);
        return { ok: true, status: 200, body: payload };
      } catch (e: any) {
        return {
          ok: false,
          status: 400,
          aborted: false,
          err: e.message || String(e),
        };
      }
    }
    const result = await request<FailurePayload>("/api/failure/decode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encoded }),
      signal,
    });
    if (!result.ok && !result.aborted) {
      // Fallback to client-side decompression if backend fails (e.g., HTTP 500/404)
      try {
        const payload = await decodeFailurePayload(encoded);
        return { ok: true, status: 200, body: payload };
      } catch (e: any) {
        return result; // return original backend error if fallback fails too
      }
    }
    return result;
  },

  async encodeFailure(payload: FailurePayload): Promise<string> {
    return encodeFailurePayload(payload);
  },
};

