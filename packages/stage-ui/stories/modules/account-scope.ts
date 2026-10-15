import { initializeAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'

// Stories render stores without a host entry, so they use the signed-out account of the preview.
// Setup files import this module first, because stores read the account when they load.
initializeAccountScope('local')
