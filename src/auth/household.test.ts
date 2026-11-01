import { describe, expect, it } from 'vitest'
import { friendlyError } from './household'

describe('friendlyError：把雲端錯誤轉成中文', () => {
  it('密碼錯誤', () => {
    expect(friendlyError({ message: 'Invalid login credentials' })).toContain('密碼錯誤')
  })
  it('網路中斷', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toContain('無法連線')
  })
  it('版本衝突', () => {
    expect(friendlyError({ message: 'VERSION_CONFLICT: 這筆資料已被其他人修改' })).toContain('已被家人修改')
  })
  it('沒有權限', () => {
    expect(friendlyError({ message: 'new row violates row-level security policy for table "trips"' })).toBe(
      '沒有權限執行這個動作。',
    )
  })
  it('資料庫的中文訊息直接顯示', () => {
    expect(friendlyError({ message: '只有家庭管理者可以邀請成員' })).toBe('只有家庭管理者可以邀請成員')
  })
})
