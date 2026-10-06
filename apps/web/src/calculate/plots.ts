import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { unitLabel } from './results';
import type { FormState } from './state';

export interface PlotPoints { t: number[]; v: number[] }

/** Present (non-missing, numeric) points only, sorted by time. Missing cells are skipped, never 0. */
export function seriesPoints(st: FormState, q: 'glucose' | 'insulin'): PlotPoints {
  const pts: Array<[number, number]> = [];
  const seen = new Set<number>();
  for (const r of st.rows) {
    const t = Number(r.time), raw = r[q].trim();
    if (r.time.trim() === '' || raw === '' || !Number.isFinite(t) || seen.has(t)) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    seen.add(t);
    pts.push([t, v]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return { t: pts.map((p) => p[0]), v: pts.map((p) => p[1]) };
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export interface Chart { u: uPlot; title: string; destroy(): void }

/** Builds `.chart` and `.readout` inside `block`; the chart is sized from its own container via ResizeObserver. */
export function drawChart(block: HTMLElement, pts: PlotPoints, label: string, unit: string, seriesVar: string): Chart {
  const muted = css('--muted'), grid = css('--border'), colour = css(seriesVar);
  const host = document.createElement('div');
  host.className = 'chart';
  const readout = document.createElement('p');
  readout.className = 'readout';
  const hint = 'Hover over the chart for exact values.';
  readout.textContent = hint;
  block.append(host, readout);
  const width = Math.max(200, host.clientWidth || 320);
  const axis = { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 } };
  const u = new uPlot(
    {
      width, height: 260,
      scales: { x: { time: false } },
      cursor: { drag: { x: false, y: false } },
      axes: [
        { ...axis, label: 'Time (min); 0 = fasting sample', values: (_u: unknown, vals: number[]) => vals.map((v) => (v === 0 ? '0 (fasting)' : String(v))), labelFont: '13px system-ui, sans-serif', font: '12px system-ui, sans-serif' },
        { ...axis, label: `${label} (${unitLabel(unit)})`, labelFont: '13px system-ui, sans-serif', font: '12px system-ui, sans-serif', size: 60 },
      ],
      series: [
        { label: 'Time (min)', value: (_u, v) => (v == null ? '-' : `${v} min`) },
        {
          label, stroke: colour, width: 2, spanGaps: true,
          points: { show: true, size: 8, stroke: colour, fill: colour },
          value: (_u, v) => (v == null ? '-' : `${v} ${unitLabel(unit)}`),
        },
      ],
      legend: { show: false },
      hooks: {
        setCursor: [(p) => {
          const i = p.cursor.idx;
          readout.textContent = i == null || pts.v[i] === undefined
            ? hint : `${label}: ${pts.v[i]} ${unitLabel(unit)} at ${pts.t[i]} min`;
        }],
      },
    },
    [pts.t, pts.v],
    host,
  );
  const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    const w = Math.floor(host.clientWidth);
    if (w >= 100 && w !== u.width) u.setSize({ width: w, height: 260 });
  });
  ro?.observe(host);
  return { u, title: `${label}`, destroy: () => { ro?.disconnect(); u.destroy(); block.replaceChildren(); } };
}

/** PNG of the plot canvas on the page background colour. */
export function downloadPng(chart: Chart, filename: string): void {
  const src = chart.u.ctx.canvas;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = css('--bg') || '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  c.toBlob((b) => { if (b) saveBlob(b, filename); }, 'image/png');
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
