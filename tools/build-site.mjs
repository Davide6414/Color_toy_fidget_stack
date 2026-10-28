// Copia i file del sito in _site/ (usato dal workflow di GitHub Pages).
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('../_site/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const entry of ['index.html', 'css', 'js', 'stl', 'assets']) {
  cpSync(new URL(entry, root), new URL(entry, out), { recursive: true });
}
writeFileSync(new URL('.nojekyll', out), '');
console.log('Sito pronto in _site/');
