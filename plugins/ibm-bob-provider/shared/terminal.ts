import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Host-wide: hooks live in the daemon machine's Bob settings. */
export const terminalSettings = defineSettings({
  id: "terminal",
  scope: "host",
  version: 1,
  schema: z.object({ bobHooks: z.boolean().default(false) }),
});

export const terminalHooksStatus = defineRpc({
  name: "terminal-hooks.status",
  input: z.object({}),
  output: z.object({ installed: z.boolean(), error: z.string().optional() }),
});

export const terminalProfileEnsure = defineRpc({
  name: "terminal-profile.ensure",
  input: z.object({}),
  output: z.object({ changed: z.boolean() }),
});
