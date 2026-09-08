import { reactive } from 'vue'

// 全局唯一的播放器：直接操作一个 <audio> 元素，状态用 reactive 暴露给界面
const audio = new Audio()
audio.preload = 'auto'

export const MODES = [
  { key: 'sequence', label: '列表循环', icon: '🔁' },
  { key: 'repeat-one', label: '单曲循环', icon: '🔂' },
  { key: 'shuffle', label: '随机播放', icon: '🔀' },
]

export const player = reactive({
  queue: [], // 当前播放队列（歌曲对象数组）
  currentIndex: -1,
  current: null, // 当前歌曲
  playing: false,
  currentTime: 0,
  duration: 0,
  mode: 'sequence',
})

let objectUrl = null

function loadCurrent() {
  const song = player.current
  if (!song) return
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(song.blob)
  audio.src = objectUrl
  audio.play().catch(() => {})
  updateMediaSession(song)
}

// 把当前歌曲信息推给系统：锁屏界面/通知栏显示歌名和控制按钮
function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.name,
    artist: 'Music Loop',
    album: '我的音乐库',
  })
}

// 响应锁屏/通知栏上的控制按钮
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}))
  navigator.mediaSession.setActionHandler('pause', () => audio.pause())
  navigator.mediaSession.setActionHandler('previoustrack', () => prev())
  navigator.mediaSession.setActionHandler('nexttrack', () => next())
  navigator.mediaSession.setActionHandler('seekto', (e) => {
    if (e.seekTime != null) audio.currentTime = e.seekTime
  })
}

// 用一组歌曲作为队列播放，从 startIndex 开始
export function playQueue(songs, startIndex = 0) {
  if (!songs.length) return
  player.queue = songs
  player.currentIndex = startIndex
  player.current = songs[startIndex]
  loadCurrent()
}

// 播放单首歌；不传 queue 时队列只有这一首
export function playSong(song, queue = null) {
  if (queue && queue.length) {
    const index = queue.findIndex((s) => s.id === song.id)
    playQueue(queue, index >= 0 ? index : 0)
  } else {
    playQueue([song], 0)
  }
}

export function togglePlay() {
  if (!player.current) return
  if (audio.paused) {
    audio.play().catch(() => {})
  } else {
    audio.pause()
  }
}

export function stop() {
  audio.pause()
  player.queue = []
  player.currentIndex = -1
  player.current = null
  player.currentTime = 0
  player.duration = 0
}

export function seek(time) {
  if (!player.current) return
  audio.currentTime = time
}

export function next() {
  const n = player.queue.length
  if (!n) return
  if (player.mode === 'shuffle' && n > 1) {
    let i
    do {
      i = Math.floor(Math.random() * n)
    } while (i === player.currentIndex)
    player.currentIndex = i
  } else {
    player.currentIndex = (player.currentIndex + 1) % n
  }
  player.current = player.queue[player.currentIndex]
  loadCurrent()
}

export function prev() {
  // 播放超过 3 秒时，"上一首"先回到本曲开头（和主流播放器一致）
  if (audio.currentTime > 3) {
    audio.currentTime = 0
    return
  }
  const n = player.queue.length
  if (!n) return
  player.currentIndex = (player.currentIndex - 1 + n) % n
  player.current = player.queue[player.currentIndex]
  loadCurrent()
}

export function cycleMode() {
  const i = MODES.findIndex((m) => m.key === player.mode)
  player.mode = MODES[(i + 1) % MODES.length].key
  audio.loop = player.mode === 'repeat-one'
}

export function currentMode() {
  return MODES.find((m) => m.key === player.mode)
}

audio.addEventListener('timeupdate', () => {
  player.currentTime = audio.currentTime
})
audio.addEventListener('loadedmetadata', () => {
  player.duration = audio.duration
})
audio.addEventListener('play', () => {
  player.playing = true
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
})
audio.addEventListener('pause', () => {
  player.playing = false
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
})
audio.addEventListener('ended', () => {
  // 单曲循环由 audio.loop 自动处理，其余模式切下一首
  if (player.mode === 'repeat-one') return
  next()
})
