import type { PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { describe, expect, it } from "vitest";
import type { ApiKeyStore } from "./keychain";
import { withBobApiKey } from "./session-env";

const store: ApiKeyStore = {
  supported: true,
  read: async () => "keychain-key",
  write: async () => {},
  remove: async () => {},
};

function request(provider: string, env: Record<string, string> = {}): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: null,
    provider,
    cwd: "/tmp",
    reason: "create",
    purpose: "interactive",
    title: null,
    background: false,
    labels: {},
    metadata: {},
    tools: [],
    env,
    mcpServers: {},
  };
}

describe("BOBSHELL_API_KEY session env", () => {
  it("adds the Keychain key to Bob sessions only", async () => {
    const bob = await withBobApiKey(request("bob", { KEEP: "1" }), store, {});
    expect(bob?.env).toEqual({ KEEP: "1", BOBSHELL_API_KEY: "keychain-key" });
    await expect(withBobApiKey(request("claude"), store, {})).resolves.toBeUndefined();
  });

  it("opens the session without a key when the Keychain cannot be read", async () => {
    const locked: ApiKeyStore = {
      ...store,
      read: async () => {
        throw new Error("User interaction is not allowed.");
      },
    };
    await expect(withBobApiKey(request("bob"), locked, {})).resolves.toBeUndefined();
  });

  it("never overrides a key from the provider env or the daemon env", async () => {
    await expect(withBobApiKey(request("bob", { BOBSHELL_API_KEY: "config-key" }), store, {})).resolves.toBeUndefined();
    await expect(withBobApiKey(request("bob"), store, { BOBSHELL_API_KEY: "daemon-key" })).resolves.toBeUndefined();
  });
});
