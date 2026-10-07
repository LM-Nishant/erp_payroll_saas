<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { describeFace, faceDistance, FACE_MATCH_THRESHOLD } from '@/lib/face';

/**
 * Camera dialog for selfie attendance. Captures a frame, computes its face descriptor and
 * pre-checks it against the stored profile descriptor; the server re-checks before accepting.
 */
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ title: string; reference: number[] | null }>();
const emit = defineEmits<{ captured: [selfie: Blob, descriptor: number[]] }>();

const video = ref<HTMLVideoElement | null>(null);
const stream = ref<MediaStream | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

function stop() {
  stream.value?.getTracks().forEach((t) => t.stop());
  stream.value = null;
}

watch(open, async (isOpen) => {
  error.value = null;
  if (!isOpen) return stop();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    error.value =
      'The camera is only available over HTTPS (or on localhost). Open the app via its https:// address.';
    return;
  }
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 },
      audio: false,
    });
    await nextTick();
    if (video.value) {
      video.value.srcObject = stream.value;
      await video.value.play();
    }
  } catch {
    error.value = 'Camera access is required for selfie attendance. Allow the camera and retry.';
  }
});
onBeforeUnmount(stop);

async function capture() {
  if (!video.value) return;
  busy.value = true;
  error.value = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.value.videoWidth;
    canvas.height = video.value.videoHeight;
    canvas.getContext('2d')!.drawImage(video.value, 0, 0);
    const descriptor = await describeFace(canvas);
    if (!descriptor) {
      error.value = 'No face detected. Face the camera in good light and try again.';
      return;
    }
    if (props.reference && faceDistance(props.reference, descriptor) > FACE_MATCH_THRESHOLD) {
      error.value = 'Your face does not match your profile photo. Punch blocked.';
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) throw new Error('Could not capture the image');
    emit('captured', blob, descriptor);
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" persistent>
    <v-card :title="title">
      <v-card-text>
        <video
          ref="video"
          autoplay
          muted
          playsinline
          style="width: 100%; border-radius: 8px; transform: scaleX(-1); background: #000"
        />
        <v-alert v-if="error" type="error" density="compact" class="mt-2">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          prepend-icon="mdi-camera"
          :loading="busy"
          :disabled="!stream"
          @click="capture"
        >
          Capture & punch
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
