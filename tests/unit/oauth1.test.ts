import { describe, expect, it } from "vitest";
import { buildSignatureBaseString, percentEncode, signRequest } from "@/server/bricklink/oauth1";

describe("OAuth 1.0a signing", () => {
  it("percent-encodes per RFC 3986", () => {
    expect(percentEncode("Ladies + Gentlemen")).toBe("Ladies%20%2B%20Gentlemen");
    expect(percentEncode("An encoded string!")).toBe("An%20encoded%20string%21");
    expect(percentEncode("Dogs, Cats & Mice")).toBe("Dogs%2C%20Cats%20%26%20Mice");
    expect(percentEncode("☃")).toBe("%E2%98%83");
  });

  it("matches the published HMAC-SHA1 reference example", () => {
    // Widely used OAuth 1.0a reference vector (signature "tnnArxj06cWHq44gCs1OSKk/jLY=").
    const url = "https://api.twitter.com/1/statuses/update.json?include_entities=true";
    const { signature } = signRequest({
      method: "POST",
      url,
      credentials: {
        consumerKey: "xvz1evFS4wEEPTGEFPHBog",
        consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        tokenValue: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      extraParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      timestamp: 1318622958,
    });
    expect(signature).toBe("tnnArxj06cWHq44gCs1OSKk/jLY=");
  });

  it("includes query parameters in the base string and builds a header", () => {
    const base = buildSignatureBaseString("get", "https://api.bricklink.com/api/store/v1/items/SET/75192-1/price?guide_type=sold", [
      ["guide_type", "sold"],
      ["oauth_nonce", "n"],
    ]);
    expect(base).toBe("GET&https%3A%2F%2Fapi.bricklink.com%2Fapi%2Fstore%2Fv1%2Fitems%2FSET%2F75192-1%2Fprice&guide_type%3Dsold%26oauth_nonce%3Dn");
    const { header } = signRequest({
      method: "GET",
      url: "https://api.bricklink.com/api/store/v1/items/SET/75192-1",
      credentials: { consumerKey: "ck", consumerSecret: "SECRET-CONSUMER-VALUE", tokenValue: "tv", tokenSecret: "SECRET-TOKEN-VALUE" },
    });
    expect(header).toMatch(/^OAuth oauth_consumer_key="ck", .*oauth_signature_method="HMAC-SHA1".*oauth_token="tv".*oauth_signature="/);
    expect(header).not.toContain("SECRET-");
  });
});
