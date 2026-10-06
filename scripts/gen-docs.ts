// Regenerates generated documentation files. Run: npm run docs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { populationsMarkdown } from './populations';

const target = fileURLToPath(new URL('../docs/derivation-populations.md', import.meta.url));
writeFileSync(target, populationsMarkdown());
console.log(`wrote ${target}`);
