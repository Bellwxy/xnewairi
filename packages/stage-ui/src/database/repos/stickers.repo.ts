import type { StickerEntry } from '../../types/sticker'

import { createAccountLocalForage } from '@proj-airi/stage-shared/account-scope/localforage'
import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'

const entries = createAccountLocalForage('airi-stickers', 'entries')
const images = createAccountLocalForage('airi-stickers', 'images')

/** Serializes sticker library writes of this account across windows. */
export const STICKER_LIBRARY_LOCK = getAccountScope().lockName('airi:sticker-library-write')

/** Device-local library. Immutable image versions remain available to saved and queued replies. */
export const stickersRepo = {
  async read() {
    return navigator.locks.request(STICKER_LIBRARY_LOCK, async () => {
      const records: StickerEntry[] = []
      const artwork: { id: string, blob: Blob }[] = []
      await Promise.all([
        entries.iterate<StickerEntry, void>((entry) => { records.push(entry) }),
        images.iterate<Blob, void>((blob, id) => { artwork.push({ id, blob }) }),
      ])
      return { records, images: artwork }
    })
  },
  async get(id: string) {
    return entries.getItem<StickerEntry>(id)
  },
  async save(entry: StickerEntry) {
    await entries.setItem(entry.id, entry)
  },
  async saveImage(id: string, blob: Blob) {
    await images.setItem(id, blob)
  },
}
