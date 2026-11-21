import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const status = z.object({
  /** The daemon runs on macOS, so the Keychain is available. */
  supported: z.boolean(),
  /** A key is saved in the Keychain. The key itself never leaves the daemon. */
  stored: z.boolean(),
  /** The daemon's own environment sets BOBSHELL_API_KEY, which takes precedence. */
  daemonEnv: z.boolean(),
});

export const apiKeyStatus = defineRpc({
  name: "api-key.status",
  input: z.object({}),
  output: status,
});

export const apiKeySave = defineRpc({
  name: "api-key.save",
  input: z.object({ key: z.string().trim().min(1).max(4096) }),
  output: status,
});

export const apiKeyClear = defineRpc({
  name: "api-key.clear",
  input: z.object({}),
  output: status,
});
