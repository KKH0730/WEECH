/* ------------------------------------------------------------------
 *  _three_hook.mjs — 'three' 를 동봉한 파일로 이어 준다.
 *
 *  브라우저에서는 index.html 의 importmap 이 이 일을 한다.
 *      { "imports": { "three": "./vendor/three.module.js" } }
 *  Node 에는 importmap 이 없으므로 같은 뜻의 해석기를 끼운다.
 *  이것 때문에 node_modules 를 만들 필요는 없다 — 이 저장소는 외부 패키지 0개다.
 * ------------------------------------------------------------------ */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const VENDOR = pathToFileURL(
  path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '..', 'public', 'vendor', 'three.module.js')
).href;

export function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: VENDOR, shortCircuit: true };
  return next(specifier, context);
}
