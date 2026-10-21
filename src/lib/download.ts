import type { ExportFile } from '../types'

/** 匯出檔名：usagi-trip-2026-10-21-2342.json（含日期時間，方便分辨新舊） */
export function exportFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `usagi-trip-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(
    date.getHours(),
  )}${p(date.getMinutes())}.json`
}

/** 讓瀏覽器下載 JSON 檔（iPhone Safari 會跳出「下載」或「分享」） */
export function downloadJson(file: ExportFile, name = exportFileName()) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
