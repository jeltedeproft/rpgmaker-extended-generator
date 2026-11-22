// Writes manifest.json (list of PNGs and readme/credit files) into a folder so the dev server can load it with ?pack=<folder>.
// Run: node tools/make-manifest.mjs test-assets/somenewwork-ex
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('Usage: node tools/make-manifest.mjs <folder>');
  process.exit(1);
}
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk(root).filter((f) => /\.(png|txt|md)$/i.test(f)).map((f) => relative(root, f).replaceAll('\\', '/')).sort();
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ name: basename(root), files }, null, 2));
console.log(`${files.length} files listed in ${join(root, 'manifest.json')}`);
