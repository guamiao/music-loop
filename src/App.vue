<script setup>
import { ref } from 'vue'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NLayout,
  NLayoutHeader,
  NLayoutContent,
  NLayoutFooter,
  NButton,
  NSpace,
  darkTheme,
} from 'naive-ui'
import LibraryView from './views/LibraryView.vue'
import PlaylistsView from './views/PlaylistsView.vue'
import PlayerBar from './components/PlayerBar.vue'

const view = ref('library')
</script>

<template>
  <n-config-provider :theme="darkTheme">
    <n-message-provider>
      <n-dialog-provider>
        <n-layout style="height: 100vh">
          <n-layout-header
            bordered
            class="app-header"
            style="
              padding: 12px 24px;
              padding-top: calc(12px + env(safe-area-inset-top, 0px));
              padding-left: calc(24px + env(safe-area-inset-left, 0px));
              padding-right: calc(24px + env(safe-area-inset-right, 0px));
              display: flex;
              align-items: center;
              gap: 24px;
            "
          >
            <span style="font-size: 18px; font-weight: 600; white-space: nowrap">
              🎵 Music Loop
            </span>
            <n-space>
              <n-button
                :type="view === 'library' ? 'primary' : 'default'"
                @click="view = 'library'"
              >
                音乐库
              </n-button>
              <n-button
                :type="view === 'playlists' ? 'primary' : 'default'"
                @click="view = 'playlists'"
              >
                歌单
              </n-button>
            </n-space>
          </n-layout-header>
          <n-layout-content class="app-content" style="padding: 24px">
            <library-view v-show="view === 'library'" />
            <playlists-view v-show="view === 'playlists'" />
          </n-layout-content>
          <n-layout-footer bordered class="app-footer">
            <player-bar />
          </n-layout-footer>
        </n-layout>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
/* 窄屏（手机）适配：压缩头部和内容区的留白 */
@media (max-width: 640px) {
  .app-header {
    padding: 10px 12px !important;
    padding-top: calc(10px + env(safe-area-inset-top, 0px)) !important;
    padding-left: calc(12px + env(safe-area-inset-left, 0px)) !important;
    padding-right: calc(12px + env(safe-area-inset-right, 0px)) !important;
    gap: 12px !important;
  }
  .app-content {
    padding: 12px !important;
  }
}

/* iOS 底部 Home 指示条安全区，避免遮挡播放器 */
.app-footer {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
