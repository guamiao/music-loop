import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
// 核心文件从 node_modules 打包进来，不依赖任何 CDN
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

let ffmpeg = null
let loading = null

// 连续这么久收不到任何字节则中止下载（慢速但持续传输的下载不会被误杀）
const STALL_TIMEOUT_MS = 60000
// worker 内实例化 WASM 的兜底超时（正常只需数秒，留出低端手机的余量）
const INIT_TIMEOUT_MS = 90000

/**
 * 绕开 Service Worker 直接下载文件并转为 Blob URL：
 * 1. 旧版 SW 可能因缓存 32MB WASM 而处于异常状态，不能让它插手核心文件请求；
 * 2. 主线程 fetch 可以拿到下载进度（worker 内部加载无法上报进度），
 *    首次下载 32MB 时用户能看到进度，而不是面对一个没有任何反馈的“提取中”。
 */
async function fetchAsBlobURL(url, mimeType, onProgress) {
  const controller = new AbortController()
  let stallTimer
  const armStallTimer = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
  }
  try {
    armStallTimer()
    const resp = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const total = Number(resp.headers.get('content-length')) || 0
    // 拿不到流式响应或总大小时，退化为整体下载（不显示进度）
    if (!resp.body || !total) {
      const blob = await resp.blob()
      onProgress?.(1)
      return URL.createObjectURL(mimeType ? new Blob([blob], { type: mimeType }) : blob)
    }
    const reader = resp.body.getReader()
    const chunks = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      armStallTimer()
      onProgress?.(Math.min(1, loaded / total))
    }
    return URL.createObjectURL(new Blob(chunks, { type: mimeType }))
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('核心文件下载中断（长时间无数据传输），请检查网络后重试')
    }
    throw err
  } finally {
    clearTimeout(stallTimer)
  }
}

// worker 启动/实例化失败时 @ffmpeg/ffmpeg 不会 reject（未监听 worker.onerror），
// 用超时兜底，保证 UI 不会无限停留在“提取中”
async function loadWithTimeout(instance, opts) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('音频核心初始化超时，请关闭页面后重新打开再试')),
      INIT_TIMEOUT_MS,
    )
  })
  try {
    await Promise.race([instance.load(opts), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// callbacks: { onDownloadProgress(0~1), onStage('init'|'extract'), onProgress(0~1) }
export function getFFmpeg(callbacks = {}) {
  if (ffmpeg) return Promise.resolve(ffmpeg)
  if (loading) return loading

  const { onDownloadProgress, onStage } = callbacks
  const instance = new FFmpeg()

  loading = (async () => {
    try {
      // core 仅约 110KB，秒下；进度由 32MB 的 wasm 主导
      const [coreBlob, wasmBlob] = await Promise.all([
        fetchAsBlobURL(coreURL, 'text/javascript'),
        fetchAsBlobURL(wasmURL, 'application/wasm', onDownloadProgress),
      ])
      // 下载完成 → 本地实例化 WASM（手机上可能需要数秒至数十秒）
      onStage?.('init')
      try {
        await loadWithTimeout(instance, { coreURL: coreBlob, wasmURL: wasmBlob })
      } finally {
        // Blob URL 在 load 内部读取完毕后即可释放
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

// 从视频文件中截取 [start, end] 秒区间，提取为 MP3
// callbacks: { onDownloadProgress(0~1), onStage('init'|'extract'), onProgress(0~1 转码进度) }
export async function extractAudio(videoFile, start, end, callbacks = {}) {
  const { onDownloadProgress, onStage, onProgress } = callbacks
  const ff = await getFFmpeg({ onDownloadProgress, onStage })
  const ext = videoFile.name.match(/\.\w+$/)?.[0] || '.mp4'
  const input = `input${ext}`
  const progressHandler = ({ progress }) => {
    if (onProgress && progress >= 0 && progress <= 1) onProgress(progress)
  }
  ff.on('progress', progressHandler)
  try {
    // 引擎就绪，进入转码阶段
    onStage?.('extract')
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
