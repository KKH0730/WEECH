# vendor

브라우저에서 바로 쓰려고 동봉한 외부 라이브러리입니다. **수정하지 마세요.**

| 파일 | 출처 | 라이선스 |
|---|---|---|
| `three.module.js` | [three.js](https://github.com/mrdoob/three.js) r169 — `build/three.module.js` | MIT |
| `CSS3DRenderer.js` | three.js r169 — `examples/jsm/renderers/CSS3DRenderer.js` | MIT |

갱신하려면:

```
npm install three@<버전>
cp node_modules/three/build/three.module.js public/vendor/
cp node_modules/three/examples/jsm/renderers/CSS3DRenderer.js public/vendor/
```
