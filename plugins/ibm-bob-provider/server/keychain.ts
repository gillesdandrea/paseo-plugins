import { spawn } from "node:child_process";

export const API_KEY_ENV = "BOBSHELL_API_KEY";

const SERVICE = "paseo-ibm-bob-provider";
const ACCOUNT = API_KEY_ENV;
/** `security` exits with 44 when the item does not exist. */
const ITEM_NOT_FOUND = 44;
/** Keys pass through `security -i` inside double quotes, so they exclude quotes and backslashes. */
const KEY_PATTERN = /^[A-Za-z0-9._~+/=:-]{8,4096}$/;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type Run = (command: string, args: string[], stdin?: string) => Promise<RunResult>;

export interface ApiKeyStore {
  /** False when the daemon is not on macOS. */
  readonly supported: boolean;
  read(): Promise<string | undefined>;
  write(key: string): Promise<void>;
  remove(): Promise<void>;
}

const runProcess: Run = (command, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });

function failure(action: string, result: RunResult): Error {
  const reason = result.stderr.trim() || `exit code ${result.code}`;
  return new Error(`Could not ${action} the Keychain item: ${reason}`);
}

export function isValidApiKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * Keeps BOBSHELL_API_KEY in the macOS login Keychain. Writes go through `security -i` on stdin so
 * the key never appears in a process argument list.
 */
export function createKeychainStore(
  run: Run = runProcess,
  platform: NodeJS.Platform = process.platform,
): ApiKeyStore {
  const supported = platform === "darwin";
  const unsupported = () =>
    new Error(
      `The Keychain needs a macOS daemon. Set ${API_KEY_ENV} under agents.providers.bob.env in the daemon's config.json instead.`,
    );
  return {
    supported,
    async read() {
      if (!supported) return undefined;
      const result = await run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      if (result.code === ITEM_NOT_FOUND) return undefined;
      if (result.code !== 0) throw failure("read", result);
      return result.stdout.trim() || undefined;
    },
    async write(key) {
      if (!supported) throw unsupported();
      if (!isValidApiKey(key)) throw new Error("The API key has unexpected characters or length.");
      const command = `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -l "IBM Bob API key (Paseo)" -w "${key}"\n`;
      const result = await run("security", ["-i"], command);
      if (result.code !== 0 || result.stderr.trim()) throw failure("save", result);
    },
    async remove() {
      if (!supported) return;
      const result = await run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
      if (result.code !== 0 && result.code !== ITEM_NOT_FOUND) throw failure("remove", result);
    },
  };
}
