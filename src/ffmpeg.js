import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
// 核心文件从 node_modules 打包进来，不依赖任何 CDN
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

let ffmpeg = null
let loading = null

// ---------- 常量 ----------
const WASM_CACHE = 'ffmpeg-wasm' // 必须与 vite.config.js 中 runtimeCaching 的 cacheName 一致
const CHUNK_SIZE = 2 * 1024 * 1024 // 分块下载：每块 2MB
const CHUNK_TIMEOUT_MS = 60000 // 单块下载超时
const CHUNK_MAX_RETRY = 8 // 单块最多重试次数（仅重试这一块，不重头下载）
const STALL_TIMEOUT_MS = 120000 // 不支持 Range 时整文件流式下载的无数据超时
// 引擎实例化的“前台累计”超时（iOS 切后台时 JS 暂停，不能用墙上时间计时）
const INIT_FOREGROUND_TIMEOUT_MS = 120000

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------- 下载 ----------

/**
 * 优先从 Cache Storage 读取（SW 的 CacheFirst 与页面共享缓存）。
 * 命中说明之前已下载过，直接秒回，完全离线可用。
 */
async function matchCache(url) {
  try {
    const cached = await caches.match(url, { ignoreSearch: true })
    if (cached && cached.ok) return await cached.blob()
  } catch {
    /* caches 不可用时忽略 */
  }
  return null
}

async function putCache(url, blob, mimeType) {
  try {
    const cache = await caches.open(WASM_CACHE)
    await cache.put(
      url,
      new Response(blob, { headers: { 'content-type': mimeType } }),
    )
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
}

// 带超时的单块 Range 请求
function fetchRange(url, start, end) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS)
  return fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer))
}

/**
 * 下载文件为 Blob：
 * 1. 先查缓存（之前成功下载过则秒回）；
 * 2. 探测服务器是否支持 Range（GitHub Pages 支持，返回 206），支持则分块下载，
 *    单块失败仅重试该块——手机弱网下不会因为一次停滞就重下整个 32MB；
 * 3. 不支持 Range 则退化为整文件流式下载（带无数据超时）；
 * 4. 成功后写入 Cache Storage，之后由 SW CacheFirst 直接命中。
 */
async function downloadBlob(url, mimeType, onProgress) {
  const hit = await matchCache(url)
  if (hit) {
    onProgress?.(1)
    return hit
  }

  // 探测 Range 支持
  let supportsRange = false
  let total = 0
  try {
    const probe = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    })
    supportsRange = probe.status === 206
    const cr = probe.headers.get('content-range') // bytes 0-0/32232419
    if (cr) total = Number(cr.split('/')[1]) || 0
    // 探测响应（1 字节）主动释放，正文走分块请求
    probe.body?.cancel?.()
  } catch {
    supportsRange = false
  }

  let blob
  if (supportsRange && total > 0) {
    blob = await downloadInChunks(url, total, onProgress)
  } else {
    blob = await downloadStream(url, onProgress)
  }
  await putCache(url, blob, mimeType)
  return blob
}

async function downloadInChunks(url, total, onProgress) {
  const chunks = []
  for (let start = 0; start < total; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, total - 1)
    let chunk
    // eslint-disable-next-line no-constant-condition
    for (let attempt = 0; ; attempt++) {
      try {
        const resp = await fetchRange(url, start, end)
        if (resp.status !== 206 && resp.status !== 200) {
          throw new Error(`HTTP ${resp.status}`)
        }
        chunk = new Uint8Array(await resp.arrayBuffer())
        // 个别服务器会忽略 Range 返回全文，这种情况下直接用整包
        if (resp.status === 200) {
          onProgress?.(1)
          return new Blob([chunk])
        }
        break
      } catch (err) {
        if (attempt >= CHUNK_MAX_RETRY) {
          throw new Error(
            '网络不稳定，引擎下载中断（每个分块已自动重试多次仍失败），请换到更稳定的 Wi-Fi 后重试',
          )
        }
        // 指数退避：1s,2s,4s,8s…（封顶 8s）
        await sleep(Math.min(1000 * 2 ** attempt, 8000))
      }
    }
    chunks.push(chunk)
    onProgress?.(Math.min(1, (end + 1) / total))
  }
  return new Blob(chunks, { type: 'application/octet-stream' })
}

