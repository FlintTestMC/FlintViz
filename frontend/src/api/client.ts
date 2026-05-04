import type {
  ReplayResponse,
  TestDetail,
  TestSummary,
} from "./types";
import { subscribeEvents, type EventsListener } from "./events";

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, message?: string) {
    super(message ?? `HTTP ${status}: ${body || "(empty body)"}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  throw new ApiError(res.status, body);
}

function encodeId(id: string): string {
  return id.split("/").map(encodeURIComponent).join("/");
}

export const api = {
  async listTests(signal?: AbortSignal): Promise<TestSummary[]> {
    const res = await ensureOk(await fetch("/api/tests", { signal }));
    return (await res.json()) as TestSummary[];
  },

  async getTest(id: string, signal?: AbortSignal): Promise<TestDetail> {
    const res = await ensureOk(
      await fetch(`/api/tests/${encodeId(id)}`, { signal }),
    );
    return (await res.json()) as TestDetail;
  },

  async replay(source: string, signal?: AbortSignal): Promise<ReplayResponse> {
    const res = await fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: source,
      signal,
    });
    if (res.status === 413) {
      throw new ApiError(413, "", "replay body too large (max 1 MiB)");
    }
    await ensureOk(res);
    return (await res.json()) as ReplayResponse;
  },

  events(onEvent: EventsListener): () => void {
    return subscribeEvents(onEvent);
  },
};
