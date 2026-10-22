/** 預設網站標題（每個人可以在自己的裝置上改成自己的名字） */
export const DEFAULT_TITLE = '🗾 我的日本自由行'

/** 瀏覽器分頁標題不需要 emoji */
export function tabTitle(title: string): string {
  return title.replace(/^\p{Extended_Pictographic}️?\s*/u, '') || title
}
