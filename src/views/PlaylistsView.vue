<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  NButton,
  NModal,
  NInput,
  NEmpty,
  NSpace,
  NCheckbox,
  NCheckboxGroup,
  NScrollbar,
  useMessage,
  useDialog,
} from 'naive-ui'
import {
  listPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  listSongs,
  getSongsByIds,
} from '../db'
import { playQueue, playSong } from '../player'
import { formatTime } from '../utils'

const message = useMessage()
const dialog = useDialog()

const playlists = ref([])
const allSongs = ref([])
const currentId = ref(null)
const currentSongs = ref([])

// 窄屏（手机）时列表和详情二选一显示
const isMobile = ref(window.innerWidth <= 640)
const mobileShowDetail = ref(false)

function onResize() {
  isMobile.value = window.innerWidth <= 640
}

const current = computed(() => playlists.value.find((p) => p.id === currentId.value))

async function refresh() {
  playlists.value = await listPlaylists()
  allSongs.value = await listSongs()
  if (!playlists.value.find((p) => p.id === currentId.value)) {
    // 桌面端默认选中第一个歌单；手机端停留在歌单列表
    currentId.value = isMobile.value ? null : (playlists.value[0]?.id ?? null)
  }
  await loadCurrentSongs()
}

async function loadCurrentSongs() {
  currentSongs.value = current.value ? await getSongsByIds(current.value.songIds) : []
}

function selectPlaylist(id) {
  currentId.value = id
  mobileShowDetail.value = true
}

watch(currentId, loadCurrentSongs)
onMounted(() => {
  window.addEventListener('resize', onResize)
  refresh()
})
onUnmounted(() => window.removeEventListener('resize', onResize))

// ---------- 新建歌单 ----------
const showCreate = ref(false)
const newPlaylistName = ref('')

async function confirmCreate() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  const id = await createPlaylist(name)
  showCreate.value = false
  newPlaylistName.value = ''
  message.success(`已创建歌单「${name}」`)
  await refresh()
  currentId.value = id
  mobileShowDetail.value = true
}

