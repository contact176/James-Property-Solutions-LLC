import { copyFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(new URL('assets/', output), { recursive: true });
const files = ['index.html', 'robots.txt', 'sitemap.xml', 'assets/quote-form.js'];
for (const file of files) await copyFile(new URL(file, root), new URL(file, output));
// Explicit allowlist also excludes any stale files left in a prior build directory.
await writeFile(new URL('.assetsignore', output), '*\n!/index.html\n!/robots.txt\n!/sitemap.xml\n!/assets/\n/assets/*\n!/assets/quote-form.js\n');
console.log(`Built ${files.length} public assets in dist/.`);
