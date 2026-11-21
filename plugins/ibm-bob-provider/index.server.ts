import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyBobHooks, bobHooksInstalled, latestOnly } from "./server/bob-hooks";
import { API_KEY_ENV, createKeychainStore } from "./server/keychain";
import { createBobProvider } from "./server/provider";
import { withBobApiKey } from "./server/session-env";
import { ensureBobProfile } from "./server/terminal-profile";
import { createBobUsageSource } from "./server/usage";
import { apiKeyClear, apiKeySave, apiKeyStatus } from "./shared/api-key";
import { terminalHooksStatus, terminalProfileEnsure, terminalSettings } from "./shared/terminal";

export default function contribute(server: PluginServerContext) {
  const store = createKeychainStore();
  const status = async () => ({
    supported: store.supported,
    stored: (await store.read()) !== undefined,
    daemonEnv: Boolean(process.env[API_KEY_ENV]),
  });

  server.registerProvider(createBobProvider());
  server.registerUsageSource(createBobUsageSource(store));
  server.handle(apiKeyStatus, status);
  server.handle(apiKeySave, async ({ key }) => {
    await store.write(key);
    return status();
  });
  server.handle(apiKeyClear, async () => {
    await store.remove();
    return status();
  });
  const removeHook = server.addHook("agent.open.before", async ({ request }) => withBobApiKey(request, store));

  // Bob terminal hooks follow the plugin's host setting, one change at a time, latest value wins.
  let hooksError: string | undefined;
  const reportHooksError = (action: string, error: unknown) => {
    hooksError = error instanceof Error ? error.message : String(error);
    console.error(`Could not ${action} Bob terminal hooks: ${hooksError}`);
  };
  const reconcile = latestOnly(async (enabled: boolean) => {
    try {
      await applyBobHooks(enabled);
      hooksError = undefined;
    } catch (error) {
      reportHooksError(enabled ? "install" : "remove", error);
    }
  });
  const settings = server.registerSettings(terminalSettings);
  settings
    .read()
    .then((state) => (state.status === "ready" ? reconcile(state.values.bobHooks) : undefined))
    .catch((error: unknown) => reportHooksError("read the setting for", error));
  const unsubscribe = settings.subscribe((state) => (state.status === "ready" ? reconcile(state.values.bobHooks) : undefined));
  server.handle(terminalHooksStatus, async () => {
    try {
      return { installed: await bobHooksInstalled(), ...(hooksError ? { error: hooksError } : {}) };
    } catch (error) {
      return { installed: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  server.handle(terminalProfileEnsure, async (_input, { paseo }) => ({ changed: await ensureBobProfile(paseo.config) }));

  return () => {
    unsubscribe();
    removeHook();
  };
}
