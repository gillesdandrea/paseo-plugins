import type { AcpTransformer } from "@getpaseo/plugin/server/acp";
import type { ProviderModel, ProviderRegistration } from "@getpaseo/plugin/server/provider";

/**
 * `bob acp` reports no model: its sessions have no model config option, because Bob picks the real
 * model behind a tier on its side. Paseo then lists 0 models and shows a placeholder "Default".
 * Report one model named after the provider instead. Selecting it changes nothing in Bob.
 */
export const BOB_MODEL: ProviderModel = { id: "ibm-bob", label: "IBM Bob", isDefault: true };

/** Fills an empty model list, and names a lone model "IBM Bob". Several models stay as reported. */
export function withBobModel<T extends { models: readonly ProviderModel[] }>(state: T): T {
  if (state.models.length === 0) return { ...state, models: [BOB_MODEL] };
  if (state.models.length === 1) {
    return { ...state, models: state.models.map((model) => ({ ...model, label: BOB_MODEL.label })) };
  }
  return state;
}

/** Model pickers and the provider diagnostic read the catalog. */
export const bobModel: AcpTransformer = {
  discover(catalog) {
    const next = withBobModel(catalog);
    return next.models[0] === BOB_MODEL ? { ...next, defaultModel: BOB_MODEL.id } : next;
  },
  // Bob has nothing to switch, so choosing the reported model is already done.
  async configure(change) {
    return change.target === "model" && change.value === BOB_MODEL.id ? "handled" : "pass";
  },
};

/** The composer's model control reads each session's config. */
export function withSessionModel<T extends ProviderRegistration>(registration: T): T {
  return {
    ...registration,
    async connect(request) {
      const inner = await registration.connect(request);
      return {
        get version() {
          return inner.version;
        },
        get capabilities() {
          return inner.capabilities;
        },
        send: (input) => inner.send(input),
        close: () => inner.close(),
        onEvent: (listener) =>
          inner.onEvent((event) => {
            if (event.type !== "session.config") return listener(event);
            const config = withBobModel(event.config);
            const model = config.models[0] === BOB_MODEL ? (config.model ?? BOB_MODEL.id) : config.model;
            listener({ ...event, config: { ...config, model } });
          }),
      };
    },
  };
}
