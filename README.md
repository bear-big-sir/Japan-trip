# 🐰 兔兔家的日本自由行管理系統

夫妻共用的日本自由行管理網頁。使用 React + TypeScript + Vite，資料存在各自瀏覽器的 IndexedDB，透過 JSON 檔手動交換與安全合併。

> ⚠️ 本 Repository 只放程式碼，**不放任何私人旅遊資料**。匯出的 `usagi-trip-*.json` 已列入 `.gitignore`。

## 在自己電腦執行

```bash
npm install     # 第一次才需要
npm run dev     # 開發模式，打開畫面上顯示的 http://localhost:5173
npm test        # 執行自動測試
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
| `.github/workflows/deploy.yml` | 推送到 main 時自動部署 GitHub Pages |

## 開發進度

- [x] 第一階段：專案、資料結構、IndexedDB、旅行管理、匯出、本機備份與還原
- [x] 第二階段：航班、住宿、每日行程（單日檢視、調整順序、複製某一天、複製旅行為範本）
- [ ] 第三階段：待辦、預算
- [ ] 第四階段：JSON 匯入、預覽、安全合併、衝突處理
- [ ] 第五階段：完整測試
- [ ] 第六階段：GitHub Pages 部署
