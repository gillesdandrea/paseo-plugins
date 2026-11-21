import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import type { ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { withContextUsage } from "./context";
import { createBobInstallation, type ProviderInstallation } from "./installation";
import { bobModel, withSessionModel } from "./model-label";

export const BOB_PROVIDER_ID = "bob";

export function createBobProvider(): ProviderRegistration & { installation: ProviderInstallation } {
  return withContextUsage(
    withSessionModel({
      ...runAcpProvider({
        id: BOB_PROVIDER_ID,
        label: "IBM Bob",
        description: "IBM Bob Shell through its local `bob acp` server",
        icon: "icon.svg",
        command: ["bob", "acp"],
        transformers: [bobModel],
      }),
      installation: createBobInstallation(),
    }),
  );
}
