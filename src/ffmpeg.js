import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

let ffmpeg = null
let loading = null

// 加载 wasm 时偶发 NetworkError（Service Worker / iOS 后台限制），带指数退避重试
async function loadWithRetry(instance, opts, retries = 3, delay = 2000) {
  for (let i = 0; i <= retries; i++) {
    try {
      await instance.load(opts)
      return
    } catch (err) {
      const isNetwork =
        err?.message?.includes('NetworkError') ||
        err?.message?.includes('network') ||
        err?.message?.includes('Failed to fetch')
      if (isNetwork && i < retries) {
        console.warn(`ffmpeg 加载失败（网络），${delay}ms 后重试 (${i + 1}/${retries})…`)
        await new Promise((r) => setTimeout(r, delay))
        delay *= 2 // 指数退避：2s → 4s → 8s
        continue
      }
      throw err
    }
  }
}

export function getFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg)
  if (loading) return loading
  const instance = new FFmpeg()
  loading = loadWithRetry(instance, { coreURL, wasmURL }).then(() => {
    ffmpeg = instance
    return ffmpeg
  }).catch((err) => {
    loading = null // 失败后清除缓存，下次可重试
    throw err
  })
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
