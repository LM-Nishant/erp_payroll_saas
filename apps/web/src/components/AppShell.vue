<script setup lang="ts">
import { computed, ref } from 'vue';
import { MENUS, visibleMenu, type LayoutKey } from '@/navigation/menus';
import { useSessionStore } from '@/stores/session';

const props = defineProps<{ layout: LayoutKey; title: string; color?: string }>();
const session = useSessionStore();
const drawer = ref(true);
const items = computed(() => visibleMenu(MENUS[props.layout], session.can));
</script>

<template>
  <v-navigation-drawer v-model="drawer">
    <v-list-item :title="title" subtitle="Education ERP" />
    <v-divider />
    <v-list density="compact" nav>
      <v-list-item
        v-for="item in items"
        :key="item.title"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
      />
    </v-list>
  </v-navigation-drawer>
  <v-app-bar :color="color ?? 'primary'" density="comfortable">
    <v-app-bar-nav-icon @click="drawer = !drawer" />
    <v-app-bar-title>{{ title }}</v-app-bar-title>
    <v-chip class="mr-4" variant="outlined" size="small">org: {{ session.devOrganization }}</v-chip>
    <v-btn to="/" icon="mdi-swap-horizontal" />
  </v-app-bar>
  <v-main>
    <v-container fluid>
      <router-view />
    </v-container>
  </v-main>
</template>
