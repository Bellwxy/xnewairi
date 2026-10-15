import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { AccountScope } from '@proj-airi/stage-shared/account-scope'
import { getAccountScope, initializeAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { app } from 'electron'
import { literal, object, parse, string } from 'valibot'

/** Device file. The main process owns the account of the whole app, and each renderer adopts it. */
const POINTER_FILE = 'account-current.json'
/** Device file. It records that the old shared files moved into `accounts/local`. */
const MIGRATION_FILE = 'account-migration-v1.json'

const pointerSchema = object({ accountId: string() })
const migrationSchema = object({ phase: literal('complete') })

/**
 * Entries under the user data directory that belong to the account.
 * Window layout, logs, IO traces, update settings and public model files stay shared.
 * Each config also has a `.bak` copy after a heal, and that copy moves with it.
 */
export const ACCOUNT_OWNED_ENTRIES = [
  'app-options.json',
  'artistry-options.json',
  'home-assistant-v1.json',
  'server-channel-config.json',
  'websocket-cert.pem',
  'websocket-key.pem',
  'websocket-ca-cert.pem',
  'websocket-ca-key.pem',
  'mcp.json',
  'extensions-v1.json',
  'extensions',
  'godot-stage',
  'computer-use',
] as const

function userDataPath(...segments: string[]) {
  return join(app.getPath('userData'), ...segments)
}

/**
 * Fixes the account of the main process for its whole life, then moves old shared files into `local` once.
 * Call it once at startup, after the single-instance guard and before any account config is read.
 * An invalid pointer file stops startup. It never selects another account.
 */
export function initializeMainAccount(): AccountScope {
  const pointerPath = userDataPath(POINTER_FILE)
  const pointer = existsSync(pointerPath) ? parse(pointerSchema, JSON.parse(readFileSync(pointerPath, 'utf-8'))).accountId : null
  const scope = initializeAccountScope(AccountScope.fromPointer(pointer).accountId)
  migrateMainAccountData()
  return scope
}

/**
 * Moves the old shared entries into `accounts/local`. Each move is one rename, so a crash leaves every entry in one place.
 * A later run moves the entries that remain. An entry in both places stops startup and keeps both copies.
 */
export function migrateMainAccountData(): void {
  // NOTICE:
  // Older clients wrote account settings, keys and imported files directly under the user data directory.
  // The account scope moved them to `accounts/<account>/`. Source: docs/ai/plans/account-data-isolation-spec.md.
  // Remove after upgrades from the shared-storage release are no longer supported.
  const markerPath = userDataPath(MIGRATION_FILE)
  if (existsSync(markerPath)) {
    parse(migrationSchema, JSON.parse(readFileSync(markerPath, 'utf-8')))
    return
  }

  const localRoot = userDataPath('accounts', new AccountScope('local').directoryName)
  for (const entry of ACCOUNT_OWNED_ENTRIES.flatMap(name => [name, `${name}.bak`])) {
    const source = userDataPath(entry)
    if (!existsSync(source))
      continue

    const destination = join(localRoot, entry)
    if (existsSync(destination))
      throw new Error(`Account migration found ${entry} in both the shared and the local directory`)

    mkdirSync(dirname(destination), { recursive: true })
    renameSync(source, destination)
  }

  writeFileAtomically(markerPath, JSON.stringify({ phase: 'complete' }))
}

/**
 * Resolves a path in the directory of the account that startup fixed.
 *
 * @example
 * accountDataPath('mcp.json') // <userData>/accounts/<account>/mcp.json
 */
export function accountDataPath(...segments: string[]): string {
  return userDataPath('accounts', getAccountScope().directoryName, ...segments)
}

/** Writes the account that the next start of the app uses. It does not change this process. */
export function writeMainAccountPointer(accountId: string): void {
  writeFileAtomically(userDataPath(POINTER_FILE), JSON.stringify({ accountId: new AccountScope(accountId).accountId }))
}

function writeFileAtomically(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, content)
  renameSync(temporaryPath, path)
}

/** IDs of the accounts that have files on this device. */
export function listMainAccountData(): string[] {
  const root = userDataPath('accounts')
  if (!existsSync(root))
    return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => AccountScope.fromDirectoryName(entry.name)?.accountId ?? [])
}

/** Deletes the files of another account. The running account keeps its files open, so it cannot delete itself. */
export function deleteMainAccountData(accountId: string): void {
  const scope = new AccountScope(accountId)
  if (scope.accountId === getAccountScope().accountId)
    throw new Error('The current account cannot delete its own data')
  rmSync(userDataPath('accounts', scope.directoryName), { recursive: true, force: true })
}
