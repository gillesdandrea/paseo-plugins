import { execCommand } from "@getpaseo/plugin/server";

// Paseo 0.17 adds these types to `@getpaseo/plugin/server/provider`. Until that SDK is published,
// they mirror the documented contract; Paseo 0.16 ignores `installation`.
export interface ProviderInstallationLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  resolved: boolean;
}

export type ProviderInspection = { status: "installed"; version?: string } | { status: "not_installed" };

export interface ProviderInstallation {
  installUrl?: string;
  updateUrl?: string;
  inspect?(context: {
    launch?: ProviderInstallationLaunch;
    signal: AbortSignal;
  }): Promise<ProviderInspection>;
}

/** Bob Shell's install page also covers upgrading; the CLI has no self-update command. */
const INSTALL_URL = "https://bob.ibm.com/docs/shell/getting-started/install-and-setup";

/**
 * Sessions run `bob acp` plus any configured arguments. The version comes from the part of the
 * launch before `acp`, so `npx @ibm/bob acp` reads `npx @ibm/bob --version`.
 */
async function readVersion(
  launch: ProviderInstallationLaunch,
  signal: AbortSignal,
): Promise<string | undefined> {
  const acp = launch.args.indexOf("acp");
  const args = acp === -1 ? launch.args : launch.args.slice(0, acp);
  const { stdout } = await execCommand(launch.command, [...args, "--version"], {
    env: launch.env,
    timeout: 5000,
    maxBuffer: 8192,
    signal,
  });
  const firstLine = stdout.trim().split("\n")[0]?.trim();
  return /\b\d+\.\d+\.\d+\S*/.exec(stdout)?.[0] ?? (firstLine || undefined);
}

export function createBobInstallation(): ProviderInstallation {
  return {
    installUrl: INSTALL_URL,
    updateUrl: INSTALL_URL,
    async inspect({ launch, signal }) {
      if (!launch?.resolved) return { status: "not_installed" };
      const version = await readVersion(launch, signal);
      return version ? { status: "installed", version } : { status: "installed" };
    },
  };
}
