import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";

type TerminalProfile = { id: string; name: string; command: string; args?: string[]; icon?: string };

const PROMPT = "{{{prompt}}}";

/**
 * `bob chat` opens Bob's interactive UI with the prompt. Bare `bob <prompt>` would run a subcommand
 * when the prompt starts with one, such as "run …", and `--` keeps a prompt that starts with "-"
 * from being read as an option. The icon resolves to this plugin's provider icon.
 */
export const BOB_TERMINAL_PROFILE: TerminalProfile = {
  id: "bob",
  name: "IBM Bob",
  command: "bob",
  args: ["chat", "--", PROMPT],
  icon: "bob",
};

/** Arguments earlier versions of this plugin wrote. Only these exact, unedited forms are upgraded. */
const EARLIER_ARGS: readonly (readonly string[])[] = [[PROMPT], ["chat", PROMPT]];

/** Paseo's built-in list, used while the daemon config has none of its own (Paseo 0.16). */
const DEFAULT_TERMINAL_PROFILES: readonly TerminalProfile[] = [
  { id: "claude", name: "Claude Code", command: "claude", args: [PROMPT], icon: "claude" },
  { id: "codex", name: "Codex", command: "codex", args: [PROMPT], icon: "codex" },
  { id: "opencode", name: "OpenCode", command: "opencode", args: [`--prompt=${PROMPT}`], icon: "opencode" },
  { id: "pi", name: "Pi", command: "pi", args: [PROMPT], icon: "pi" },
];

/**
 * Records that the profile was offered once on a daemon, so a profile the user removes stays removed.
 * Each daemon home gets its own marker; the default home keeps the original file name.
 */
export function profileMarkerPath(home: string | undefined = process.env.PASEO_HOME): string {
  const dir = path.join(os.homedir(), ".config", "paseo-plugins", "ibm-bob-provider");
  const resolved = home ? path.resolve(home) : undefined;
  if (!resolved || resolved === path.join(os.homedir(), ".paseo")) return path.join(dir, "terminal-profile-added");
  const key = createHash("sha256").update(resolved).digest("hex").slice(0, 12);
  return path.join(dir, `terminal-profile-added-${key}`);
}

const sameArgs = (left: readonly string[] | undefined, right: readonly string[]) =>
  left !== undefined && left.length === right.length && left.every((arg, index) => arg === right[index]);

/** Upgrades a Bob profile an earlier version wrote; returns undefined when there is none to upgrade. */
export function withUpgradedBobProfile(
  profiles: readonly TerminalProfile[] | null | undefined,
): TerminalProfile[] | undefined {
  if (!profiles) return undefined;
  const index = profiles.findIndex(
    (profile) =>
      profile.id === BOB_TERMINAL_PROFILE.id &&
      profile.command === BOB_TERMINAL_PROFILE.command &&
      EARLIER_ARGS.some((args) => sameArgs(profile.args, args)),
  );
  if (index === -1) return undefined;
  return profiles.map((profile, at) => (at === index ? { ...profile, args: [...BOB_TERMINAL_PROFILE.args!] } : profile));
}

export function withBobProfile(profiles: readonly TerminalProfile[] | null | undefined): TerminalProfile[] | undefined {
  const current = profiles ?? DEFAULT_TERMINAL_PROFILES;
  if (current.some((profile) => profile.id === BOB_TERMINAL_PROFILE.id)) return undefined;
  return [...current, BOB_TERMINAL_PROFILE];
}

type ConfigApi = Pick<PaseoApi["config"], "get" | "patch">;

async function ensure(config: ConfigApi, marker: string): Promise<boolean> {
  const offered = existsSync(marker);
  const { config: current } = await config.get();
  const profiles = (current as { terminalProfiles?: TerminalProfile[] | null }).terminalProfiles;
  let next = withUpgradedBobProfile(profiles);
  if (!offered) next = withBobProfile(next ?? profiles) ?? next;
  if (next) await config.patch({ terminalProfiles: next } as Parameters<ConfigApi["patch"]>[0]);
  if (!offered) {
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, `${new Date().toISOString()}\n`, "utf8");
  }
  return next !== undefined;
}

// Every connecting app asks; one at a time, so two apps never patch the profile list together.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Adds the IBM Bob terminal profile the first time only, and upgrades one an earlier version added.
 * Returns whether it changed the profiles.
 */
export function ensureBobProfile(config: ConfigApi, marker: string = profileMarkerPath()): Promise<boolean> {
  const run = queue.then(() => ensure(config, marker));
  queue = run.catch(() => undefined);
  return run;
}
