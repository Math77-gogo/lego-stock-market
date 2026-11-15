import { createHmac, randomBytes } from "node:crypto";

/** RFC 3986 percent-encoding as required by OAuth 1.0a (RFC 5849 §3.6). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface OAuthCredentials {
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
}

export interface SignInput {
  method: string;
  url: string; // may include a query string
  credentials: OAuthCredentials;
  extraParams?: Record<string, string>; // form body params, if any
  nonce?: string;
  timestamp?: number;
}

export function buildSignatureBaseString(
  method: string,
  url: string,
  params: [string, string][],
): string {
  const u = new URL(url);
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const normalized = params
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return [method.toUpperCase(), percentEncode(baseUrl), percentEncode(normalized)].join("&");
}

/** Returns the value for the `Authorization` header (OAuth 1.0a, HMAC-SHA1). */
export function signRequest(input: SignInput): { header: string; signature: string } {
  const { method, url, credentials } = input;
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: input.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: credentials.tokenValue,
    oauth_version: "1.0",
  };
  const u = new URL(url);
  const params: [string, string][] = [
    ...Object.entries(oauth),
    ...Array.from(u.searchParams.entries()),
    ...Object.entries(input.extraParams ?? {}),
  ];
  const base = buildSignatureBaseString(method, url, params);
  const key = `${percentEncode(credentials.consumerSecret)}&${percentEncode(credentials.tokenSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  const header =
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
      .join(", ");
  return { header, signature };
}
