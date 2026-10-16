<script setup lang="ts">
import { useRouter } from 'vue-router'

// The settings entry and the module list open the same memory page. The module page owns it.
void useRouter().replace('/settings/modules/memory-long-term')
</script>

<template>
  <div />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:leaf-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
