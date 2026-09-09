import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

let ffmpeg = null
let loading = null

const LOAD_TIMEOUT = 180000 // 180 秒超时，覆盖慢速网络下载 32MB WASM 文件的场景
const MAX_RETRIES = 3

function isNetworkError(err) {
  const msg = err?.message || ''
  return (
    msg.includes('NetworkError') ||
    msg.includes('network') ||
    msg.includes('Failed to fetch') ||
    err?.name === 'AbortError' ||
    msg.includes('超时')
  )
}

// 带超时的 fetch，防止 SW 卡死时无限挂起
function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

// 将 URL 转为 data URL（base64 内联），绕过 Service Worker 缓存问题
async function toDataURL(url) {
  const resp = await fetchWithTimeout(url, 120000)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} when loading ${url}`)
  const buf = await resp.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  const base64 = btoa(binary)
  const ext = url.split('.').pop()?.split('?')[0] || ''
  const mime = ext === 'wasm' ? 'application/wasm' : 'application/octet-stream'
  return `data:${mime};base64,${base64}`
}

export function getFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg)
  if (loading) return loading

  const instance = new FFmpeg()

  const doLoad = async (opts) => {
    await Promise.race([
      instance.load(opts),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ffmpeg 加载超时，请检查网络后重试')), LOAD_TIMEOUT),
      ),
    ])
  }

  loading = (async () => {
    let lastErr
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.warn(`ffmpeg 加载重试 (${attempt}/${MAX_RETRIES})…`)
          // 重试时把文件内联为 data URL，绕过 SW 缓存
          const [coreData, wasmData] = await Promise.all([
            toDataURL(coreURL),
            toDataURL(wasmURL),
          ])
          await doLoad({ coreURL: coreData, wasmURL: wasmData })
        } else {
          // 首次尝试正常 URL（走 SW 预缓存）
          await doLoad({ coreURL, wasmURL })
        }
        ffmpeg = instance
        return ffmpeg
      } catch (err) {
        lastErr = err
        console.warn(`ffmpeg 加载失败 (attempt ${attempt + 1}):`, err?.message)
        if (isNetworkError(err) && attempt < MAX_RETRIES) {
          const delay = 2000 * Math.pow(2, attempt)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    throw lastErr
  })().catch((err) => {
    loading = null
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
