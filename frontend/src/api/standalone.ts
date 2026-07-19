import { newTestTemplate } from "../panels/newTestTemplate";
import type { EventsListener } from "./events";
import { decodeFailurePayload, encodeFailurePayload } from "./failurePayload";
import { localReplay } from "./localEngine";
import type {
  FailurePayload,
  ReplayResponse,
  TestDetail,
  TestSpec,
  TestSummary,
} from "./types";

const STANDALONE_TESTS_KEY = "flint_viz_standalone_tests";
const SOURCE_PREFIX = "flint_viz_test_source:";

let enabled = false;

export function setStandalone(val: boolean) {
  enabled = val;
}

export function isStandalone(): boolean {
  return enabled;
}

function getLocalTestIds(): string[] {
  try {
    const list = localStorage.getItem(STANDALONE_TESTS_KEY);
    if (list) return JSON.parse(list) as string[];
  } catch {
    // ignore
  }
  const defaultId = "basic_example.json";
  try {
    localStorage.setItem(STANDALONE_TESTS_KEY, JSON.stringify([defaultId]));
    localStorage.setItem(SOURCE_PREFIX + defaultId, newTestTemplate("basic_example"));
  } catch {
    // ignore
  }
  return [defaultId];
}

function saveLocalTestIds(ids: string[]) {
  try {
    localStorage.setItem(STANDALONE_TESTS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function getLocalTestSource(id: string): string {
  try {
    return localStorage.getItem(SOURCE_PREFIX + id) || "";
  } catch {
    return "";
  }
}

function saveLocalTestSource(id: string, source: string) {
  try {
    localStorage.setItem(SOURCE_PREFIX + id, source);
  } catch {
    // ignore
  }
}

const localListeners = new Set<EventsListener>();

function triggerLocalFileChanged(id: string) {
  for (const listener of localListeners) {
    try {
      listener({ id });
    } catch {
      // ignore
    }
  }
}

export function standaloneListTests(): TestSummary[] {
  const ids = getLocalTestIds();
  return ids.map((id) => {
    const source = getLocalTestSource(id);
    const name = id.replace(/\.json$/i, "");
    let tags: string[] = [];
    let parse_error: string | undefined;
    try {
      if (source) {
        const parsed = JSON.parse(source) as { tags?: string[] };
        tags = parsed.tags || [];
      }
    } catch (err) {
      parse_error = err instanceof Error ? err.message : String(err);
    }
    return {
      id,
      path: `local://${id}`,
      name,
      tags,
      parse_error,
    };
  });
}

export function standaloneGetTest(id: string): TestDetail {
  const source = getLocalTestSource(id);
  let spec: TestSpec | null = null;
  let parse_error: string | null = null;
  try {
    if (source) {
      spec = JSON.parse(source) as TestSpec;
    }
  } catch (err) {
    parse_error = err instanceof Error ? err.message : String(err);
  }
  return { id, source, spec, parse_error };
}

export function standaloneReplay(source: string): Promise<ReplayResponse> {
  return localReplay(source);
}

export function standaloneSaveTest(id: string, source: string): void {
  saveLocalTestSource(id, source);
  triggerLocalFileChanged(id);
}

export function standaloneCreateTest(
  id: string,
  source: string,
): { ok: true } | { ok: false; status: number; err: string } {
  const ids = getLocalTestIds();
  if (ids.includes(id)) {
    return { ok: false, status: 409, err: "file already exists" };
  }
  ids.push(id);
  saveLocalTestIds(ids);
  saveLocalTestSource(id, source);
  triggerLocalFileChanged(id);
  return { ok: true };
}

export function standaloneSubscribeEvents(onEvent: EventsListener): () => void {
  localListeners.add(onEvent);
  return () => {
    localListeners.delete(onEvent);
  };
}

export async function standaloneDecodeFailure(
  encoded: string,
): Promise<{ ok: true; body: FailurePayload } | { ok: false; err: string }> {
  try {
    const payload = await decodeFailurePayload(encoded);
    return { ok: true, body: payload };
  } catch (err) {
    return {
      ok: false,
      err: err instanceof Error ? err.message : String(err),
    };
  }
}

export function standaloneEncodeFailure(payload: FailurePayload): Promise<string> {
  return encodeFailurePayload(payload);
}
