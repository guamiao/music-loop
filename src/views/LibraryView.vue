<script setup>
import { ref, onMounted } from 'vue'
import {
  NButton,
  NSpace,
  NModal,
  NInput,
  NSelect,
  NEmpty,
  NDropdown,
  useMessage,
  useDialog,
} from 'naive-ui'
import {
  listSongs,
  addSong,
  renameSong,
  deleteSong,
  listPlaylists,
  updatePlaylist,
} from '../db'
import { player, playSong, playQueue, stop } from '../player'
import { formatTime, readMediaDuration } from '../utils'
import ImportVideoModal from '../components/ImportVideoModal.vue'

const message = useMessage()
const dialog = useDialog()

const songs = ref([])
const playlists = ref([])

async function refresh() {
  songs.value = await listSongs()
  playlists.value = await listPlaylists()
}
onMounted(refresh)

// ---------- 导入音频文件 ----------
const audioInput = ref(null)

function pickAudio() {
  audioInput.value.click()
}

async function onAudioPicked(e) {
  const files = [...e.target.files]
  for (const f of files) {
    const duration = await readMediaDuration(f)
    await addSong({
      name: f.name.replace(/\.\w+$/, ''),
      duration,
      blob: f,
      sourceName: f.name,
      createdAt: Date.now(),
    })
  }
  e.target.value = ''
  if (files.length) message.success(`已导入 ${files.length} 首`)
  refresh()
}

// ---------- 导入视频剪辑 ----------
const showImportVideo = ref(false)

// ---------- 重命名 ----------
const renaming = ref(null)
const newName = ref('')

function openRename(song) {
  renaming.value = song
  newName.value = song.name
}

async function confirmRename() {
  if (!newName.value.trim()) return
  await renameSong(renaming.value.id, newName.value.trim())
  renaming.value = null
  message.success('已重命名')
  refresh()
}

// ---------- 加入歌单 ----------
const addingSong = ref(null)
const targetPlaylistId = ref(null)

function openAddToPlaylist(song) {
  if (!playlists.value.length) {
    message.warning('还没有歌单，请先到「歌单」页创建一个')
    return
  }
  addingSong.value = song
  targetPlaylistId.value = null
}

async function confirmAddToPlaylist() {
  const pl = playlists.value.find((p) => p.id === targetPlaylistId.value)
  if (!pl) return
  if (pl.songIds.includes(addingSong.value.id)) {
    message.warning(`「${pl.name}」中已有这首歌`)
    return
  }
  await updatePlaylist(pl.id, { songIds: [...pl.songIds, addingSong.value.id] })
  message.success(`已加入「${pl.name}」`)
  addingSong.value = null
}

// ---------- 删除 ----------
function confirmDelete(song) {
  dialog.warning({
    title: '删除歌曲',
    content: `确定删除「${song.name}」吗？会同时从所有歌单中移除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await deleteSong(song.id)
      if (player.current?.id === song.id) stop()
      message.success('已删除')
      refresh()
    },
  })
}

// ---------- 每首歌的操作菜单 ----------
const rowActions = [
  { label: '加入歌单', key: 'add-to-playlist' },
  { label: '重命名', key: 'rename' },
  { label: '删除', key: 'delete' },
]

function handleAction(key, song) {
  if (key === 'add-to-playlist') openAddToPlaylist(song)
  else if (key === 'rename') openRename(song)
  else if (key === 'delete') confirmDelete(song)
}
</script>

<template>
  <div>
    <n-space style="margin-bottom: 16px" wrap>
      <n-button type="primary" @click="showImportVideo = true">
        🎬 导入视频并剪辑
      </n-button>
      <n-button @click="pickAudio">🎵 导入音频文件</n-button>
      <n-button v-if="songs.length" @click="playQueue(songs, 0)">▶ 播放全部</n-button>
    </n-space>

    <input
      ref="audioInput"
      type="file"
      accept="audio/*"
      multiple
      hidden
      @change="onAudioPicked"
    />

    <div v-if="songs.length" class="song-list">
      <div
        v-for="song in songs"
        :key="song.id"
        class="song-row"
        :class="{ playing: player.current?.id === song.id }"
      >
        <div class="info" @click="playSong(song, songs)">
          <div class="song-name" :title="song.name">{{ song.name }}</div>
          <div class="song-meta">
            {{ formatTime(song.duration) }}
            <span v-if="song.sourceName" class="source">· {{ song.sourceName }}</span>
          </div>
        </div>
        <n-space size="small" align="center" :wrap="false">
          <n-button size="small" quaternary type="primary" @click="playSong(song, songs)">
            播放
          </n-button>
          <n-dropdown
            trigger="click"
            :options="rowActions"
            @select="(key) => handleAction(key, song)"
          >
            <n-button size="small" quaternary>⋯</n-button>
          </n-dropdown>
        </n-space>
      </div>
    </div>
    <n-empty
      v-else
      description="音乐库还是空的，先导入一个视频或音频吧"
      style="margin-top: 80px"
    />

    <!-- 重命名弹窗 -->
    <n-modal
      :show="!!renaming"
      preset="card"
      title="重命名"
      style="width: 400px; max-width: 92vw"
      @update:show="renaming = null"
    >
      <n-space vertical>
        <n-input
          v-model:value="newName"
          placeholder="歌曲名字"
          @keyup.enter="confirmRename"
        />
        <n-button type="primary" :disabled="!newName.trim()" @click="confirmRename">
          确定
        </n-button>
      </n-space>
    </n-modal>

    <!-- 加入歌单弹窗 -->
    <n-modal
      :show="!!addingSong"
      preset="card"
      :title="`把「${addingSong?.name ?? ''}」加入歌单`"
      style="width: 400px; max-width: 92vw"
      @update:show="addingSong = null"
    >
      <n-space vertical>
        <n-select
          v-model:value="targetPlaylistId"
          placeholder="选择歌单"
          :options="playlists.map((p) => ({ label: p.name, value: p.id }))"
        />
        <n-button type="primary" :disabled="!targetPlaylistId" @click="confirmAddToPlaylist">
          确定
        </n-button>
      </n-space>
    </n-modal>

    <!-- 视频剪辑弹窗 -->
    <import-video-modal v-model:show="showImportVideo" @done="refresh" />
  </div>
</template>

<style scoped>
.song-list {
  display: flex;
  flex-direction: column;
}
.song-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
}
.song-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.song-row.playing .song-name {
  color: #63e2b7;
}
.song-row .info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.song-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-meta {
  font-size: 12px;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
