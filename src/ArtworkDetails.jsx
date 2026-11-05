import { CATALOG_COLUMNS, catalogValue } from './catalog.js';

export default function ArtworkDetails({ art, count, onClose, onEdit, Modal, Button }) {
  return (
    <Modal title="作品情報" subtitle={art.title} onClose={onClose}>
      {art.image && <img className="artwork-info-image" src={art.image} alt={art.title} />}
      <dl className="artwork-info-fields">
        {CATALOG_COLUMNS.filter(([key]) => !['width', 'height', 'depth'].includes(key)).map(
          ([key, label]) => {
            const value = catalogValue(art, key);
            return value === '' || value === null ? null : (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{String(value)}</dd>
              </div>
            );
          },
        )}
        <div>
          <dt>このプランの配置数</dt>
          <dd>{count}点</dd>
        </div>
      </dl>
      <div className="modal-footer">
        <Button onClick={onClose}>閉じる</Button>
        <Button onClick={onEdit}>作品情報を編集</Button>
      </div>
    </Modal>
  );
}
