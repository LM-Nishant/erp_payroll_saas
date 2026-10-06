<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <h2 class="text-h5 mb-4">{{ title }}</h2>
  <v-alert type="info" variant="tonal">Coming in a later layer.</v-alert>
</template>
