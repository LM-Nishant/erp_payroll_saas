<script setup lang="ts">
import type { StudentDto } from '@erp/shared';

defineProps<{ wards: StudentDto[] }>();
const model = defineModel<string | undefined>();
</script>
<template>
  <v-select
    v-if="wards.length > 1"
    v-model="model"
    :items="wards"
    item-title="displayName"
    item-value="id"
    label="Child"
    density="compact"
    class="mb-2"
    style="max-width: 360px"
  />
</template>
