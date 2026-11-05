import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { format } from './domain.js';

export default function ObjectContextMenu({ target, art, partition, onClose, onInfo, onDelete }) {
  const root = useRef();
  const [position, setPosition] = useState({ x: target.x, y: target.y });
  useLayoutEffect(() => {
    const rect = root.current.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8)),
    });
    root.current.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [target]);
  useEffect(() => {
    const outside = (event) => {
      if (!root.current?.contains(event.target)) onClose();
    };
    const close = () => onClose();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);
  const name = art?.title || partition?.name;
  return (
    <div
      ref={root}
      className="object-context-menu"
      role="menu"
      aria-label={art ? '作品のメニュー' : '可動壁のメニュー'}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const items = [...root.current.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(document.activeElement);
        if (['Escape', 'Tab'].includes(event.key)) {
          event.stopPropagation();
          onClose();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <div className="object-menu-summary">
        <strong>{name}</strong>
        {art ? (
          <>
            <span>{[art.artist, art.year].filter(Boolean).join(' / ')}</span>
            <span>
              {format(art.width)} × {format(art.height)} × {format(art.depth)} mm
            </span>
          </>
        ) : (
          <span>
            {format(partition.width)} × {format(partition.height)} × {format(partition.thickness)}{' '}
            mm
          </span>
        )}
      </div>
      {art && (
        <button role="menuitem" onClick={onInfo}>
          作品情報を表示
        </button>
      )}
      <button role="menuitem" className="context-delete" onClick={onDelete}>
        {art ? '作品の配置を削除' : '可動壁を削除'}
      </button>
    </div>
  );
}
