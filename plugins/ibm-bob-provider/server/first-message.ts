import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { ProviderEvent, ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { BOB_DB_PATH, loadSqlite, nativeSessionId } from "./context";

/**
 * Paseo's session search matches a session's title, prompt preview and folder name. `bob acp` lists
 * title and folder only, so a word from the first prompt finds nothing. Bob keeps each task's first
 * prompt in its own column, apart from the system prompt and the transcript, and this reports it as
 * the session description, which Paseo searches as the prompt preview.
 */

/** Returns the first prompt of each task found, keyed by task id. */
export type ReadFirstMessages = (taskIds: readonly string[]) => ReadonlyMap<string, string>;

/** The length Paseo keeps for ACP prompt previews. */
const PREVIEW_LENGTH = 160;

/** How long to wait while Bob holds a lock, so a write in progress does not drop the previews. */
const BUSY_TIMEOUT_MS = 200;

export function firstMessagePreview(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed.slice(0, PREVIEW_LENGTH) : undefined;
}

/** Opens Bob's database read-only for one query; a missing database or a schema change reads nothing. */
export function createFirstMessageReader(dbPath: string = BOB_DB_PATH): ReadFirstMessages {
  return (taskIds) => {
    const found = new Map<string, string>();
    if (taskIds.length === 0 || !existsSync(dbPath)) return found;
    const sqlite = loadSqlite();
    if (!sqlite) return found;
    let db: DatabaseSync | undefined;
    try {
      db = new sqlite.DatabaseSync(dbPath, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
      const rows = db
        .prepare("SELECT id, first_message FROM tasks WHERE id IN (SELECT value FROM json_each(?))")
        .all(JSON.stringify(taskIds)) as Array<{ id: unknown; first_message: unknown }>;
      for (const row of rows) {
        const preview = firstMessagePreview(row.first_message);
        if (typeof row.id === "string" && preview) found.set(row.id, preview);
      }
    } catch {
      // No previews, so search falls back to titles and folders.
    } finally {
      db?.close();
    }
    return found;
  };
}

function withPreviews(event: Extract<ProviderEvent, { type: "sessions" }>, read: ReadFirstMessages): ProviderEvent {
  const taskIds = event.sessions.flatMap((session) => nativeSessionId(session.persistence) ?? []);
  const previews = read(taskIds);
  if (previews.size === 0) return event;
  return {
    ...event,
    sessions: event.sessions.map((session) => {
      if (session.description) return session;
      const taskId = nativeSessionId(session.persistence);
      const preview = taskId ? previews.get(taskId) : undefined;
      return preview ? { ...session, description: preview } : session;
    }),
  };
}

/** Adds each listed Bob session's first prompt as its description. */
export function withFirstMessages<T extends ProviderRegistration>(
  registration: T,
  read: ReadFirstMessages = createFirstMessageReader(),
): T {
  return {
    ...registration,
    async connect(request) {
      const inner = await registration.connect(request);
      const listeners = new Set<(event: ProviderEvent) => void>();
      // One subscription, so each listing reads the database once however many listeners there are.
      const unsubscribe = inner.onEvent((event) => {
        const next = event.type === "sessions" ? withPreviews(event, read) : event;
        for (const listener of listeners) listener(next);
      });
      return {
        get version() {
          return inner.version;
        },
        get capabilities() {
          return inner.capabilities;
        },
        send: (input) => inner.send(input),
        onEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async close() {
          unsubscribe();
          listeners.clear();
          await inner.close();
        },
      };
    },
  };
}
