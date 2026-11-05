import { Field } from './SteelFrames.jsx';
import { steelSections } from './steelFrames.js';
import {
  STEEL_LINE_PLANES,
  steelLineLength,
  steelLineEndpoints,
  withSteelLineEndpoints,
} from './steelLinePlacement.js';

export function SteelLineControls({
  project,
  settings,
  onSettings,
  active,
  start,
  onStart,
  onStop,
}) {
  const plane = STEEL_LINE_PLANES.find((p) => p.id === settings.plane);
  return (
    <section className="steel-line-controls" aria-label="鉄骨ラインの配置">
      <div className="section-label">3Dでラインを描く</div>
      <label className="select-label">
        作業面
        <select
          aria-label="鉄骨ラインの作業面"
          value={settings.plane}
          onChange={(e) => {
            const next = STEEL_LINE_PLANES.find((p) => p.id === e.target.value);
            onSettings({
              ...settings,
              plane: next.id,
              offset: start?.[next.axis] ?? next.defaultOffset,
            });
          }}
        >
          {STEEL_LINE_PLANES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={plane.label}
        value={settings.offset}
        min={plane.axis === 0 ? -100000 : 0}
        max={150000}
        onChange={(offset) => onSettings({ ...settings, offset })}
      />
      <label className="select-label">
        ラインの部材断面
        <select
          aria-label="ラインの部材断面"
          value={settings.sectionId}
          onChange={(e) => onSettings({ ...settings, sectionId: e.target.value })}
        >
          {steelSections(project).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          aria-label="鉄骨ラインを連続配置"
          checked={settings.continuous}
          onChange={(e) => onSettings({ ...settings, continuous: e.target.checked })}
        />
        終点から続けて描く
      </label>
      <button
        className={`button full ${active ? '' : 'primary'}`}
        onClick={active ? onStop : onStart}
      >
        {active ? 'ライン配置を終了' : '3Dでライン配置を開始'}
      </button>
      <p className="field-note">
        始点・終点をクリック。作業面を変えて立体的につなげます。端点に吸着、Altで1
        mm刻み。右ドラッグで視点回転、Enter／Escで終了。
      </p>
      {active && start && (
        <p className="steel-line-start">
          始点 {start.map((n) => n.toLocaleString()).join(' / ')} mm
        </p>
      )}
    </section>
  );
}
export function SteelLineInspector({
  frame: f,
  project,
  onChange,
  onDuplicate,
  onRemove,
  onFocus,
  onContinue,
  onRegisterSection,
}) {
  const ends = steelLineEndpoints(f);
  const changeEnd = (which, axis, value) => {
    const points = ends.map((p) => [...p]);
    points[which][axis] = value;
    onChange(withSteelLineEndpoints(f, ...points));
  };
  return (
    <div className="steel-inspector">
      <div className="partition-summary">
        <span className="eyebrow">STEEL LINE</span>
        <input
          aria-label="鉄骨ライン名"
          maxLength={200}
          value={f.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p>長さ {Math.round(steelLineLength(f)).toLocaleString()} mm</p>
        <button className="button full" onClick={onFocus}>
          ラインを拡大して確認
        </button>
      </div>
      <div className="inspector-section">
        <label className="select-label">
          部材断面
          <select
            aria-label="鉄骨ラインの部材断面"
            value={f.sectionId}
            onChange={(e) => onChange({ sectionId: e.target.value })}
          >
            {steelSections(project).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button full" onClick={onRegisterSection}>
          独自の部材断面を登録
        </button>
      </div>
      {ends.map((point, which) => (
        <div className="inspector-section" key={which}>
          <div className="section-label">{which ? '終点' : '始点'}の座標</div>
          {['X', 'Y', 'Z'].map((axis, i) => (
            <Field
              key={axis}
              label={`ライン${which ? '終点' : '始点'} ${axis}`}
              value={point[i]}
              min={i === 0 ? -100000 : 0}
              max={150000}
              onChange={(v) => changeEnd(which, i, v)}
            />
          ))}
        </div>
      ))}
      <div className="inspector-section">
        <button className="button full" onClick={onContinue}>
          この終点から描き続ける
        </button>
        <p className="field-note">
          座標で水平・垂直・斜めのラインを指定できます。同じ平面で輪郭を閉じると、左の「ラインから生成した面」から膜を貼れます。
        </p>
      </div>
      <div className="inspector-section placement-actions">
        <button className="button" onClick={onDuplicate}>
          フレームを複製
        </button>
        <button className="button danger" onClick={onRemove}>
          フレームを削除
        </button>
      </div>
    </div>
  );
}
