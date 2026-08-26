// Generates dist/artifact.html from index.html.
// The Artifact host supplies its own <!doctype>/<html>/<head>/<body> wrapper, so we
// hand it just the <title>, the styles and the page body — one source of truth.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(resolve(here, 'index.html'), 'utf8');

const slice = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`missing marker: ${i < 0 ? a : b}`);
  return src.slice(i + a.length, j).trim();
};

const title = src.match(/<title>([^<]*)<\/title>/)[1];
const head = slice('<!--ARTIFACT:HEAD-START-->', '<!--ARTIFACT:HEAD-END-->');
const body = slice('<!--ARTIFACT:BODY-START-->', '<!--ARTIFACT:BODY-END-->');

await mkdir(resolve(here, 'dist'), { recursive: true });
await writeFile(resolve(here, 'dist/artifact.html'), `<title>${title}</title>\n${head}\n\n${body}\n`);
console.log('dist/artifact.html written');
