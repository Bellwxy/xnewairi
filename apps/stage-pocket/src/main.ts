import { startWithAccountStorage } from '@proj-airi/stage-ui/services/account-startup'

// Application modules read account storage when they load. Fix the account before importing them.
void startWithAccountStorage(() => import('./bootstrap'))
