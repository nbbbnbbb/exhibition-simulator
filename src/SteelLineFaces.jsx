import { Field } from './SteelFrames.jsx';
export function SteelLineFaceList({ faces, membranes, selected, onSelect, onToggle }) {
  if (!faces.length)
    return (
      <p className="field-note">ラインを同じ平面で閉じると、膜を貼れる面が自動生成されます。</p>
    );
  return (
    <section className="steel-line-faces" aria-label="ラインから生成した面">
      <div className="section-label">ラインから生成した面 · {faces.length}</div>
      {faces.map((face) => (
        <div
          className={`steel-line-face-row ${selected === face.id ? 'selected' : ''}`}
          key={face.id}
        >
          <button onClick={() => onSelect(face.id)}>
            {face.name}
            <small>
              {(face.area / 1e6).toLocaleString('ja-JP', { maximumFractionDigits: 2 })} m²
            </small>
          </button>
          <label>
            <input
              type="checkbox"
              aria-label={`${face.name}に膜を貼る`}
              checked={membranes.some((m) => m.faceId === face.id)}
              onChange={(e) => onToggle(face.id, e.target.checked)}
            />
            膜
          </label>
        </div>
      ))}
    </section>
  );
}
export function SteelLineFaceInspector({ face, membrane, onToggle, onChange, onFocus }) {
  return (
    <div className="steel-inspector">
      <div className="partition-summary">
        <span className="eyebrow">SURFACE FROM STEEL LINES</span>
        <h3>{face.name}</h3>
        <p>
          面積 {(face.area / 1e6).toLocaleString('ja-JP', { maximumFractionDigits: 3 })} m² · 周囲{' '}
          {face.lineIds.length}本
        </p>
        <button className="button full" onClick={onFocus}>
          この面を拡大して確認
        </button>
      </div>
      <div className="inspector-section">
        <div className="section-label">ビニール膜</div>
        <label className="check-label">
          <input
            type="checkbox"
            aria-label="このライン面に膜を貼る"
            checked={!!membrane}
            onChange={(e) => onToggle(e.target.checked)}
          />
          この面に膜を貼る
        </label>
        {membrane && (
          <>
            <label className="membrane-color">
              膜の色
              <input
                type="color"
                aria-label="ライン面の膜の色"
                value={membrane.color}
                onChange={(e) => onChange({ color: e.target.value })}
              />
            </label>
            <Field
              label="ライン面の膜の不透明度"
              value={Math.round(membrane.opacity * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => onChange({ opacity: v / 100 })}
            />
            <button className="button full" onClick={() => onToggle(false)}>
              この面の膜を外す
            </button>
          </>
        )}
        <p className="field-note">
          閉じたラインから生成した面に膜を貼れます。水平面・垂直面・斜めの面に対応。輪郭が開いた場合は膜を非表示にし、閉じ直すと復元します。境界のラインを削除すると、この膜の設定も削除します。
        </p>
      </div>
    </div>
  );
}
