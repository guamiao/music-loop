import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
// 同源兜底地址（Vite 打包产物）；默认优先走下方国内 CDN
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

let ffmpeg = null
let loading = null

// ---------- 常量 ----------
const WASM_CACHE = 'ffmpeg-wasm' // 应用自管的 Cache Storage 名称
// 升级 @ffmpeg/core 依赖时需同步修改此版本号
const FFMPEG_CORE_VERSION = '0.12.10'
// 国内 CDN（npmmirror / 阿里）：手机访问 GitHub Pages 跨国下载 32MB 很慢且易断流，
// 实测国内节点速度很快，且 CORS 开放、支持 Range。作为首选源，
// 同源（GitHub Pages 打包文件）作为兜底源。
const MIRROR_BASE = `https://registry.npmmirror.com/@ffmpeg/core/${FFMPEG_CORE_VERSION}/files/dist/esm`
// 各资源的候选下载源（按顺序尝试，前一个失败才用下一个）
const SOURCES = {
  core: [`${MIRROR_BASE}/ffmpeg-core.js`, coreURL],
  wasm: [`${MIRROR_BASE}/ffmpeg-core.wasm`, wasmURL],
}
// 与下载源无关的固定缓存键：换源/版本 URL 变化后仍能命中已下载的引擎
const CACHE_KEYS = {
  core: `ffmpeg-assets/${FFMPEG_CORE_VERSION}/ffmpeg-core.js`,
  wasm: `ffmpeg-assets/${FFMPEG_CORE_VERSION}/ffmpeg-core.wasm`,
}
const CONNECT_TIMEOUT_MS = 20000 // 等待响应头
const FIRST_STALL_MS = 120000 // 首字节宽限：CDN 冷节点回源可能要几十秒
const STALL_TIMEOUT_MS = 30000 // 已开始接收后，两块数据之间最长间隔
const RESUME_MAX_RETRY = 5 // 中途断流后的断点续传次数
const WAIT_HINT_MS = 3000 // 多久没收到首字节就提示“节点冷启动中”
// 引擎实例化的“前台累计”超时（iOS 切后台时 JS 暂停，不能用墙上时间计时）
const INIT_FOREGROUND_TIMEOUT_MS = 120000

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------- 缓存 ----------

async function matchCache(cacheKey) {
  try {
    const cached = await caches.match(cacheKey, { cacheName: WASM_CACHE })
    if (cached && cached.ok) return await cached.blob()
  } catch {
    /* caches 不可用时忽略 */
  }
  return null
}

async function putCache(cacheKey, blob, mimeType) {
  try {
    const cache = await caches.open(WASM_CACHE)
    await cache.put(cacheKey, new Response(blob, { headers: { 'content-type': mimeType } }))
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
}

// ---------- 下载 ----------

// 同一资源的在途下载去重：应用启动后的静默预热与用户点击提取共享一次下载
const inflight = new Map()

async function downloadBlob(sources, cacheKey, mimeType, onProgress, onWaiting) {
  const hit = await matchCache(cacheKey)
  if (hit) {
    onProgress?.(1)
    return hit
  }
  if (inflight.has(cacheKey)) {
    const job = inflight.get(cacheKey)
    if (onProgress) job.subs.add(onProgress)
    try {
      return await job.promise
    } finally {
      if (onProgress) job.subs.delete(onProgress)
    }
  }

  const subs = new Set()
  if (onProgress) subs.add(onProgress)
  const emit = (p) => subs.forEach((fn) => fn?.(p))
  const job = (async () => {
    let lastErr
    for (const url of sources) {
      try {
        const blob = await downloadFromSource(url, mimeType, emit, onWaiting)
        await putCache(cacheKey, blob, mimeType)
        return blob
      } catch (err) {
        lastErr = err
        console.warn(`[ffmpeg] 下载源失败，尝试下一个：${url}`, err?.message || err)
      }
    }
    throw (
      lastErr ||
      new Error('音频引擎下载失败：所有下载源均不可用，请检查网络后重试')
    )
  })()
  inflight.set(cacheKey, { promise: job, subs })
  try {
    return await job
  } finally {
    inflight.delete(cacheKey)
  }
}

// 等待响应头阶段超时中止
function fetchWithTimeout(url, timeoutMs, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  )
}

