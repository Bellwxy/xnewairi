import type { Card } from '@proj-airi/ccc'

import type { AiriCard, AiriExtension } from '../types/airiCard'

import { isEqual } from 'es-toolkit'
import {
  check,
  looseObject,
  nonEmpty,
  object,
  objectWithRest,
  parse,
  parseJson,
  pipe,
  regex,
  safeParse,
  string,
  trim,
  unknown,
} from 'valibot'

import { joinCard, splitCard } from '../libs/character-card-sync'

export type AiriCardDraftValidationError = 'name' | 'version' | 'invalid_artistry_json'

/** Module settings owned by the AIRI Card editor form. */
interface AiriCardEditorModules {
  consciousness: AiriExtension['modules']['consciousness']
  vision: AiriExtension['modules']['vision']
  speech: Pick<AiriExtension['modules']['speech'], 'provider' | 'model' | 'voice_id'>
  displayModelId?: string
  artistry: Pick<
    NonNullable<AiriExtension['modules']['artistry']>,
    | 'provider'
    | 'model'
    | 'promptPrefix'
    | 'widgetInstruction'
    | 'spawnMode'
    | 'options'
    | 'autonomousEnabled'
    | 'autonomousThreshold'
  >
}

/**
 * Reads the module fields that the AIRI Card editor owns.
 *
 * Empty strings mean that the card inherits the corresponding global setting.
 */
export function getAiriCardEditorModuleSettings(
  card: Card | undefined,
): Pick<AiriCardEditorModules, 'consciousness' | 'vision' | 'speech' | 'displayModelId'> {
  const modules = getAiriCardModules(card?.extensions?.airi)

  return {
    consciousness: {
      provider: getModuleString(modules?.consciousness, 'provider'),
      model: getModuleString(modules?.consciousness, 'model'),
    },
    vision: {
      provider: getModuleString(modules?.vision, 'provider'),
      model: getModuleString(modules?.vision, 'model'),
    },
    speech: {
      provider: getModuleString(modules?.speech, 'provider'),
      model: getModuleString(modules?.speech, 'model'),
      voice_id: getModuleString(modules?.speech, 'voice_id'),
    },
    displayModelId: getModuleString(modules, 'displayModelId'),
  }
}

type CardWithAiriExtension = Card & {
  extensions: NonNullable<Card['extensions']> & {
    airi: AiriExtension
  }
}

export type AiriCardDraftValidationResult
  = | {
    success: true
    output: {
      card: Card
      artistryOptions: Record<string, unknown> | undefined
    }
  }
  | {
    success: false
    error: AiriCardDraftValidationError
  }

const cardDraftSchema = object({
  name: pipe(string(), trim(), nonEmpty()),
  version: pipe(string(), trim(), regex(/^(?:\d+\.)+\d+$/)),
})

const artistryOptionsSchema = pipe(
  string(),
  trim(),
  parseJson(),
  check(isRecord),
  objectWithRest({}, unknown()),
)

/**
 * Validates and normalizes the fields owned by the AIRI Card editor.
 *
 * Display text remains untouched except for boundary whitespace on the
 * required name and version fields. Artistry options must be a JSON object
 * when present.
 */
export function safeParseAiriCardDraft(card: Card, artistryOptionsJson: string): AiriCardDraftValidationResult {
  const cardResult = safeParse(cardDraftSchema, card)
  if (!cardResult.success) {
    const invalidField = cardResult.issues[0]?.path?.[0]?.key
    return {
      success: false,
      error: invalidField === 'version' ? 'version' : 'name',
    }
  }

  const normalizedArtistryOptions = artistryOptionsJson.trim()
  if (!normalizedArtistryOptions) {
    return {
      success: true,
      output: {
        card: { ...card, ...cardResult.output },
        artistryOptions: undefined,
      },
    }
  }

  const artistryResult = safeParse(artistryOptionsSchema, normalizedArtistryOptions)
  if (!artistryResult.success) {
    return {
      success: false,
      error: 'invalid_artistry_json',
    }
  }

  return {
    success: true,
    output: {
      card: { ...card, ...cardResult.output },
      artistryOptions: artistryResult.output,
    },
  }
}

