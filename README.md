# 🐰 兔兔家的日本自由行管理系統

夫妻共用的日本自由行管理網頁。前臺使用 React + TypeScript + Vite，部署在 GitHub Pages；後臺使用 Supabase（登入、PostgreSQL、Realtime、RLS 權限）。

> 🚧 雲端改造進行中：登入與家庭工作區已完成，旅行資料目前仍存在瀏覽器 IndexedDB，下一步改存 Supabase。

> ⚠️ 本 Repository 只放程式碼，**不放任何私人旅遊資料**。匯出的 `usagi-trip-*.json` 已列入 `.gitignore`。

## 環境設定

複製 `.env.example` 為 `.env.local`，填入 Supabase 的 Project URL 與 publishable key。正式網站改用 GitHub Secrets：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。**絕對不要**把 `service_role` / `sb_secret_` 金鑰或資料庫密碼放進程式或 GitHub。

## 在自己電腦執行

```bash
npm install     # 第一次才需要
npm run dev     # 開發模式，打開畫面上顯示的 http://localhost:5173
npm test        # 執行自動測試
npm run test:db # 在本機臨時 PostgreSQL 測試資料庫權限（需要安裝 PostgreSQL）
npm run build   # 編譯正式版到 dist/
```

## 專案結構

| 檔案 | 用途 |
| --- | --- |
| `src/types.ts` | 資料結構：旅行、航班、住宿、行程、待辦、預算、匯出格式 |
| `src/db/db.ts` | IndexedDB 儲存層：新增、修改、刪除、整批取代、本機備份 |
| `src/db/db.test.ts` | 儲存層自動測試 |
| `src/db/copy.ts` | 複製某一天、複製旅行為範本（一律產生新 ID，不改動原資料） |
| `src/lib/id.ts` | 唯一 ID 與時間工具 |
| `src/pages/` | 各頁面 |
| `supabase/migrations/` | 雲端資料表、RLS 權限、版本衝突、修改紀錄（在 Supabase SQL Editor 執行） |
| `src/auth/` | 登入、家庭工作區、邀請成員 |
| `.github/workflows/deploy.yml` | 推送到 main 時自動部署 GitHub Pages |

## 開發進度

- [x] 第一階段：專案、資料結構、IndexedDB、旅行管理、匯出、本機備份與還原
- [x] 第二階段：航班、住宿、每日行程（單日檢視、調整順序、複製某一天、複製旅行為範本）
- [x] 第三階段：待辦（常見清單、勾選完成）、預算（分類小計、各幣別總額、自訂匯率換算）
- [x] 第四階段：JSON 匯入檢查、預覽、安全合併、衝突選擇、匯入前自動備份；旅遊功課；未匯出變更提醒
- [ ] 第五階段：完整測試
- [ ] 第六階段：GitHub Pages 部署
