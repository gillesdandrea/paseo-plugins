import type { PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { API_KEY_ENV, type ApiKeyStore } from "./keychain";
import { BOB_PROVIDER_ID } from "./provider";

/**
 * Adds the Keychain key to Bob sessions. A key already in the session env (provider config) or in
 * the daemon's own environment wins, so the hook never overrides an explicit setting.
 */
export async function withBobApiKey(
  request: PluginSessionOpenRequest,
  store: ApiKeyStore,
  daemonEnv: NodeJS.ProcessEnv = process.env,
): Promise<PluginSessionOpenRequest | undefined> {
  if (request.provider !== BOB_PROVIDER_ID) return undefined;
  if (request.env[API_KEY_ENV] || daemonEnv[API_KEY_ENV]) return undefined;
  let key: string | undefined;
  try {
    key = await store.read();
  } catch (error) {
    // A locked or unreadable Keychain must not stop the agent: Bob falls back to its own login.
    console.error(`IBM Bob API key not read from the Keychain: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (!key) return undefined;
  return { ...request, env: { ...request.env, [API_KEY_ENV]: key } };
}