/**
 * Applies editor-owned module fields to a complete character card.
 *
 * The returned card preserves extension fields the form cannot display,
 * including body models, backgrounds, advanced speech/artistry settings, and
 * agent configuration.
 */
export function applyAiriCardEditorModules(
  card: Card,
  edited: AiriCardEditorModules,
): CardWithAiriExtension {
  const existing = isAiriExtension(card.extensions?.airi)
    ? card.extensions.airi
    : undefined

  return {
    ...card,
    extensions: {
      ...card.extensions,
      airi: {
        ...existing,
        modules: {
          ...existing?.modules,
          ...edited,
          speech: {
            ...existing?.modules.speech,
            ...edited.speech,
          },
          artistry: {
            ...existing?.modules.artistry,
            ...edited.artistry,
          },
        },
        agents: existing?.agents ?? {},
      },
    },
  }
}

function isAiriExtension(value: unknown): value is AiriExtension {
  return isRecord(value)
    && isRecord(value.modules)
    && isRecord(value.agents)
}

function getAiriCardModules(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.modules))
    return undefined

  return value.modules
}

function getModuleString(module: unknown, key: string): string {
  if (!isRecord(module))
    return ''

  const value = module[key]
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The longest personality that the editor saves, in Unicode code points. Generation in spec 2.5 uses the same limit. */
export const personalityLimit = 2000

/** Counts Unicode code points, so one emoji counts as one character. */
export function countCodePoints(text: string | undefined): number {
  return text ? [...text].length : 0
}

/**
 * Tells whether the personality of a draft blocks saving.
 *
 * An imported personality over the limit stays as it is, so the user can still edit other fields.
 * When the user edits the personality, the new text must fit the limit. The editor never cuts the text.
 */
export function isPersonalityOverLimit(draft: string | undefined, baseline: string | undefined): boolean {
  return (draft ?? '') !== (baseline ?? '') && countCodePoints(draft) > personalityLimit
}

/** The members that every card needs before the card store can normalize it. */
const mergedCardSchema = looseObject({ name: string(), version: string() })

/** Which value a conflicting field keeps. `draft` keeps the edit of the user. `latest` keeps the value of the other source. */
export type CardEditConflictChoice = 'draft' | 'latest'

export interface CardEditMerge {
  /** The card to save. It is the latest card with each field that the draft changed since the editor opened. */
  card: Card
  /**
   * JSON Pointers of the fields that both the draft and another source changed to different values
   * since the editor opened, for example `/personality`. The editor asks the user before it saves them.
   */
  conflicts: string[]
}

/**
 * Merges an editor draft into the latest stored card, field by field.
 *
 * Other sources write a card while the editor is open, for example the wake word tool or cloud sync.
 * The merge keeps their writes for every field that the draft did not change.
 * Fields are the parts that cloud sync splits, so each module of `extensions.airi.modules` is one field.
 *
 * Use when:
 * - The card editor saves an edit of an existing card.
 *
 * Returns:
 * - The card to save, and the fields that conflict. `choice` decides the value of each conflicting field.
 */
export function mergeCardEdit(
  versions: { baseline: AiriCard, draft: AiriCard, latest: AiriCard },
  choice: CardEditConflictChoice = 'draft',
): CardEditMerge {
  const baseline = splitCard(versions.baseline)
  const draft = splitCard(versions.draft)
  const merged = splitCard(versions.latest)
  const conflicts: string[] = []

  for (const key of new Set([...Object.keys(baseline), ...Object.keys(draft)])) {
    if (isEqual(draft[key], baseline[key]))
      continue

    const latestChanged = !isEqual(merged[key], baseline[key])
    if (latestChanged && !isEqual(merged[key], draft[key])) {
      conflicts.push(key)
      if (choice === 'latest')
        continue
    }

    // `splitCard` omits empty values, so a missing draft key means that the user removed the field.
    if (key in draft)
      merged[key] = draft[key]
    else
      delete merged[key]
  }

  return { card: parse(mergedCardSchema, joinCard(merged)), conflicts }
}
