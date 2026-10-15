import { initializeAccountScope } from './runtime'

// Vitest setup file. Application hosts fix the account in their entrypoint before stores load.
// Tests of consumers start in the `local` account. A test of another account uses `AccountScope` directly.
initializeAccountScope('local')
