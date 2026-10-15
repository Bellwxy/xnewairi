import type { AiriCard, AiriExtension } from '@proj-airi/stage-ui/types'

import type { AudioInputSession } from '../../../src/types'

import { pageAccountScope } from '../../../src/setup/account-scope'

type ActiveCardModules = Partial<Pick<AiriExtension['modules'], 'consciousness' | 'speech'>>

/** Updates Provider selections that the active AIRI Card reapplies during application startup. */
export async function configureActiveCardModules(
  runtime: AudioInputSession,
  modules: ActiveCardModules,
): Promise<void> {
  const scope = await pageAccountScope(runtime.runtimePage)
  const keys = { cards: scope.storageKey('airi-cards'), activeCardId: scope.storageKey('airi-card-active-id') }
  await runtime.runtimePage.evaluate(({ configuredModules, keys }) => {
    const serializedCards = localStorage.getItem(keys.cards)
    if (!serializedCards)
      throw new Error('The AIRI Card store is not initialized.')

    const activeCardId = localStorage.getItem(keys.activeCardId) ?? 'default'
    const cards = JSON.parse(serializedCards) as Array<[string, AiriCard]>
    const activeCard = cards.find(([cardId]) => cardId === activeCardId)?.[1]
    if (!activeCard)
      throw new Error(`The active AIRI Card "${activeCardId}" does not exist.`)

    const currentModules = activeCard.extensions.airi.modules
    activeCard.extensions.airi.modules = {
      ...currentModules,
      ...(configuredModules.consciousness
        ? { consciousness: configuredModules.consciousness }
        : {}),
      ...(configuredModules.speech
        ? { speech: { ...currentModules.speech, ...configuredModules.speech } }
        : {}),
    }
    localStorage.setItem(keys.cards, JSON.stringify(cards))
  }, { configuredModules: modules, keys })
}
