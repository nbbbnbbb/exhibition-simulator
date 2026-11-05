import { useState } from 'react';
import { Field } from './SteelFrames.jsx';
import { OBJECT_KINDS, DEFAULT_OUTLINE, silhouettes, validateOutline } from './sceneObjects.js';
import './scene-objects.css';

function OutlineEditor({ points, onChange }) {
  return (
    <div className="outline-editor">
      <p className="field-note">
        枠内を順にクリックして輪郭を指定（3点以上）。幅・奥行に合わせて拡縮します。
      </p>
      <svg
        viewBox="-0.06 -0.06 1.12 1.12"
        role="img"
        aria-label="多角形の輪郭を描く"
        onClick={(event) => {
          const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
            event.currentTarget.getScreenCTM().inverse(),
          );
          if (points.length < 64)
            onChange([
              ...points,
              [
                Math.max(0, Math.min(1, Math.round(p.x * 20) / 20)),
                Math.max(0, Math.min(1, Math.round(p.y * 20) / 20)),
              ],
            ]);
        }}
      >
        <rect width="1" height="1" fill="#f4f5ef" stroke="#b9c3b1" strokeWidth=".008" />
        {Array.from({ length: 9 }, (_, i) => (
          <path
            key={i}
            d={`M${(i + 1) / 10} 0V1M0 ${(i + 1) / 10}H1`}
            stroke="#dce1d6"
            strokeWidth=".003"
          />
        ))}
        <polygon
          points={points.map((p) => p.join(',')).join(' ')}
          fill="#b7c5ab88"
          stroke="#637757"
          strokeWidth=".012"
        />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r=".018" fill="#637757" />
        ))}
      </svg>
      <div className="object-actions">
        <button type="button" className="button" onClick={() => onChange([])}>
          描き直す
        </button>
        <button
          type="button"
          className="button"
          disabled={!points.length}
          onClick={() => onChange(points.slice(0, -1))}
        >
          頂点を戻す
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onChange(structuredClone(DEFAULT_OUTLINE))}
        >
          L字
        </button>
      </div>
    </div>
  );
}

function Dimensions({ object, onChange }) {
  const horizontal = object.kind === 'plane' && object.orientation === 'horizontal';
  const silhouette = object.kind === 'silhouette';
  return (
    <>
      {object.kind === 'plane' && (
        <label className="select-label">
          平面の向き
          <select
            aria-label="平面の向き"
            value={object.orientation}
            onChange={(e) => onChange({ orientation: e.target.value })}
          >
            <option value="vertical">垂直（パネル）</option>
            <option value="horizontal">水平（床・天板）</option>
          </select>
        </label>
      )}
      <div className="object-fields">
        {!silhouette && (
          <Field
            label="幅"
            value={object.width}
            min={1}
            max={100000}
            onChange={(width) => onChange({ width })}
          />
        )}
        {!horizontal && (
          <Field
            label={silhouette ? '身長' : '高さ'}
            value={object.height}
            min={1}
            max={100000}
            onChange={(height) => onChange({ height })}
          />
        )}
        {!silhouette && !(object.kind === 'plane' && !horizontal) && (
          <Field
            label="奥行"
            value={object.depth}
            min={1}
            max={100000}
            onChange={(depth) => onChange({ depth })}
          />
        )}
      </div>
      {silhouette && <p className="field-note">縦横比を保持 · 足元は床面 0 mm · グレー</p>}
    </>
  );
}

function Appearance({ object, onChange }) {
  return (
    <div className="object-appearance">
      {object.kind !== 'silhouette' && (
        <label>
          色{' '}
          <input
            aria-label="形状の色"
            type="color"
            value={object.color}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </label>
      )}
      <label>
        透明度 <output>{Math.round((1 - object.opacity) * 100)}%</output>
        <input
          type="range"
          aria-label="透明度"
          min="0"
          max="100"
          value={Math.round((1 - object.opacity) * 100)}
          onChange={(e) => onChange({ opacity: (100 - Number(e.target.value)) / 100 })}
        />
      </label>
    </div>
  );
}

function SilhouetteChoices({ value, onChange }) {
  return (
    <div className="silhouette-choices" role="group" aria-label="人物シルエットの種類">
      {silhouettes.map((s) => (
        <button
          type="button"
          key={s.id}
          className={value === s.id ? 'active' : ''}
          aria-label={s.name}
          aria-pressed={value === s.id}
          onClick={() => onChange(s.id)}
        >
          <svg viewBox={`-0.025 -0.025 ${s.aspect + 0.05} 1.05`} aria-hidden="true">
            <polygon points={s.points.map((p) => p.join(',')).join(' ')} fill="currentColor" />
          </svg>
          <span>{s.name}</span>
        </button>
      ))}
    </div>
  );
}

