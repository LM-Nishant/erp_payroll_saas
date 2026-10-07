<script setup lang="ts">
import type { FinanceTableDto } from '@erp/shared';
defineProps<{ table: FinanceTableDto | null; loading?: boolean }>();
const fmt = (v: string | number) =>
  typeof v === 'number'
    ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v;
</script>
<template>
  <v-progress-linear v-if="loading" indeterminate class="mb-2" />
  <v-card v-if="table" variant="outlined"
    ><v-card-title>{{ table.title }}</v-card-title
    ><v-card-subtitle v-if="table.subtitle">{{ table.subtitle }}</v-card-subtitle
    ><v-table density="compact"
      ><thead>
        <tr>
          <th v-for="c in table.columns" :key="c">{{ c }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in table.rows" :key="i">
          <td v-for="(v, j) in r" :key="j" :class="{ 'text-right': typeof v === 'number' }">
            {{ fmt(v) }}
          </td>
        </tr>
        <tr v-if="!table.rows.length">
          <td :colspan="table.columns.length" class="text-medium-emphasis">No data</td>
        </tr>
      </tbody></v-table
    ></v-card
  >
</template>
