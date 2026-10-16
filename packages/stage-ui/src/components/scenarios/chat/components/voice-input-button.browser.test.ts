import type { VoiceMessageSnapshot } from '../../../../libs/voice/voice-message'
import type { VoiceHostSnapshot, VoiceInputCommand, VoiceMessageCommand } from '../../../../services/speech/bus'

import { defineInvokeHandler } from '@moeru/eventa'
import { accountStorageKey } from '@proj-airi/stage-shared/account-scope/runtime'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, ref, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import ChatInput from './chat-input.vue'
import VoiceInputButton from './voice-input-button.vue'

import { pushToTalkTriggerKey } from '../../../../composables/push-to-talk-trigger'
import { getSpeechBusContext, voiceInputCommand, voiceMessageCommand, voiceMessagesChanged, voiceRequestSnapshot, voiceSnapshotChanged } from '../../../../services/speech/bus'

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  localStorage.clear()
})

/** Mounts the button against a scripted voice host. `afterFinish` is the message state the host reports after `finish`. */
async function mountButton(options: { afterFinish?: Partial<VoiceMessageSnapshot>, dictation?: string | Promise<string>, queued?: boolean, pushToTalkTrigger?: boolean, inputModes?: boolean } = {}) {
  const commands: Array<VoiceInputCommand | VoiceMessageCommand> = []
  const context = getSpeechBusContext()
  const connected: VoiceHostSnapshot = { connected: true, drafts: [] }
  cleanups.push(context.on(voiceRequestSnapshot, () => context.emit(voiceSnapshotChanged, connected)))
  cleanups.push(defineInvokeHandler(context, voiceMessageCommand, (command) => {
    commands.push(command)
    if (command.type === 'record')
      context.emit(voiceMessagesChanged, [{ id: command.id, sessionId: command.sessionId, phase: 'capturing' }])
    if (command.type === 'finish' && command.send)
      context.emit(voiceMessagesChanged, options.queued ? [{ id: command.id, sessionId: 'alice', phase: 'sending' }] : [])
    else if (command.type === 'finish')
      context.emit(voiceMessagesChanged, [{ id: command.id, sessionId: 'alice', phase: 'ready', audio: new Blob(['wav'], { type: 'audio/wav' }), ...options.afterFinish }])
    if (command.type === 'discard' || command.type === 'send')
      context.emit(voiceMessagesChanged, [])
    return { status: 'accepted' }
  }))
  cleanups.push(defineInvokeHandler(context, voiceInputCommand, async (command) => {
    commands.push(command)
    if (command.type === 'begin')
      context.emit(voiceSnapshotChanged, { ...connected, input: { requestId: command.requestId, sessionId: command.sessionId, phase: 'capturing', text: 'how are', segments: [] } })
    if (command.type === 'end')
      return { status: 'accepted', text: await options.dictation }
    return { status: 'accepted' }
  }))

  const pinia = createPinia()
  cleanups.push(() => disposePinia(pinia))
  const draft = ref('Hello')
  const submitted: unknown[] = []
  const status = document.body.appendChild(document.createElement('div'))
  const attachment = document.body.appendChild(document.createElement('div'))
  cleanups.push(() => status.remove(), () => attachment.remove())
  const button = shallowRef<{ sendPending: (text: string) => Promise<'none' | 'sent' | 'failed'> }>()
  const component = defineComponent({ setup() {
    const props = () => ({
      'modelValue': draft.value,
      'onUpdate:modelValue': (value: string) => draft.value = value,
      'ref': button,
      'attachmentElement': attachment,
      'sessionId': 'alice',
      'onSubmit': () => submitted.push(true),
    })
    return () => options.inputModes
      ? h(ChatInput, props(), { default: () => h('textarea', { value: draft.value }) })
      : h(VoiceInputButton, { ...props(), statusElement: status })
  } })
  const screen = await render(component, {
    global: {
      plugins: [pinia, createI18n({
        legacy: false,
        locale: 'en',
        missingWarn: false,
        fallbackWarn: false,
        messages: { en: { stage: { chat: { 'input-mode': { label: 'Input mode', text: 'Text', voice: 'Voice' } } } } },
      })],
      provide: options.pushToTalkTrigger === undefined ? {} : { [pushToTalkTriggerKey as symbol]: options.pushToTalkTrigger },
    },
  })
  cleanups.push(() => screen.unmount())
  return { screen, commands, draft, submitted, button }
}

