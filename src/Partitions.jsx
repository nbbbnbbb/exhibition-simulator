import { useState, useEffect } from 'react';
import { format, railGeometry, partitionGeometry } from './domain.js';
function Field({ label, value, onChange, min = 0, max = 150000, testId }) {
  const [v, set] = useState(value);
  useEffect(() => set(value), [value]);
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          data-testid={testId}
          type="number"
          value={v}
          min={min}
          max={max}
          onChange={(e) => set(e.target.value)}
          onBlur={() => {
            const n = Math.round(Number(v));
            if (v === '' || !Number.isFinite(n) || n < min || n > max) {
              set(value);
              return;
            }
            if (n !== value) onChange(n);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <small>mm</small>
      </div>
    </label>
  );
}
export function PartitionLibrary({
  partitions,
  rails,
  selected,
  onSelect,
  onAdd,
  onEditRails,
  showRails,
  onShowRails,
}) {
  const [rail, setRail] = useState('rail-cross-3');
  const railId = rails.some((r) => r.id === rail) ? rail : rails[0]?.id;
  return (
    <div className="partitions-library">
      <p className="muted">
        点線に沿って可動壁を配置。
        <br />
        初期寸法 3,000 × 5,000 × 200 mm
      </p>
      <label className="select-label">
        配置ライン
        <select
          aria-label="追加先の配置ライン"
          value={railId || ''}
          onChange={(e) => setRail(e.target.value)}
        >
          {rails.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button className="button primary full" disabled={!railId} onClick={() => onAdd(railId)}>
        ＋ 可動壁を追加
      </button>
      <label className="check-label">
        <input
          type="checkbox"
          checked={showRails}
          onChange={(e) => onShowRails(e.target.checked)}
        />
        配置ラインを表示
      </label>
      <button className="rail-edit-link" onClick={onEditRails}>
        配置ラインの座標を編集 →
      </button>
      <div className="partition-cards">
        {partitions.map((p) => (
          <button
            key={p.id}
            className={`partition-card ${p.id === selected ? 'selected' : ''}`}
            onClick={() => onSelect(p.id)}
          >
            <div className="partition-symbol">
              <svg viewBox="0 0 130 65" aria-hidden="true">
                <path d="M10 50h110" stroke="#b3c1a5" strokeDasharray="4 4" />
                <path d="m35 46 55-15 0-27-55 15z" fill="#e8eadf" stroke="#839875" />
                <path d="m90 31 5 3V7l-5-3" fill="#b5c2a7" />
              </svg>
            </div>
            <strong>{p.name}</strong>
            <span>
              {format(p.width)} × {format(p.height)} × {format(p.thickness)} mm
            </span>
            <small>{rails.find((r) => r.id === p.railId)?.name}</small>
          </button>
        ))}
        {!partitions.length && (
          <p className="empty-small">
            まだ可動壁はありません。
            <br />
            追加すると3Dと平面図に反映されます。
          </p>
        )}
      </div>
      <p className="field-note">
        点線の実寸座標は未記載のため推定です。壁のサイズはご指定の実寸です。高さ5
        mの壁は推定中二階と干渉する場合があります。
      </p>
    </div>
  );
}
export function PartitionInspector({
  partition: p,
  rails,
  face,
  onFace,
  onChange,
  onRemove,
  onDuplicate,
  onLibrary,
}) {
  const g = partitionGeometry(p, rails),
    r = rails.find((r) => r.id === p.railId);
  return (
    <>
      <div className="partition-summary">
        <span className="eyebrow">MOVABLE WALL</span>
        <input
          aria-label="可動壁名"
          maxLength={200}
          value={p.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p>作品を両面に配置できます</p>
      </div>
      <div className="inspector-section">
        <label className="select-label">
          配置ライン
          <select
            aria-label="可動壁の配置ライン"
            value={p.railId}
            onChange={(e) => {
              const rail = rails.find((r) => r.id === e.target.value);
              onChange({ railId: rail.id, s: Math.round(railGeometry(rail).length / 2) });
            }}
          >
            {rails.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <p className="field-note">
          ライン長 {format(g.railLength)} mm · 方向 {r.x1 === r.x2 ? '縦' : '横'}
        </p>
        <Field
          label="ライン起点から壁中心"
          testId="partition-s"
          value={p.s}
          onChange={(s) => onChange({ s })}
        />
        <div className="center-height">
          <span>壁中心座標 X / Z</span>
          <strong>
            {format(g.x)} / {format(g.z)}
          </strong>
        </div>
        <p className="field-note">
          平面図・3Dで壁をドラッグして移動できます。方向は選択した配置ラインに従います。
        </p>
      </div>
      <div className="inspector-section">
        <div className="section-label">可動壁の実寸</div>
        <Field
          label="可動壁の幅"
          testId="partition-width"
          value={p.width}
          min={100}
          max={30000}
          onChange={(width) => onChange({ width })}
        />
        <Field
          label="可動壁の高さ"
          value={p.height}
          min={100}
          max={20000}
          onChange={(height) => onChange({ height })}
        />
        <Field
          label="可動壁の厚み"
          value={p.thickness}
          min={10}
          max={2000}
          onChange={(thickness) => onChange({ thickness })}
        />
      </div>
      <div className="inspector-section">
        <div className="section-label">作品の追加先</div>
        <div className="segmented partition-faces">
          <button className={face === 'front' ? 'active' : ''} onClick={() => onFace('front')}>
            表面
          </button>
          <button className={face === 'back' ? 'active' : ''} onClick={() => onFace('back')}>
            裏面
          </button>
        </div>
        <button className="button full subtle" onClick={onLibrary}>
          作品を選んで、この面に配置
        </button>
        <p className="field-note">壁に付けた作品は壁の移動・向き変更に追従します。</p>
      </div>
      <div className="inspector-section">
        <div className="placement-actions">
          <button className="button" onClick={onDuplicate}>
            壁を複製
          </button>
          <button className="button danger" onClick={onRemove}>
            壁を削除
          </button>
        </div>
      </div>
    </>
  );
}
export function RailEditor({ rails, onApply }) {
  const [draft, setDraft] = useState(() => structuredClone(rails));
  function change(id, values) {
    setDraft((rs) =>
      rs.map((r) =>
        r.id === id ? { ...r, ...values, source: 'ユーザー設定（実測根拠は別途記録）' } : r,
      ),
    );
  }
  return (
    <>
      <p className="muted">
        座標はmm。原点は主室の図面上端・左内隅。+Xは右、+Zは下。方向は水平か垂直にしてください。使用中のラインを削除するには、先に可動壁を別のラインへ移します。
      </p>
      <div className="rail-editor-list">
        {draft.map((r, i) => (
          <div className="rail-editor-row" key={r.id}>
            <div className="rail-row-heading">
              <input
                aria-label={`ライン${i + 1}の名前`}
                value={r.name}
                maxLength={200}
                onChange={(e) => change(r.id, { name: e.target.value })}
              />
              <span className="source-tag">{r.source || '推定'}</span>
              <button
                className="text-danger"
                aria-label={`${r.name}のラインを削除`}
                onClick={() => setDraft((rs) => rs.filter((q) => q.id !== r.id))}
              >
                削除
              </button>
            </div>
            <div className="rail-coordinates">
              {[
                ['x1', '始点 X'],
                ['z1', '始点 Z'],
                ['x2', '終点 X'],
                ['z2', '終点 Z'],
              ].map(([key, label]) => (
                <Field
                  key={key}
                  label={`${r.name} ${label}`}
                  value={r[key]}
                  min={-100000}
                  max={150000}
                  onChange={(v) => change(r.id, { [key]: v })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="modal-footer">
        <button
          className="button"
          onClick={() =>
            setDraft((rs) => [
              ...rs,
              {
                id: crypto.randomUUID(),
                name: `追加ライン ${rs.length + 1}`,
                x1: 0,
                z1: 10000,
                x2: 8985,
                z2: 10000,
                source: 'ユーザー設定（実測根拠は別途記録）',
              },
            ])
          }
        >
          ＋ ラインを追加
        </button>
        <button className="button primary" onClick={() => onApply(draft)}>
          配置ラインを適用
        </button>
      </div>
    </>
  );
}
