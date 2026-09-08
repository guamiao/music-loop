// 通用工具函数

export function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// 读取音频/视频文件的时长（通过临时 <audio> 元素解析元数据）
export function readMediaDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const el = new Audio()
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(el.duration)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    el.src = url
  })
}
