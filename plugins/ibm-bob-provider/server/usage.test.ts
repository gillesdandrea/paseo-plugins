import { describe, expect, it } from "vitest";
import type { ApiKeyStore } from "./keychain";
import { createBobUsageSource, type FetchProfile } from "./usage";

const store: ApiKeyStore = {
  supported: true,
  read: async () => "keychain-key",
  write: async () => {},
  remove: async () => {},
};

/** The redacted shape of a real GET /admin/v1/profile response. */
const profile = {
  user_id: "someone@example.com",
  instances: [
    {
      instance_id: "inst-1",
      instance_name: "Example Org",
      instance_status: "active",
      refresh_at: 1796083200,
      plan_name: "Example plan",
      teams: [{ id: "team-1", name: "default", usage: 900, budget_limit: 1200 }],
    },
  ],
};

function source(result: Awaited<ReturnType<FetchProfile>>, seen: string[] = []) {
  return createBobUsageSource(store, {}, async (key) => {
    seen.push(key);
    return result;
  });
}

describe("IBM Bob usage source", () => {
  it("maps a team budget to a monthly window and a Bobcoin balance", async () => {
    const seen: string[] = [];
    const report = await source({ ok: true, profile }, seen).fetch({ store: "keychain" });
    expect(seen).toEqual(["keychain-key"]);
    expect(report).toMatchObject({
      status: "available",
      planLabel: "Example plan",
      windows: [{ label: "Monthly budget", summary: true, resetsAt: "2026-12-01T00:00:00.000Z", tone: "warning" }],
      balances: [{ used: 900, limit: 1200, unit: "credits" }],
    });
    if (report.status !== "available") throw new Error("expected available");
    expect(report.windows[0]?.usedPct).toBe(75);
    expect(report.balances?.[0]?.remaining).toBe(300);
  });

  it("reports a rejected key so the user can save a new one", async () => {
    await expect(
      source({ ok: false, status: 401, message: "Invalid or expired API Key" }).fetch({ store: "keychain" }),
    ).resolves.toMatchObject({ status: "unavailable", problem: { kind: "rejected", status: 401 } });
  });

  it("finds the Keychain account globally and for Bob sessions that run on it", async () => {
    const usage = source({ ok: true, profile });
    await expect(usage.discover({ kind: "global" })).resolves.toMatchObject([{ input: { store: "keychain" } }]);
    await expect(
      usage.discover({ kind: "session", provider: "bob", env: { BOBSHELL_API_KEY: "keychain-key" } }),
    ).resolves.toMatchObject([{ key: "ibm-bob-keychain" }]);
    await expect(usage.discover({ kind: "session", provider: "codex", env: {} })).resolves.toEqual([]);
  });
});
