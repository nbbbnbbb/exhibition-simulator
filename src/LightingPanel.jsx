import { useMemo, useState, useEffect } from 'react';
import { solarPosition, solarState, sampleIlluminance, lightingDefaults } from './lighting.js';
import { positionOnWall } from './domain.js';

const n = (value) => Math.round(value).toLocaleString('ja-JP');
export const timeString = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
function Slider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange, testId }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="light-slider">
      <span>
        {label}
        <span className="light-number">
          <input
            data-testid={testId}
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={() => {
              const v = Number(draft);
              if (draft !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v);
              else setDraft(value);
            }}
          />
          <small>{unit}</small>
        </span>
      </span>
      <input
        aria-label={`${label}スライダー`}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function SolarDiagram({ lighting: l }) {
  const sun = solarState(l);
  const samples = Array.from({ length: 49 }, (_, i) => {
    const t = i * 30,
      p = solarPosition(l.date, t, l.latitude, l.longitude, l.utcOffset);
    return { t, ...p, x: 24 + (t / 1440) * 212, y: 103 - (Math.max(0, p.altitude) / 90) * 75 };
  });
  const points = samples.map((s) => `${s.x},${s.y}`).join(' ');
  return (
    <svg
      className="solar-diagram"
      viewBox="0 0 260 135"
      role="img"
      aria-label="一日の太陽高度と南側遮蔽の目安"
    >
      <defs>
        <clipPath id="sun-chart-clip">
          <rect x="24" y="25" width="212" height="78" />
        </clipPath>
      </defs>
      <path d="M24 28V103H236M24 65H236" fill="none" stroke="#dce3d1" strokeWidth="1" />
      <g clipPath="url(#sun-chart-clip)">
        {samples
          .filter((s) => s.azimuth >= l.southStart && s.azimuth <= l.southEnd && s.altitude > 0)
          .map((s) => (
            <rect
              key={s.t}
              x={s.x - 2.3}
              y={103 - (l.southHorizon / 90) * 75}
              width="4.7"
              height={(l.southHorizon / 90) * 75}
              fill="#d3d9c9"
              opacity=".65"
            />
          ))}
        <polyline points={points} stroke="#b99560" strokeWidth="1.8" fill="none" />
        <circle
          cx={24 + (l.minutes / 1440) * 212}
          cy={103 - (Math.max(0, sun.altitude) / 90) * 75}
          r="4"
          fill="#b98b4c"
          stroke="#fafbf5"
        />
      </g>
      <text x="5" y="30">
        90°
      </text>
      <text x="8" y="106">
        0°
      </text>
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={24 + (h / 24) * 212} y="121" textAnchor="middle">
          {h}:00
        </text>
      ))}
      <text x="232" y="15" textAnchor="end">
        灰色：南側の推定遮蔽
      </text>
    </svg>
  );
}
export default function LightingPanel({
  project,
  layout,
  placement,
  artwork,
  wall,
  onChange,
  cutawayRoof,
  onCutaway,
  onSources,
  onWindowView,
}) {
  const l = layout.lighting,
    sun = solarState(l),
    change = (key, value) => onChange({ [key]: value });
  const probe = useMemo(() => {
    if (placement && artwork && wall) {
      const pos = positionOnWall(wall, placement.s, placement.bottom, artwork);
      return {
        name: '選択作品の表面中心',
        point: {
          x: (pos.x + wall.normal.x * (artwork.depth / 2 + 1)) / 1000,
          y: pos.y / 1000,
          z: (pos.z + wall.normal.z * (artwork.depth / 2 + 1)) / 1000,
        },
        normal: { x: wall.normal.x, y: 0, z: wall.normal.z },
      };
    }
    return {
      name: '主室の基準作業面（高さ800 mm）',
      point: {
        x: project.building.mainWidth / 2000,
        y: 0.8,
        z: (project.building.length - 8620) / 2000,
      },
      normal: { x: 0, y: 1, z: 0 },
    };
  }, [placement, artwork, wall?.id, project.building]);
  const lux = useMemo(
    () =>
      sampleIlluminance(
        probe.point,
        probe.normal,
        l,
        project.building,
        layout.partitions,
        project.rails,
      ),
    [probe, l, project.building, layout.partitions, project.rails],
  );
  const year = l.date.slice(0, 4);
  return (
    <div className="lighting-panel" data-testid="lighting-panel">
      <div className="lighting-intro">
        <span className="eyebrow">GALLERY @KCUA / LIGHT STUDY</span>
        <p>真北＝図面上端。閉じた天井と、北・南のガラス窓を前提に計算します。</p>
        <div className="light-presets">
          <button onClick={() => onChange({ daylight: true, spots: false, rails: false })}>
            自然光のみ
          </button>
          <button onClick={() => onChange({ daylight: false, spots: true, rails: true })}>
            人工光のみ
          </button>
          <button onClick={() => onChange({ daylight: false, spots: false, rails: false })}>
            全光源OFF
          </button>
        </div>
      </div>
      <section className="light-section">
        <div className="light-section-heading">
          <h3>自然光・季節と時刻</h3>
          <label className="light-switch">
            <input
              aria-label="自然光を有効"
              type="checkbox"
              checked={l.daylight}
              onChange={(e) => change('daylight', e.target.checked)}
            />
            <span>ON</span>
          </label>
        </div>
        <div className="light-date-time">
          <label>
            日付
            <input
              aria-label="日照の日付"
              type="date"
              min="1900-01-01"
              max="2100-12-31"
              value={l.date}
              onChange={(e) => {
                if (e.target.value) change('date', e.target.value);
              }}
            />
          </label>
          <label>
            時刻 JST
            <input
              aria-label="日照の時刻"
              type="time"
              value={timeString(l.minutes)}
              onChange={(e) => {
                if (e.target.value) {
                  const [h, m] = e.target.value.split(':').map(Number);
                  change('minutes', h * 60 + m);
                }
              }}
            />
          </label>
        </div>
        <input
          className="time-slider"
          aria-label="日照の時刻スライダー"
          type="range"
          min="0"
          max="1439"
          step="1"
          value={l.minutes}
          onChange={(e) => change('minutes', Number(e.target.value))}
        />
        <div className="season-presets">
          {[
            ['春分', '03-20'],
            ['夏至', '06-21'],
            ['秋分', '09-23'],
            ['冬至', '12-22'],
          ].map(([name, date]) => (
            <button key={name} onClick={() => change('date', year + '-' + date)}>
              {name}
            </button>
          ))}
        </div>
        <SolarDiagram lighting={l} />
        <div className="window-view-buttons">
          <button onClick={() => onWindowView('north')}>北窓側から見る</button>
          <button onClick={() => onWindowView('south')}>南窓側から見る</button>
        </div>
        <div className="sun-readout">
          <span>
            太陽高度<strong data-testid="sun-altitude">{sun.altitude.toFixed(1)}°</strong>
          </span>
          <span>
            方位角<strong>{sun.azimuth.toFixed(1)}°</strong>
          </span>
        </div>
        <p className="sun-state" data-testid="sun-state">
          {!l.daylight
            ? '自然光 OFF'
            : sun.altitude <= -18
              ? '夜間：自然光なし'
              : sun.altitude <= 0
                ? '薄明：天空光が徐々に減光'
                : sun.blocked && l.southBlock === 1
                  ? '南側建物による直達光の遮蔽中'
                  : sun.blocked
                    ? `南側の遮蔽を反映（透過 ${n((1 - l.southBlock) * 100)}%）`
                    : `${sun.window === 'north' ? '北' : '南'}窓に直達光の可能性`}
        </p>
        <Slider
          label="太陽光の強度"
          value={l.sunPercent}
          min={0}
          max={200}
          unit="%"
          onChange={(v) => change('sunPercent', v)}
        />
        <Slider
          label="太陽の影の柔らかさ"
          value={Math.round(l.sunSoftness * 100)}
          unit="%"
          onChange={(v) => change('sunSoftness', v / 100)}
        />
        <Slider
          label="屋外の天空光"
          value={l.skyLux}
          max={50000}
          step={100}
          unit="lx"
          onChange={(v) => change('skyLux', v)}
        />
      </section>
      <section className="light-section">
        <div className="light-section-heading">
          <h3>天井スポットライト</h3>
          <label className="light-switch">
            <input
              aria-label="スポットライトを有効"
              type="checkbox"
              checked={l.spots}
              onChange={(e) => change('spots', e.target.checked)}
            />
            <span>ON</span>
          </label>
        </div>
        <Slider
          label="スポット 色温度"
          testId="spot-kelvin"
          value={l.spotKelvin}
          min={1800}
          max={10000}
          step={100}
          unit="K"
          onChange={(v) => change('spotKelvin', v)}
        />
        <Slider
          label="スポット 基準照度"
          testId="spot-lux"
          value={l.spotLux}
          max={3000}
          step={10}
          unit="lx"
          onChange={(v) => change('spotLux', v)}
        />
        <p className="field-note">
          各スポットの光軸が壁の高さ1,500 mmと交わる位置での目標照度。器具の配光は円すいで近似。
        </p>
        <Slider
          label="スポット 配光角"
          value={l.spotAngle}
          min={15}
          max={100}
          unit="°"
          onChange={(v) => change('spotAngle', v)}
        />
        <Slider
          label="スポット 光の縁の柔らかさ"
          value={Math.round(l.spotSoftness * 100)}
          unit="%"
          onChange={(v) => change('spotSoftness', v / 100)}
        />
      </section>
      <section className="light-section">
        <div className="light-section-heading">
          <h3>レール定常光</h3>
          <label className="light-switch">
            <input
              aria-label="レール定常光を有効"
              type="checkbox"
              checked={l.rails}
              onChange={(e) => change('rails', e.target.checked)}
            />
            <span>ON</span>
          </label>
        </div>
        <Slider
          label="定常光 色温度"
          testId="rail-kelvin"
          value={l.railKelvin}
          min={1800}
          max={10000}
          step={100}
          unit="K"
          onChange={(v) => change('railKelvin', v)}
        />
        <Slider
          label="定常光 基準照度"
          testId="rail-lux"
          value={l.railLux}
          max={3000}
          step={10}
          unit="lx"
          onChange={(v) => change('railLux', v)}
        />
        <p className="field-note">
          主室基準点・高さ800 mmでの遮蔽前の目標照度。連続した線状の面光源で近似しています。
        </p>
      </section>
      <section className="light-section">
        <div className="light-section-heading">
          <h3>照度の概算</h3>
          <span className="source-tag estimate">参考値</span>
        </div>
        <p className="probe-name">{probe.name}</p>
        <div className="lux-total">
          <strong data-testid="probe-lux">{n(lux.total)}</strong>
          <span>lx</span>
        </div>
        <div className="lux-breakdown">
          {[
            ['直達光', lux.direct],
            ['天空光', lux.sky],
            ['スポット', lux.spot],
            ['定常光', lux.rail],
            ['間接反射', lux.indirect],
          ].map(([name, v]) => (
            <span key={name}>
              {name}
              <b>{n(v)}</b>
            </span>
          ))}
        </div>
        <p className="field-note">
          光源の基準照度と測定点の照度は異なります。器具のIES配光・実測・多重反射を含む照明設計計算ではありません。面光源の影は表示上の近似があります。
        </p>
      </section>
      <section className="light-section">
        <details>
          <summary>敷地の遮蔽条件を調整（推定）</summary>
          <p className="field-note">
            添付配置図とご指定から、南面は強い遮蔽、北面は比較的開放と判断。隣棟は3Dモデル化せず、方位別の遮蔽として反映します。遮蔽角80°は南からの直射を抑える保守的な初期仮定です。
          </p>
          <Slider
            label="南側の遮蔽高度"
            value={l.southHorizon}
            max={90}
            unit="°"
            onChange={(v) => change('southHorizon', v)}
          />
          <Slider
            label="南側の直達光遮蔽率"
            value={Math.round(l.southBlock * 100)}
            unit="%"
            onChange={(v) => change('southBlock', v / 100)}
          />
          <Slider
            label="南側遮蔽の始まり（方位角）"
            value={l.southStart}
            min={90}
            max={179}
            unit="°"
            onChange={(v) => change('southStart', v)}
          />
          <Slider
            label="南側遮蔽の終わり（方位角）"
            value={l.southEnd}
            min={181}
            max={270}
            unit="°"
            onChange={(v) => change('southEnd', v)}
          />
          <Slider
            label="北窓の天空開放率"
            value={Math.round(l.northSky * 100)}
            unit="%"
            onChange={(v) => change('northSky', v / 100)}
          />
          <Slider
            label="南窓の天空開放率"
            value={Math.round(l.southSky * 100)}
            unit="%"
            onChange={(v) => change('southSky', v / 100)}
          />
          <Slider
            label="ガラスの可視光透過率"
            value={Math.round(l.glassTransmission * 100)}
            unit="%"
            onChange={(v) => change('glassTransmission', v / 100)}
          />
          <p className="field-note">
            計算位置は新キャンパス近傍の仮座標 北緯34.9868° / 東経135.7662°、JST固定です。
          </p>
          <button className="rail-edit-link" onClick={onSources}>
            配置図と根拠を見る →
          </button>
        </details>
      </section>
      <section className="light-section">
        <Slider
          label="床・壁の反射光"
          value={l.bouncePercent ?? 100}
          max={200}
          unit="%"
          onChange={(v) => change('bouncePercent', v)}
        />
        <p className="field-note">
          床・壁からの反射を簡易補正し、天井・梁の下面を明るくします。0%で補正OFF、100%が標準です。実際の反射率ではありません。
        </p>
        <Slider
          label="画面の露出"
          value={l.exposureEV}
          min={-3}
          max={3}
          step={0.25}
          unit="EV"
          onChange={(v) => change('exposureEV', v)}
        />
        <p className="field-note">画面の見え方だけを調整し、照度の概算値は変えません。</p>
        <label className="check-label roof-control">
          <input
            aria-label="俯瞰で天井を透視"
            type="checkbox"
            checked={cutawayRoof}
            onChange={(e) => onCutaway(e.target.checked)}
          />
          俯瞰で天井を透視（遮光は維持）
        </label>
        <button className="button full subtle" onClick={() => onChange(lightingDefaults())}>
          このプランの照明を初期値に戻す
        </button>
      </section>
    </div>
  );
}
