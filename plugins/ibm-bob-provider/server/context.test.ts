import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProviderConnection, ProviderEvent, ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { afterEach, describe, expect, it } from "vitest";
import { contextFromTask, createBobDbReader, withContextUsage } from "./context";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Bob context from a task row", () => {
  it("prefers the window Bob resolved and estimates 200k for the premium tier", () => {
    const env = '{"model":{"id":"premium-ide","contextWindow":270000}}';
    expect(contextFromTask({ costs: '{"contextTokens":40792}', env })).toEqual({ used: 40792, max: 270000 });
    expect(contextFromTask({ costs: '{"contextTokens":40792,"contextWindow":128000}', env: "{}" })).toEqual({
      used: 40792,
      max: 128000,
    });
    expect(contextFromTask({ costs: '{"contextTokens":40792}', env: '{"model":{"id":"premium"}}' })).toEqual({
      used: 40792,
      max: 200000,
    });
    expect(contextFromTask({ costs: '{"contextTokens":10}', env: '{"model":{"id":"standard"}}' })).toEqual({ used: 10 });
  });

  it("treats missing or malformed costs as no data", () => {
    expect(contextFromTask({ costs: null, env: null })).toBeUndefined();
    expect(contextFromTask({ costs: "not json", env: "{}" })).toBeUndefined();
  });

  it("reads a task from a Bob database read-only", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-bob-db-"));
    temporary.push(dir);
    const file = path.join(dir, "bob.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, costs TEXT, env TEXT)");
    db.prepare("INSERT INTO tasks VALUES (?, ?, ?)").run("task-1", '{"contextTokens":5}', '{"model":{"id":"premium"}}');
    db.close();
    const read = createBobDbReader(file);
    expect(read("task-1")).toEqual({ used: 5, max: 200000 });
    expect(read("missing")).toBeUndefined();
    expect(createBobDbReader(path.join(dir, "absent.db"))("task-1")).toBeUndefined();
  });
});

function fakeConnection() {
  let listener: ((event: ProviderEvent) => void) | undefined;
  const connection: ProviderConnection = {
    version: 1,
    capabilities: [],
    send: async () => {},
    onEvent(next) {
      listener = next;
      return () => (listener = undefined);
    },
    close: async () => {},
  };
  return { connection, push: (event: ProviderEvent) => listener?.(event) };
}

describe("context usage events", () => {
  it("reports Bob's count when a session opens and after each turn", async () => {
    const inner = fakeConnection();
    const registration = { connect: async () => inner.connection } as unknown as ProviderRegistration;
    const reads: string[] = [];
    const wrapped = withContextUsage(
      registration,
      (taskId) => {
        reads.push(taskId);
        return { used: 1000 * reads.length, max: 200000 };
      },
      0,
    );
    const connection = await wrapped.connect({} as never);
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

    inner.push({
      type: "session.opened",
      sessionId: "paseo-1",
      persistence: { version: 1, data: { sessionId: "bob-task-1" } },
    } as unknown as ProviderEvent);
    await settle();
    inner.push({ type: "session.turn", sessionId: "paseo-1", turnId: "t1", state: "started" } as ProviderEvent);
    inner.push({ type: "session.turn", sessionId: "paseo-1", turnId: "t1", state: "completed" } as ProviderEvent);
    await settle();

    expect(reads).toEqual(["bob-task-1", "bob-task-1"]);
    const usage = events.filter((event) => event.type === "session.usage");
    expect(usage).toEqual([
      { type: "session.usage", sessionId: "paseo-1", usage: { contextWindowUsedTokens: 1000, contextWindowMaxTokens: 200000 } },
      {
        type: "session.usage",
        sessionId: "paseo-1",
        turnId: "t1",
        usage: { contextWindowUsedTokens: 2000, contextWindowMaxTokens: 200000 },
      },
    ]);
    expect(events.filter((event) => event.type === "session.turn")).toHaveLength(2);
  });
});
