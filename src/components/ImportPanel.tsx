import { useRef, useState, type ChangeEvent } from 'react'
import { DATA_STORES, STORE_LABELS, type AppData, type BaseRecord, type ExportFile } from '../types'
import { loadAll } from '../db/db'
import {
  FIELD_LABELS,
  importMerge,
  planMerge,
  recordTitle,
  validateImport,
  type Choice,
  type Conflict,
  type MergePlan,
  type MergeResult,
} from '../db/merge'
import { formatDateTime } from '../lib/id'

interface Props {
  onChanged: () => Promise<void>
  onExport: () => Promise<void>
}

type State =
  | { step: 'idle' }
  | { step: 'error'; fileName: string; errors: string[] }
  | {
      step: 'preview'
      fileName: string
      file: ExportFile
      plan: MergePlan
      local: AppData
    }
  | { step: 'done'; result: MergeResult }

/** 匯入 JSON → 檢查 → 預覽與衝突選擇 → 確認後安全合併 */
export function ImportPanel({ onChanged, onExport }: Props) {
  const [state, setState] = useState<State>({ step: 'idle' })
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [runError, setRunError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = '' // 讓同一個檔案可以再選一次
    if (!f) return
    setRunError('')
    setChoices({})
    let text: string
    try {
      text = await f.text()
    } catch {
      return setState({ step: 'error', fileName: f.name, errors: ['無法讀取這個檔案。'] })
    }
    const local = await loadAll()
    const r = validateImport(
      text,
      local.trips.map((t) => t.id),
    )
    if (!r.ok) return setState({ step: 'error', fileName: f.name, errors: r.errors })
    setState({ step: 'preview', fileName: f.name, file: r.file, plan: planMerge(local, r.file.data), local })
  }

  async function run() {
    if (state.step !== 'preview') return
    setBusy(true)
    setRunError('')
    try {
      const result = await importMerge(state.file, choices)
      setState({ step: 'done', result })
      await onChanged()
    } catch (e) {
      setRunError(`匯入失敗，原有資料沒有任何變更：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function chooseAll(c: Choice) {
    if (state.step !== 'preview') return
    setChoices(Object.fromEntries(state.plan.conflicts.map((x) => [x.key, c])))
  }

  const reset = () => setState({ step: 'idle' })

  return (
    <div className="card">
      <h3>③ 匯入 JSON 與安全合併</h3>
      <p className="muted">
        選擇對方（或自己之前）匯出的 JSON 檔。系統會先檢查檔案、顯示預覽，<b>按下確認前不會改動任何資料</b>。
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={onFile}
        hidden
      />

      {(state.step === 'idle' || state.step === 'error') && (
        <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
          ⬆ 選擇 JSON 檔案
        </button>
      )}

      {state.step === 'error' && (
        <div className="error-box import-errors">
          <b>❌ 無法匯入「{state.fileName}」</b>
          <ul>
            {state.errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <div>你目前的資料完全沒有變更。</div>
        </div>
      )}

      {state.step === 'preview' && (
        <Preview
          fileName={state.fileName}
          file={state.file}
          plan={state.plan}
          local={state.local}
          choices={choices}
          onChoose={(key, c) => setChoices((old) => ({ ...old, [key]: c }))}
          onChooseAll={chooseAll}
          onCancel={reset}
          onRun={run}
          busy={busy}
          error={runError}
        />
      )}

      {state.step === 'done' && (
        <div className="import-result">
          <p>
            <b>✅ 合併完成！</b>
          </p>
          <ul>
            <li>新增 {state.result.added} 筆</li>
            <li>相同內容略過 {state.result.skipped} 筆</li>
            <li>
              衝突 {state.result.conflicts} 筆
              {state.result.conflicts > 0 &&
                `（保留我的 ${state.result.keptLocal} 筆、改用對方的 ${state.result.usedIncoming} 筆）`}
            </li>
          </ul>
          <p className="muted small">匯入前的資料已自動備份，可以在下方「本機備份與還原」找到。</p>
          <p className="warning-text">👉 建議現在再匯出一次完整資料，傳給對方，作為下一次交換的基礎。</p>
          <div className="card-actions">
            <button className="btn btn-primary" onClick={onExport}>
              ⬇ 匯出合併後的資料
            </button>
            <button className="btn" onClick={reset}>
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface PreviewProps {
  fileName: string
  file: ExportFile
  plan: MergePlan
  local: AppData
  choices: Record<string, Choice>
  onChoose: (key: string, c: Choice) => void
  onChooseAll: (c: Choice) => void
  onCancel: () => void
  onRun: () => void
  busy: boolean
  error: string
}

function Preview(p: PreviewProps) {
  const { file, plan } = p
  const unresolved = plan.conflicts.filter((c) => !p.choices[c.key]).length
  const nothing = plan.totals.added === 0 && plan.totals.conflicts === 0
  const tripNames = new Map(
    [...p.local.trips, ...file.data.trips].map((t) => [t.id, t.name] as const),
  )

  return (
    <div className="import-preview">
      <div className="import-file">
        📄 <b>{p.fileName}</b>
        <div className="muted small">
          匯出裝置：{file.deviceName || '未命名'}　匯出時間：{formatDateTime(file.exportedAt)}　格式版本：
          {file.formatVersion}
        </div>
      </div>

      <div className="table-wrap">
        <table className="budget-table">
          <thead>
            <tr>
              <th>資料</th>
              <th className="num">檔案內</th>
              <th className="num">新增</th>
              <th className="num">相同略過</th>
              <th className="num">衝突</th>
            </tr>
          </thead>
          <tbody>
            {DATA_STORES.map((s) => (
              <tr key={s}>
                <td>{STORE_LABELS[s]}</td>
                <td className="num">{file.data[s].length}</td>
                <td className="num">{plan.addedCount[s] || '—'}</td>
                <td className="num">{plan.sameCount[s] || '—'}</td>
                <td className="num">{plan.conflicts.filter((c) => c.store === s).length || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>合計</th>
              <th className="num">{DATA_STORES.reduce((n, s) => n + file.data[s].length, 0)}</th>
              <th className="num">{plan.totals.added}</th>
              <th className="num">{plan.totals.same}</th>
              <th className="num">{plan.totals.conflicts}</th>
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="small import-notes">
        <li>確認後，系統會<b>先自動建立本機備份</b>，再一次寫入；中途失敗不會留下一半的資料。</li>
        <li>合併只會新增或更新，<b>不會刪除</b>任何資料。對方刪掉的項目，在你這邊仍會保留，需要的話請自己刪除。</li>
      </ul>

      {plan.conflicts.length > 0 && (
        <div className="conflicts">
          <h4>⚠️ 有 {plan.conflicts.length} 筆衝突：同一筆資料兩邊內容不同</h4>
          <p className="muted small">請逐筆選擇要保留哪一份，或用下面按鈕一次選好。</p>
          <div className="card-actions">
            <button className="btn btn-small" onClick={() => p.onChooseAll('local')}>
              全部保留我的
            </button>
            <button className="btn btn-small" onClick={() => p.onChooseAll('incoming')}>
              全部改用對方的
            </button>
          </div>
          {plan.conflicts.map((c) => (
            <ConflictCard
              key={c.key}
              conflict={c}
              choice={p.choices[c.key]}
              onChoose={(v) => p.onChoose(c.key, v)}
              deviceName={file.deviceName}
              tripNames={tripNames}
            />
          ))}
        </div>
      )}

      {nothing && <p className="notice">這個檔案的資料你都已經有了，不需要合併。</p>}
      {p.error && <p className="error">{p.error}</p>}
      <div className="form-actions">
        <button className="btn" onClick={p.onCancel} disabled={p.busy}>
          取消
        </button>
        <button
          className="btn btn-primary"
          onClick={p.onRun}
          disabled={p.busy || nothing || unresolved > 0}
        >
          {p.busy ? '合併中…' : unresolved > 0 ? `還有 ${unresolved} 筆衝突未選擇` : '確認合併'}
        </button>
      </div>
    </div>
  )
}

function show(field: string, v: unknown, tripNames: Map<string, string>): string {
  if (v === undefined || v === '') return '（空白）'
  if (field === 'tripId' && typeof v === 'string') return tripNames.get(v) ?? v
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (field === 'createdAt' && typeof v === 'string') return formatDateTime(v)
  return String(v)
}

interface ConflictProps {
  conflict: Conflict
  choice?: Choice
  onChoose: (c: Choice) => void
  deviceName: string
  tripNames: Map<string, string>
}

function ConflictCard({ conflict: c, choice, onChoose, deviceName, tripNames }: ConflictProps) {
  const rec = (r: BaseRecord) => r as unknown as Record<string, unknown>
  const newer =
    c.local.updatedAt === c.incoming.updatedAt ? null : c.local.updatedAt > c.incoming.updatedAt ? 'local' : 'incoming'
  const side = (who: Choice, label: string, r: BaseRecord) => (
    <label className={'conflict-side' + (choice === who ? ' chosen' : '')}>
      <span className="conflict-side-head">
        <input type="radio" name={c.key} checked={choice === who} onChange={() => onChoose(who)} />
        <b>{label}</b>
        {newer === who && <span className="badge-soft">較新</span>}
      </span>
      <span className="muted small">修改時間：{formatDateTime(r.updatedAt)}</span>
      {c.fields.map((f) => (
        <span key={f} className="conflict-field">
          <span className="muted">{FIELD_LABELS[f] ?? f}：</span>
          <span className="pre">{show(f, rec(r)[f], tripNames)}</span>
        </span>
      ))}
    </label>
  )
  return (
    <div className="conflict">
      <div className="conflict-title">
        {STORE_LABELS[c.store]}：{recordTitle(c.store, c.local)}
      </div>
      <div className="conflict-sides">
        {side('local', '保留我的', c.local)}
        {side('incoming', `改用對方的${deviceName ? `（${deviceName}）` : ''}`, c.incoming)}
      </div>
    </div>
  )
}
