<script setup lang="ts">
import type { SignedUrlDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { describeFile } from '@/lib/face';

/**
 * Shows an employee's profile photo and lets the caller replace it. The face descriptor used for
 * selfie attendance is computed in the browser and uploaded alongside the image.
 */
const props = defineProps<{ basePath: string; editable?: boolean; size?: number }>();
const emit = defineEmits<{ updated: [hasFaceDescriptor: boolean] }>();

const url = ref<string | null>(null);
const busy = ref(false);
const message = ref<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
const input = ref<HTMLInputElement | null>(null);

async function loadUrl() {
  try {
    url.value =
      (await apiFetch<{ data: SignedUrlDto | null }>(`${props.basePath}/photo-url`)).data?.url ??
      null;
  } catch {
    url.value = null;
  }
}
onMounted(loadUrl);

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  busy.value = true;
  message.value = null;
  try {
    let descriptor: number[] | null = null;
    try {
      descriptor = await describeFile(file);
    } catch {
      descriptor = null;
    }
    const body = new FormData();
    if (descriptor) body.append('faceDescriptor', JSON.stringify(descriptor));
    body.append('file', file);
    await apiFetch(`${props.basePath}/photo`, { method: 'POST', body });
    await loadUrl();
    message.value = descriptor
      ? { type: 'success', text: 'Photo updated. Face registered for selfie attendance.' }
      : {
          type: 'warning',
          text: 'Photo saved, but no clear face was detected — selfie attendance will not work. Use a front-facing, well-lit photo.',
        };
    emit('updated', !!descriptor);
  } catch (e) {
    message.value = { type: 'error', text: (e as Error).message };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="d-flex align-center ga-4">
    <v-avatar :size="size ?? 96" color="grey-lighten-2">
      <v-img v-if="url" :src="url" cover />
      <v-icon v-else :size="(size ?? 96) / 2">mdi-account</v-icon>
    </v-avatar>
    <div v-if="editable">
      <input
        ref="input"
        type="file"
        accept="image/jpeg,image/png"
        class="d-none"
        @change="onFile"
      />
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-camera"
        :loading="busy"
        @click="input?.click()"
      >
        {{ url ? 'Change photo' : 'Upload photo' }}
      </v-btn>
      <div class="text-caption text-medium-emphasis mt-1">
        JPG/PNG, max 5 MB, face clearly visible
      </div>
    </div>
  </div>
  <v-alert
    v-if="message"
    :type="message.type"
    density="compact"
    class="mt-2"
    closable
    @click:close="message = null"
  >
    {{ message.text }}
  </v-alert>
</template>
