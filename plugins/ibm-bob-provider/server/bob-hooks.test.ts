import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyBobHooks, BOB_HOOKS, bobHooksInstalled, hookCommand, latestOnly } from "./bob-hooks";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const userHooks = {
  theme: "dark",
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "shepr hook bob", timeout: 5 }] }],
    PreToolUse: [{ matcher: "^ask_followup_question$", hooks: [{ type: "command", command: "bob-herdr hook" }] }],
  },
};

async function settingsFile(content: unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-bob-hooks-"));
  temporary.push(dir);
  const file = path.join(dir, "settings.json");
  await writeFile(file, JSON.stringify(content, null, 2));
  return file;
}

const read = async (file: string) => JSON.parse(await readFile(file, "utf8"));

describe("Bob terminal hooks", () => {
  it("adds Paseo-tagged hooks beside the user's own, once", async () => {
    const file = await settingsFile(userHooks);
    await applyBobHooks(true, file);
    await applyBobHooks(true, file);
    const settings = await read(file);
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("shepr hook bob");
    expect(settings.hooks.Stop[1].hooks[0].command).toBe(hookCommand({ event: "Stop", paseo: ["claude", "Stop"] }));
    expect(settings.hooks.PermissionRequest[0].hooks[0].command).toContain("hooks codex PermissionRequest");
    await expect(bobHooksInstalled(file)).resolves.toBe(true);
  });

  it("removes only its own hooks when turned off", async () => {
    const file = await settingsFile(userHooks);
    await applyBobHooks(true, file);
    await applyBobHooks(false, file);
    await expect(read(file)).resolves.toEqual(userHooks);
    await expect(bobHooksInstalled(file)).resolves.toBe(false);
  });

  it("runs only inside a Paseo terminal, through Paseo's hook command", () => {
    for (const hook of BOB_HOOKS) {
      expect(hookCommand(hook)).toMatch(/^if \[ -n "\$PASEO_TERMINAL_ID" \]; then "\$\{PASEO_HOOK_CLI:-paseo\}" hooks (claude|codex) \w+; fi # paseo-ibm-bob-hook$/);
    }
  });

  it("writes through a symlinked settings file and keeps its permissions", async () => {
    const target = await settingsFile(userHooks);
    await chmod(target, 0o600);
    const link = path.join(path.dirname(target), "link.json");
    await symlink(target, link);
    await applyBobHooks(true, link);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    await expect(bobHooksInstalled(target)).resolves.toBe(true);
  });

  it("restores a settings file's original mode after writing it owner-only", async () => {
    const file = await settingsFile(userHooks);
    await chmod(file, 0o644);
    await applyBobHooks(true, file);
    expect((await stat(file)).mode & 0o777).toBe(0o644);
  });

  it("applies only the latest value when changes pile up, one at a time", async () => {
    const applied: boolean[] = [];
    let active = 0;
    const reconcile = latestOnly(async (value: boolean) => {
      active += 1;
      expect(active).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      applied.push(value);
      active -= 1;
    });
    await Promise.all([reconcile(true), reconcile(false), reconcile(true), reconcile(false)]);
    expect(applied).toEqual([true, false]);
  });

  it("leaves a settings file it cannot parse untouched", async () => {
    const file = await settingsFile({});
    await writeFile(file, "{ not json");
    await expect(applyBobHooks(true, file)).rejects.toThrow();
    await expect(readFile(file, "utf8")).resolves.toBe("{ not json");
  });
});
