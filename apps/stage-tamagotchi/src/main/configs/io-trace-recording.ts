import { boolean, object } from 'valibot'

import { createConfig } from '../libs/electron/persistence'

export function createIOTraceRecordingConfig() {
  const config = createConfig('io-trace-recording', 'options.json', object({ enabled: boolean() }), {
    owner: 'device',
    default: { enabled: false },
    autoHeal: true,
  })
  config.setup()
  return config
}
