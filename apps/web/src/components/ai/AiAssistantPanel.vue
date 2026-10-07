<script setup lang="ts">
import type {
  AiChatResponseDto,
  AiConversationDetailDto,
  AiConversationDto,
  AiMessageDto,
  ApiListResponse,
} from '@erp/shared';
import { nextTick, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';

/**
 * Floating "Ask AI" assistant (AppShell). The backend only lets the model call read-only tools
 * the signed-in user is permitted to use, so answers never exceed the caller's own access.
 */
const open = ref(false);
const showHistory = ref(false);
const conversations = ref<AiConversationDto[]>([]);
const conversationId = ref<string | null>(null);
const messages = ref<AiMessageDto[]>([]);
const input = ref('');
const sending = ref(false);
const error = ref<string | null>(null);
const scroller = ref<HTMLElement | null>(null);

const SUGGESTIONS = [
  'How many employees do we have?',
  'Show leave balances for Ravi',
  'Attendance summary for this month',
  'Total of the latest payroll run',
  'How many students are enrolled?',
];

async function loadConversations() {
  try {
    conversations.value = (
      await apiFetch<ApiListResponse<AiConversationDto>>(
        '/api/v1/ai/conversations?pageSize=20&feature=assistant',
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

watch(open, (v) => {
  if (v) void loadConversations();
});

async function scrollToEnd() {
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}

function newChat() {
  conversationId.value = null;
  messages.value = [];
  showHistory.value = false;
  error.value = null;
}

async function openConversation(c: AiConversationDto) {
  error.value = null;
  try {
    const detail = (
      await apiFetch<{ data: AiConversationDetailDto }>(`/api/v1/ai/conversations/${c.id}`)
    ).data;
    conversationId.value = detail.id;
    messages.value = detail.messages;
    showHistory.value = false;
    await scrollToEnd();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function removeConversation(c: AiConversationDto) {
  if (!confirm(`Delete conversation "${c.title}"?`)) return;
  try {
    await apiFetch(`/api/v1/ai/conversations/${c.id}`, { method: 'DELETE' });
    if (conversationId.value === c.id) newChat();
    await loadConversations();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function send(text?: string) {
  const message = (text ?? input.value).trim();
  if (!message || sending.value) return;
  sending.value = true;
  error.value = null;
  try {
    const res = (
      await apiFetch<{ data: AiChatResponseDto }>('/api/v1/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          ...(conversationId.value ? { conversationId: conversationId.value } : {}),
        }),
      })
    ).data;
    conversationId.value = res.conversation.id;
    messages.value.push(...res.messages);
    input.value = '';
    await scrollToEnd();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <v-btn
    class="ai-fab"
    color="secondary"
    icon="mdi-robot-happy-outline"
    size="large"
    elevation="8"
    title="Ask AI"
    @click="open = !open"
  />
  <v-navigation-drawer v-model="open" location="right" width="420" temporary>
    <v-toolbar density="compact" color="secondary">
      <v-toolbar-title>Ask ERP</v-toolbar-title>
      <v-btn icon="mdi-history" title="Conversations" @click="showHistory = !showHistory" />
      <v-btn icon="mdi-plus" title="New chat" @click="newChat" />
      <v-btn icon="mdi-close" title="Close" @click="open = false" />
    </v-toolbar>
    <v-alert v-if="error" type="error" density="compact" class="ma-2" closable>{{ error }}</v-alert>

    <v-list v-if="showHistory" density="compact">
      <v-list-subheader>Your conversations</v-list-subheader>
      <v-list-item v-if="!conversations.length" title="No conversations yet" />
      <v-list-item
        v-for="c in conversations"
        :key="c.id"
        :title="c.title"
        :subtitle="`${c.messageCount} messages · ${new Date(c.updatedAt).toLocaleString()}`"
        @click="openConversation(c)"
      >
        <template #append>
          <v-btn
            icon="mdi-delete"
            size="small"
            variant="text"
            title="Delete"
            @click.stop="removeConversation(c)"
          />
        </template>
      </v-list-item>
    </v-list>

    <template v-else>
      <div ref="scroller" class="ai-messages pa-3">
        <div v-if="!messages.length" class="text-medium-emphasis">
          <p class="mb-2">
            Ask about your organization's data. I only read what you are allowed to see.
          </p>
          <v-chip
            v-for="s in SUGGESTIONS"
            :key="s"
            class="ma-1"
            size="small"
            variant="outlined"
            @click="send(s)"
          >
            {{ s }}
          </v-chip>
        </div>
        <div
          v-for="m in messages"
          :key="m.id"
          class="mb-3"
          :class="m.role === 'user' ? 'text-right' : ''"
        >
          <v-sheet
            :color="m.role === 'user' ? 'primary' : 'surface-variant'"
            rounded="lg"
            class="d-inline-block pa-2 text-left ai-bubble"
          >
            <div class="ai-text">{{ m.content }}</div>
            <div v-if="m.toolCalls.length" class="mt-1">
              <v-chip
                v-for="(t, i) in m.toolCalls"
                :key="i"
                size="x-small"
                class="mr-1"
                :color="t.ok ? 'success' : 'error'"
                :title="t.summary"
                prepend-icon="mdi-database-search"
              >
                {{ t.name }}
              </v-chip>
            </div>
          </v-sheet>
        </div>
        <v-progress-linear v-if="sending" indeterminate color="secondary" />
      </div>
      <div class="pa-2 d-flex align-center">
        <v-textarea
          v-model="input"
          rows="1"
          auto-grow
          max-rows="4"
          hide-details
          density="compact"
          placeholder="Ask a question…"
          @keydown.enter.exact.prevent="send()"
        />
        <v-btn
          icon="mdi-send"
          variant="text"
          color="secondary"
          :loading="sending"
          :disabled="!input.trim()"
          @click="send()"
        />
      </div>
    </template>
  </v-navigation-drawer>
</template>

<style scoped>
.ai-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1005;
}
.ai-messages {
  height: calc(100vh - 170px);
  overflow-y: auto;
}
.ai-bubble {
  max-width: 90%;
}
.ai-text {
  white-space: pre-wrap;
}
</style>
