import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { defineInvokeHandler } from '@moeru/eventa'
import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { app, session } from 'electron'

import { electronAccountCurrent, electronAccountDeleteData, electronAccountListData, electronAccountSwitch } from '../../../shared/eventa'
import { deleteMainAccountData, listMainAccountData, writeMainAccountPointer } from '../../libs/electron/account'
import { flushConfigWrites } from '../../libs/electron/persistence'

let relaunching = false

/**
 * Serves the account of this run, and relaunches the app into another account.
 * A relaunch restarts every main service, so no service keeps files of the previous account open.
 */
export function createAccountService(params: { context: ReturnType<typeof createContext>['context'] }) {
  defineInvokeHandler(params.context, electronAccountCurrent, () => getAccountScope().accountId)
  defineInvokeHandler(params.context, electronAccountListData, () => listMainAccountData())
  defineInvokeHandler(params.context, electronAccountDeleteData, ({ accountId }) => deleteMainAccountData(accountId))
  defineInvokeHandler(params.context, electronAccountSwitch, async ({ accountId }) => {
    if (relaunching || accountId === getAccountScope().accountId)
      return

    // The write validates the ID. An invalid ID throws here and leaves this run unchanged.
    writeMainAccountPointer(accountId)
    relaunching = true
    await flushConfigWrites()
    // Chromium writes localStorage to disk later. Flush it, so the last settings of this account survive the relaunch.
    session.defaultSession.flushStorageData()
    app.relaunch()
    app.quit()
  })
}
