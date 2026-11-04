import React, { useRef, useState } from 'react';
import { CATALOG_COLUMNS, catalogValue, catalogCSV, catalogJSON } from './catalog.js';
import { download } from './storage.js';

export default function ArtworkCatalog({
  artworks,
  name,
  Modal,
  Button,
  onClose,
  onEdit,
  onImport,
}) {
  const fileInput = useRef();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="作品リスト"
      subtitle={`${artworks.length}件の作品・作品群。作品・梱包寸法はmmで統一し、複数枚は1枚あたりの寸法と点数で管理します。`}
      onClose={onClose}
      wide
    >
      <div className="catalog-toolbar">
        <Button
          icon="download"
          onClick={() =>
            download(`${name}-作品リスト.csv`, catalogCSV(artworks), 'text/csv;charset=utf-8')
          }
        >
          作品リストCSVを保存
        </Button>
        <Button
          icon="download"
          onClick={() => download(`${name}-作品リスト.ma-artworks.json`, catalogJSON(artworks))}
        >
          作品リストJSONを保存
        </Button>
        <Button icon="upload" disabled={busy} onClick={() => fileInput.current.click()}>
          {busy ? '読込中…' : '作品リストJSONを開く'}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="作品リストJSONファイル"
          hidden
          onChange={async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              if (file.size > 80 * 1024 * 1024) throw new Error('JSONは80 MB以内にしてください');
              await onImport(JSON.parse(await file.text()));
            } catch (err) {
              setError(`取り込み失敗：${err.message}`);
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
      </div>
      <p className="field-note">
        CSVは表計算用、JSONは画像を含む再編集用です。JSONの読み込みでは同じIDの作品を更新し、それ以外は追加します。プランと他の作品は保持され、操作後は元に戻せます。
      </p>
      <p className="field-note">
        壁面には＋でプレビューを開始し、壁をクリックして1枚ずつ配置します。各プランで数量上限を超える追加や、重なる位置への追加はできません。仮寸法・概寸は確定値と区別し、展示構成と梱包は別の欄に整理しています。三橋の「出す作品たち」はサイズ未確定のまま管理します。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="catalog-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="作品リスト一覧（横スクロール）"
      >
        <table className="catalog-table">
          <thead>
            <tr>
              {CATALOG_COLUMNS.map(([key, label]) => (
                <th scope="col" key={key}>
                  {label}
                </th>
              ))}
              <th scope="col">編集</th>
            </tr>
          </thead>
          <tbody>
            {artworks.map((art) => (
              <tr key={art.id}>
                {CATALOG_COLUMNS.map(([key]) => (
                  <td key={key}>{catalogValue(art, key) === '' ? '—' : catalogValue(art, key)}</td>
                ))}
                <td>
                  <button
                    className="button"
                    aria-label={`${art.artist} ${art.title}を一覧から編集`}
                    onClick={() => onEdit(art.id)}
                  >
                    編集
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
