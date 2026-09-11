<script setup>
import { ref } from 'vue'
import {
  NModal,
  NButton,
  NInput,
  NSlider,
  NSpace,
  NProgress,
  NText,
  useMessage,
} from 'naive-ui'
import { extractAudio } from '../ffmpeg'
import { addSong } from '../db'
import { formatTime, readMediaDuration } from '../utils'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['update:show', 'done'])
const message = useMessage()

const fileInput = ref(null)
const videoEl = ref(null)
const videoFile = ref(null)
const videoUrl = ref('')
const duration = ref(0)
const range = ref([0, 0])
const name = ref('')
const busy = ref(false)       // 防抖：整个提取流程期间锁定按钮
const progress = ref(0)
// 当前阶段：waiting = 等待下载节点响应（冷启动），download = 下载引擎，
// init = 本地启动引擎，extract = 正在转码提取
const phase = ref('extract')

function pick() {
  fileInput.value.click()
}

function onPicked(e) {
  const file = e.target.files[0]
  if (!file) return
  reset()
  videoFile.value = file
  name.value = file.name.replace(/\.\w+$/, '')
  videoUrl.value = URL.createObjectURL(file)
  e.target.value = ''
}

function onLoaded() {
  duration.value = videoEl.value.duration
  range.value = [0, Math.floor(duration.value * 10) / 10]
}

async function doExtract() {
  if (busy.value) return
  busy.value = true
  phase.value = 'extract'
  progress.value = 0
  try {
    const blob = await extractAudio(
      videoFile.value,
      range.value[0],
      range.value[1],
      {
        onDownloadProgress: (p) => {
          phase.value = 'download'
          progress.value = Math.round(p * 100)
        },
        onWaiting: () => {
          // CDN 节点冷启动回源中（响应头已到、首字节未到）
          if (phase.value !== 'download') phase.value = 'waiting'
          progress.value = 0
        },
        onStage: (s) => {
          phase.value = s
          if (s === 'init') progress.value = 100
          if (s === 'extract') progress.value = 0
        },
        onProgress: (p) => {
          phase.value = 'extract'
          progress.value = Math.round(p * 100)
        },
      },
    )
    const audioDuration = await readMediaDuration(blob)
    await addSong({
      name: name.value.trim() || videoFile.value.name,
      duration: audioDuration || range.value[1] - range.value[0],
      blob,
      sourceName: videoFile.value.name,
      createdAt: Date.now(),
    })
    message.success('提取成功，已加入音乐库')
    close()
    emit('done')
  } catch (err) {
    console.error(err)
    const msg = err?.message || String(err)
    if (msg.includes('NetworkError') || msg.includes('network') || msg.includes('Failed to fetch')) {
      message.error('网络加载 ffmpeg 核心文件失败，请检查网络后重试')
    } else {
      message.error('提取失败：' + msg)
    }
  } finally {
    busy.value = false
  }
}

function reset() {
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
  videoFile.value = null
  videoUrl.value = ''
  duration.value = 0
  range.value = [0, 0]
  name.value = ''
  progress.value = 0
}

function close() {
  reset()
  emit('update:show', false)
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="导入视频并提取音频"
    style="width: 640px"
    :mask-closable="!busy"
    @update:show="close"
  >
    <input
      ref="fileInput"
      type="file"
      accept="video/*"
      hidden
      @change="onPicked"
    />
    <n-space vertical size="large">
      <n-button :disabled="busy" @click="pick">
        {{ videoFile ? '重新选择视频' : '选择视频文件' }}
      </n-button>
      <template v-if="videoUrl">
        <video
          ref="videoEl"
          :src="videoUrl"
          controls
          style="width: 100%; max-height: 280px; background: #000"
          @loadedmetadata="onLoaded"
        />
        <div>
          <n-text depth="3" style="font-size: 13px">
            剪辑范围：{{ formatTime(range[0]) }} ~ {{ formatTime(range[1]) }}
            （视频全长 {{ formatTime(duration) }}）
          </n-text>
          <n-slider
            v-model:value="range"
            range
            :min="0"
            :max="duration"
            :step="0.1"
            :format-tooltip="formatTime"
            :disabled="busy"
          />
        </div>
        <n-input
          v-model:value="name"
          placeholder="给这段音频起个名字"
          :disabled="busy"
        />
        <n-progress
          v-if="busy"
          type="line"
          :percentage="progress"
          :processing="phase === 'init' || phase === 'waiting'"
          :show-indicator="phase !== 'init' && phase !== 'waiting'"
          :height="10"
        />
        <!-- 忙碌态与空闲态使用两个独立节点（v-if/v-else），
             避免 iOS Safari 在同一按钮反复切换文字/loading 时留下合成层残影（表现为按钮堆叠） -->
        <n-button
          v-if="busy"
          class="extract-btn"
          type="primary"
          loading
          disabled
        >
          {{
            phase === 'waiting'
              ? '连接中…'
              : phase === 'download'
                ? '准备中…'
                : phase === 'init'
                  ? '启动引擎中…'
                  : '提取中…'
          }}
        </n-button>
        <n-button
          v-else
          class="extract-btn"
          type="primary"
          :disabled="!name.trim()"
          @click="doExtract"
        >
          提取音频并存入音乐库
        </n-button>
        <n-text v-if="busy" depth="3" style="font-size: 12px">
          <template v-if="phase === 'waiting'">
            正在连接国内下载节点，首次访问可能需要几十秒唤醒节点缓存，请保持页面在前台稍候…
          </template>
          <template v-else-if="phase === 'download'">
            正在下载音频引擎（约 32MB）{{ progress }}%，网络波动会自动断点续传，下载一次后永久缓存…
          </template>
          <template v-else-if="phase === 'init'">
            引擎已下载完成，正在手机本地启动（通常几秒到几十秒），请保持页面在前台、不要锁屏或切走…
          </template>
          <template v-else>
            正在提取音频 {{ progress }}%，请耐心等待…
          </template>
        </n-text>
      </template>
    </n-space>
  </n-modal>
</template>

<style scoped>
/* 强制按钮独立合成层，规避 iOS WebKit 按钮状态切换后的重绘残影 */
.extract-btn {
  transform: translateZ(0);
  -webkit-transform: translateZ(0);
}
</style>
