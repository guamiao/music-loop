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
const extracting = ref(false)
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
  extracting.value = true
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
    message.error('提取失败：' + (err?.message || err))
  } finally {
    extracting.value = false
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
    :mask-closable="!extracting"
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
      <n-button :disabled="extracting" @click="pick">
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
            :disabled="extracting"
          />
        </div>
        <n-input
          v-model:value="name"
          placeholder="给这段音频起个名字"
          :disabled="extracting"
        />
        <n-progress v-if="extracting" type="line" :percentage="progress" />
        <n-button
          type="primary"
          :loading="extracting"
          :disabled="!name.trim()"
          @click="doExtract"
        >
          {{ extracting ? '提取中…' : '提取音频并存入音乐库' }}
        </n-button>
        <n-text v-if="extracting" depth="3" style="font-size: 12px">
          首次使用需要加载 ffmpeg 核心文件（约 25MB），请耐心等待
        </n-text>
      </template>
    </n-space>
  </n-modal>
</template>
