import { Field } from './SteelFrames.jsx';
import { steelSections } from './steelFrames.js';
import {
  STEEL_LINE_PLANES,
  steelLineLength,
  steelLineEndpoints,
  withSteelLineEndpoints,
  steelPlaneCenter,
  moveSteelPlane,
} from './steelLinePlacement.js';

export function SteelLineControls({
  project,
  settings,
  onSettings,
  active,
  start,
  onStart,
  onStop,
  phase,
  onConfirm,
  onMovePlane,
  onFocusPlane,
}) {
  const center = steelPlaneCenter(settings);
  return (
    <section className="steel-line-controls" aria-label="鉄骨ラインの配置">
      <div className="section-label">3Dでラインを描く</div>
      <p className="workplane-step">
        {!active
          ? '作業平面を置いてから始めます'
          : phase === 'plane'
            ? '1 / 作業平面をドラッグして配置'
            : '2 / 作業平面でラインを描く'}
      </p>
      {!active ? (
        <button className="button primary full" onClick={onStart}>
          作業平面を配置
        </button>
      ) : phase === 'plane' ? (
        <>
          <p className="field-note">
            半透明の平面をドラッグ。X・Y・Zの矢印でも位置を調整できます。
          </p>
          <button className="button primary full" onClick={onConfirm}>
            この平面でラインを描く
          </button>
        </>
      ) : (
        <button className="button full" onClick={onMovePlane}>
          作業平面を動かす
        </button>
      )}
      {active && (
        <button className="button full" onClick={onFocusPlane}>
          作業平面を拡大
        </button>
      )}
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
              center: start ? [...start] : center,
              offset: (start || center)[next.axis],
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
      <details className="workplane-coordinates">
        <summary>作業平面の座標</summary>
        {['X', 'Y', 'Z'].map((axis, i) => (
          <Field
            key={axis}
            label={`作業平面の中心 ${axis}`}
            value={center[i]}
            min={Number.MIN_SAFE_INTEGER}
            max={Number.MAX_SAFE_INTEGER}
            onChange={(v) => {
              const next = [...center];
              next[i] = v;
              onSettings(moveSteelPlane(settings, next));
            }}
          />
        ))}
      </details>
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
          aria-label="鉄骨配置のスナップ"
          checked={settings.snap !== false}
          onChange={(e) => onSettings({ ...settings, snap: e.target.checked })}
        />
        スナップ
      </label>
      <p className="field-note">
        平面の中心は既存鉄骨に、ラインは建物・鉄骨の端点や辺に吸着。OFFで1 mm刻み。
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          aria-label="鉄骨ラインの直交モード"
          checked={!!settings.orthogonal}
          onChange={(e) => onSettings({ ...settings, orthogonal: e.target.checked })}
        />
        直交モード
      </label>
      <p className="field-note">
        始点から作業平面の軸方向へ描画。ONの間はスナップも直交を保ちます。
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          aria-label="鉄骨ラインを連続配置"
          checked={settings.continuous}
          onChange={(e) => onSettings({ ...settings, continuous: e.target.checked })}
        />
        終点から続けて描く
      </label>
      {active && (
        <button className="button full" onClick={onStop}>
          ライン配置を終了
        </button>
      )}
      <p className="field-note">
        平面の位置を決めたら始点・終点をクリック。建物の外や床下・天井より上にも配置できます。
        スナップと直交を切り替えできます。Altで1
        mm刻み。右ドラッグで視点回転。Enterで確定／終了、Escで中止。
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
              min={Number.MIN_SAFE_INTEGER}
              max={Number.MAX_SAFE_INTEGER}
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
