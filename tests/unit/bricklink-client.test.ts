import { describe, expect, it } from "vitest";
import { BrickLinkClient } from "@/server/bricklink/client";
import { BrickLinkError } from "@/server/bricklink/errors";
import { createMockState, mockTransport } from "../fixtures/bricklink";

const creds = { consumerKey: "a", consumerSecret: "b", tokenValue: "c", tokenSecret: "d" };
const make = (state = createMockState(), credentials: typeof creds | null = creds) => ({
  state,
  client: new BrickLinkClient({
    baseUrl: "https://api.bricklink.com/api/store/v1",
    credentials,
    mode: "test",
    transport: mockTransport(state),
  }),
});

describe("BrickLinkClient", () => {
  it("fetches catalog items", async () => {
    const { client } = make();
    const item = await client.getItem("SET", "75192-1");
    expect(item.name).toContain("Millennium Falcon");
    expect(item.type).toBe("SET");
  });

  it("requests the sold price guide in CAD for each condition separately", async () => {
    const { client, state } = make();
    const n = await client.getPriceGuide({
      type: "SET",
      no: "75192-1",
      condition: "N",
      guideType: "sold",
    });
    const u = await client.getPriceGuide({
      type: "SET",
      no: "75192-1",
      condition: "U",
      guideType: "sold",
    });
    expect(n.new_or_used).toBe("N");
    expect(u.new_or_used).toBe("U");
    expect(n.qty_avg_price).toBeCloseTo(1123.4567);
    expect(u.qty_avg_price).toBeCloseTo(850.1);
    expect(n.currency_code).toBe("CAD");
    const q = new URL(state.calls[0]!.url).searchParams;
    expect(q.get("currency_code")).toBe("CAD");
    expect(q.get("guide_type")).toBe("sold");
    expect(q.get("new_or_used")).toBe("N");
    expect(state.calls[0]!.headers.Authorization).toMatch(/^OAuth /);
  });

  it("maps BrickLink errors to typed errors", async () => {
    const { client, state } = make();
    state.failNext.push(
      { metaCode: 401 },
      { metaCode: 404 },
      { status: 429 },
      { status: 503 },
      { body: "<html>", status: 200 },
      { throws: true },
      { body: JSON.stringify({ meta: { code: 200 }, data: { nope: 1 } }) },
    );
    const kinds: string[] = [];
    for (let i = 0; i < 7; i++) {
      try {
        await client.getItem("SET", "75192-1");
      } catch (e) {
        kinds.push((e as BrickLinkError).kind);
      }
    }
    expect(kinds).toEqual([
      "unauthorized",
      "not_found",
      "rate_limited",
      "unavailable",
      "bad_response",
      "network",
      "bad_response",
    ]);
  });

  it("refuses to run without credentials", async () => {
    const { client } = make(createMockState(), null);
    await expect(client.getItem("SET", "75192-1")).rejects.toMatchObject({
      kind: "not_configured",
    });
  });

  it("refuses a mock transport in production mode", () => {
    expect(
      () =>
        new BrickLinkClient({
          baseUrl: "https://x.test",
          credentials: creds,
          mode: "production",
          transport: mockTransport(createMockState()),
        }),
    ).toThrow(/production/);
  });

  it("reports every request for quota accounting and honors beforeRequest", async () => {
    const state = createMockState();
    const logs: unknown[] = [];
    let allowed = 1;
    const client = new BrickLinkClient({
      baseUrl: "https://api.bricklink.com/api/store/v1",
      credentials: creds,
      mode: "test",
      transport: mockTransport(state),
      onRequest: (e) => void logs.push(e),
      beforeRequest: async () => {
        if (allowed-- <= 0) throw new BrickLinkError("quota_exhausted", "budget");
      },
    });
    await client.getItem("SET", "75192-1");
    await expect(client.getItem("SET", "75192-1")).rejects.toMatchObject({
      kind: "quota_exhausted",
    });
    expect(logs).toHaveLength(1);
    expect(state.calls).toHaveLength(1);
  });
});
