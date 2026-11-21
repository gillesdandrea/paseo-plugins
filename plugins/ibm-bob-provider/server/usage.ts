import type {
  UsageAccount,
  UsageBalance,
  UsageReport,
  UsageScope,
  UsageSourceRegistration,
  UsageWindow,
} from "@getpaseo/plugin/server/usage";
import { z } from "zod";
import { API_KEY_ENV, type ApiKeyStore } from "./keychain";
import { BOB_PROVIDER_ID } from "./provider";

/** Only the us-east host is verified; instances report their own `region_domain`. */
export const PROFILE_URL = "https://api.us-east.bob.ibm.com/admin/v1/profile";

/** Names where the key lives; never the key itself. */
const inputSchema = z.object({ store: z.enum(["keychain", "daemon-env"]) });
type UsageInput = z.infer<typeof inputSchema>;

const profileSchema = z.object({
  instances: z.array(
    z.object({
      instance_id: z.string(),
      instance_name: z.string().nullish(),
      instance_status: z.string().nullish(),
      refresh_at: z.number().nullish(),
      plan_name: z.string().nullish(),
      teams: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().nullish(),
            usage: z.number().nullish(),
            budget_limit: z.number().nullish(),
          }),
        )
        .nullish(),
    }),
  ),
});
export type BobProfile = z.infer<typeof profileSchema>;

export type FetchProfile = (
  apiKey: string,
) => Promise<{ ok: true; profile: unknown } | { ok: false; status: number; message: string }>;

/** Paseo gives each fetch 20 seconds; stop the request before that. */
const FETCH_TIMEOUT_MS = 15_000;

const fetchProfile: FetchProfile = async (apiKey) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(PROFILE_URL, {
      headers: { Authorization: `apikey ${apiKey}`, Accept: "application/json" },
      // React Native and Node both declare AbortSignal; fetch here is Node's.
      signal: controller.signal as unknown as RequestInit["signal"],
    });
    if (response.ok) return { ok: true, profile: await response.json() };
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : response.statusText;
    return { ok: false, status: response.status, message };
  } finally {
    clearTimeout(timer);
  }
};

function safeId(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
}

function tone(usedPct: number | null): UsageWindow["tone"] {
  if (usedPct === null) return "default";
  if (usedPct >= 90) return "danger";
  if (usedPct >= 75) return "warning";
  return "ok";
}

/** One monthly window and one Bobcoin balance per team. Units are Bobcoins, not dollars. */
export function reportFromProfile(profile: BobProfile): UsageReport {
  const windows: UsageWindow[] = [];
  const balances: UsageBalance[] = [];
  const plans = new Set<string>();
  const instances = profile.instances.filter((instance) => instance.instance_status !== "inactive");
  const labelTeams = instances.length > 1 || instances.some((instance) => (instance.teams ?? []).length > 1);
  for (const instance of instances) {
    if (instance.plan_name) plans.add(instance.plan_name);
    const resetsAt = instance.refresh_at ? new Date(instance.refresh_at * 1000).toISOString() : null;
    for (const team of instance.teams ?? []) {
      const id = safeId(`${instance.instance_id}.${team.id}`);
      const used = team.usage ?? null;
      const limit = team.budget_limit ?? null;
      const usedPct = used !== null && limit !== null && limit > 0 ? Math.min(100, (used / limit) * 100) : null;
      const name = instance.instance_name ?? "Bob";
      const label = labelTeams ? `${name} · ${team.name ?? team.id}` : "Monthly budget";
      windows.push({
        id,
        label,
        shortLabel: "mo",
        summary: windows.length === 0,
        usedPct,
        remainingPct: usedPct === null ? null : 100 - usedPct,
        resetsAt,
        tone: tone(usedPct),
      });
      balances.push({
        id,
        label: `${label} (Bobcoins)`,
        used,
        limit,
        remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null,
        unit: "credits",
        resetsAt,
        tone: tone(usedPct),
      });
    }
  }
  if (windows.length === 0) {
    return { status: "unavailable", problem: { kind: "no_quota", detail: "No Bob team budget on this account" } };
  }
  const planLabel = [...plans].join(", ");
  return { status: "available", ...(planLabel ? { planLabel } : {}), windows, balances };
}

export function createBobUsageSource(
  store: ApiKeyStore,
  daemonEnv: NodeJS.ProcessEnv = process.env,
  getProfile: FetchProfile = fetchProfile,
): UsageSourceRegistration {
  async function keyFor(input: UsageInput): Promise<string | undefined> {
    return input.store === "keychain" ? store.read() : daemonEnv[API_KEY_ENV] || undefined;
  }

  async function accounts(scope: UsageScope): Promise<UsageAccount[]> {
    const daemonKey = daemonEnv[API_KEY_ENV] || undefined;
    const keychainKey = await store.read().catch(() => undefined);
    const keychain: UsageAccount = { key: "ibm-bob-keychain", label: "Keychain API key", harness: "IBM Bob", input: { store: "keychain" } };
    const daemon: UsageAccount = { key: "ibm-bob-daemon-env", label: "Daemon API key", harness: "IBM Bob", input: { store: "daemon-env" } };
    if (scope.kind === "global") {
      return [...(daemonKey ? [daemon] : []), ...(keychainKey ? [keychain] : [])];
    }
    if (scope.provider !== BOB_PROVIDER_ID) return [];
    // A session runs on the key in its env; match it to the store it came from.
    const sessionKey = scope.env[API_KEY_ENV];
    if (sessionKey && sessionKey === daemonKey) return [daemon];
    if (sessionKey && sessionKey === keychainKey) return [keychain];
    return [];
  }

  return {
    id: "ibm-bob",
    label: "IBM Bob",
    icon: "icon.svg",
    input: inputSchema,
    discover: accounts,
    async fetch(raw) {
      const key = await keyFor(inputSchema.parse(raw));
      if (!key) return { status: "error", error: `No ${API_KEY_ENV} is stored for this account` };
      try {
        const result = await getProfile(key);
        if (!result.ok) {
          if (result.status === 401 || result.status === 403) {
            // Only the us-east API is known, so a valid key for another region is rejected the same way.
            const refreshedBy =
              "Check the API key in the IBM Bob plugin settings. Usage is read from Bob's us-east API only, so keys for other regions are rejected too";
            return { status: "unavailable", problem: { kind: "rejected", status: result.status, refreshedBy } };
          }
          return { status: "error", error: `Bob profile request failed (${result.status}): ${result.message}` };
        }
        const profile = profileSchema.safeParse(result.profile);
        if (!profile.success) return { status: "error", error: "Bob profile response has an unexpected shape" };
        return reportFromProfile(profile.data);
      } catch (error) {
        return { status: "error", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
