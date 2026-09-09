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
  progress.value = 0
  try {
    const blob = await extractAudio(
      videoFile.value,
      range.value[0],
      range.value[1],
      (p) => {
        progress.value = Math.round(p * 100)
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
        <n-progress v-if="busy" type="line" :percentage="progress" />
        <n-button
          type="primary"
          :loading="busy"
          :disabled="!name.trim()"
          @click="doExtract"
        >
          {{ busy ? '提取中…' : '提取音频并存入音乐库' }}
        </n-button>
        <n-text v-if="busy" depth="3" style="font-size: 12px">
          正在加载 ffmpeg 核心文件并提取音频，请耐心等待…
        </n-text>
      </template>
    </n-space>
  </n-modal>
</template>
