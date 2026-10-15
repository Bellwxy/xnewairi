import { getAccountScope } from './runtime'

/**
 * Opens the OPFS directory of the account fixed at startup.
 * Imported display models live here. Public inference caches stay at the origin root.
 */
export async function getAccountOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const scope = getAccountScope()
  const origin = await navigator.storage.getDirectory()
  const accounts = await origin.getDirectoryHandle('accounts', { create: true })
  return await accounts.getDirectoryHandle(scope.directoryName, { create: true })
}
