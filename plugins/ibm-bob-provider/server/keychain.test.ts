import { describe, expect, it } from "vitest";
import { createKeychainStore, type Run } from "./keychain";

type Call = { command: string; args: string[]; stdin?: string };

function fakeSecurity(code: number | null, stdout = "", stderr = "") {
  const calls: Call[] = [];
  const run: Run = async (command, args, stdin) => {
    calls.push({ command, args, stdin });
    return { code, stdout, stderr };
  };
  return { run, calls };
}

describe("Keychain API key store", () => {
  it("reads the key, and treats a missing item as no key", async () => {
    await expect(createKeychainStore(fakeSecurity(0, "secret-key-123\n").run, "darwin").read()).resolves.toBe(
      "secret-key-123",
    );
    await expect(createKeychainStore(fakeSecurity(44).run, "darwin").read()).resolves.toBeUndefined();
  });

  it("writes through `security -i` on stdin so the key is not in argv", async () => {
    const security = fakeSecurity(0);
    await createKeychainStore(security.run, "darwin").write("secret-key-123");
    const [call] = security.calls;
    expect(call?.args).toEqual(["-i"]);
    expect(call?.args.join(" ")).not.toContain("secret-key-123");
    expect(call?.stdin).toContain('-w "secret-key-123"');
  });

  it("rejects keys that could break out of the quoted command", async () => {
    const security = fakeSecurity(0);
    await expect(createKeychainStore(security.run, "darwin").write('abc" ; rm -rf ~ "')).rejects.toThrow(
      "must be 8 to 4096 characters",
    );
    expect(security.calls).toEqual([]);
  });

  it("is unsupported off macOS and points to the provider env", async () => {
    const store = createKeychainStore(fakeSecurity(0).run, "linux");
    expect(store.supported).toBe(false);
    await expect(store.read()).resolves.toBeUndefined();
    await expect(store.write("secret-key-123")).rejects.toThrow("agents.providers.bob.env");
  });
});
