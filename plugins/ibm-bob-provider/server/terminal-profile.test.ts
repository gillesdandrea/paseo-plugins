import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOB_TERMINAL_PROFILE,
  ensureBobProfile,
  profileMarkerPath,
  withBobProfile,
  withUpgradedBobProfile,
} from "./terminal-profile";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function markerFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-bob-profile-"));
  temporary.push(dir);
  return path.join(dir, "added");
}

function fakeConfig(terminalProfiles: unknown) {
  const patches: { terminalProfiles: unknown }[] = [];
  let current = terminalProfiles;
  const config = {
    get: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { requestId: "r", config: { terminalProfiles: current } };
    },
    patch: async (patch: { terminalProfiles: unknown }) => {
      patches.push(patch);
      current = patch.terminalProfiles;
      return { requestId: "r", config: {} };
    },
  };
  return { config: config as never, patches };
}

describe("IBM Bob terminal profile", () => {
  it("runs `bob chat -- <prompt>` and appends to Paseo's built-in or the user's list", () => {
    expect(BOB_TERMINAL_PROFILE.args).toEqual(["chat", "--", "{{{prompt}}}"]);
    expect(withBobProfile(null)?.map((profile) => profile.id)).toEqual(["claude", "codex", "opencode", "pi", "bob"]);
    expect(withBobProfile([{ id: "x", name: "X", command: "x" }])).toEqual([
      { id: "x", name: "X", command: "x" },
      BOB_TERMINAL_PROFILE,
    ]);
    expect(withBobProfile([BOB_TERMINAL_PROFILE])).toBeUndefined();
  });

  it("upgrades a Bob profile an earlier version wrote, but not one the user edited", () => {
    const earlier = { id: "bob", name: "IBM Bob", command: "bob", args: ["chat", "{{{prompt}}}"], icon: "bob" };
    expect(withUpgradedBobProfile([earlier])).toEqual([{ ...earlier, args: ["chat", "--", "{{{prompt}}}"] }]);
    expect(withUpgradedBobProfile([{ ...earlier, args: ["{{{prompt}}}"] }])?.[0]?.args).toEqual([
      "chat",
      "--",
      "{{{prompt}}}",
    ]);
    expect(withUpgradedBobProfile([{ ...earlier, args: ["chat", "--mode", "plan", "{{{prompt}}}"] }])).toBeUndefined();
    expect(withUpgradedBobProfile(null)).toBeUndefined();
  });

  it("adds the profile once, and not again after the user removes it", async () => {
    const marker = await markerFile();
    const first = fakeConfig(null);
    await expect(ensureBobProfile(first.config, marker)).resolves.toBe(true);
    expect(first.patches).toHaveLength(1);
    const later = fakeConfig([]);
    await expect(ensureBobProfile(later.config, marker)).resolves.toBe(false);
    expect(later.patches).toEqual([]);
  });

  it("upgrades an earlier profile even after the profile was offered", async () => {
    const marker = await markerFile();
    await ensureBobProfile(fakeConfig(null).config, marker);
    const earlier = fakeConfig([{ id: "bob", name: "IBM Bob", command: "bob", args: ["{{{prompt}}}"] }]);
    await expect(ensureBobProfile(earlier.config, marker)).resolves.toBe(true);
    expect(earlier.patches[0]?.terminalProfiles).toEqual([
      { id: "bob", name: "IBM Bob", command: "bob", args: ["chat", "--", "{{{prompt}}}"] },
    ]);
  });

  it("patches once when several apps ask at the same time", async () => {
    const marker = await markerFile();
    const shared = fakeConfig(null);
    await Promise.all([ensureBobProfile(shared.config, marker), ensureBobProfile(shared.config, marker)]);
    expect(shared.patches).toHaveLength(1);
  });

  it("keeps a separate marker per daemon home", () => {
    const home = os.homedir();
    expect(profileMarkerPath(undefined)).toBe(profileMarkerPath(path.join(home, ".paseo")));
    expect(profileMarkerPath("/srv/paseo-a")).not.toBe(profileMarkerPath("/srv/paseo-b"));
    expect(profileMarkerPath("/srv/paseo-a")).not.toBe(profileMarkerPath(undefined));
  });
});
