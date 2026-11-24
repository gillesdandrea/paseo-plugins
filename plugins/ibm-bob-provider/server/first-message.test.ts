import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProviderConnection, ProviderEvent, ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFirstMessageReader, firstMessagePreview, withFirstMessages } from "./first-message";

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("first message preview", () => {
  it("collapses whitespace and keeps 160 characters", () => {
    expect(firstMessagePreview("Explain me the ToU:\n\n1.  Preamble ")).toBe("Explain me the ToU: 1. Preamble");
    expect(firstMessagePreview("x".repeat(300))).toHaveLength(160);
    expect(firstMessagePreview("  \n ")).toBeUndefined();
    expect(firstMessagePreview(null)).toBeUndefined();
  });

  async function bobDb() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-bob-db-"));
    temporary.push(dir);
    const file = path.join(dir, "bob.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, first_message TEXT)");
    const insert = db.prepare("INSERT INTO tasks VALUES (?, ?)");
    insert.run("task-1", "Explain me the ToU");
    insert.run("task-2", null);
    insert.run("task-3", "not asked for");
    db.close();
    return { dir, file };
  }

  it("reads first messages from a Bob database", async () => {
    const { dir, file } = await bobDb();
    const read = createFirstMessageReader(file);
    expect([...read(["task-1", "task-2", "missing"])]).toEqual([["task-1", "Explain me the ToU"]]);
    expect(read([]).size).toBe(0);
    expect(createFirstMessageReader(path.join(dir, "absent.db"))(["task-1"]).size).toBe(0);
  });

  it("opens Bob's database read-only and waits briefly for Bob's locks", async () => {
    const { file } = await bobDb();
    const sqlite = process.getBuiltinModule("node:sqlite");
    const getBuiltinModule = process.getBuiltinModule.bind(process);
    const opened: unknown[] = [];
    class RecordingDatabase extends sqlite.DatabaseSync {
      constructor(location: string, options?: ConstructorParameters<typeof DatabaseSync>[1]) {
        opened.push(options);
        super(location, options);
      }
    }
    vi.spyOn(process, "getBuiltinModule").mockImplementation(((id: string) =>
      id === "node:sqlite" ? { ...sqlite, DatabaseSync: RecordingDatabase } : getBuiltinModule(id)) as never);
    expect(createFirstMessageReader(file)(["task-1"]).size).toBe(1);
    expect(opened).toEqual([{ readOnly: true, timeout: 200 }]);
  });

  it("reads nothing when the table has another shape", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-bob-db-"));
    temporary.push(dir);
    const file = path.join(dir, "bob.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY)");
    db.close();
    expect(createFirstMessageReader(file)(["task-1"]).size).toBe(0);
  });
});

describe("session listing", () => {
  it("adds the first message as the description of listed sessions", async () => {
    let push: ((event: ProviderEvent) => void) | undefined;
    const inner: ProviderConnection = {
      version: 1,
      capabilities: [],
      send: async () => {},
      onEvent(listener) {
        push = listener;
        return () => (push = undefined);
      },
      close: async () => {},
    };
    const registration = { connect: async () => inner } as unknown as ProviderRegistration;
    const asked: string[][] = [];
    const wrapped = withFirstMessages(registration, (taskIds) => {
      asked.push([...taskIds]);
      return new Map([
        ["bob-1", "Explain me the ToU"],
        ["bob-2", "ignored"],
      ]);
    });
    const connection = await wrapped.connect({} as never);
    const events: ProviderEvent[] = [];
    const second: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    connection.onEvent((event) => second.push(event));

    const session = (id: string, extra: object = {}) => ({
      persistence: { version: 1, data: { sessionId: id } },
      cwd: "/repo",
      title: `Task ${id}`,
      ...extra,
    });
    push?.({
      type: "sessions",
      requestId: "r1",
      sessions: [session("bob-1"), session("bob-2", { description: "from Bob" }), session("bob-3")],
    });
    push?.({ type: "request.completed", requestId: "r1" });

    expect(asked).toEqual([["bob-1", "bob-2", "bob-3"]]);
    expect(events).toEqual([
      {
        type: "sessions",
        requestId: "r1",
        sessions: [
          session("bob-1", { description: "Explain me the ToU" }),
          session("bob-2", { description: "from Bob" }),
          session("bob-3"),
        ],
      },
      { type: "request.completed", requestId: "r1" },
    ]);
    // Both listeners get the same listing from a single database read.
    expect(second).toEqual(events);
  });
});
