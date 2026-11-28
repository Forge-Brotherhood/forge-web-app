import fs from "node:fs";
import path from "node:path";
import {
  AutoRenewStatus,
  Environment,
  OfferType,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";

/**
 * Apple's signed data (pricing-plan.md §7, §14): StoreKit transactions sent by the app, and App Store
 * Server Notifications V2. Verified against Apple's root certificates, committed in ./certs.
 */

export const PRODUCT_IDS = ["forge.Forge.plus.monthly", "forge.Forge.plus.annual"];

/**
 * Which of Apple's environments are accepted. Production needs APP_STORE_APP_ID. Sandbox is always
 * accepted: App Review and TestFlight buy in it. Xcode's local StoreKit testing is not signed by
 * Apple, so it is accepted only when APP_STORE_ALLOW_XCODE is on, and never on a production deploy.
 */
export function acceptedEnvironments(env: Record<string, string | undefined> = process.env): Environment[] {
  const accepted: Environment[] = [];
  if (env.APP_STORE_APP_ID) accepted.push(Environment.PRODUCTION);
  accepted.push(Environment.SANDBOX);
  if (env.APP_STORE_ALLOW_XCODE === "true" && env.VERCEL_ENV !== "production") accepted.push(Environment.XCODE);
  return accepted;
}

const CERT_DIR = path.join(process.cwd(), "src/lib/subscription/certs");
const CERT_FILES = ["AppleRootCA-G3.cer", "AppleRootCA-G2.cer", "AppleIncRootCertificate.cer"];

let verifiers: SignedDataVerifier[] | null = null;

const getVerifiers = (): SignedDataVerifier[] => {
  if (verifiers) return verifiers;
  const roots = CERT_FILES.map((f) => fs.readFileSync(path.join(CERT_DIR, f)));
  const bundleId = process.env.APP_STORE_BUNDLE_ID || "forge.Forge";
  const appAppleId = process.env.APP_STORE_APP_ID ? Number(process.env.APP_STORE_APP_ID) : undefined;
  verifiers = acceptedEnvironments().map((environment) => new SignedDataVerifier(roots, true, environment, bundleId, appAppleId));
  return verifiers;
};

/** The first accepted environment whose verifier takes it; each verifier rejects any other environment and bundle. */
async function verifyWithAny<T>(verify: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
  let lastError: unknown = new Error("No App Store environment is accepted");
  for (const v of getVerifiers()) {
    try {
      return await verify(v);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export const verifyTransaction = (jws: string): Promise<JWSTransactionDecodedPayload> => verifyWithAny((v) => v.verifyAndDecodeTransaction(jws));

export const verifyRenewalInfo = (jws: string): Promise<JWSRenewalInfoDecodedPayload> => verifyWithAny((v) => v.verifyAndDecodeRenewalInfo(jws));

export const verifyNotification = (jws: string): Promise<ResponseBodyV2DecodedPayload> => verifyWithAny((v) => v.verifyAndDecodeNotification(jws));

/** What one transaction says about the plan. `undefined` fields are not known from it and are left as they are. */
export type AppleFields = {
  source: "app_store";
  productId: string;
  originalTransactionId: string;
  environment: string | null;
  expiresAt: Date | null;
  isTrial: boolean;
  revokedAt: Date | null;
  willRenew: boolean | undefined;
  graceExpiresAt: Date | null | undefined;
};

const date = (ms: number | undefined): Date | null => (typeof ms === "number" ? new Date(ms) : null);

/**
 * A decoded transaction, and the renewal info when there is one (notifications carry it; the app's
 * sync does not), as the fields of the `Subscription` row. Used by the webhook and the sync alike.
 * The latest transaction of a subscription carries its expiry, whether it is the free introductory
 * offer, and any refund or revocation; the renewal info carries auto-renew and the grace period.
 */
export function subscriptionFromApple(transaction: JWSTransactionDecodedPayload, renewal: JWSRenewalInfoDecodedPayload | null): AppleFields {
  return {
    source: "app_store",
    productId: transaction.productId ?? "",
    originalTransactionId: transaction.originalTransactionId ?? "",
    environment: transaction.environment ?? null,
    expiresAt: date(transaction.expiresDate),
    isTrial: transaction.offerType === OfferType.INTRODUCTORY_OFFER,
    revokedAt: date(transaction.revocationDate),
    willRenew: renewal ? renewal.autoRenewStatus === AutoRenewStatus.ON : undefined,
    graceExpiresAt: renewal ? date(renewal.gracePeriodExpiresDate) : undefined,
  };
}

/**
 * An older transaction than the one stored (Apple's notifications can arrive out of order, and the
 * app's sync can race them) is not applied: it would move the expiry back.
 */
export const isOlderThanStored = (stored: { expiresAt: Date | null } | null, fields: AppleFields): boolean =>
  Boolean(stored?.expiresAt && fields.expiresAt && fields.expiresAt.getTime() < stored.expiresAt.getTime());
