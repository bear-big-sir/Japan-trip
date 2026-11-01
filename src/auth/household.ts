/**
 * 登入者與家庭工作區
 * 這個檔案只負責「向 Supabase 查詢」，畫面放在 AuthGate.tsx。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type Role = 'owner' | 'member'

export interface Membership {
  householdId: string
  householdName: string
  role: Role
  displayName: string
  email: string
}

export interface Member {
  userId: string
  role: Role
  displayName: string
  email: string
  createdAt: string
}

export interface Invite {
  id: string
  email: string
  displayName: string
  createdAt: string
  expiresAt: string
}

/** 把 Supabase 的英文錯誤轉成看得懂的中文 */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e)
  if (/Invalid login credentials/i.test(msg)) return 'Email 或密碼錯誤，請再確認一次。'
  if (/Email not confirmed/i.test(msg)) return '這個帳號的 Email 還沒有確認，請管理者在 Supabase 後台確認帳號。'
  if (/Signups not allowed|signup.*disabled/i.test(msg)) return '本網站不開放自行註冊，請由家庭管理者建立帳號。'
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return '無法連線到雲端資料庫，請確認網路後再試一次。'
  if (/rate limit|too many/i.test(msg)) return '嘗試次數太多，請稍等幾分鐘再試。'
  if (/VERSION_CONFLICT/.test(msg)) return '這筆資料已被家人修改過，請重新讀取最新內容後再儲存。'
  // 資料庫自己寫的中文錯誤訊息，直接顯示
  if (/[\u4e00-\u9fff]/.test(msg)) return msg
  if (/duplicate key|unique/i.test(msg)) return '這筆資料已經存在。'
  if (/row-level security|permission denied/i.test(msg)) return '沒有權限執行這個動作。'
  return msg
}

/**
 * 登入後呼叫：先接受寄給自己 Email 的邀請（如果有），再讀取自己所屬的家庭。
 * 回傳 null 代表還沒有加入任何家庭。
 */
export async function loadMembership(client: SupabaseClient, userId: string): Promise<Membership | null> {
  const accepted = await client.rpc('accept_invite')
  if (accepted.error) throw accepted.error
  const { data, error } = await client
    .from('household_members')
    .select('household_id, role, display_name, email, households(name)')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const h = data.households as unknown as { name: string } | { name: string }[] | null
  const name = Array.isArray(h) ? h[0]?.name : h?.name
  return {
    householdId: data.household_id,
    householdName: name ?? '',
    role: data.role as Role,
    displayName: data.display_name,
    email: data.email,
  }
}

export async function createHousehold(client: SupabaseClient, name: string, displayName: string) {
  const { error } = await client.rpc('create_household', {
    household_name: name,
    my_display_name: displayName,
  })
  if (error) throw error
}

export async function listMembers(client: SupabaseClient): Promise<Member[]> {
  const { data, error } = await client
    .from('household_members')
    .select('user_id, role, display_name, email, created_at')
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((m) => ({
    userId: m.user_id,
    role: m.role as Role,
    displayName: m.display_name,
    email: m.email,
    createdAt: m.created_at,
  }))
}

/** 只有管理者讀得到（RLS）；一般成員會拿到空陣列 */
export async function listInvites(client: SupabaseClient): Promise<Invite[]> {
  const { data, error } = await client
    .from('household_invites')
    .select('id, email, display_name, created_at, expires_at')
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    displayName: i.display_name,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
  }))
}

export async function inviteMember(client: SupabaseClient, email: string, displayName: string) {
  const { error } = await client.rpc('invite_member', {
    invite_email: email.trim().toLowerCase(),
    invite_display_name: displayName.trim(),
  })
  if (error) throw error
}

export async function cancelInvite(client: SupabaseClient, inviteId: string) {
  const { error } = await client.rpc('cancel_invite', { invite_id: inviteId })
  if (error) throw error
}

export async function removeMember(client: SupabaseClient, userId: string) {
  const { error } = await client.rpc('remove_member', { member_user_id: userId })
  if (error) throw error
}

export async function setMyDisplayName(client: SupabaseClient, name: string) {
  const { error } = await client.rpc('set_my_display_name', { new_name: name.trim() })
  if (error) throw error
}
