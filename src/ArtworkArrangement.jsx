import React, { useState } from 'react';
import './artwork-arrangement.css';

export default function ArtworkArrangement({
  selectedCount,
  targetCount,
  onArrange,
  Button,
  NumberField,
}) {
  const [axis, setAxis] = useState('horizontal');
  const [gap, setGap] = useState(500);
  const [gridColumns, setGridColumns] = useState(2);
  const [gapX, setGapX] = useState(500);
  const [gapY, setGapY] = useState(500);
  const columns = Math.min(gridColumns, Math.max(1, targetCount));
  const alignments = [
    ['left', '左端'],
    ['horizontal-center', '左右中央'],
    ['right', '右端'],
    ['top', '上端'],
    ['vertical-center', '上下中央'],
    ['bottom', '下端'],
  ];
  return (
    <div className="inspector-section artwork-arrangement">
      <div className="section-label">
        選択作品の整列 <span>{selectedCount} 点</span>
      </div>
      <div className="alignment-buttons" role="group" aria-label="選択作品の整列">
        {alignments.map(([alignment, label]) => (
          <Button
            key={alignment}
            disabled={selectedCount < 2}
            aria-label={`${label}を揃える`}
            onClick={() => onArrange({ mode: 'align', alignment }, `${label}を揃えました`)}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="field-note">選択範囲の端・中央が基準。左右は壁を正面から見た向きです。</p>
      <div className="section-label arrangement-heading">
        均等配置{' '}
        <span>
          {selectedCount >= 2 ? `選択 ${targetCount} 点` : `この壁の全 ${targetCount} 点`}
        </span>
      </div>
      <div className="arrangement-axis" role="group" aria-label="均等配置の方向">
        {[
          ['horizontal', '横方向'],
          ['vertical', '縦方向'],
        ].map(([value, label]) => (
          <Button key={value} aria-pressed={axis === value} onClick={() => setAxis(value)}>
            {label}
          </Button>
        ))}
      </div>
      <Button
        className="full"
        icon="ruler"
        disabled={targetCount < 2}
        onClick={() =>
          onArrange(
            { mode: 'distribute', axis },
            `${axis === 'horizontal' ? '横' : '縦'}方向のすき間を均等にしました`,
          )
        }
      >
        両端を固定して等間隔
      </Button>
      <div className="gap-row">
        <NumberField label="作品間のすき間" value={gap} max={20000} onChange={setGap} />
        <Button
          disabled={targetCount < 2}
          onClick={() =>
            onArrange(
              { mode: 'distribute', axis, gap },
              `${gap.toLocaleString('ja-JP')} mmのすき間で配置しました`,
            )
          }
        >
          適用
        </Button>
      </div>
      <p className="field-note">横は左端、縦は上端を固定して指定のすき間を適用します。</p>
      <details className="arrangement-grid">
        <summary>行列に並べる</summary>
        <div className="arrangement-fields">
          <NumberField
            label="列数"
            value={columns}
            min={1}
            max={Math.max(1, targetCount)}
            unit="列"
            onChange={setGridColumns}
          />
          <div className="arrangement-rows">
            行数
            <strong>
              {Math.ceil(targetCount / columns)} <small>行</small>
            </strong>
          </div>
          <NumberField label="列のすき間" value={gapX} max={20000} onChange={setGapX} />
          <NumberField label="行のすき間" value={gapY} max={20000} onChange={setGapY} />
        </div>
        <Button
          className="full"
          icon="grid"
          disabled={targetCount < 2}
          onClick={() =>
            onArrange(
              { mode: 'grid', columns, gapX, gapY },
              `${columns}列 × ${Math.ceil(targetCount / columns)}行に配置しました`,
            )
          }
        >
          行列配置を適用
        </Button>
        <p className="field-note">
          選択順に左上から配置。各列・行の最大寸法を基準に中央で揃えます。
        </p>
      </details>
      <p className="field-note">
        Shift/Ctrl＋クリックで複数選択。均等・行列配置は1点選択時に同じ壁の全作品が対象です。
      </p>
    </div>
  );
}
