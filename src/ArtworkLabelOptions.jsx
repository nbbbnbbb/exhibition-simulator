import React from 'react';
import { LABEL_FIELDS, DEFAULT_LABELS } from './artworkLabels.js';
export default function ArtworkLabelOptions({ settings, onChange, onClose, Modal, Button }) {
  return (
    <Modal
      title="作品情報の表示項目"
      subtitle="作品脇の3Dラベルと平面図に表示します。設定はプロジェクトJSONにも保存されます。"
      onClose={onClose}
    >
      <label className="check-label label-enable">
        <input
          type="checkbox"
          checked={settings.enabled}
          aria-label="作品情報ラベルを有効にする"
          onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
        />
        作品情報を表示
      </label>
      <div className="label-presets">
        <Button onClick={() => onChange({ ...settings, fields: [...DEFAULT_LABELS.fields] })}>
          基本項目
        </Button>
        <Button onClick={() => onChange({ ...settings, fields: LABEL_FIELDS.map(([id]) => id) })}>
          すべて選択
        </Button>
        <Button onClick={() => onChange({ ...settings, fields: [] })}>選択を解除</Button>
      </div>
      <div className="label-field-list">
        {LABEL_FIELDS.map(([key, name]) => (
          <label className="check-label" key={key}>
            <input
              type="checkbox"
              aria-label={`表示項目 ${name}`}
              checked={settings.fields.includes(key)}
              onChange={(e) =>
                onChange({
                  ...settings,
                  fields: e.target.checked
                    ? [...settings.fields, key]
                    : settings.fields.filter((id) => id !== key),
                })
              }
            />
            {name}
          </label>
        ))}
      </div>
      {!settings.fields.length && <p className="field-note">表示する項目を選択してください。</p>}
      <p className="field-note">
        空欄のデータは表示しません。長いデータはラベル内で折り返し、一定の長さを超える場合は末尾を省略します。ラベルは確認用表示で、GLBには含めません。
      </p>
      <div className="modal-footer">
        <span>変更はすぐに反映されます</span>
        <Button onClick={onClose}>閉じる</Button>
      </div>
    </Modal>
  );
}