export function SceneObjectLibrary({ objects, selected, onSelect, onAdd }) {
  const [tab, setTab] = useState('shapes');
  const initial = (kind) => ({
    kind,
    width: 1000,
    height: kind === 'silhouette' ? 1700 : kind === 'table' ? 720 : 1000,
    depth: kind === 'table' ? 700 : 1000,
    orientation: 'vertical',
    points: structuredClone(DEFAULT_OUTLINE),
    color: '#b8b5ac',
    opacity: kind === 'silhouette' ? 0.5 : 1,
    silhouetteId: silhouettes[0].id,
  });
  const [draft, setDraft] = useState(() => initial('box'));
  const [error, setError] = useState('');
  const change = (values) => {
    setDraft((d) => ({ ...d, ...values }));
    setError('');
  };
  return (
    <div className="scene-object-library">
      <div className="object-kind-tabs">
        <button
          className={tab === 'shapes' ? 'active' : ''}
          onClick={() => {
            setTab('shapes');
            setDraft(initial('box'));
            setError('');
          }}
        >
          形状
        </button>
        <button
          className={tab === 'people' ? 'active' : ''}
          onClick={() => {
            setTab('people');
            setDraft(initial('silhouette'));
            setError('');
          }}
        >
          人物シルエット
        </button>
      </div>
      <p className="muted">
        {tab === 'people'
          ? '添付図から分けた11種類。身長と透明度を指定して配置。'
          : '形状と実寸を指定して展示空間に追加。単位 mm。'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const options = { ...draft };
            if (draft.kind === 'polygon') options.points = validateOutline(draft.points);
            onAdd(draft.kind, options);
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        {tab === 'shapes' ? (
          <label className="select-label">
            追加する形状
            <select
              aria-label="追加する形状"
              value={draft.kind}
              onChange={(e) => {
                setDraft(initial(e.target.value));
                setError('');
              }}
            >
              {OBJECT_KINDS.map(([kind, name]) => (
                <option key={kind} value={kind}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <SilhouetteChoices
            value={draft.silhouetteId}
            onChange={(silhouetteId) => change({ silhouetteId })}
          />
        )}
        {draft.kind === 'polygon' && (
          <OutlineEditor points={draft.points} onChange={(points) => change({ points })} />
        )}
        <Dimensions object={draft} onChange={change} />
        <Appearance object={draft} onChange={change} />
        {error && (
          <p className="object-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary full">
          {tab === 'people' ? '＋ 人物を追加' : '＋ 形状を追加'}
        </button>
      </form>
      <p className="field-note">
        追加後は平面図・3Dでドラッグして移動。右の詳細で位置・寸法を編集できます。
      </p>
      <h3>
        配置済み <small>{objects.length}</small>
      </h3>
      <div className="scene-object-list">
        {objects.length === 0 && <p className="muted">まだ配置されていません。</p>}
        {objects.map((o) => (
          <button
            key={o.id}
            className={selected === o.id ? 'active' : ''}
            onClick={() => onSelect(o.id)}
          >
            <span>{o.kind === 'silhouette' ? '人' : '◇'}</span>
            <span>
              {o.name}
              <small>
                {o.kind === 'silhouette'
                  ? `身長 ${o.height} mm`
                  : `${o.width} × ${o.height} × ${o.depth} mm`}
              </small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SceneObjectInspector({ object, onChange, onRemove, onDuplicate, onFocus }) {
  return (
    <div className="scene-object-inspector" key={object.id}>
      <h3>{object.kind === 'silhouette' ? '人物シルエット' : '形状の詳細'}</h3>
      <label className="select-label">
        名前
        <input
          aria-label="形状・人物の名前"
          value={object.name}
          maxLength={200}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      {object.kind === 'silhouette' && (
        <SilhouetteChoices
          value={object.silhouetteId}
          onChange={(silhouetteId) => onChange({ silhouetteId })}
        />
      )}
      <Dimensions object={object} onChange={onChange} />
      <h4>位置・回転</h4>
      <div className="object-fields">
        <Field
          label="位置 X"
          value={object.x}
          min={-1000000}
          max={1000000}
          onChange={(x) => onChange({ x })}
        />
        <Field
          label="位置 Z"
          value={object.z}
          min={-1000000}
          max={1000000}
          onChange={(z) => onChange({ z })}
        />
        {object.kind !== 'silhouette' && (
          <Field
            label="床からの高さ"
            value={object.y}
            max={100000}
            onChange={(y) => onChange({ y })}
          />
        )}
        <Field
          label="回転"
          value={object.rotation}
          min={-360000}
          max={360000}
          unit="°"
          onChange={(rotation) => onChange({ rotation })}
        />
      </div>
      {object.kind === 'polygon' && (
        <details>
          <summary>輪郭を編集</summary>
          <EditableOutline object={object} onChange={onChange} />
        </details>
      )}
      <Appearance object={object} onChange={onChange} />
      <button className="button full" onClick={onFocus}>
        3Dでこの配置を見る
      </button>
      <div className="object-actions">
        <button className="button" onClick={onDuplicate}>
          複製
        </button>
        <button className="button danger" onClick={onRemove}>
          配置を削除
        </button>
      </div>
    </div>
  );
}

function EditableOutline({ object, onChange }) {
  const [points, setPoints] = useState(object.points),
    [error, setError] = useState('');
  return (
    <>
      <OutlineEditor
        points={points}
        onChange={(p) => {
          setPoints(p);
          setError('');
        }}
      />
      <button
        className="button full"
        onClick={() => {
          try {
            onChange({ points: validateOutline(points) });
            setError('');
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        輪郭を適用
      </button>
      {error && (
        <p className="object-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
