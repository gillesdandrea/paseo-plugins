import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { terminalHooksStatus, terminalSettings } from "../shared/terminal";

const STATUS_KEY = ["ibm-bob", "terminal-hooks-status"];

export function TerminalSettings(_props: PluginSurfaceProps) {
  const settings = useSettings(terminalSettings);
  const getStatus = useRpc(terminalHooksStatus);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => getStatus({}) });
  const [saveError, setSaveError] = useState<string>();

  const ready = settings.status === "ready";
  const enabled = ready ? settings.values.bobHooks : false;

  const toggle = async (next: boolean) => {
    if (settings.status !== "ready") return;
    setSaveError(undefined);
    const saved = await settings.save({ ...settings.values, bobHooks: next }, settings.revision);
    if (!saved) setSaveError("Another app changed this setting at the same time. Try again.");
    // The daemon applies the change after the save; read the result back shortly after.
    setTimeout(() => void queryClient.invalidateQueries({ queryKey: STATUS_KEY }), 500);
  };

  const installed = status.data?.installed;
  const state =
    installed === undefined ? "Checking Bob's settings…" : installed ? "Installed in ~/.bob/settings/settings.json" : "Not installed";

  return (
    <SettingsSection title="Terminal agent hooks">
      <SettingsCard>
        <SettingsSwitch
          label="Bob terminal hooks"
          hint="Shows whether Bob in a Paseo terminal is running, needs input or has finished. Turning this on adds hooks to ~/.bob/settings/settings.json; turning it off removes them and leaves your other Bob hooks."
          value={enabled}
          disabled={!ready}
          onValueChange={(next) => void toggle(next)}
          error={saveError}
        />
        <SettingsRow label="Status" hint={state} error={status.data?.error ?? (status.error ? String(status.error) : undefined)} />
      </SettingsCard>
    </SettingsSection>
  );
}
