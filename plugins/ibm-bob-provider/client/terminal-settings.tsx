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
    if (!saved) setSaveError("The setting changed elsewhere. Try again.");
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
          hint="Shows running, needs-input and finished status for Bob running in a Paseo terminal. Adds hooks to Bob's settings and removes them when turned off; your other Bob hooks stay as they are."
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