// 退化路径：整文件流式下载，连续 STALL_TIMEOUT_MS 收不到数据才中止
async function downloadStream(url, onProgress) {
  const controller = new AbortController()
  let stallTimer
  const arm = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
  }
  try {
    arm()
    const resp = await fetch(url, { signal: controller.signal })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const len = Number(resp.headers.get('content-length')) || 0
    if (!resp.body || !len) {
      const b = await resp.blob()
      onProgress?.(1)
      return b
    }
    const reader = resp.body.getReader()
    const chunks = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      arm()
      onProgress?.(Math.min(1, loaded / len))
    }
    return new Blob(chunks)
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('引擎下载中断（长时间无数据传输），请检查网络后重试')
    }
    throw err
  } finally {
    clearTimeout(stallTimer)
  }
}

async function fetchAsBlobURL(url, mimeType, onProgress) {
  const blob = await downloadBlob(
    url,
    mimeType,
    mimeType === 'application/wasm' ? onProgress : undefined,
  )
  return URL.createObjectURL(
    mimeType ? new Blob([blob], { type: mimeType }) : blob,
  )
}

// ---------- 引擎实例化（带前台看门狗 + 后台挂起自动重启） ----------

/**
 * 只累计“页面在前台”的时间：iOS 切后台时整个 JS 世界被暂停，墙上时间超时会误杀。
 * 另外，若 init 期间经历过后台→前台，worker 中的 WASM 编译很可能已半死不活，
 * 此时直接 reject 一个重启信号，由外层用全新 FFmpeg 实例重试一次。
 */
function guardInit(loadPromise) {
  return new Promise((resolve, reject) => {
    let foregroundMs = 0
    let last = Date.now()
    let done = false
    const ticker = setInterval(() => {
      const now = Date.now()
      if (!document.hidden) foregroundMs += now - last
      last = now
      if (foregroundMs > INIT_FOREGROUND_TIMEOUT_MS) {
        finish(
          new Error(
            '引擎在手机本地启动超时（累计已等待超过 2 分钟），请杀掉页面后重新打开再试',
          ),
        )
      }
    }, 1000)
    const onVisibility = () => {
      if (!document.hidden) {
        // 从后台回来：本次 init 判定为挂起，请求外层重启
        finish(Object.assign(new Error('__RESTART__'), { restart: true }))
      }
    }
    function finish(err, value) {
      if (done) return
      done = true
      clearInterval(ticker)
      document.removeEventListener('visibilitychange', onVisibility)
      if (err) reject(err)
      else resolve(value)
    }
    document.addEventListener('visibilitychange', onVisibility)
    loadPromise.then(
      () => finish(null, true),
      (e) => finish(e),
    )
  })
}

async function initFFmpeg(coreBlob, wasmBlob, onStage) {
  let instance = new FFmpeg()
  let lastErr
  // 最多两轮：首轮 + 经历后台挂起后的重启轮
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      try {
        instance.terminate()
      } catch {
        /* ignore */
      }
      instance = new FFmpeg()
      onStage?.('init')
    }
    try {
      await guardInit(instance.load({ coreURL: coreBlob, wasmURL: wasmBlob }))
      return instance
    } catch (err) {
      lastErr = err
      if (err?.restart) continue
      throw err
    }
  }
  throw lastErr
}

// callbacks: { onDownloadProgress(0~1), onStage('init'|'extract'), onProgress(0~1) }
export function getFFmpeg(callbacks = {}) {
  if (ffmpeg) return Promise.resolve(ffmpeg)
  if (loading) return loading

  const { onDownloadProgress, onStage } = callbacks

  loading = (async () => {
    let coreBlobUrl
    let wasmBlobUrl
    try {
      // core 仅约 110KB；进度由 32MB 的 wasm 主导
      ;[coreBlobUrl, wasmBlobUrl] = await Promise.all([
        fetchAsBlobURL(coreURL, 'text/javascript'),
        fetchAsBlobURL(wasmURL, 'application/wasm', onDownloadProgress),
      ])
      // 下载完成 → 本地实例化 WASM（手机上可能需要数秒至数十秒）
      onStage?.('init')
      ffmpeg = await initFFmpeg(coreBlobUrl, wasmBlobUrl, onStage)
      return ffmpeg
    } catch (err) {
      loading = null
      throw err
    } finally {
      // load 内部读取完毕后即可释放 Blob URL
      if (coreBlobUrl) URL.revokeObjectURL(coreBlobUrl)
      if (wasmBlobUrl) URL.revokeObjectURL(wasmBlobUrl)
    }
  })()

  return loading
}

// 从视频文件中截取 [start, end] 秒区间，提取为 MP3
// callbacks: { onDownloadProgress, onStage('init'|'extract'), onProgress(转码 0~1) }
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
