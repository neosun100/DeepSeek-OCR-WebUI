<template>
  <div class="empty-state-container">
    <div class="empty-state-hero">
      <div class="empty-icon-container">
        <NIcon
          size="64"
          :color="PRIMARY_COLOR"
        >
          <CloudUploadOutline />
        </NIcon>
      </div>
      <h2
        class="empty-title"
        data-testid="welcome-title"
      >
        {{ $t('app.welcomeTitle') }}
      </h2>
      <p
        class="empty-description"
        data-testid="welcome-description"
      >
        {{ $t('app.welcomeDescription') }}
      </p>
      <NButton
        type="primary"
        size="large"
        class="select-files-btn empty-add-btn"
        data-testid="start-import-button"
        @click="$emit('add-files')"
      >
        <template #icon>
          <NIcon>
            <AddOutline />
          </NIcon>
        </template>
        {{ $t('app.startImport') }}
      </NButton>
    </div>
    <div class="empty-state-footer">
      <span>Made with ❤️ by </span>
      <a
        href="https://github.com/neosun100"
        target="_blank"
        rel="noopener"
      >neosun100</a>
      <span> & </span>
      <a
        href="https://github.com/cloudman6"
        target="_blank"
        rel="noopener"
      >cloudman6</a>
      <div class="footer-version">
        DeepSeek-OCR-WebUI {{ APP_VERSION_LABEL }} | © 2026
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { APP_VERSION_LABEL } from '@/version'
import { NIcon, NButton } from 'naive-ui'
import { CloudUploadOutline, AddOutline } from '@vicons/ionicons5'
import { PRIMARY_COLOR } from '@/theme/vars'

defineEmits<{
  (e: 'add-files'): void
}>()
</script>

<style scoped>
.empty-state-container {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f9fafb;
}

.empty-state-hero {
  text-align: center;
  padding: 40px;
  max-width: 600px;
}

.icon-wrapper {
  margin-bottom: 24px;
  animation: float 6s ease-in-out infinite;
}

.hero-title {
  font-size: 32px;
  font-weight: 800;
  color: #333;
  margin: 0 0 16px 0;
  letter-spacing: -1px;
}

.hero-subtitle {
  font-size: 18px;
  color: #666;
  margin: 0 0 32px 0;
}

.select-files-btn {
  font-weight: 600;
  padding: 0 32px;
  height: 48px;
  font-size: 16px;
  box-shadow: 0 4px 14px 0 rgba(24, 160, 88, 0.39);
}

@keyframes float {
  0% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
  }
  100% {
    transform: translateY(0px);
  }
}

.empty-state-footer {
  position: absolute;
  bottom: 24px;
  left: 0;
  right: 0;
  text-align: center;
  color: #999;
  font-size: 14px;
}

.empty-state-footer a {
  color: v-bind(PRIMARY_COLOR);
  text-decoration: none;
  font-weight: 500;
}

.empty-state-footer a:hover {
  text-decoration: underline;
}

.footer-version {
  margin-top: 4px;
  font-size: 12px;
  color: #bbb;
}
</style>
