import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { vuetify } from './plugins/vuetify';
import { installGuards, router } from './router';
import { connectApiClient } from './stores/auth';

const app = createApp(App).use(createPinia());
connectApiClient(
  () =>
    void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } }),
);
installGuards(router);
app.use(router).use(vuetify).mount('#app');
