interface Props {
  title: string
  stage: string
  features: string[]
}

/** 尚未完成的功能頁：清楚標示會在哪個階段完成，不放任何沒有作用的按鈕 */
export function PlaceholderPage({ title, stage, features }: Props) {
  return (
    <section>
      <div className="card">
        <h3>{title}</h3>
        <p className="muted">🚧 這一頁會在<b>{stage}</b>完成。資料結構已經準備好，將包含：</p>
        <ul>
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
