import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { number, object } from 'valibot'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @example
 * describe('createConfig', () => {
 *   it('persists configuration data', async () => {
 *     // assertions
 *   })
 * })
 */
describe('createConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  // https://github.com/moeru-ai/airi/commit/d2d5493136af4614798546c674d5707618429ca6
  //
  // ROOT CAUSE:
  //
  // If concurrent save calls share one temporary file path, one rename removes the file first.
  // A second rename attempt then fails with ENOENT and the save path logs an error.
  //
  // We fixed this by asserting each save operation writes and renames a distinct temp file path.
  it('uses a unique temp file per save to avoid concurrent rename collisions', async () => {
    const appMock = {
      getPath: vi.fn(() => join(tmpdir(), 'airi-user-data')),
    }
    const mkdirMock = vi.fn(async () => {})
    const existingTempFiles = new Set<string>()
    const renameMock = vi.fn(async (from: string) => {
      if (!existingTempFiles.has(from)) {
        const error = new Error(`ENOENT: no such file or directory, rename '${from}'`) as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      existingTempFiles.delete(from)
    })
    const writeCoordinator = {
      calls: 0,
      waitFor: Promise.resolve(),
      release: () => {},
    }
    const writeFileMock = vi.fn(async (path: string) => {
      existingTempFiles.add(path)
      writeCoordinator.calls += 1
      if (writeCoordinator.calls === 2) {
        writeCoordinator.release()
      }
      await writeCoordinator.waitFor
    })

    writeCoordinator.waitFor = new Promise<void>((resolve) => {
      writeCoordinator.release = resolve
    })

    vi.doMock('electron', () => ({
      app: appMock,
    }))
    vi.doMock('es-toolkit', () => ({
      throttle: (handler: (...args: unknown[]) => unknown) => handler,
    }))
    vi.doMock('node:fs', () => ({
      existsSync: () => false,
      readFileSync: () => '',
    }))
    vi.doMock('node:fs/promises', () => ({
      copyFile: vi.fn(async () => {}),
      mkdir: mkdirMock,
      rename: renameMock,
      writeFile: writeFileMock,
    }))

    const { createConfig } = await import('./persistence')
    const schema = object({ value: number() })
    const config = createConfig('windows-widgets', 'config.json', schema, { owner: 'device', default: { value: 0 } })
    const saveErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    config.setup()
    config.update({ value: 1 })
    config.update({ value: 2 })

    /**
     * @example
     * expect(renameMock).toHaveBeenCalledTimes(2)
     * expect(saveErrorSpy).not.toHaveBeenCalledWith('Failed to save config', expect.anything())
     * expect(new Set(renameMock.mock.calls.map(([from]) => from)).size).toBe(2)
     */
    await vi.waitFor(() => {
      expect(renameMock).toHaveBeenCalledTimes(2)
    })

    expect(saveErrorSpy).not.toHaveBeenCalledWith('Failed to save config', expect.anything())
    expect(new Set(renameMock.mock.calls.map(([from]) => from)).size).toBe(2)
    saveErrorSpy.mockRestore()
  })

  // https://github.com/moeru-ai/airi/actions/runs/38099469838/job/114352217426

  // ROOT CAUSE:
  //
  // `save` is throttled and `update` does not await it, and it read
  // `app.getPath('userData')` while it ran. A write that a case scheduled
  // therefore landed in the root the next case had already created.
  //
  // It now reaches the root its own config read from.
  it('writes a deferred save to the root its own config read from', async () => {
    const files = new Map<string, string>()
    const rootA = join(tmpdir(), 'airi-user-data-a')
    const rootB = join(tmpdir(), 'airi-user-data-b')
    const fileOf = (root: string) => join(root, 'app-options.json')
    const appMock = { getPath: vi.fn(() => rootA) }
    let runPendingSave: (() => unknown) | undefined

    vi.doMock('electron', () => ({
      app: appMock,
    }))
    // Hold the throttled write, so the test can run it after the root moved.
    vi.doMock('es-toolkit', () => ({
      throttle: (handler: () => unknown) => () => {
        runPendingSave = handler
      },
    }))
    vi.doMock('node:fs', () => ({
      existsSync: (path: string) => files.has(path),
      readFileSync: (path: string) => files.get(path),
    }))
    vi.doMock('node:fs/promises', () => ({
      copyFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      rename: vi.fn(async (from: string, to: string) => {
        files.set(to, files.get(from) ?? '')
        files.delete(from)
      }),
      writeFile: vi.fn(async (path: string, body: string) => {
        files.set(path, body)
      }),
    }))

    const { createConfig } = await import('./persistence')
    const schema = object({ value: number() })

    const first = createConfig('app', 'options.json', schema, { owner: 'device', default: { value: 0 } })
    first.setup()
    first.update({ value: 7 })
    const deferredSave = runPendingSave
    if (!deferredSave) {
      throw new Error('Expected the throttled write.')
    }

    // The root moves before that write runs, the way each case of the extension
    // host suite receives its own directory.
    appMock.getPath.mockReturnValue(rootB)
    await deferredSave()

    // The write reached the root its config read from, and the other root holds
    // no file at all.
    expect(files.get(fileOf(rootA))).toBe(JSON.stringify({ value: 7 }))
    expect(files.has(fileOf(rootB))).toBe(false)

    const second = createConfig('app', 'options.json', schema, { owner: 'device', default: { value: 0 } })
    second.setup()

    expect(second.get()).toEqual({ value: 0 })
    expect(first.get()).toEqual({ value: 7 })
  })

  it('stores account configs in the account directory and device configs at the root', async () => {
    const files = new Map<string, string>()
    const root = join(tmpdir(), 'airi-user-data-owner')
    vi.doMock('electron', () => ({ app: { getPath: () => root } }))
    vi.doMock('es-toolkit', () => ({ throttle: (handler: () => unknown) => handler }))
    vi.doMock('node:fs', () => ({ existsSync: () => false, readFileSync: () => '' }))
    vi.doMock('node:fs/promises', () => ({
      copyFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      rename: vi.fn(async (from: string, to: string) => {
        files.set(to, files.get(from) ?? '')
        files.delete(from)
      }),
      writeFile: vi.fn(async (path: string, body: string) => {
        files.set(path, body)
      }),
    }))

    // `vi.resetModules` also reset the account runtime, so fix the account again.
    const { initializeAccountScope } = await import('@proj-airi/stage-shared/account-scope/runtime')
    initializeAccountScope('local')
    const { createConfig } = await import('./persistence')
    const schema = object({ value: number() })
    const keys = createConfig('artistry', 'options.json', schema, { owner: 'account', default: { value: 0 } })
    const layout = createConfig('app', 'config.json', schema, { owner: 'device', default: { value: 0 } })
    keys.setup()
    layout.setup()
    keys.update({ value: 1 })
    layout.update({ value: 2 })

    await vi.waitFor(() => expect(files.get(join(root, 'accounts', 'local', 'artistry-options.json'))).toBe('{"value":1}'))
    await vi.waitFor(() => expect(files.get(join(root, 'app-config.json'))).toBe('{"value":2}'))
  })

  // ROOT CAUSE:
  //
  // A throttled save runs up to 250 ms after `update`. An account switch relaunches
  // the app at once, so the last change of the previous account was lost.
  //
  // We fixed this by flushing every held save before the relaunch.
  it('writes a held change when the configs are flushed', async () => {
    const files = new Map<string, string>()
    const root = join(tmpdir(), 'airi-user-data-flush')
    let held: (() => unknown) | undefined
    vi.doMock('electron', () => ({ app: { getPath: () => root } }))
    vi.doMock('es-toolkit', () => ({
      throttle: (handler: () => unknown) => Object.assign(() => {
        held = handler
      }, {
        flush: () => {
          const run = held
          held = undefined
          run?.()
        },
      }),
    }))
    vi.doMock('node:fs', () => ({ existsSync: () => false, readFileSync: () => '' }))
    vi.doMock('node:fs/promises', () => ({
      copyFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      rename: vi.fn(async (from: string, to: string) => {
        files.set(to, files.get(from) ?? '')
        files.delete(from)
      }),
      writeFile: vi.fn(async (path: string, body: string) => {
        files.set(path, body)
      }),
    }))

    const { createConfig, flushConfigWrites } = await import('./persistence')
    const config = createConfig('app', 'options.json', object({ value: number() }), { owner: 'device', default: { value: 0 } })
    config.setup()
    config.update({ value: 3 })
    expect(files.size).toBe(0)

    await flushConfigWrites()

    expect(files.get(join(root, 'app-options.json'))).toBe('{"value":3}')
  })
})
