import { useCallback, useEffect, useRef, useState } from 'react';
import Plan from './Plan.jsx';
import './workspace.css';

export function usePlanWindow(onBlocked) {
  const [popup, setPopup] = useState(null);
  const current = useRef(null);
  const open = () => {
    if (current.current && !current.current.closed) {
      current.current.focus();
      return;
    }
    const next = window.open('', '', 'popup=yes,width=1060,height=860,resizable=yes');
    if (!next) {
      onBlocked('平面図を開くには、このサイトのポップアップを許可してください');
      return;
    }
    next.document.title = '平面図 | 間 MA';
    next.document.documentElement.lang = 'ja';
    next.document.body.replaceChildren();
    current.current = next;
    setPopup(next);
  };
  useEffect(() => {
    if (!popup) return;
    const styles = [];
    const copyStyles = () => {
      styles.splice(0).forEach((node) => node.remove());
      document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        const copy = node.cloneNode(true);
        if (node.tagName === 'LINK') copy.href = node.href;
        popup.document.head.append(copy);
        styles.push(copy);
      });
    };
    copyStyles();
    const observer = new MutationObserver(copyStyles);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const closed = () => {
      if (current.current === popup) current.current = null;
      setPopup(null);
    };
    const close = () => popup.close();
    popup.addEventListener('pagehide', closed);
    window.addEventListener('pagehide', close);
    return () => {
      observer.disconnect();
      popup.removeEventListener('pagehide', closed);
      window.removeEventListener('pagehide', close);
      popup.close();
    };
  }, [popup]);
  return [popup, open];
}

const INITIAL_VIEW = { zoom: 1, x: 0, y: 0 };
const objectSelector =
  '.plan-art, .plan-partition, .plan-steel-frame, .plan-scene-object, [data-steel-line-face-id]';

export default function PlanWindow({ popup, planProps, onUndo, onRedo, canUndo, canRedo }) {
  const [view, setView] = useState(INITIAL_VIEW);
  const [panMode, setPanMode] = useState(false);
  const [panning, setPanning] = useState(false);
  const surface = useRef(null);
  const gesture = useRef(null);
  const space = useRef(false);
  const layoutId = planProps.project.activeLayoutId;
  useEffect(() => setView(INITIAL_VIEW), [layoutId]);
  const zoom = useCallback((factor, anchor) => {
    setView((previous) => {
      const nextZoom = Math.max(0.25, Math.min(16, previous.zoom * factor));
      const ratio = 1 - previous.zoom / nextZoom;
      return {
        zoom: nextZoom,
        x: previous.x + (anchor?.x || 0) * ratio,
        y: previous.y + (anchor?.y || 0) * ratio,
      };
    });
  }, []);
  useEffect(() => {
    const host = surface.current;
    const wheel = (event) => {
      event.preventDefault();
      const svg = host.querySelector('svg');
      const p = svg.createSVGPoint();
      p.x = event.clientX;
      p.y = event.clientY;
      const point = p.matrixTransform(svg.getScreenCTM().inverse());
      const box = svg.viewBox.baseVal;
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
      zoom(Math.exp(-delta * 0.0015), {
        x: point.x - (box.x + box.width / 2),
        y: point.y - (box.y + box.height / 2),
      });
    };
    const keyDown = (event) => {
      if (
        ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName) ||
        event.target.isContentEditable
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        space.current = true;
        host.classList.add('space-pan');
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(1.25);
      }
      if (event.key === '-') {
        event.preventDefault();
        zoom(0.8);
      }
      if (event.key === '0') setView(INITIAL_VIEW);
    };
    const releaseSpace = () => {
      space.current = false;
      host.classList.remove('space-pan');
    };
    const keyUp = (event) => {
      if (event.code === 'Space') releaseSpace();
    };
    const blur = () => {
      releaseSpace();
      gesture.current = null;
      setPanning(false);
    };
    host.addEventListener('wheel', wheel, { passive: false });
    popup.addEventListener('keydown', keyDown);
    popup.addEventListener('keyup', keyUp);
    popup.addEventListener('blur', blur);
    return () => {
      host.removeEventListener('wheel', wheel);
      popup.removeEventListener('keydown', keyDown);
      popup.removeEventListener('keyup', keyUp);
      popup.removeEventListener('blur', blur);
    };
  }, [popup, zoom]);
  const finishPan = (event) => {
    if (!gesture.current || gesture.current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const layout = planProps.project.layouts.find((l) => l.id === planProps.project.activeLayoutId);
  return (
    <main className="plan-window">
      <header className="plan-window-header">
        <div>
          <strong>平面図</strong>
          <span>
            {planProps.project.name} / {layout.name}
          </span>
        </div>
        <button className="button" onClick={() => popup.close()}>
          閉じる
        </button>
      </header>
      <div className="plan-window-toolbar" aria-label="平面図の操作">
        <button className="button" aria-label="平面図を縮小" onClick={() => zoom(0.8)}>
          −
        </button>
        <output aria-label="平面図のズーム倍率">{Math.round(view.zoom * 100)}%</output>
        <button className="button" aria-label="平面図を拡大" onClick={() => zoom(1.25)}>
          ＋
        </button>
        <button className="button" onClick={() => setView(INITIAL_VIEW)}>
          全体を表示
        </button>
        <span className="toolbar-separator" />
        <button
          className={`button ${panMode ? 'primary' : ''}`}
          aria-pressed={panMode}
          onClick={() => setPanMode((value) => !value)}
        >
          パン
        </button>
        <div className="toolbar-spacer" />
        <button className="button" disabled={!canUndo} onClick={onUndo}>
          元に戻す
        </button>
        <button className="button" disabled={!canRedo} onClick={onRedo}>
          やり直す
        </button>
      </div>
      <div
        ref={surface}
        className={`plan-window-surface ${panMode ? 'pan-mode' : ''} ${panning ? 'panning' : ''}`}
        tabIndex={0}
        aria-label="平面図の表示領域"
        onPointerDownCapture={(event) => {
          const placing = planProps.placingArtworkId || planProps.placingPartition;
          const background = !placing && !event.target.closest(objectSelector);
          if (
            event.button !== 1 &&
            !(event.button === 0 && (panMode || space.current || background))
          )
            return;
          if (gesture.current) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          const svg = event.currentTarget.querySelector('svg');
          gesture.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            matrix: svg.getScreenCTM().inverse(),
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanning(true);
        }}
        onPointerMoveCapture={(event) => {
          const drag = gesture.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          const dx = event.clientX - drag.x,
            dy = event.clientY - drag.y;
          setView((previous) => ({
            ...previous,
            x: previous.x - dx * drag.matrix.a - dy * drag.matrix.c,
            y: previous.y - dx * drag.matrix.b - dy * drag.matrix.d,
          }));
          drag.x = event.clientX;
          drag.y = event.clientY;
        }}
        onPointerUpCapture={finishPan}
        onPointerCancelCapture={finishPan}
        onLostPointerCapture={finishPan}
      >
        <Plan {...planProps} viewTransform={view} />
      </div>
      <footer className="plan-window-footer">
        ホイールでズーム · 背景ドラッグ / Space＋ドラッグでパン · 作品はドラッグで移動
        <span>メイン画面と連動</span>
      </footer>
    </main>
  );
}
