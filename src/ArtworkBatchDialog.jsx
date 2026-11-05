import { useState } from 'react';
import { artworkBatchDimensions } from './artworkPlacement.js';
import { format } from './domain.js';

export default function ArtworkBatchDialog({ art, remaining, onStart, onClose, Modal, Button }) {
  const [count, setCount] = useState(remaining),
    [columns, setColumns] = useState(Math.min(3, remaining)),
    [gapX, setGapX] = useState(100),
    [gapY, setGapY] = useState(100);
  const options = {
    count: Number(count),
    columns: Number(columns),
    gapX: Number(gapX),
    gapY: Number(gapY),
  };
  let size,
    error = '';
  try {
    size = artworkBatchDimensions(art, options);
    if (options.count < 2 || options.count > remaining)
      error = `追加する点数は2〜${remaining}点で指定してください`;
  } catch (e) {
    error = e.message;
  }
  return (
    <Modal
      title="作品をまとめて配置"
      subtitle={`${art.title} · このプランで追加できる残り ${remaining}点`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!error) onStart(options);
        }}
      >
        <div className="batch-fields">
          {[
            ['追加する点数', count, setCount, 2, remaining, '点'],
            ['列数', columns, setColumns, 1, Number(count) || remaining, '列'],
            ['横の間隔', gapX, setGapX, 0, 100000, 'mm'],
            ['縦の間隔', gapY, setGapY, 0, 100000, 'mm'],
          ].map(([label, value, setter, min, max, unit]) => (
            <label className="number-field" key={label}>
              <span>{label}</span>
              <div>
                <input
                  aria-label={label}
                  type="number"
                  required
                  min={min}
                  max={max}
                  step="1"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                />
                <small>{unit}</small>
              </div>
            </label>
          ))}
        </div>
        {error ? (
          <p role="alert" className="batch-error">
            {error}
          </p>
        ) : (
          <p className="field-note">
            {size.columns}列 × {size.rows}行 · 全体 {format(size.width)} × {format(size.height)} mm
          </p>
        )}
        <p className="field-note">
          壁を正面から見て左上から並びます。3Dまたは平面図で全点の位置を確認し、クリック1回で確定します。収まらない壁や重なる位置には追加できません。
        </p>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            キャンセル
          </Button>
          <button type="submit" className="button primary" disabled={!!error}>
            行列のプレビューを開始
          </button>
        </div>
      </form>
    </Modal>
  );
}
