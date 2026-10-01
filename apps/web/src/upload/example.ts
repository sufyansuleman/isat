import templateCsv from '../../public/isat-template.csv?raw';
import { esc } from '../calculate/format';
import { parseDelimited } from './parse';

/** The example file, bundled from the single source public/isat-template.csv (also the download link target). */
export const EXAMPLE_CSV: string = templateCsv;
export const EXAMPLE_FILE_NAME = 'isat-example.csv';

export const EXAMPLE_CAPTION_1 = 'Fasting values: fasting_glucose, fasting_insulin (and TG, HDL_c, FFA). OGTT values: glucose_30 … insulin_120 = minutes after the 75 g glucose drink.';
export const EXAMPLE_CAPTION_2 = 'Units in this example: glucose, lipids and FFA in mmol/L; insulin in pmol/L. Empty cell = not measured.';

/** The example as an HTML table with the exact headers and cells (empty cells stay blank). */
export function exampleTableHtml(csv: string = EXAMPLE_CSV): string {
  const rows = parseDelimited(csv, ',');
  const head = rows[0] ?? [];
  const th = head.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const body = rows.slice(1).map((r) =>
    `<tr>${head.map((_, k) => (k === 0 ? `<th scope="row">${esc(r[k] ?? '')}</th>` : `<td>${esc(r[k] ?? '')}</td>`)).join('')}</tr>`).join('');
  return `<div class="table-wrap example-wrap"><table class="ogtt example"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function exampleDetailsHtml(): string {
  const n = Math.max(0, parseDelimited(EXAMPLE_CSV, ',').length - 1);
  return `<details class="example-file"><summary>Show example file (${n} participants)</summary>
<p class="hint">${esc(EXAMPLE_CAPTION_1)}<br>${esc(EXAMPLE_CAPTION_2)}</p>
${exampleTableHtml()}
<p><button type="button" id="up-use-example">Use this example</button></p>
</details>`;
}

export function exampleFile(): File {
  return new File([EXAMPLE_CSV], EXAMPLE_FILE_NAME, { type: 'text/csv' });
}
