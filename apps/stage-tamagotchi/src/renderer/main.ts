import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { startWithAccountStorage } from '@proj-airi/stage-ui/services/account-startup'

import { electronAccountCurrent } from '../shared/eventa'

// Application modules read account storage when they load. Fix the account before importing them.
// The main process owns the account of the whole app. A switch relaunches the app, so pages do not follow pointer changes.
void useElectronEventaInvoke(electronAccountCurrent)()
  .then(accountId => startWithAccountStorage(() => import('./bootstrap'), { accountId, followPointerChanges: false }))
