import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  type SettingsInputHandle,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiKeyClear, apiKeySave, apiKeyStatus } from "../shared/api-key";

const STATUS_KEY = ["ibm-bob", "api-key-status"];

type Status = { supported: boolean; stored: boolean; daemonEnv: boolean };

function describe(status: Status | undefined): string {
  if (!status) return "Checking the Keychain…";
  if (!status.supported) {
    return "The Keychain needs a macOS daemon. Set BOBSHELL_API_KEY under agents.providers.bob.env in the daemon's config.json instead.";
  }
  if (status.daemonEnv) return "The daemon environment sets BOBSHELL_API_KEY, which takes precedence over the Keychain.";
  if (status.stored) return "A key is stored in the macOS Keychain. New and reopened Bob sessions use it.";
  return "No key stored. Bob uses its own login unless a key is set.";
}

function message(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof Error ? error.message : String(error);
}

export function ApiKeySettings(_props: PluginSurfaceProps) {
  const queryClient = useQueryClient();
  const getStatus = useRpc(apiKeyStatus);
  const saveKey = useRpc(apiKeySave);
  const clearKey = useRpc(apiKeyClear);
  const input = useRef<SettingsInputHandle>(null);
  const [draft, setDraft] = useState("");

  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => getStatus({}) });
  const update = (next: Status) => queryClient.setQueryData(STATUS_KEY, next);
  const save = useMutation({
    mutationFn: (key: string) => saveKey({ key }),
    onSuccess: (next) => {
      update(next);
      input.current?.replaceText("");
      setDraft("");
    },
  });
  const clear = useMutation({ mutationFn: () => clearKey({}), onSuccess: update });

  const supported = status.data?.supported ?? false;
  const busy = save.isPending || clear.isPending;

  return (
    <SettingsSection title="API key">
      <SettingsCard>
        <SettingsRow label="Status" hint={describe(status.data)} error={message(status.error)} />
        <SettingsInput
          ref={input}
          label="BOBSHELL_API_KEY"
          hint="Stored in the daemon's macOS Keychain. It is never sent back to the app."
          placeholder={status.data?.stored ? "Enter a new key to replace the stored one" : "Paste your Bob API key"}
          secureTextEntry
          disabled={!supported || busy}
          onChangeText={setDraft}
          error={message(save.error)}
        />
        <SettingsAction
          label="Save key"
          actionLabel="Save"
          disabled={!supported || busy || draft.trim() === ""}
          onPress={() => save.mutate(draft.trim())}
        />
        <SettingsAction
          label="Remove stored key"
          actionLabel="Remove"
          error={message(clear.error)}
          disabled={!status.data?.stored || busy}
          onPress={() => clear.mutate()}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
