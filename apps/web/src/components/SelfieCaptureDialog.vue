<script setup lang="ts">
import type { LivenessProof, LivenessStep } from '@erp/shared';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { describeFace, faceDistance, faceLandmarks, FACE_MATCH_THRESHOLD } from '@/lib/face';
import { faceMetrics, LivenessTracker, STEP_PROMPTS } from '@/lib/liveness';

/**
 * Camera dialog for selfie attendance with a liveness check: the server picks a blink and a head
 * turn in random order; face landmarks confirm each step live, and a face descriptor is taken at
 * each step. Only descriptors leave the browser; the server re-checks everything before accepting.
 */
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ title: string; reference: number[] | null }>();
const emit = defineEmits<{
  captured: [selfie: Blob, descriptor: number[], liveness: LivenessProof];
}>();

interface Challenge {
  challenge: string;
  steps: LivenessStep[];
  expiresAt: string;
}

const video = ref<HTMLVideoElement | null>(null);
const stream = ref<MediaStream | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const hint = ref<string | null>(null);
const challenge = ref<Challenge | null>(null);
const frames = ref<LivenessProof['frames']>([]);
const expired = ref(false);
let tracker: LivenessTracker | null = null;
let run = 0;

const current = computed(() => challenge.value?.steps[frames.value.length] ?? null);
const live = computed(
  () => !!challenge.value && frames.value.length === challenge.value.steps.length,
);

function stop() {
  run += 1;
  stream.value?.getTracks().forEach((t) => t.stop());
  stream.value = null;
}

function snapshot(): HTMLCanvasElement | null {
  const v = video.value;
  if (!v || !v.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d')!.drawImage(v, 0, 0);
  return canvas;
}

const matches = (d: number[]) =>
  !props.reference || faceDistance(props.reference, d) <= FACE_MATCH_THRESHOLD;

/** Watches the camera until every challenge step has been seen (or the dialog closes). */
async function track(id: number) {
  while (id === run && tracker && !tracker.done) {
    if (challenge.value && Date.parse(challenge.value.expiresAt) < Date.now()) {
      expired.value = true;
      return;
    }
    const canvas = snapshot();
    const points = canvas ? await faceLandmarks(canvas).catch(() => null) : null;
    if (id !== run) return;
    const m = points ? faceMetrics(points) : null;
    hint.value = m ? null : 'No face detected. Face the camera in good light.';
    if (m && canvas && tracker.observe(m)) {
      const descriptor = await describeFace(canvas);
      if (id !== run) return;
      if (descriptor && matches(descriptor)) {
        frames.value = [...frames.value, { step: tracker.current!, descriptor }];
        tracker.complete();
      } else if (descriptor) {
        hint.value = 'Your face does not match your profile photo.';
      }
    }
    await new Promise((r) => setTimeout(r, 60));
  }
}

async function startChallenge() {
  const id = ++run;
  expired.value = false;
  frames.value = [];
  error.value = null;
  try {
    const res = await apiFetch<{ data: Challenge }>('/api/v1/attendance/me/liveness-challenge', {
      method: 'POST',
      body: '{}',
    });
    if (id !== run) return;
    challenge.value = res.data;
    tracker = new LivenessTracker(res.data.steps);
    void track(id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

watch(open, async (isOpen) => {
  error.value = null;
  hint.value = null;
  challenge.value = null;
  frames.value = [];
  tracker = null;
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
    return;
  }
  await startChallenge();
});
onBeforeUnmount(stop);

async function capture() {
  if (!live.value || !challenge.value) return;
  busy.value = true;
  error.value = null;
  try {
    const canvas = snapshot();
    const descriptor = canvas ? await describeFace(canvas) : null;
    if (!canvas || !descriptor) {
      error.value = 'No face detected. Face the camera in good light and try again.';
      return;
    }
    if (!matches(descriptor)) {
      error.value = 'Your face does not match your profile photo. Punch blocked.';
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) throw new Error('Could not capture the image');
    emit('captured', blob, descriptor, {
      challenge: challenge.value.challenge,
      frames: frames.value,
    });
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
        <div v-if="challenge" class="mt-2" aria-label="Liveness check">
          <div class="d-flex flex-wrap ga-2 mb-2">
            <v-chip
              v-for="(step, i) in challenge.steps"
              :key="step"
              size="small"
              :color="i < frames.length ? 'success' : i === frames.length ? 'primary' : undefined"
              :prepend-icon="i < frames.length ? 'mdi-check' : 'mdi-circle-outline'"
            >
              {{ STEP_PROMPTS[step] }}
            </v-chip>
          </div>
          <div v-if="expired" class="text-body-1">
            Time ran out.
            <v-btn variant="text" size="small" @click="startChallenge">Start again</v-btn>
          </div>
          <div v-else-if="current" class="text-h6">{{ STEP_PROMPTS[current] }}</div>
          <div v-else class="text-h6">Look straight at the camera and capture.</div>
          <div v-if="hint && !live" class="text-caption text-medium-emphasis">{{ hint }}</div>
        </div>
        <v-alert v-if="error" type="error" density="compact" class="mt-2">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          prepend-icon="mdi-camera"
          :loading="busy"
          :disabled="!stream || !live"
          @click="capture"
        >
          Capture & punch
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
