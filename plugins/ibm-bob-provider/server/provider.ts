import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import type { ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { withContextUsage } from "./context";
import { withFirstMessages } from "./first-message";
import { createBobInstallation, type ProviderInstallation } from "./installation";
import { bobModel, withSessionModel } from "./model-label";

export const BOB_PROVIDER_ID = "bob";

export function createBobProvider(): ProviderRegistration & { installation: ProviderInstallation } {
  return withContextUsage(
    withFirstMessages(
      withSessionModel({
        ...runAcpProvider({
          id: BOB_PROVIDER_ID,
          label: "IBM Bob",
          description: "IBM Bob Shell through its local `bob acp` server",
          icon: "icon.svg",
          command: ["bob", "acp"],
          // Bob replays a loaded session's history just after `session/load` returns, not before.
          // Without this wait, Paseo takes the replay for live output and drops the user messages,
          // so an imported session loses its prompts and its name.
          acpOptions: { loadReplayQuietPeriodMs: 200 },
          transformers: [bobModel],
        }),
        installation: createBobInstallation(),
      }),
    ),
  );
}
