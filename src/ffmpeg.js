import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
// 核心文件从 node_modules 打包进来，不依赖任何 CDN，克隆项目后离线也能用
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

let ffmpeg = null
let loading = null

// 懒加载 ffmpeg 核心（首次使用时加载，约 25MB wasm）
export function getFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg)
  if (loading) return loading
  const instance = new FFmpeg()
  loading = instance.load({ coreURL, wasmURL }).then(() => {
    ffmpeg = instance
    return ffmpeg
  })
  return loading
}

// 从视频文件中截取 [start, end] 秒区间，提取为 MP3
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
