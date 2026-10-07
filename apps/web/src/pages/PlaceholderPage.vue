<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <h2 class="text-h5 mb-4">{{ title }}</h2>
  <v-btn variant="tonal" prepend-icon="mdi-home" :to="{ name: 'home' }">Back to home</v-btn>
</template>
