import type { ProviderConnection, ProviderEvent, ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { describe, expect, it } from "vitest";
import { BOB_MODEL, bobModel, withBobModel, withSessionModel } from "./model-label";

const context = { sessionId: "s1", config: { read: async () => ({}), set: async () => {} } };

describe("IBM Bob model", () => {
  it("reports one IBM Bob model when Bob reports none, and keeps several as reported", () => {
    expect(withBobModel({ models: [] }).models).toEqual([BOB_MODEL]);
    expect(withBobModel({ models: [{ id: "x", label: "Default" }] }).models).toEqual([{ id: "x", label: "IBM Bob" }]);
    const tiers = { models: [{ id: "premium", label: "Premium" }, { id: "standard", label: "Standard" }] };
    expect(withBobModel(tiers)).toBe(tiers);
  });

  it("lists the model in the catalog as the default and treats selecting it as done", async () => {
    const catalog = await bobModel.discover!({ models: [], modes: [] }, context);
    expect(catalog).toMatchObject({ models: [BOB_MODEL], defaultModel: "ibm-bob" });
    await expect(bobModel.configure!({ target: "model", value: "ibm-bob" }, context)).resolves.toBe("handled");
    await expect(bobModel.configure!({ target: "mode", value: "plan" }, context)).resolves.toBe("pass");
  });

  it("selects the model in session config events and passes other events through", async () => {
    let push: ((event: ProviderEvent) => void) | undefined;
    const inner: ProviderConnection = {
      version: 1,
      capabilities: [],
      send: async () => {},
      onEvent(listener) {
        push = listener;
        return () => {};
      },
      close: async () => {},
    };
    const registration = { connect: async () => inner } as unknown as ProviderRegistration;
    const connection = await withSessionModel(registration).connect({} as never);
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));

    push?.({ type: "session.config", sessionId: "s1", config: { models: [], modes: [], thinkingOptions: [] } } as ProviderEvent);
    const turn = { type: "session.turn", sessionId: "s1", turnId: "t1", state: "started" } as ProviderEvent;
    push?.(turn);

    expect(events[0]).toMatchObject({ config: { model: "ibm-bob", models: [BOB_MODEL] } });
    expect(events[1]).toBe(turn);
  });
});
