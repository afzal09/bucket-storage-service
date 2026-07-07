/**
 * Resolved identity attached to a request once SignatureGuard verifies it.
 * Mirrors the shape AlaanPay's own JWT principal takes (id + tenant scoping)
 * so this maps cleanly onto @User('corporateId')-style patterns if this
 * service is ever run behind the same auth gateway.
 */
export interface Principal {
  ownerId: string;
  accessKeyId: string;
  isRoot?: boolean;
}
