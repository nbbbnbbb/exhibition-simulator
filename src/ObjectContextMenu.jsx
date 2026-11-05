import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { format } from './domain.js';

export default function ObjectContextMenu({
  target,
  art,
  partition,
  steelFrame,
  steelLineFace,
  membraneFace,
  onClose,
  onInfo,
  onDelete,
}) {
  const root = useRef();
  const [position, setPosition] = useState({ x: target.x, y: target.y });
  useLayoutEffect(() => {
    const ownerWindow = root.current.ownerDocument.defaultView;
    const rect = root.current.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(target.x, ownerWindow.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(target.y, ownerWindow.innerHeight - rect.height - 8)),
    });
    root.current.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [target]);
  useEffect(() => {
    const ownerWindow = root.current.ownerDocument.defaultView;
    const outside = (event) => {
      if (!root.current?.contains(event.target)) onClose();
    };
    const close = () => onClose();
    ownerWindow.addEventListener('pointerdown', outside, true);
    ownerWindow.addEventListener('resize', close);
    ownerWindow.addEventListener('scroll', close, true);
    ownerWindow.addEventListener('blur', close);
    return () => {
      ownerWindow.removeEventListener('pointerdown', outside, true);
      ownerWindow.removeEventListener('resize', close);
      ownerWindow.removeEventListener('scroll', close, true);
      ownerWindow.removeEventListener('blur', close);
    };
  }, [onClose]);
  const isMembrane = !!(membraneFace || steelLineFace);
  const isLine = steelFrame?.kind === 'line';
  const name =
    art?.title ||
    partition?.name ||
    (membraneFace
      ? `${steelFrame.name} / ${membraneFace.name}の膜`
      : steelLineFace
        ? `${steelLineFace.name}の膜`
        : steelFrame?.name);
  const menuLabel = art
    ? '作品のメニュー'
    : partition
      ? '可動壁のメニュー'
      : isMembrane
        ? '膜のメニュー'
        : isLine
          ? '鉄骨ラインのメニュー'
          : '鉄骨フレームのメニュー';
  const deleteLabel = art
    ? '作品の配置を削除'
    : partition
      ? '可動壁を削除'
      : isMembrane
        ? 'この面の膜を削除'
        : isLine
          ? '鉄骨ラインを削除'
          : '鉄骨フレームを削除';
  const dimensions = art || partition || steelFrame;
  return (
    <div
      ref={root}
      className="object-context-menu"
      role="menu"
      aria-label={menuLabel}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const items = [...root.current.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(root.current.ownerDocument.activeElement);
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
        ) : isMembrane ? (
          <span>{steelLineFace ? '輪郭のラインは残ります' : '鉄骨フレームは残ります'}</span>
        ) : isLine ? (
          <span>長さ {format(Math.hypot(...steelFrame.lineEnd))} mm</span>
        ) : (
          <span>
            {format(dimensions.width)} × {format(dimensions.height)} ×{' '}
            {format(dimensions.thickness ?? dimensions.depth)} mm
          </span>
        )}
      </div>
      {art && (
        <button role="menuitem" onClick={onInfo}>
          作品情報を表示
        </button>
      )}
      <button role="menuitem" className="context-delete" onClick={onDelete}>
        {deleteLabel}
      </button>
    </div>
  );
}
