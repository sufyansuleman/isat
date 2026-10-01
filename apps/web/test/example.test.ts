// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXAMPLE_CSV, EXAMPLE_FILE_NAME, exampleFile, exampleTableHtml } from '../src/upload/example';
import { loadTable, parseDelimited } from '../src/upload/parse';
import { mountUpload } from '../src/upload/view';

const file = readFileSync(resolve(process.cwd(), 'public/isat-template.csv'), 'utf8');

describe('example file', () => {
  it('is bundled from public/isat-template.csv', () => expect(EXAMPLE_CSV).toBe(file));

  it('renders 10 rows and 19 columns with the CSV header, blanks left blank', () => {
    const host = document.createElement('div');
    host.innerHTML = exampleTableHtml();
    const csv = parseDelimited(file, ',');
    expect(host.querySelectorAll('tbody tr').length).toBe(10);
    expect(host.querySelectorAll('thead th').length).toBe(19);
    expect([...host.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual(csv[0]);
    expect(host.querySelector('tbody tr')!.children.length).toBe(19);
    const cells = [...host.querySelectorAll('tbody td, tbody th')].map((c) => c.textContent);
    expect(cells).toEqual(csv.slice(1).flat());
    expect(cells.includes('')).toBe(true);
    expect(cells.includes('—')).toBe(false);
  });

  it('"Use this example" gives the same parsed rows as uploading the file', async () => {
    const f = exampleFile();
    expect(f.name).toBe(EXAMPLE_FILE_NAME);
    expect(loadTable(await f.text())).toEqual(loadTable(file));
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountUpload(root);
    (root.querySelector('#up-use-example') as HTMLButtonElement).click();
    for (let k = 0; k < 50 && root.querySelector('#up-loaded')!.hasAttribute('hidden'); k++) await new Promise((r) => setTimeout(r, 20));
    const text = root.querySelector('#up-loaded')!.textContent!;
    expect(text).toContain('isat-example.csv');
    expect(text).toContain('10 participants');
    expect((root.querySelector('#u-u-glucose') as HTMLSelectElement).value).toBe('mmol/L');
    expect((root.querySelector('#u-u-insulin') as HTMLSelectElement).value).toBe('pmol/L');
  });
});
