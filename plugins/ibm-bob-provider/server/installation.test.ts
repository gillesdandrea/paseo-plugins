import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBobInstallation, type ProviderInstallationLaunch } from "./installation";

const temporary: string[] = [];
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A `bob` that records its arguments and prints Bob Shell's two-line `--version` banner. */
async function fakeBob() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-bob-"));
  temporary.push(dir);
  const script = path.join(dir, "bob.mjs");
  const record = path.join(dir, "args.json");
  await writeFile(
    script,
    [
      `import { writeFileSync } from "node:fs";`,
      `writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));`,
      `console.log("2.1.0\\ncommit: 8afc0007b");`,
    ].join("\n"),
  );
  const launch: ProviderInstallationLaunch = {
    command: process.execPath,
    args: [script, "acp", "--debug"],
    env: {},
    resolved: true,
  };
  return { launch, args: async () => JSON.parse(await readFile(record, "utf8")) as string[] };
}

describe("IBM Bob installation", () => {
  it("reads the version from the launch without `acp` and its arguments", async () => {
    const bob = await fakeBob();
    await expect(createBobInstallation().inspect!({ launch: bob.launch, signal })).resolves.toEqual({
      status: "installed",
      version: "2.1.0",
    });
    expect(await bob.args()).toEqual(["--version"]);
  });

  it("is not installed when the executable does not resolve", async () => {
    const launch = { command: "bob", args: ["acp"], env: {}, resolved: false };
    await expect(createBobInstallation().inspect!({ launch, signal })).resolves.toEqual({
      status: "not_installed",
    });
  });

  it("links Bob Shell's install page for install and update", () => {
    const installation = createBobInstallation();
    expect(installation.installUrl).toBe("https://bob.ibm.com/docs/shell/getting-started/install-and-setup");
    expect(installation.updateUrl).toBe(installation.installUrl);
  });
});