describe('voiceInputButton', () => {
  // Review: https://github.com/moeru-ai/airi/pull/2729#discussion_r4239147482
  it('warns in the menu when the saved mode is Push to Talk and the host has no trigger', async () => {
    localStorage.setItem(accountStorageKey('settings/hearing/input-mode'), 'push-to-talk')
    const { screen } = await mountButton()

    await screen.getByTestId('voice-input-button').click({ button: 'right' })

    await expect.element(screen.getByTestId('voice-menu-push-to-talk-stranded')).toBeVisible()
    await expect.element(screen.getByTestId('voice-menu-push-to-talk-stranded')).toHaveTextContent('stage.chat.voice-composer.push-to-talk-unavailable')
  })

  it('shows no Push to Talk warning in the menu when the host has a trigger', async () => {
    localStorage.setItem(accountStorageKey('settings/hearing/input-mode'), 'push-to-talk')
    const { screen } = await mountButton({ pushToTalkTrigger: true })

    await screen.getByTestId('voice-input-button').click({ button: 'right' })

    await expect.element(screen.getByTestId('voice-menu-listen')).toBeVisible()
    expect(screen.getByTestId('voice-menu-push-to-talk-stranded').query()).toBeNull()
  })

  it('keeps a voice message pending when Auto send is off, and sends it with the composer text', async () => {
    const { screen, commands, button } = await mountButton()
    const control = screen.getByTestId('voice-input-button')
    await expect.element(control).toBeEnabled()

    await control.click()
    await expect.element(screen.getByTestId('voice-status-bar')).toHaveAttribute('data-phase', 'recording')
    await control.click()

    const record = commands[0] as Extract<VoiceMessageCommand, { type: 'record' }>
    await expect.poll(() => commands[1]).toEqual({ type: 'finish', id: record.id, send: false })
    await expect.element(screen.getByTestId('voice-pending-card')).toBeVisible()
    expect(await button.value?.sendPending('see the attached clip')).toBe('sent')
    await expect.poll(() => commands.at(-1)).toEqual({ type: 'send', id: record.id, text: 'see the attached clip' })
    await expect.element(screen.getByTestId('voice-pending-card')).not.toBeInTheDocument()
  })

  it('sends the voice message when the recording stops with Auto send on', async () => {
    localStorage.setItem(accountStorageKey('settings/hearing/auto-send-enabled'), 'true')
    const { screen, commands } = await mountButton()
    const button = screen.getByTestId('voice-input-button')
    await button.click()
    await expect.element(screen.getByTestId('voice-status-bar')).toBeInTheDocument()
    await button.click()

    await expect.poll(() => commands[1]).toMatchObject({ type: 'finish', send: true })
    await expect.element(screen.getByTestId('voice-pending-card')).not.toBeInTheDocument()
  })

  it('can cancel a recording when Auto send is off', async () => {
    const { screen, commands } = await mountButton()
    await screen.getByTestId('voice-input-button').click()
    await expect.element(screen.getByTestId('voice-status-bar')).toBeInTheDocument()

    await screen.getByTestId('voice-status-cancel').click()
    await expect.poll(() => commands.at(-1)).toMatchObject({ type: 'discard' })
    await expect.element(screen.getByTestId('voice-status-bar')).not.toBeInTheDocument()
  })

  // The chat queues a voice message behind a running reply. The control used to spin until that reply ended.
  it('frees the control while a sent voice message waits in the chat queue', async () => {
    localStorage.setItem(accountStorageKey('settings/hearing/auto-send-enabled'), 'true')
    const { screen } = await mountButton({ queued: true })
    const button = screen.getByTestId('voice-input-button')
    await button.click()
    await expect.element(screen.getByTestId('voice-status-bar')).toBeInTheDocument()
    await button.click()

    await expect.element(screen.getByTestId('voice-status-bar')).not.toBeInTheDocument()
    await expect.element(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('cancels from the status bar without sending when Auto send is on', async () => {
    localStorage.setItem(accountStorageKey('settings/hearing/auto-send-enabled'), 'true')
    const { screen, commands } = await mountButton()
    await screen.getByTestId('voice-input-button').click()
    await screen.getByTestId('voice-status-cancel').click()

    const record = commands[0] as Extract<VoiceMessageCommand, { type: 'record' }>
    await expect.poll(() => commands[1]).toEqual({ type: 'discard', id: record.id })
    await expect.element(screen.getByTestId('voice-status-bar')).not.toBeInTheDocument()
  })

  it('writes the live transcript into the composer and keeps the final text', async () => {
    localStorage.setItem(accountStorageKey('ui/chat/voice-mode'), 'transcription')
    localStorage.setItem(accountStorageKey('settings/hearing/active-provider'), 'browser-web-speech-api')
    const { screen, commands, draft, submitted } = await mountButton({ dictation: 'how are you' })
    const button = screen.getByTestId('voice-input-button')
    await button.click()

    await expect.poll(() => commands[0]).toMatchObject({ type: 'begin', target: 'composer' })
    await expect.poll(() => draft.value).toBe('Hello how are')
    await button.click()

    await expect.poll(() => draft.value).toBe('Hello how are you')
    expect(submitted).toEqual([])
  })

  it('switches input modes without recording or changing the text draft', async () => {
    const { screen, commands, draft } = await mountButton({ inputModes: true })
    await expect.element(screen.getByRole('textbox')).toBeVisible()

    await screen.getByTestId('chat-input-mode-voice').click()
    await expect.element(screen.getByTestId('chat-text-input')).not.toBeVisible()
    await expect.element(screen.getByTestId('voice-input-button')).toBeVisible()
    await expect.element(screen.getByTestId('chat-input-mode-voice')).toHaveAttribute('aria-pressed', 'true')
    expect(commands).toEqual([])

    await screen.getByTestId('chat-input-mode-text').click()
    await expect.element(screen.getByRole('textbox')).toBeVisible()
    await expect.element(screen.getByRole('textbox')).toHaveFocus()
    expect(draft.value).toBe('Hello')
  })

  it('discards the active recording when switching to Text with Auto send on', async () => {
    localStorage.setItem(accountStorageKey('settings/hearing/auto-send-enabled'), 'true')
    const { screen, commands, draft } = await mountButton({ inputModes: true })
    await screen.getByTestId('chat-input-mode-voice').click()
    await screen.getByTestId('voice-input-button').click()
    await expect.element(screen.getByTestId('voice-status-bar')).toBeVisible()

    await screen.getByTestId('chat-input-mode-text').click()

    await expect.poll(() => commands.map(command => command.type)).toEqual(['record', 'discard'])
    await expect.element(screen.getByRole('textbox')).toHaveFocus()
    expect(draft.value).toBe('Hello')
  })

  it('keeps the original draft when a cancelled dictation finishes after switching to Text', async () => {
    localStorage.setItem(accountStorageKey('ui/chat/voice-mode'), 'transcription')
    localStorage.setItem(accountStorageKey('settings/hearing/active-provider'), 'browser-web-speech-api')
    const result = Promise.withResolvers<string>()
    const { screen, commands, draft } = await mountButton({ inputModes: true, dictation: result.promise })
    await screen.getByTestId('chat-input-mode-voice').click()
    await screen.getByTestId('voice-input-button').click()
    await expect.poll(() => draft.value).toBe('Hello how are')
    await screen.getByTestId('voice-input-button').click()
    await expect.element(screen.getByTestId('voice-status-bar')).toHaveAttribute('data-phase', 'processing')

    await screen.getByTestId('chat-input-mode-text').click()
    await expect.poll(() => commands.map(command => command.type)).toEqual(['begin', 'end', 'cancel'])
    result.resolve('late transcript')
    await new Promise(resolve => setTimeout(resolve, 0))

    await expect.element(screen.getByRole('textbox')).toHaveFocus()
    expect(draft.value).toBe('Hello')
  })
})
