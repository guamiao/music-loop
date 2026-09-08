<script setup>
import { NButton, NSlider, NSpace } from 'naive-ui'
import {
  player,
  togglePlay,
  next,
  prev,
  seek,
  cycleMode,
  currentMode,
} from '../player'
import { formatTime } from '../utils'
</script>

<template>
  <div class="player-bar">
    <div class="song-info">
      <div v-if="player.current" class="song-name" :title="player.current.name">
        {{ player.current.name }}
      </div>
      <span v-else style="opacity: 0.5">暂无播放</span>
    </div>
    <div class="controls">
      <n-space align="center">
        <n-button quaternary circle @click="prev" title="上一首">⏮</n-button>
        <n-button
          type="primary"
          circle
          size="large"
          :disabled="!player.current"
          @click="togglePlay"
        >
          {{ player.playing ? '⏸' : '▶' }}
        </n-button>
        <n-button quaternary circle @click="next" title="下一首">⏭</n-button>
        <n-button quaternary @click="cycleMode" :title="currentMode().label">
          {{ currentMode().icon }} {{ currentMode().label }}
        </n-button>
      </n-space>
    </div>
    <div class="progress">
      <span class="time">{{ formatTime(player.currentTime) }}</span>
      <n-slider
        :value="player.currentTime"
        :max="player.duration || 0"
        :step="0.1"
        :format-tooltip="formatTime"
        style="flex: 1"
        @update:value="seek"
      />
      <span class="time">{{ formatTime(player.duration) }}</span>
    </div>
  </div>
</template>

<style scoped>
.player-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 24px;
}
.song-info {
  width: 220px;
  overflow: hidden;
  flex-shrink: 0;
}
.song-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.controls {
  flex-shrink: 0;
}
.progress {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}
.time {
  font-size: 12px;
  opacity: 0.7;
  width: 44px;
  text-align: center;
  flex-shrink: 0;
}

/* 窄屏（手机）：两行布局——上行歌名+控制，下行进度条 */
@media (max-width: 640px) {
  .player-bar {
    flex-wrap: wrap;
    gap: 4px 12px;
    padding: 8px 12px;
  }
  .song-info {
    width: auto;
    flex: 1;
    min-width: 0;
  }
  .progress {
    flex-basis: 100%;
    order: 3;
  }
}
</style>
