import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Paseo's terminal-agent hooks know Claude, Codex and OpenCode only. Bob Shell runs the same kind of
 * command hooks, so these call Paseo's own `paseo hooks` command with the Claude or Codex event that
 * means the same thing. They do nothing outside a Paseo terminal.
 */

export const BOB_SETTINGS_PATH = path.join(os.homedir(), ".bob", "settings", "settings.json");

/** Ends every command this plugin installs, so it only ever removes its own hooks. */
const MARKER = "# paseo-ibm-bob-hook";
const TIMEOUT_SECONDS = 5;

interface BobHook {
  /** The Bob event. */
  event: string;
  matcher?: string;
  /** The Paseo hook provider and event whose activity mapping fits. */
  paseo: ["claude" | "codex", string];
}

const QUESTION_TOOL = "^ask_followup_question$";

export const BOB_HOOKS: readonly BobHook[] = [
  { event: "UserPromptSubmit", paseo: ["claude", "UserPromptSubmit"] }, // running
  { event: "PermissionRequest", paseo: ["codex", "PermissionRequest"] }, // needs input
  { event: "PermissionResolved", paseo: ["codex", "PostToolUse"] }, // running
  { event: "PreToolUse", matcher: QUESTION_TOOL, paseo: ["codex", "PermissionRequest"] }, // Bob asks: needs input
  { event: "PostToolUse", matcher: QUESTION_TOOL, paseo: ["codex", "PostToolUse"] }, // answered: running
  { event: "Stop", paseo: ["claude", "Stop"] }, // idle, finished
  { event: "SessionEnd", paseo: ["claude", "SessionEnd"] }, // idle
];

export function hookCommand(hook: BobHook): string {
  const [agent, event] = hook.paseo;
  return `if [ -n "$PASEO_TERMINAL_ID" ]; then "\${PASEO_HOOK_CLI:-paseo}" hooks ${agent} ${event}; fi ${MARKER}`;
}

type HookCommand = { type?: string; command?: string; [key: string]: unknown };
type HookEntry = { matcher?: string; hooks?: HookCommand[]; [key: string]: unknown };
type Settings = { hooks?: Record<string, HookEntry[]>; [key: string]: unknown };

const isOurs = (command: HookCommand) => typeof command.command === "string" && command.command.includes(MARKER);

/** Removes this plugin's commands, and only the entries and events that held nothing else. */
export function withoutBobHooks(settings: Settings): Settings {
  if (!settings.hooks) return settings;
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) {
      hooks[event] = entries;
      continue;
    }
    const kept = entries.flatMap((entry) => {
      if (!Array.isArray(entry.hooks) || !entry.hooks.some(isOurs)) return [entry];
      const rest = entry.hooks.filter((command) => !isOurs(command));
      return rest.length > 0 ? [{ ...entry, hooks: rest }] : [];
    });
    if (kept.length > 0 || entries.length === 0) hooks[event] = kept;
  }
  return { ...settings, hooks };
}

export function withBobHooks(settings: Settings): Settings {
  const clean = withoutBobHooks(settings);
  const hooks: Record<string, HookEntry[]> = { ...(clean.hooks ?? {}) };
  for (const hook of BOB_HOOKS) {
    const entry: HookEntry = {
      ...(hook.matcher ? { matcher: hook.matcher } : {}),
      hooks: [{ type: "command", command: hookCommand(hook), timeout: TIMEOUT_SECONDS }],
    };
    hooks[hook.event] = [...(hooks[hook.event] ?? []), entry];
  }
  return { ...clean, hooks };
}

export function hasBobHooks(settings: Settings): boolean {
  const commands = Object.values(settings.hooks ?? {})
    .flatMap((entries) => (Array.isArray(entries) ? entries : []))
    .flatMap((entry) => entry.hooks ?? [])
    .filter(isOurs)
    .map((command) => command.command);
  return BOB_HOOKS.every((hook) => commands.includes(hookCommand(hook)));
}

async function readSettings(file: string): Promise<{ settings: Settings; indent: string }> {
  if (!existsSync(file)) return { settings: {}, indent: "  " };
  const text = await readFile(file, "utf8");
  // Refuse to rewrite a file Bob could not read either, rather than lose its content.
  const settings = JSON.parse(text) as unknown;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`${file} is not a JSON object`);
  }
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  return { settings: settings as Settings, indent };
}

/**
 * Replaces the file atomically. A symlinked settings file is written through to its target, and the
 * file keeps its permissions.
 */
async function writeSettings(file: string, settings: Settings, indent: string): Promise<void> {
  const target = existsSync(file) ? await realpath(file) : file;
  await mkdir(path.dirname(target), { recursive: true });
  const mode = existsSync(target) ? (await stat(target)).mode & 0o777 : undefined;
  const temporary = `${target}.paseo-${process.pid}-${randomUUID()}.tmp`;
  try {
    // Owner-only from creation, so a private file's content is never readable by others mid-write.
    await writeFile(temporary, `${JSON.stringify(settings, null, indent)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Runs `apply` one call at a time and, when calls pile up, only for the latest value. A quick on then
 * off therefore ends with the hooks off.
 */
export function latestOnly<T>(apply: (value: T) => Promise<void>): (value: T) => Promise<void> {
  let pending: { value: T } | undefined;
  let running: Promise<void> | undefined;
  return (value) => {
    pending = { value };
    running ??= (async () => {
      try {
        while (pending) {
          const next = pending.value;
          pending = undefined;
          await apply(next);
        }
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
}

/** Installs or removes the hooks so Bob's settings match `enabled`. Writes only when they differ. */
export async function applyBobHooks(enabled: boolean, file: string = BOB_SETTINGS_PATH): Promise<boolean> {
  const { settings, indent } = await readSettings(file);
  const installed = hasBobHooks(settings);
  if (enabled && !installed) await writeSettings(file, withBobHooks(settings), indent);
  if (!enabled && JSON.stringify(withoutBobHooks(settings)) !== JSON.stringify(settings)) {
    await writeSettings(file, withoutBobHooks(settings), indent);
  }
  return enabled;
}

export async function bobHooksInstalled(file: string = BOB_SETTINGS_PATH): Promise<boolean> {
  return hasBobHooks((await readSettings(file)).settings);
}
