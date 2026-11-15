export type BrickLinkErrorKind =
  | "not_configured"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "quota_exhausted"
  | "unavailable"
  | "invalid_request"
  | "bad_response"
  | "network";

export class BrickLinkError extends Error {
  constructor(
    public readonly kind: BrickLinkErrorKind,
    message: string,
    public readonly httpStatus?: number,
    public readonly bricklinkCode?: number,
  ) {
    super(message);
    this.name = "BrickLinkError";
  }

  /** Whether retrying later (with backoff) can succeed. */
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "unavailable" || this.kind === "network";
  }
}
