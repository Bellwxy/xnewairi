<script setup lang="ts">
import { gatewayProviderDefinitionId, useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useRoute, useRouter } from 'vue-router'

import GatewayProviderSettings from './components/gateway-provider-settings.vue'

const route = useRoute('/settings/providers/chat/[providerId]')
const router = useRouter()
const routeProviderId = route.params.providerId
if (typeof routeProviderId !== 'string')
  throw new Error('Expected a provider id in the settings route')

// Only the gateway serves LLM requests. Another provider id, for example from an old link, returns to Consciousness settings
// before its settings view mounts and validates the old credentials.
const definitionId = useProviderConfigStore().getProvider(routeProviderId)?.definitionId ?? routeProviderId
const isGateway = definitionId === gatewayProviderDefinitionId
if (!isGateway)
  void router.replace('/settings/modules/consciousness')
</script>

<template>
  <GatewayProviderSettings v-if="isGateway" :provider-id="routeProviderId" />
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
