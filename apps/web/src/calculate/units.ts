import { esc } from './format';
import { unitLabel } from './results';
import type { UnitChoice } from './state';

const opt = (v: string, cur: string, label = unitLabel(v)) =>
  `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;

/** Units selectors and conversion factors; shared by manual entry and file upload. `prefix` keeps element ids unique. */
export function unitsSectionHtml(u: UnitChoice, prefix: string, head?: { title: string; intro: string }): string {
  const sel = (key: string, o: string) => `<select id="${prefix}-u-${key}" data-u="${key}">${o}</select>`;
  return `<section aria-labelledby="${prefix}-h-units"><h2 id="${prefix}-h-units">${head ? esc(head.title) : 'Units'}</h2>
${head ? `<p class="hint">${esc(head.intro)}</p>
` : ''}<div class="units">
  <span class="upair"><label for="${prefix}-u-glucose">Glucose</label>${sel('glucose', opt('mmol/L', u.glucose) + opt('mg/dL', u.glucose))}</span>
  <span class="upair"><label for="${prefix}-u-insulin">Insulin</label>${sel('insulin', opt('pmol/L', u.insulin) + opt('uU/mL', u.insulin, 'µU/mL (= mU/L)'))}</span>
  <span class="upair"><label for="${prefix}-u-tg">TG</label>${sel('tg', opt('mmol/L', u.tg) + opt('mg/dL', u.tg))}</span>
  <span class="upair"><label for="${prefix}-u-hdl">HDL</label>${sel('hdl', opt('mmol/L', u.hdl) + opt('mg/dL', u.hdl))}</span>
  <span class="upair"><label for="${prefix}-u-ffa">FFA</label>${sel('ffa', opt('mmol/L', u.ffa) + opt('umol/L', u.ffa))}</span>
</div>
<details class="factors"><summary>Conversion factors</summary>
  <div class="units">
    <span class="upair"><label for="${prefix}-x-insulin">Insulin, pmol/L per µU/mL</label> <select id="${prefix}-x-insulin" data-x="insulinFactor"><option value="6">6.0 (default)</option><option value="6.945">6.945</option></select></span>
    <span class="upair"><label for="${prefix}-x-glucose">Glucose, mg/dL per mmol/L</label> <select id="${prefix}-x-glucose" data-x="glucoseFactor"><option value="18">18 (default)</option><option value="18.016">18.016</option></select></span>
  </div>
</details>
</section>`;
}