// ---------- 删除歌单 ----------
function confirmDeletePlaylist() {
  if (!current.value) return
  dialog.warning({
    title: '删除歌单',
    content: `确定删除歌单「${current.value.name}」吗？歌曲仍会保留在音乐库中。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await deletePlaylist(current.value.id)
      message.success('已删除歌单')
      mobileShowDetail.value = false
      refresh()
    },
  })
}

// ---------- 添加歌曲到歌单 ----------
const showAddSongs = ref(false)
const checkedIds = ref([])

const addableSongs = computed(() => {
  if (!current.value) return []
  return allSongs.value.filter((s) => !current.value.songIds.includes(s.id))
})

async function confirmAddSongs() {
  if (!checkedIds.value.length) return
  await updatePlaylist(current.value.id, {
    songIds: [...current.value.songIds, ...checkedIds.value],
  })
  message.success(`已添加 ${checkedIds.value.length} 首`)
  checkedIds.value = []
  showAddSongs.value = false
  refresh()
}

// ---------- 歌单内编辑 ----------
async function removeSong(songId) {
  await updatePlaylist(current.value.id, {
    songIds: current.value.songIds.filter((id) => id !== songId),
  })
  refresh()
}

async function moveSong(index, dir) {
  const ids = [...current.value.songIds]
  const target = index + dir
  if (target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  await updatePlaylist(current.value.id, { songIds: ids })
  refresh()
}
</script>

<template>
  <div class="playlists-page">
    <!-- 左侧：歌单列表 -->
    <div v-show="!isMobile || !mobileShowDetail" class="sidebar">
      <n-button type="primary" block @click="showCreate = true">＋ 新建歌单</n-button>
      <n-scrollbar style="flex: 1; margin-top: 12px">
        <div
          v-for="p in playlists"
          :key="p.id"
          class="playlist-item"
          :class="{ active: p.id === currentId }"
          @click="selectPlaylist(p.id)"
        >
          <span class="name">{{ p.name }}</span>
          <span class="count">{{ p.songIds.length }} 首</span>
        </div>
        <n-empty
          v-if="!playlists.length"
          description="还没有歌单"
          style="margin-top: 60px"
        />
      </n-scrollbar>
    </div>

    <!-- 右侧：歌单详情 -->
    <div v-show="!isMobile || mobileShowDetail" class="detail">
      <template v-if="current">
        <div class="detail-header">
          <n-space align="center" :wrap="false" style="min-width: 0">
            <n-button
              v-if="isMobile"
              quaternary
              @click="mobileShowDetail = false"
            >
              ← 返回
            </n-button>
            <h2 class="playlist-title">{{ current.name }}</h2>
          </n-space>
          <n-space>
            <n-button
              type="primary"
              :disabled="!currentSongs.length"
              @click="playQueue(currentSongs, 0)"
            >
              ▶ 播放全部
            </n-button>
            <n-button :disabled="!addableSongs.length" @click="showAddSongs = true">
              添加歌曲
            </n-button>
            <n-button type="error" quaternary @click="confirmDeletePlaylist">
              删除歌单
            </n-button>
          </n-space>
        </div>

        <n-empty
          v-if="!currentSongs.length"
          description="歌单还是空的，点击「添加歌曲」从音乐库挑选"
          style="margin-top: 80px"
        />
        <div v-else class="song-list">
          <div v-for="(song, i) in currentSongs" :key="song.id" class="song-row">
            <span class="index">{{ i + 1 }}</span>
            <span class="song-name" :title="song.name">{{ song.name }}</span>
            <span class="duration">{{ formatTime(song.duration) }}</span>
            <n-space size="small">
              <n-button size="tiny" quaternary @click="playSong(song, currentSongs)">
                播放
              </n-button>
              <n-button size="tiny" quaternary :disabled="i === 0" @click="moveSong(i, -1)">
                ↑
              </n-button>
              <n-button
                size="tiny"
                quaternary
                :disabled="i === currentSongs.length - 1"
                @click="moveSong(i, 1)"
              >
                ↓
              </n-button>
              <n-button size="tiny" quaternary type="error" @click="removeSong(song.id)">
                移除
              </n-button>
            </n-space>
          </div>
        </div>
      </template>
      <n-empty v-else description="选择或创建一个歌单" style="margin-top: 80px" />
    </div>

    <!-- 新建歌单弹窗 -->
    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="新建歌单"
      style="width: 400px"
    >
      <n-space vertical>
        <n-input
          v-model:value="newPlaylistName"
          placeholder="歌单名字"
          @keyup.enter="confirmCreate"
        />
        <n-button type="primary" :disabled="!newPlaylistName.trim()" @click="confirmCreate">
          创建
        </n-button>
      </n-space>
    </n-modal>

    <!-- 添加歌曲弹窗 -->
    <n-modal
      v-model:show="showAddSongs"
      preset="card"
      :title="`添加歌曲到「${current?.name ?? ''}」`"
      style="width: 480px"
    >
      <n-space vertical>
        <n-scrollbar style="max-height: 320px">
          <n-checkbox-group v-model:value="checkedIds">
            <n-space vertical>
              <n-checkbox
                v-for="s in addableSongs"
                :key="s.id"
                :value="s.id"
                :label="`${s.name}（${formatTime(s.duration)}）`"
              />
            </n-space>
          </n-checkbox-group>
        </n-scrollbar>
        <n-button type="primary" :disabled="!checkedIds.length" @click="confirmAddSongs">
          添加 {{ checkedIds.length ? `（${checkedIds.length} 首）` : '' }}
        </n-button>
      </n-space>
    </n-modal>
  </div>
</template>

<style scoped>
.playlists-page {
  display: flex;
  gap: 24px;
  height: 100%;
}
.sidebar {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.playlist-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
}
.playlist-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.playlist-item.active {
  background: rgba(99, 226, 183, 0.15);
}
.playlist-item .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.playlist-item .count {
  font-size: 12px;
  opacity: 0.6;
  flex-shrink: 0;
  margin-left: 8px;
}
.detail {
  flex: 1;
  min-width: 0;
}
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.song-list {
  display: flex;
  flex-direction: column;
}
.song-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 6px;
}
.song-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.song-row .index {
  width: 24px;
  text-align: right;
  opacity: 0.5;
  flex-shrink: 0;
}
.song-row .song-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.song-row .duration {
  font-size: 12px;
  opacity: 0.6;
  flex-shrink: 0;
}
.playlist-title {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 窄屏（手机）：侧边栏占满整行，详情页头部纵向排列 */
@media (max-width: 640px) {
  .playlists-page {
    gap: 0;
  }
  .sidebar {
    width: 100%;
  }
  .detail-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
