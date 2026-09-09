import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

let ffmpeg = null
let loading = null

// 主动绕过 Service Worker，直接从网络获取文件并转为 Blob URL
// 解决 SW 预缓存 32MB WASM 文件时卡死导致整个加载挂起的问题
async function fetchAsBlobURL(url) {
  const resp = await fetch(url, { cache: 'no-store' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}

export function getFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg)
  if (loading) return loading

  const instance = new FFmpeg()

  loading = (async () => {
    try {
      // 绕过 SW：直接 fetch 文件，转为 Blob URL 再传给 load()
      const [coreBlob, wasmBlob] = await Promise.all([
        fetchAsBlobURL(coreURL),
        fetchAsBlobURL(wasmURL),
      ])
      try {
        await instance.load({ coreURL: coreBlob, wasmURL: wasmBlob })
      } finally {
        // Blob URL 用完即释放（load 内部已读取完毕）
        URL.revokeObjectURL(coreBlob)
        URL.revokeObjectURL(wasmBlob)
      }
      ffmpeg = instance
      return ffmpeg
    } catch (err) {
      loading = null
      throw err
    }
  })()

  return loading
}

export async function extractAudio(videoFile, start, end, onProgress) {
  const ff = await getFFmpeg()
  const ext = videoFile.name.match(/\.\w+$/)?.[0] || '.mp4'
  const input = `input${ext}`
  const progressHandler = ({ progress }) => {
    if (onProgress && progress >= 0 && progress <= 1) onProgress(progress)
  }
  ff.on('progress', progressHandler)
  try {
    await ff.writeFile(input, await fetchFile(videoFile))
    await ff.exec([
      '-ss', start.toFixed(2),
      '-to', end.toFixed(2),
      '-i', input,
      '-vn',
      '-acodec', 'libmp3lame',
      '-q:a', '4',
      'output.mp3',
    ])
    const data = await ff.readFile('output.mp3')
    await ff.deleteFile(input)
    await ff.deleteFile('output.mp3')
    return new Blob([data], { type: 'audio/mpeg' })
  } finally {
    ff.off('progress', progressHandler)
  }
}
