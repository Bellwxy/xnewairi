import { brand } from '@proj-airi/stage-shared/brand'

/** Uses the customer policy for every UI locale. The policy server owns language selection. */
export function getAnalyticsPrivacyPolicyUrl(): string {
  return brand.privacyUrl
}
