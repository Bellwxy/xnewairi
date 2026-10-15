import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = { root: '' }

vi.mock('electron', () => ({
  app: { getPath: () => userData.root },
}))

const { accountDataPath, deleteMainAccountData, initializeMainAccount, listMainAccountData, migrateMainAccountData, writeMainAccountPointer } = await import('./account')

function write(path: string, content = 'value') {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  userData.root = mkdtempSync(join(tmpdir(), 'airi-account-'))
})

afterEach(() => {
  rmSync(userData.root, { recursive: true, force: true })
})

describe('main account data', () => {
  it('moves account files into local and keeps device files shared', () => {
    write(join(userData.root, 'artistry-options.json'), 'keys')
    write(join(userData.root, 'artistry-options.json.bak'), 'old keys')
    write(join(userData.root, 'extensions', 'v1', 'plugin', 'manifest.json'), 'plugin')
    write(join(userData.root, 'app-config.json'), 'window layout')
    write(join(userData.root, 'logs', 'today.log'), 'log')

    migrateMainAccountData()

    const local = join(userData.root, 'accounts', 'local')
    expect(readFileSync(join(local, 'artistry-options.json'), 'utf-8')).toBe('keys')
    expect(readFileSync(join(local, 'artistry-options.json.bak'), 'utf-8')).toBe('old keys')
    expect(readFileSync(join(local, 'extensions', 'v1', 'plugin', 'manifest.json'), 'utf-8')).toBe('plugin')
    expect(existsSync(join(userData.root, 'artistry-options.json'))).toBe(false)
    expect(readFileSync(join(userData.root, 'app-config.json'), 'utf-8')).toBe('window layout')
    expect(existsSync(join(userData.root, 'logs', 'today.log'))).toBe(true)
  })

  it('does not move files again after the migration completed', () => {
    migrateMainAccountData()
    write(join(userData.root, 'mcp.json'), 'written by an old client')

    migrateMainAccountData()

    expect(existsSync(join(userData.root, 'mcp.json'))).toBe(true)
    expect(existsSync(join(userData.root, 'accounts', 'local', 'mcp.json'))).toBe(false)
  })

  it('stops and keeps both copies when a file exists in both places', () => {
    write(join(userData.root, 'mcp.json'), 'shared')
    write(join(userData.root, 'accounts', 'local', 'mcp.json'), 'local')

    expect(() => migrateMainAccountData()).toThrow('both')

    expect(readFileSync(join(userData.root, 'mcp.json'), 'utf-8')).toBe('shared')
    expect(readFileSync(join(userData.root, 'accounts', 'local', 'mcp.json'), 'utf-8')).toBe('local')
    expect(existsSync(join(userData.root, 'account-migration-v1.json'))).toBe(false)
  })

  it('resumes a migration that stopped between two moves', () => {
    write(join(userData.root, 'accounts', 'local', 'artistry-options.json'), 'moved before the crash')
    write(join(userData.root, 'mcp.json'), 'not moved yet')

    migrateMainAccountData()

    expect(readFileSync(join(userData.root, 'accounts', 'local', 'mcp.json'), 'utf-8')).toBe('not moved yet')
    expect(readFileSync(join(userData.root, 'accounts', 'local', 'artistry-options.json'), 'utf-8')).toBe('moved before the crash')
  })

  it('reads the pointer that a switch wrote and resolves account paths', () => {
    // The shared test setup fixed `local` for this runtime. Another account needs a new process.
    writeMainAccountPointer('local')

    expect(initializeMainAccount().accountId).toBe('local')
    expect(accountDataPath('mcp.json')).toBe(join(userData.root, 'accounts', 'local', 'mcp.json'))
  })

  it('writes an encoded account ID and rejects an invalid one', () => {
    writeMainAccountPointer('user/1')
    expect(JSON.parse(readFileSync(join(userData.root, 'account-current.json'), 'utf-8'))).toEqual({ accountId: 'user/1' })

    expect(() => writeMainAccountPointer('..')).toThrow('Invalid account')
    expect(JSON.parse(readFileSync(join(userData.root, 'account-current.json'), 'utf-8'))).toEqual({ accountId: 'user/1' })
  })

  it('stops startup on a damaged pointer file instead of selecting local', () => {
    write(join(userData.root, 'account-current.json'), '{"account":"alice"}')

    expect(() => initializeMainAccount()).toThrow()
  })

  it('lists account directories and deletes another account only', () => {
    write(join(userData.root, 'accounts', 'local', 'mcp.json'))
    write(join(userData.root, 'accounts', 'user%2F1', 'mcp.json'))
    // A name that the account scope would not create, such as an unencoded space, is not an account.
    write(join(userData.root, 'accounts', 'a b', 'mcp.json'))

    expect(listMainAccountData().toSorted()).toEqual(['local', 'user/1'])

    deleteMainAccountData('user/1')
    expect(existsSync(join(userData.root, 'accounts', 'user%2F1'))).toBe(false)
    expect(() => deleteMainAccountData('local')).toThrow('current account')
    expect(existsSync(join(userData.root, 'accounts', 'local', 'mcp.json'))).toBe(true)
  })
})
