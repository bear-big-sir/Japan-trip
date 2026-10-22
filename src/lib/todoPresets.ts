import type { TodoCategory, TodoItem } from '../types'

/** 每趟日本旅行常見的待辦事項（可一次加入，之後自行修改或刪除） */
export const TODO_PRESETS: { category: TodoCategory; title: string }[] = [
  { category: 'flight', title: '確認去程航班時間與航廈' },
  { category: 'flight', title: '確認回程航班時間與航廈' },
  { category: 'flight', title: '線上報到／選位' },
  { category: 'hotel', title: '確認每晚住宿都已訂好' },
  { category: 'hotel', title: '確認入住時間與付款方式' },
  { category: 'documents', title: '護照效期確認（至少 6 個月）' },
  { category: 'documents', title: '填寫 Visit Japan Web' },
  { category: 'documents', title: '旅遊保險' },
  { category: 'network', title: '網卡／eSIM' },
  { category: 'network', title: '交通卡（Suica／ICOCA）或 JR Pass' },
  { category: 'luggage', title: '行動電源、充電線、轉接頭' },
  { category: 'luggage', title: '常備藥品' },
  { category: 'luggage', title: '日圓現金與信用卡' },
]

/** 找出這趟旅行還沒有的建議項目（標題相同就視為已經有了，不重複加入） */
export function missingPresets(existing: Pick<TodoItem, 'title'>[]) {
  const have = new Set(existing.map((t) => t.title.trim()))
  return TODO_PRESETS.filter((p) => !have.has(p.title))
}
