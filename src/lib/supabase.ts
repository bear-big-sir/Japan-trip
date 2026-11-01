/**
 * Supabase 連線設定
 *
 * 網址與 publishable key 來自環境變數（本機：.env.local；正式版：GitHub Secrets）。
 * publishable key 本來就會出現在網頁裡，資料安全完全由資料庫的 RLS 權限保護。
 * 絕對不要把 service_role / sb_secret_ 金鑰放進前端或 GitHub。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 去掉不小心貼進來的空白與換行
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()

export const supabaseConfigured = Boolean(url && key)

if (key && /^sb_secret_|service_role/.test(key)) {
  throw new Error('偵測到私密金鑰被放進網頁設定，已停止執行。請改用 publishable key。')
}

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
