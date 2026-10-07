<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { LIBRARY_TABS } from './library';

defineProps<{ title: string }>();
const route = useRoute();
/** `/institution/library` or `/group/library`. */
const base = computed(() => {
  const m = /^(\/[^/]+\/library)/.exec(route.path);
  return m ? m[1] : '/institution/library';
});
</script>
<template>
  <div class="d-flex align-center mb-2">
    <h2 class="text-h5">{{ title }}</h2>
    <v-spacer />
    <slot name="actions" />
  </div>
  <v-tabs density="compact" class="mb-4" show-arrows color="primary">
    <v-tab
      v-for="t in LIBRARY_TABS"
      :key="t.path"
      :to="t.path ? `${base}/${t.path}` : base"
      :exact="!t.path"
      >{{ t.title }}</v-tab
    >
  </v-tabs>
</template>
