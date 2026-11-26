// src/*.js를 이어 붙여 dist/backend.js·dist/frontend.js를 만든다(의존성 없음, charge_P와 같은 방식).
// 실행: 이 폴더에서 node scripts/build.js
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const join = async (names) =>
  (await Promise.all(names.map((n) => readFile(`src/${n}.js`, 'utf8'))))
    .map((s) => s.replace(/^import [^;]*? from '\.\/[^']*';\r?\n/gms, ''))
    .join('\n');

await mkdir('dist', { recursive: true });
await writeFile('dist/backend.js', await join(['core', 'match', 'memory', 'art', 'portrait', 'backend']));
await writeFile('dist/frontend.js', await join(['core', 'frontend']));
console.log('built dist/backend.js, dist/frontend.js');