/**
 * 单次（可带 Range 的）流式下载。
 * 冷节点回源时响应头很快但首字节要等较久，故首字节与后续数据用不同宽限：
 * - 首字节：FIRST_STALL_MS；开始接收后两块间隔：STALL_TIMEOUT_MS；
 * - start>0 时用 Range 从断点续传；
 * - onWaiting：等待首字节超过 WAIT_HINT_MS 时给出一次提示。
 * 返回已收到的分片、字节数与总大小，由调用方判断是否完整。
 */
async function streamOnce(url, { start = 0, onWaiting, onProgress }) {
  // 首次（start=0）要容忍冷节点长达数十秒的回源；断点续传时节点已暖，用短超时
  const connectTimeout = start === 0 ? FIRST_STALL_MS : CONNECT_TIMEOUT_MS
  const headers = start > 0 ? { Range: `bytes=${start}-` } : undefined
  const resp = await fetchWithTimeout(url, connectTimeout, { headers })
  if (resp.status !== 200 && resp.status !== 206) {
    throw new Error(`HTTP ${resp.status}`)
  }
  const isPartial = resp.status === 206
  let total = 0
  if (isPartial) {
    const cr = resp.headers.get('content-range') // bytes start-end/total
    if (cr) total = Number(cr.split('/')[1]) || 0
  } else {
    total = Number(resp.headers.get('content-length')) || 0
  }

  if (!resp.body) {
    const buf = new Uint8Array(await resp.arrayBuffer())
    onProgress?.(1)
    return { chunks: [buf], received: buf.length, total }
  }

  const reader = resp.body.getReader()
  const chunks = []
  let received = 0
  let gotFirst = false
  let stallTimer
  let timedOut = false
  const armStall = (ms) => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      timedOut = true
      reader.cancel()
    }, ms)
  }
  const waitTimer = setTimeout(() => {
    if (!gotFirst) onWaiting?.()
  }, WAIT_HINT_MS)
  // 首字节宽限更长（冷节点回源），收到第一块后切换为正常断流宽限
  armStall(FIRST_STALL_MS)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!gotFirst) {
        gotFirst = true
        clearTimeout(waitTimer)
        armStall(STALL_TIMEOUT_MS)
      }
      chunks.push(value)
      received += value.length
      if (total) onProgress?.(Math.min(1, (start + received) / total))
    }
  } finally {
    clearTimeout(waitTimer)
    clearTimeout(stallTimer)
  }
  // 断流不抛错：把已收到的分片带回，由调用方用 Range 从断点续传，避免丢弃已下载部分
  return { chunks, received, total, stalled: timedOut }
}

/**
 * 整包流式优先 + 断点续传：
 * 冷节点对“每个不同的 Range URL”都可能单独回源，故不预先分块；
 * 先整包 GET（单一缓存键，边缘只需回源一次）。
 * - 若已收到部分数据后断流：用 Range 从断点续传（此刻边缘通常已暖）；
 * - 若连首字节都没等到（冷节点回源过久）：直接失败交给 downloadBlob 换下一个源，
 *   不在同一个冷节点上死等。
 */
async function resumeDownload(url, mimeType, onProgress, onWaiting) {
  const allChunks = []
  let start = 0
  let total = 0
  let waitingEmitted = false // 避免续传时重复触发 onWaiting
  for (let attempt = 0; attempt <= RESUME_MAX_RETRY; attempt++) {
    const r = await streamOnce(url, {
      start,
      onWaiting: waitingEmitted ? undefined : onWaiting,
      onProgress,
    })
    waitingEmitted = true
    allChunks.push(...r.chunks)
    total = r.total || total
    start += r.received
    if (!total || start >= total) {
      return new Blob(allChunks, { type: mimeType })
    }
    if (r.stalled && start === 0) {
      // 一个字节都没收到：换源，而不是在冷节点上反复重试
      throw new Error('下载节点长时间无响应，切换备用下载源')
    }
    // 已收到部分数据后断流：稍候，用 Range 断点续传
    await sleep(800)
  }
  throw new Error('网络不稳定，引擎多次断点续传仍未完成，请换到更稳定的 Wi-Fi 后重试')
}

async function downloadFromSource(url, mimeType, onProgress, onWaiting) {
  return resumeDownload(url, mimeType, onProgress, onWaiting)
}

