// 빌드된 dist/frontend.js를 가짜 DOM(linkedom)과 가짜 ctx로 띄워 화면 전환을 확인한다. 실행: node test/dist-frontend.check.mjs
import { parseHTML } from '../../charge_P/node_modules/linkedom/esm/index.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { window, document } = parseHTML('<html><body></body></html>');
Object.assign(globalThis, { window, document, confirm: () => true });
const { setup } = await import(pathToFileURL(resolve('dist/frontend.js')).href);

const now = Date.now();
const c = {
  id: 'cabc123', name: '등대지기', ratio: 7, theirNowLabel: '만난 지 3일째 저녁', delivery: { min: 1, max: 24 }, reply: null,
  letters: [
    { id: 'l1', from: 'me', body: '안녕하세요', sentAt: now - 9e6, arriveAt: now - 5e6, state: 'arrived', theirSentLabel: '1일째', theirArriveLabel: '2일째' },
    { id: 'l2', from: 'them', state: 'delivered', body: '<b>편지</b> 잘 받았네.', ps: '춥군.', envelope: { medium: '기름 먹인 천', scent: '소금' }, enclosures: [{ item: '조개', note: '' }], sentAt: now - 4e6, arriveAt: now - 1e6, theirWrittenLabel: '3일째' },
    { id: 'l3', from: 'me', body: '둘째', sentAt: now, arriveAt: now + 5 * 3600e3, state: 'in_transit', theirSentLabel: '3일째', theirArriveLabel: '4일째' },
  ],
};
let backend;
const replies = {
  load: () => ({ list: [{ id: c.id, name: c.name, ratio: 7, theirNow: '3일째', unread: 1, status: '편지가 가는 중', failed: false, lastAt: now }], settings: { showExactEta: false } }),
  get: () => ({ c, input: { name: c.name, brief: 'b', ratio: 7 } }),
  open: () => ({ c: { ...c, letters: c.letters.map((l) => (l.id === 'l2' ? { ...l, state: 'opened' } : l)) } }),
  connections: () => ({ connections: [{ id: 'v', name: 'Vertex', model: 'gemini', is_default: true }] }),
};
let badge = null;
const root = document.createElement('div');
document.body.append(root);
const ctx = {
  onBackendMessage: (h) => { backend = h; return () => {}; },
  sendToBackend: (m) => setTimeout(() => backend({ ok: true, requestId: m.requestId, ...(replies[m.type]?.() || {}) }), 0),
  ui: { registerDrawerTab: () => ({ root, setBadge: (b) => { badge = b; }, onActivate: () => () => {}, destroy() {} }) },
  dom: { addStyle: () => () => {} },
};
const tick = () => new Promise((r) => setTimeout(r, 10));
const click = (text) => {
  const b = [...root.querySelectorAll('button,.im-card,.im-letter')].find((x) => x.textContent.includes(text));
  if (!b) throw new Error(`못 찾음: ${text}`);
  b.dispatchEvent(new window.Event('click'));
};
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); };

const stop = setup(ctx);
await tick();
ok('우편함에 상대 표시', root.textContent.includes('등대지기'));
ok('읽지 않은 편지 배지', badge === '1');
click('등대지기'); await tick();
ok('상대 화면: 배송 중 남은 시간', root.textContent.includes('도착까지 약 5시간'));
ok('상대 화면: 회수 버튼', root.textContent.includes('회수하기'));
ok('상대 화면: 새 편지', root.textContent.includes('새 편지'));
click('새 편지'); await tick();
ok('봉투 화면: 매체', root.textContent.includes('기름 먹인 천'));
ok('봉투 화면: 동봉물 암시', root.textContent.includes('더 들어 있는'));
click('봉투 열기'); await tick(); await tick();
ok('본문 표시', root.textContent.includes('잘 받았네'));
ok('HTML이 글자로만 들어감', !root.querySelector('.im-paper b') && root.textContent.includes('<b>편지</b>'));
ok('추신', root.textContent.includes('추신. 춥군.'));
ok('동봉물', root.textContent.includes('동봉: 조개'));
click('← 등대지기'); await tick();
click('상대 정보 수정'); await tick();
ok('수정 화면', root.textContent.includes('상대 정보 수정') && root.querySelector('input').value === '등대지기');
click('← 돌아가기'); await tick();
click('← 우편함'); await tick();
click('설정'); await tick(); await tick();
ok('설정: 연결 목록', root.textContent.includes('Vertex — gemini (기본)'));
stop();

let fail = 0;
for (const [n, pass] of checks) { console.log(`${pass ? 'ok  ' : 'FAIL'} ${n}`); if (!pass) fail++; }
process.exit(fail ? 1 : 0);
