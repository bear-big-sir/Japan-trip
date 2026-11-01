import { createContext, useContext } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Membership } from './household'

export interface AuthState {
  client: SupabaseClient
  user: User
  membership: Membership
  online: boolean
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

/** 已登入且已加入家庭後才會使用（AuthGate 保證） */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthGate 裡面使用')
  return ctx
}
