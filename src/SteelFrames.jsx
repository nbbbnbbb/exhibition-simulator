import { useState, useEffect } from 'react';
import {
  frameShapes,
  steelSections,
  shapeBounds,
  frameGeometry,
  validateFrameShape,
  validateSteelSection,
  FRAME_SHAPES,
  sectionLoops,
} from './steelFrames.js';

function Field({ label, value, onChange, min = 0, max = 30000, unit = 'mm' }) {
  const [draft, set] = useState(value);
  useEffect(() => set(value), [value]);
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          value={draft}
          onChange={(e) => set(e.target.value)}
          onBlur={() => {
            const n = Math.round(Number(draft));
            if (draft === '' || !Number.isFinite(n) || n < min || n > max) return set(value);
            if (n !== value) onChange(n);
            set(value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
export function FramePreview({ shape }) {
  const { min, size } = shapeBounds(shape);
  const points = shape.nodes.map((p) => [
    ((p[0] - min[0]) / (size[0] || 1)) * 110 + ((p[2] - min[2]) / (size[2] || 1)) * 28,
    (-(p[1] - min[1]) / (size[1] || 1)) * 85 - ((p[2] - min[2]) / (size[2] || 1)) * 18,
  ]);
  return (
    <svg className="frame-preview" viewBox="-12 -120 164 140" aria-hidden="true">
      {shape.members.map(([a, b], i) => (
        <line
          key={i}
          x1={points[a][0]}
          y1={points[a][1]}
          x2={points[b][0]}
          y2={points[b][1]}
          stroke="currentColor"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}
export function SteelFrameLibrary({
  project,
  frames,
  selected,
  onSelect,
  onAdd,
  onRegister,
  onRemoveShape,
}) {
  const shapes = frameShapes(project),
    [shapeId, setShape] = useState('rectangle');
  const shape = shapes.find((s) => s.id === shapeId) || shapes[0];
  const custom = project.frameShapes.some((s) => s.id === shape.id),
    used = project.layouts.some((l) => l.steelFrames.some((f) => f.shapeId === shape.id));
  return (
    <div className="steel-library">
      <p className="muted">軽量鉄骨を自由に配置し、面ごとにビニール膜を貼ります。</p>
      <label className="select-label">
        組立形状
        <select
          aria-label="追加するフレーム形状"
          value={shape.id}
          onChange={(e) => setShape(e.target.value)}
        >
          {shapes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {project.frameShapes.includes(s) ? '（登録形状）' : ''}
            </option>
          ))}
        </select>
      </label>
      <FramePreview shape={shape} />
      <button className="button primary full" onClick={() => onAdd(shape.id)}>
        ＋ 鉄骨フレームを追加
      </button>
      <button className="button full" onClick={onRegister}>
        独自の組立形状を登録
      </button>
      {custom && (
        <button className="text-danger" disabled={used} onClick={() => onRemoveShape(shape.id)}>
          {used ? '使用中の形状は削除できません' : 'この登録形状を削除'}
        </button>
      )}
      <p className="field-note">
        矩形・ボックス・門形・三角形を用意。追加後に外寸、部材断面、位置、向きを変更できます。
      </p>
      <div className="steel-frame-list">
        {frames.map((f) => (
          <button
            key={f.id}
            className={`steel-frame-card ${selected === f.id ? 'selected' : ''}`}
            onClick={() => onSelect(f.id)}
          >
            <strong>{f.name}</strong>
            <span>
              {f.width.toLocaleString()} × {f.height.toLocaleString()}
              {f.depth ? ` × ${f.depth.toLocaleString()}` : ''} mm
            </span>
            <small>
              {steelSections(project).find((s) => s.id === f.sectionId)?.name} · 膜{' '}
              {f.membrane.faces.length}面
            </small>
          </button>
        ))}
      </div>
      {!frames.length && <p className="empty-small">追加すると3Dと平面図に反映されます。</p>}
    </div>
  );
}
export function SteelFrameInspector({
  frame: f,
  project,
  onChange,
  onDuplicate,
  onRemove,
  onRegisterSection,
  onFocus,
}) {
  const { shape } = frameGeometry(f, project),
    shapes = frameShapes(project),
    sections = steelSections(project),
    section = sections.find((s) => s.id === f.sectionId);
  return (
    <div className="steel-inspector">
      <div className="partition-summary">
        <span className="eyebrow">LIGHT GAUGE STEEL</span>
        <input
          aria-label="鉄骨フレーム名"
          maxLength={200}
          value={f.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p>外寸・座標はmm、回転は上から見た角度</p>
        <button className="button full" onClick={onFocus}>
          フレームを正面から確認
        </button>
      </div>
      <div className="inspector-section">
        <label className="select-label">
          組立形状
          <select
            aria-label="フレームの組立形状"
            value={f.shapeId}
            onChange={(e) => {
              const s = shapes.find((s) => s.id === e.target.value),
                size = shapeBounds(s).size;
              onChange({
                shapeId: s.id,
                width: Math.round(size[0]),
                height: Math.round(size[1]),
                depth: Math.round(size[2]),
                membrane: { ...f.membrane, faces: [] },
              });
            }}
          >
            {shapes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="select-label">
          部材断面
          <select
            aria-label="鉄骨の部材断面"
            value={f.sectionId}
            onChange={(e) => onChange({ sectionId: e.target.value })}
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <svg
          className="section-preview"
          viewBox="-85 -85 170 170"
          role="img"
          aria-label={`${section.name}の断面`}
        >
          <path
            fillRule="evenodd"
            d={sectionLoops(section)
              .map((loop) => `M${loop.map(([x, y]) => `${x},${-y}`).join('L')}Z`)
              .join(' ')}
            fill="#8b9da3"
            stroke="#4e6755"
            strokeWidth="0.5"
          />
        </svg>
        <button className="button full" onClick={onRegisterSection}>
          独自の部材断面を登録
        </button>
      </div>
      <div className="inspector-section">
        <div className="section-label">フレーム外寸</div>
        {[
          ['width', 'フレーム幅'],
          ['height', 'フレーム高さ'],
          ...(shapeBounds(shape).size[2] ? [['depth', 'フレーム奥行']] : []),
        ].map(([key, label]) => (
          <Field
            key={key}
            label={label}
            value={f[key]}
            min={100}
            max={key === 'height' ? 20000 : 30000}
            onChange={(v) => onChange({ [key]: v })}
          />
        ))}
      </div>
      <div className="inspector-section">
        <div className="section-label">位置・向き</div>
        {[
          ['x', 'フレーム中心 X', -100000, 100000],
          ['z', 'フレーム中心 Z', 0, 150000],
          ['y', 'フレーム下端高さ', 0, 20000],
          ['rotation', 'フレーム回転角', -360, 360],
        ].map(([key, label, min, max]) => (
          <Field
            key={key}
            label={label}
            value={f[key]}
            min={min}
            max={max}
            unit={key === 'rotation' ? '°' : 'mm'}
            onChange={(v) => onChange({ [key]: v })}
          />
        ))}
        <p className="field-note">
          平面図・3Dでドラッグして自由に移動。通常10 mm、Altで1 mm刻み。Escで中止します。
        </p>
      </div>
      <div className="inspector-section">
        <div className="section-label">ビニール膜</div>
        {shape.faces.length ? (
          <>
            <div className="placement-actions">
              <button
                className="button"
                onClick={() =>
                  onChange({ membrane: { ...f.membrane, faces: shape.faces.map((_, i) => i) } })
                }
              >
                全ての面に貼る
              </button>
              <button
                className="button"
                onClick={() => onChange({ membrane: { ...f.membrane, faces: [] } })}
              >
                全て外す
              </button>
            </div>
            <div className="membrane-faces">
              {shape.faces.map((face, i) => (
                <label className="check-label" key={i}>
                  <input
                    type="checkbox"
                    aria-label={`${face.name}に膜を貼る`}
                    checked={f.membrane.faces.includes(i)}
                    onChange={(e) =>
                      onChange({
                        membrane: {
                          ...f.membrane,
                          faces: e.target.checked
                            ? [...f.membrane.faces, i]
                            : f.membrane.faces.filter((q) => q !== i),
                        },
                      })
                    }
                  />
                  {face.name}
                </label>
              ))}
            </div>
          </>
        ) : (
          <p className="field-note">
            この形状には閉じた面がありません。膜を貼るには、周囲を部材で囲んだ面を独自形状に登録してください。
          </p>
        )}
        <label className="membrane-color">
          膜の色
          <input
            type="color"
            aria-label="膜の色"
            value={f.membrane.color}
            onChange={(e) => onChange({ membrane: { ...f.membrane, color: e.target.value } })}
          />
        </label>
        <Field
          label="膜の不透明度"
          value={Math.round(f.membrane.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => onChange({ membrane: { ...f.membrane, opacity: v / 100 } })}
        />
        <p className="field-note">0%で透明、100%で不透明。膜は平らに張った状態を表示します。</p>
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
export function FrameShapeEditor({ onSave }) {
  const [name, setName] = useState('独自フレーム'),
    [source, setSource] = useState('rectangle');
  const [nodes, setNodes] = useState('0, 0, 0\n3000, 0, 0\n3000, 2400, 0\n0, 2400, 0');
  const [members, setMembers] = useState('1, 2\n2, 3\n3, 4\n4, 1'),
    [faces, setFaces] = useState('1, 2, 3, 4'),
    [error, setError] = useState('');
  const rows = (text) =>
    text.trim()
      ? text
          .trim()
          .split(/\n/)
          .map((s) =>
            s
              .trim()
              .split(/[,\s、]+/)
              .map(Number),
          )
      : [];
  const draft = () => ({
    id: crypto.randomUUID(),
    name: name.trim(),
    nodes: rows(nodes),
    members: rows(members).map((r) => r.map((n) => n - 1)),
    faces: rows(faces).map((r, i) => ({ name: `面${i + 1}`, nodes: r.map((n) => n - 1) })),
  });
  let preview;
  try {
    preview = validateFrameShape(draft());
  } catch {}
  return (
    <form
      className="frame-shape-editor"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSave(validateFrameShape(draft()));
        } catch (err) {
          setError(err.message);
        }
      }}
    >
      <label className="select-label">
        プリセットを元に編集
        <select
          aria-label="形状編集の元プリセット"
          value={source}
          onChange={(e) => {
            const s = FRAME_SHAPES.find((q) => q.id === e.target.value);
            setSource(s.id);
            setNodes(s.nodes.map((n) => n.join(', ')).join('\n'));
            setMembers(s.members.map((r) => r.map((i) => i + 1).join(', ')).join('\n'));
            setFaces(s.faces.map((f) => f.nodes.map((i) => i + 1).join(', ')).join('\n'));
            setError('');
          }}
        >
          {FRAME_SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="select-label">
        形状名
        <input
          aria-label="登録する形状名"
          maxLength={200}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="field-note">
        頂点は1行に X, Y,
        Z（mm）。Yは上向きです。部材は接続する2頂点の番号、面は周囲の頂点番号を順に入力。番号は1から始まります。面は省略でき、登録すると全プランから利用できます。
      </p>
      <div className="frame-editor-grid">
        <label>
          頂点座標
          <textarea
            aria-label="形状の頂点座標"
            rows={9}
            value={nodes}
            onChange={(e) => setNodes(e.target.value)}
          />
        </label>
        <label>
          部材の接続
          <textarea
            aria-label="形状の部材接続"
            rows={9}
            value={members}
            onChange={(e) => setMembers(e.target.value)}
          />
        </label>
        <label>
          膜を貼れる面
          <textarea
            aria-label="形状の膜面"
            rows={9}
            value={faces}
            onChange={(e) => setFaces(e.target.value)}
          />
        </label>
      </div>
      {preview && <FramePreview shape={preview} />}
      {error && (
        <p className="frame-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <button className="button primary" type="submit">
          組立形状を登録
        </button>
      </div>
    </form>
  );
}
export function SteelSectionEditor({ onSave }) {
  const [name, setName] = useState('独自断面'),
    [points, setPoints] = useState('-20, -20\n20, -20\n20, -18\n-18, -18\n-18, 20\n-20, 20'),
    [error, setError] = useState('');
  return (
    <form
      className="frame-shape-editor"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSave(
            validateSteelSection({
              id: crypto.randomUUID(),
              name: name.trim(),
              kind: 'custom',
              points: points
                .trim()
                .split('\n')
                .map((s) =>
                  s
                    .trim()
                    .split(/[,\s、]+/)
                    .map(Number),
                ),
            }),
          );
        } catch (err) {
          setError(err.message);
        }
      }}
    >
      <label className="select-label">
        断面名
        <input
          aria-label="登録する断面名"
          maxLength={200}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="field-note">
        部材中心を原点に、断面の輪郭を順に X, Y（mm）で入力します。3〜32頂点、各軸±500
        mm以内。閉じる最後の頂点は重複させず、厚みを含む輪郭を指定してください。独自断面は穴のない多角形に対応します。
      </p>
      <label className="select-label">
        断面の輪郭
        <textarea
          aria-label="断面の輪郭座標"
          rows={10}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
      </label>
      {error && (
        <p className="frame-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <button className="button primary" type="submit">
          部材断面を登録
        </button>
      </div>
    </form>
  );
}