async function fetchAsBlobURL(sources, cacheKey, mimeType, onProgress, onWaiting) {
  const blob = await downloadBlob(sources, cacheKey, mimeType, onProgress, onWaiting)
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

async function initFFmpeg(coreBlobUrl, wasmBlobUrl, onStage) {
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
      await guardInit(instance.load({ coreURL: coreBlobUrl, wasmURL: wasmBlobUrl }))
      return instance
    } catch (err) {
      lastErr = err
      if (err?.restart) continue
      throw err
    }
  }
  throw lastErr
}

// 引擎加载的订阅者集合（预热与正式提取可能同时存在）+ 当前快照，供后加入者回放
const loadSubs = new Set()
let loadSnapshot = { stage: null, progress: 0 }
function emitLoad(event) {
  if (event.stage) loadSnapshot = { ...loadSnapshot, stage: event.stage }
  if (typeof event.progress === 'number') {
    loadSnapshot = { ...loadSnapshot, progress: event.progress }
  }
  for (const cb of loadSubs) cb(event)
}

// callbacks: { onDownloadProgress(0~1), onWaiting(), onStage('init'|'extract') }
export function getFFmpeg(callbacks = {}) {
  if (ffmpeg) return Promise.resolve(ffmpeg)

  const { onDownloadProgress, onWaiting, onStage } = callbacks
  // 订阅在途加载：立即回放当前快照（预热可能已在下载/初始化中）
  let sub
  if (onDownloadProgress || onStage) {
    sub = (e) => {
      if (e.stage) onStage?.(e.stage)
      if (typeof e.progress === 'number') onDownloadProgress?.(e.progress)
    }
    loadSubs.add(sub)
    if (loadSnapshot.stage === 'init') onStage?.('init')
    else if (loadSnapshot.stage === 'download') {
      onStage?.('download')
      onDownloadProgress?.(loadSnapshot.progress)
    }
  }

  if (!loading) {
    loading = (async () => {
      let coreBlobUrl
      let wasmBlobUrl
      try {
        // core 仅约 110KB；进度由 32MB 的 wasm 主导
        // 两个文件分别按“国内 CDN → 同源兜底”的顺序下载
        ;[coreBlobUrl, wasmBlobUrl] = await Promise.all([
          fetchAsBlobURL(SOURCES.core, CACHE_KEYS.core, 'text/javascript'),
          fetchAsBlobURL(
            SOURCES.wasm,
            CACHE_KEYS.wasm,
            'application/wasm',
            (p) => emitLoad({ stage: 'download', progress: p }),
            () => emitLoad({ stage: 'waiting' }),
          ),
        ])
        // 下载完成 → 本地实例化 WASM（手机上可能需要数秒至数十秒）
        emitLoad({ stage: 'init' })
        ffmpeg = await initFFmpeg(coreBlobUrl, wasmBlobUrl, () =>
          emitLoad({ stage: 'init' }),
        )
        return ffmpeg
      } catch (err) {
        loading = null
        loadSnapshot = { stage: null, progress: 0 }
        throw err
      } finally {
        if (coreBlobUrl) URL.revokeObjectURL(coreBlobUrl)
        if (wasmBlobUrl) URL.revokeObjectURL(wasmBlobUrl)
      }
    })()
  }

  return loading.finally(() => sub && loadSubs.delete(sub))
}

// 从视频文件中截取 [start, end] 秒区间，提取为 MP3
// callbacks: { onDownloadProgress, onWaiting, onStage('init'|'extract'), onProgress(转码 0~1) }
export async function extractAudio(videoFile, start, end, callbacks = {}) {
  const { onDownloadProgress, onWaiting, onStage, onProgress } = callbacks
  const ff = await getFFmpeg({ onDownloadProgress, onWaiting, onStage })
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

/**
 * 应用启动后在浏览器空闲时静默下载并初始化引擎：
 * 用户打开本工具几乎必然要提取音频，提前在后台完成 32MB 下载与本地实例化，
 * 等其点「提取」时通常已直接就绪。预热失败静默忽略，正式提取时仍会重试。
 */
export function prewarmFFmpeg() {
  if (document.hidden) return
  // 省流模式下不主动下载
  if (navigator.connection?.saveData) return
  const run = () => {
    getFFmpeg({}).catch(() => {})
  }
  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 3000 })
  } else {
    setTimeout(run, 1000)
  }
}
