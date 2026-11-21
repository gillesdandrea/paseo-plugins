import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ApiKeySettings } from "./client/api-key-settings";
import { TerminalSettings } from "./client/terminal-settings";
import { terminalProfileEnsure } from "./shared/terminal";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({ id: "api-key", title: "API key", icon: "KeyRound", Component: ApiKeySettings });
  client.addSettingsScreen({ id: "terminal", title: "Terminal", icon: "SquareTerminal", Component: TerminalSettings });
  // Offers the IBM Bob terminal profile once per host; the daemon remembers it did.
  client.rpc(terminalProfileEnsure, {}).catch((error: unknown) => {
    console.error("IBM Bob terminal profile was not added", error);
  });
  return () => {};
}
