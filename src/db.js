import Dexie from 'dexie'

// 本地数据库：歌曲 + 歌单，全部存在浏览器 IndexedDB 中
export const db = new Dexie('music-loop')

db.version(1).stores({
  // Song: { id, name, duration, blob, sourceName, createdAt }
  songs: '++id, createdAt',
  // Playlist: { id, name, songIds[], createdAt }
  playlists: '++id, createdAt',
})

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
