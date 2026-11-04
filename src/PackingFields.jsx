import React from 'react';

export default function PackingFields({ draft, edit, NumberField, Button }) {
  const packs = draft.packages || [];
  const change = (index, key, value) =>
    edit(
      'packages',
      packs.map((pack, i) => (i === index ? { ...pack, [key]: value } : pack)),
    );
  return (
    <fieldset className="packing-fields">
      <legend>梱包の寸法・数量</legend>
      <p className="field-note">
        単位はmm。種類ごとに分けて入力します。未指定の奥行・梱包数は空欄にできます。
      </p>
      {draft.packingSize && (
        <label className="text-field">
          引継ぎ済みの梱包メモ
          <input
            aria-label="梱包メモ"
            value={draft.packingSize}
            maxLength={500}
            onChange={(e) => edit('packingSize', e.target.value)}
          />
        </label>
      )}
      {packs.map((pack, index) => (
        <div className="packing-row" key={index}>
          <div className="packing-numbers">
            {['width', 'height', 'depth', 'quantity'].map((key, i) => (
              <NumberField
                key={key}
                label={`梱包${index + 1} ${['幅', '高さ', '奥行', '数量'][i]}`}
                value={pack[key]}
                min={1}
                max={key === 'quantity' ? 10000 : 100000}
                unit={key === 'quantity' ? '梱包' : 'mm'}
                nullable
                onChange={(value) => change(index, key, value)}
              />
            ))}
          </div>
          <div className="packing-options">
            <label>
              <input
                type="checkbox"
                checked={pack.approximate}
                onChange={(e) => change(index, 'approximate', e.target.checked)}
              />
              概寸
            </label>
            <label>
              <input
                type="checkbox"
                checked={pack.upperBound}
                onChange={(e) => change(index, 'upperBound', e.target.checked)}
              />
              上限寸法（以内）
            </label>
            <button
              type="button"
              className="text-danger"
              aria-label={`梱包${index + 1}を削除`}
              onClick={() =>
                edit(
                  'packages',
                  packs.filter((_, i) => i !== index),
                )
              }
            >
              削除
            </button>
          </div>
        </div>
      ))}
      <Button
        icon="plus"
        onClick={() =>
          edit('packages', [
            ...packs,
            {
              width: null,
              height: null,
              depth: null,
              quantity: null,
              approximate: false,
              upperBound: false,
            },
          ])
        }
      >
        梱包を追加
      </Button>
    </fieldset>
  );
}
