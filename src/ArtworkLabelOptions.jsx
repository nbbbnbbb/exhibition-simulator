import React from 'react';
import { LABEL_FIELDS, DEFAULT_LABELS, LABEL_STYLE_LIMITS } from './artworkLabels.js';
export default function ArtworkLabelOptions({
  settings,
  onChange,
  onClose,
  Modal,
  Button,
  NumberField,
}) {
  return (
    <Modal
      title="作品情報の表示項目"
      subtitle="作品の上・作品に重ねる表示を選べます。表示項目と文字の設定は展覧会プランに保存されます。"
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
      <label className="select-label">
        表示位置
        <select
          aria-label="作品情報の表示位置"
          value={settings.position}
          onChange={(e) => onChange({ ...settings, position: e.target.value })}
        >
          <option value="above">作品の上</option>
          <option value="overlay">作品に重ねる（オーバーレイ）</option>
        </select>
      </label>
      <div className="label-style-fields">
        {[
          ['fontSize', '文字サイズ', 'px'],
          ['lineHeight', '行間', '%'],
          ['width', 'ラベルの横幅', 'mm'],
          ['gap', '作品との余白', 'mm'],
        ].map(([key, label, unit]) => (
          <NumberField
            key={key}
            label={label}
            value={settings[key]}
            min={LABEL_STYLE_LIMITS[key][0]}
            max={LABEL_STYLE_LIMITS[key][1]}
            unit={unit}
            onChange={(value) => onChange({ ...settings, [key]: value })}
          />
        ))}
      </div>
      <p className="field-note">文字サイズ・行間は3Dと平面図に反映されます。</p>
      {settings.position === 'overlay' && (
        <p className="field-note">
          作品の中央に重ねて表示します。「作品との余白」は作品の上に表示する場合に使います。
        </p>
      )}
      <div className="label-presets">
        <Button onClick={() => onChange({ ...settings, fields: [...DEFAULT_LABELS.fields] })}>
          基本項目
        </Button>
        <Button onClick={() => onChange({ ...settings, fields: LABEL_FIELDS.map(([id]) => id) })}>
          すべて選択
        </Button>
        <Button onClick={() => onChange({ ...settings, fields: [] })}>選択を解除</Button>
        <Button
          onClick={() =>
            onChange({
              ...settings,
              fontSize: DEFAULT_LABELS.fontSize,
              lineHeight: DEFAULT_LABELS.lineHeight,
              width: DEFAULT_LABELS.width,
              gap: DEFAULT_LABELS.gap,
            })
          }
        >
          文字の設定を初期値に戻す
        </Button>
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
