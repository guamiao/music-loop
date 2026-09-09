import Dexie from 'dexie'

// 本地数据库：歌曲 + 歌单，全部存在浏览器 IndexedDB 中
export const db = new Dexie('music-loop')

db.version(1).stores({
  // Song: { id, name, duration, blob, sourceName, createdAt }
  songs: '++id, createdAt',
  // Playlist: { id, name, songIds[], createdAt }
  playlists: '++id, createdAt',
})

// ---------- localStorage 自动备份（防止 iOS Safari 存储压力清空 IndexedDB） ----------
const BACKUP_KEY = 'music-loop-backup'
const BACKUP_VERSION = 1

async function backup() {
  try {
    const [songs, playlists] = await Promise.all([
      db.songs.toArray(),
      db.playlists.toArray(),
    ])
    const data = { v: BACKUP_VERSION, songs, playlists, ts: Date.now() }
    localStorage.setItem(BACKUP_KEY, JSON.stringify(data))
  } catch (e) {
    console.warn('备份数据失败:', e)
  }
}

async function restore() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return false
    const data = JSON.parse(raw)
    if (data.v !== BACKUP_VERSION) return false
    // 数据库为空时才恢复，避免覆盖用户已有数据
    const songCount = await db.songs.count()
    if (songCount > 0) return false
    if (data.songs?.length) await db.songs.bulkAdd(data.songs)
    if (data.playlists?.length) await db.playlists.bulkAdd(data.playlists)
    console.log(`从备份恢复了 ${data.songs.length} 首歌曲、${data.playlists.length} 个歌单`)
    return true
  } catch (e) {
    console.warn('恢复备份失败:', e)
    return false
  }
}

// 监听 Dexie 写操作，自动备份（防抖500ms，避免频繁写入）
let backupTimer = null
function scheduleBackup() {
  if (backupTimer) clearTimeout(backupTimer)
  backupTimer = setTimeout(() => { backup(); backupTimer = null }, 500)
}
db.songs.hook('creating', scheduleBackup)
db.songs.hook('updating', scheduleBackup)
db.songs.hook('deleting', scheduleBackup)
db.playlists.hook('creating', scheduleBackup)
db.playlists.hook('updating', scheduleBackup)
db.playlists.hook('deleting', scheduleBackup)

// 启动时检查是否需要恢复
export const dbReady = restore()

// ---------- 歌曲 ----------

export function addSong(song) {
  return db.songs.add(song)
}

export function listSongs() {
  return db.songs.orderBy('createdAt').reverse().toArray()
}

export function renameSong(id, name) {
  return db.songs.update(id, { name })
}

// 删除歌曲时，同步从所有歌单中移除
export function deleteSong(id) {
  return db.transaction('rw', db.songs, db.playlists, async () => {
    await db.songs.delete(id)
    const playlists = await db.playlists.toArray()
    for (const p of playlists) {
      if (p.songIds.includes(id)) {
        await db.playlists.update(p.id, {
          songIds: p.songIds.filter((sid) => sid !== id),
        })
      }
    }
  })
}

// 按 id 列表顺序取歌曲（歌单内顺序以 songIds 为准）
export async function getSongsByIds(ids) {
  const songs = await db.songs.bulkGet(ids)
  return songs.filter(Boolean)
}

// ---------- 歌单 ----------

export function listPlaylists() {
  return db.playlists.orderBy('createdAt').toArray()
}

export function createPlaylist(name) {
  return db.playlists.add({ name, songIds: [], createdAt: Date.now() })
}

export function updatePlaylist(id, changes) {
  return db.playlists.update(id, changes)
}

export function deletePlaylist(id) {
  return db.playlists.delete(id)
}
