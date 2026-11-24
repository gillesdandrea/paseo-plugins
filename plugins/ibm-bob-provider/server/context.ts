import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  ProviderConnection,
  ProviderEvent,
  ProviderPersistence,
  ProviderRegistration,
} from "@getpaseo/plugin/server/provider";

/**
 * `bob acp` sends no ACP `usage_update`, so Paseo has no context data for Bob sessions. Bob does
 * keep a running count per task in its own SQLite database, and the ACP session id is the Bob task
 * id. This reads that count after each turn and reports it to Paseo.
 */

export interface BobContext {
  used: number;
  max?: number;
}

/** Returns undefined when the task, the database or the fields are missing. */
export type ReadContext = (taskId: string) => BobContext | undefined;

/**
 * Bob reads the real window from its model gateway at runtime and stores it with the task. Older
 * tasks may lack it; those that store one on the premium tier show 200000, so that is the estimate.
 */
const PREMIUM_CONTEXT_WINDOW = 200_000;

export const BOB_DB_PATH = path.join(os.homedir(), ".bob", "db", "bob.db");

function parseObject(text: unknown): Record<string, unknown> | undefined {
  if (typeof text !== "string") return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function contextFromTask(row: { costs: unknown; env: unknown }): BobContext | undefined {
  const costs = parseObject(row.costs);
  const used = positive(costs?.contextTokens);
  if (used === undefined) return undefined;
  const rawModel = parseObject(row.env)?.model;
  const model = rawModel && typeof rawModel === "object" ? (rawModel as Record<string, unknown>) : undefined;
  // Bob Shell records the window it resolved in env.model; the IDE records it in costs.
  const stored = positive(model?.contextWindow) || positive(costs?.contextWindow);
  const tier = model?.id;
  const max = stored || (typeof tier === "string" && tier.startsWith("premium") ? PREMIUM_CONTEXT_WINDOW : undefined);
  return max ? { used, max } : { used };
}

/**
 * Loads `node:sqlite` only when needed, so a Node without it (before 22.5, or 22.12 and earlier
 * without the flag) leaves the context and the search previews empty instead of failing the whole
 * plugin.
 */
export function loadSqlite(): typeof import("node:sqlite") | undefined {
  try {
    return process.getBuiltinModule?.("node:sqlite");
  } catch {
    return undefined;
  }
}

/** Opens Bob's database read-only for one short query, so Bob's WAL checkpoints are never held up. */
export function createBobDbReader(dbPath: string = BOB_DB_PATH): ReadContext {
  return (taskId) => {
    if (!existsSync(dbPath)) return undefined;
    const sqlite = loadSqlite();
    if (!sqlite) return undefined;
    let db: DatabaseSync | undefined;
    try {
      db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare("SELECT costs, env FROM tasks WHERE id = ?").get(taskId) as
        | { costs: unknown; env: unknown }
        | undefined;
      return row ? contextFromTask(row) : undefined;
    } catch {
      // A schema change in a later Bob version means no context data, not a broken provider.
      return undefined;
    } finally {
      db?.close();
    }
  };
}

export function nativeSessionId(persistence: ProviderPersistence | undefined): string | undefined {
  const data = persistence?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const id = (data as Record<string, unknown>).sessionId;
  return typeof id === "string" && id ? id : undefined;
}

/** Bob saves the task's costs as the turn ends; read a moment later so the count includes it. */
const READ_DELAY_MS = 300;

function withContext(inner: ProviderConnection, read: ReadContext, delayMs: number): ProviderConnection {
  const tasks = new Map<string, string>();
  const listeners = new Set<(event: ProviderEvent) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const emit = (event: ProviderEvent) => {
    for (const listener of listeners) listener(event);
  };

  const report = (sessionId: string, turnId?: string) => {
    const taskId = tasks.get(sessionId);
    if (!taskId) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      const context = read(taskId);
      if (!context) return;
      emit({
        type: "session.usage",
        sessionId,
        ...(turnId ? { turnId } : {}),
        usage: {
          contextWindowUsedTokens: context.used,
          ...(context.max ? { contextWindowMaxTokens: context.max } : {}),
        },
      });
    }, delayMs);
    timers.add(timer);
  };

  const remember = (sessionId: string, persistence: ProviderPersistence | undefined) => {
    const taskId = nativeSessionId(persistence);
    if (taskId) tasks.set(sessionId, taskId);
  };

  const unsubscribe = inner.onEvent((event) => {
    emit(event);
    if (event.type === "session.opened") {
      remember(event.sessionId, event.persistence);
      report(event.sessionId);
    } else if (event.type === "session.persistence") {
      remember(event.sessionId, event.persistence);
    } else if (event.type === "session.turn" && event.state !== "started") {
      report(event.sessionId, event.turnId);
    }
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
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
      await inner.close();
    },
  };
}

/** Adds Bob's context-window usage to every connection the registration opens. */
export function withContextUsage<T extends ProviderRegistration>(
  registration: T,
  read: ReadContext = createBobDbReader(),
  delayMs: number = READ_DELAY_MS,
): T {
  return {
    ...registration,
    async connect(request) {
      return withContext(await registration.connect(request), read, delayMs);
    },
  };
}
