// 빌드된 dist/frontend.js를 가짜 DOM(linkedom)과 가짜 ctx로 띄워 화면을 확인한다. 실행: node test/dist-frontend.check.mjs
import { parseHTML } from '../../charge_P/node_modules/linkedom/esm/index.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { window, document } = parseHTML('<html><body></body></html>');
const store = new Map();
Object.assign(globalThis, {
  window, document, confirm: () => true,
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
});
window.innerWidth = 1280; window.innerHeight = 800;
const { setup } = await import(pathToFileURL(resolve('dist/frontend.js')).href);

const now = Date.now();
const mk = (id, name, personaId, personaName, extra = {}) => ({
  id, name, personaId, personaName, ratio: 7, theirNowLabel: '만난 지 4일째 저녁', delivery: { min: 1, max: 2 }, writeDelay: { min: 6, max: 12 }, timeScale: 60, maxReplyRealHours: 24, brief: 'b', world: '', reply: null,
  letters: [], items: [], ...extra,
});
const miren = mk('c1', '미렌', 'p1', '시드', {
  letters: [
    { id: 'l1', from: 'me', personaName: '시드', body: '처음 편지', enclosures: [{ item: '은행잎 한 장' }], sentAt: now - 9e6, arriveAt: now - 8e6, state: 'arrived', theirSentLabel: '1일째', theirArriveLabel: '2일째' },
    { id: 'l2', from: 'them', state: 'opened', body: '<b>편지</b> 잘 받았네.', ps: '춥군.', envelope: { medium: '기름 먹인 천', scent: '소금', stamp: '등대 도장' }, enclosures: [{ item: '조개', note: '얼음 틈에서' }], sentAt: now - 4e6, arriveAt: now - 3e6, theirWrittenLabel: '3일째', writtenLabel: '만난 지 3일째 새벽' },
    { id: 'l3', from: 'them', state: 'delivered', body: '두 번째', envelope: { medium: '갈색 종이', texture: '거칠다' }, enclosures: [{ item: '깃털' }], sentAt: now - 2e6, arriveAt: now - 1e6, theirWrittenLabel: '4일째' },
    { id: 'l4', from: 'me', personaName: '시드', body: '가는 중인 편지', sentAt: now, arriveAt: now + 5 * 3600e3, state: 'in_transit', theirSentLabel: '4일째' },
  ],
  items: [
    { id: 'i1', name: '은행잎 한 장', from: 'me', state: 'arrived', letterId: 'l1', theirLabel: '1일째', arriveAt: now - 8e6 },
    { id: 'i2', name: '조개', note: '얼음 틈에서', from: 'them', state: 'arrived', letterId: 'l2', theirLabel: '3일째', arriveAt: now - 3e6 },
    { id: 'i3', name: '깃털', from: 'them', state: 'arrived', letterId: 'l3', theirLabel: '4일째', arriveAt: now - 1e6 },
  ],
});
const other = mk('c2', '하르', 'p2', '하루');
let all = [miren, other];
const summary = (c) => ({ id: c.id, name: c.name, ratio: 7, theirNow: '4일째', personaId: c.personaId, personaName: c.personaName, unread: c.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length, status: '편지가 가는 중', failed: false, lastAt: now });
const sentLog = [];
let backend;
const replies = {
  all: () => ({ all, settings: { showExactEta: false } }),
  load: () => ({ list: all.map(summary), settings: { showExactEta: false } }),
  personas: () => ({ activeId: 'p1', personas: [{ id: 'p1', name: '시드', title: '반마', imageId: 'img1' }, { id: 'p2', name: '하루', title: '', imageId: '' }, { id: 'p3', name: '빈 페르소나', title: '', imageId: '' }] }),
  open: (m) => { all = all.map((c) => (c.id === m.id ? { ...c, letters: c.letters.map((l) => (l.id === m.letterId ? { ...l, state: 'opened' } : l)) } : c)); return {}; },
  send: (m) => { sentLog.push(m); return {}; },
  connections: () => ({ connections: [] }),
};
let badge = null;
const drawerRoot = document.createElement('div');
const panelRoot = document.createElement('div');
const widgetRoot = document.createElement('div');
document.body.append(drawerRoot, panelRoot, widgetRoot);
let collapsed = true;
const ctx = {
  onBackendMessage: (h) => { backend = h; return () => {}; },
  sendToBackend: (m) => setTimeout(() => backend({ ok: true, requestId: m.requestId, ...(replies[m.type]?.(m) || {}) }), 0),
  ui: {
    registerDrawerTab: () => ({ root: drawerRoot, setBadge: (b) => { badge = b; }, onActivate: () => () => {}, destroy() {} }),
    requestDockPanel: () => ({ root: panelRoot, isCollapsed: () => collapsed, expand: () => { collapsed = false; }, collapse: () => { collapsed = true; }, onVisibilityChange: () => () => {}, destroy() {} }),
    createFloatWidget: () => ({ root: widgetRoot, onDragEnd: () => () => {}, destroy() {} }),
  },
  dom: { addStyle: () => () => {} },
};
const tick = (n = 3) => new Promise((r) => setTimeout(r, 15 * n));
const clickIn = (root, sel, text) => {
  const b = [...root.querySelectorAll(sel)].find((x) => x.textContent.includes(text));
  if (!b) throw new Error(`못 찾음: ${text}`);
  b.dispatchEvent(new window.Event('click'));
};
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); };

const stop = setup(ctx);
await tick(6);
// 서랍
ok('서랍: 상대 2명', drawerRoot.textContent.includes('미렌') && drawerRoot.textContent.includes('하르'));
ok('서랍: 페르소나 칩(상대 있는 것만)', drawerRoot.textContent.includes('시드 · 1') && drawerRoot.textContent.includes('하루 · 1') && !drawerRoot.textContent.includes('빈 페르소나'));
ok('서랍: 페르소나 아바타', !!drawerRoot.querySelector('img.im-ava[src="/api/v1/images/img1?size=sm"]'));
ok('읽지 않은 편지 배지', badge === '1');
clickIn(drawerRoot, '.im-chip', '하루'); await tick();
ok('페르소나 고르면 그 상대만', drawerRoot.textContent.includes('하르') && ![...drawerRoot.querySelectorAll('.im-card')].some((x) => x.textContent.includes('미렌')));
clickIn(drawerRoot, '.im-chip', '모두'); await tick();
clickIn(drawerRoot, '.im-card', '미렌'); await tick(6);
ok('상대 화면: 보내는 사람 표시', drawerRoot.textContent.includes('보내는 사람: 시드'));
ok('상대 화면: 가속 반영 배송 시간', drawerRoot.textContent.includes('시험 가속 60배'));
ok('상대 화면: 남은 시간', drawerRoot.textContent.includes('도착까지 약 5시간'));
// 위젯
ok('위젯: 깃발 올라감 + 숫자', widgetRoot.querySelector('svg path[d^="M53.5 12"]') && widgetRoot.textContent.includes('1'));
widgetRoot.querySelector('.im-box').dispatchEvent(new window.Event('click')); await tick(6);
ok('위젯 누르면 보조창 열림', collapsed === false);
// 보조창 편지첩
ok('편지첩: 상대 편지 편지지', !!panelRoot.querySelector('.im-paper.im-theirs'));
ok('편지첩: 내 편지 편지지', !!panelRoot.querySelector('.im-paper.im-mine'));
ok('편지첩: HTML은 글자로만', !panelRoot.querySelector('.im-paper b') && panelRoot.textContent.includes('<b>편지</b>'));
ok('편지첩: 우표 칸', panelRoot.querySelector('.im-stamp')?.textContent.includes('등대 도장'));
ok('편지첩: 동봉 줄', panelRoot.textContent.includes('동봉 · 조개 — 얼음 틈에서'));
ok('편지첩: 안 연 봉투', !!panelRoot.querySelector('.im-envelope') && panelRoot.textContent.includes('거칠다'));
ok('편지첩: 가는 중인 내 편지', panelRoot.textContent.includes('내 편지가 가는 중'));
clickIn(panelRoot, 'button', '봉투 열기'); await tick(8);
ok('봉투 열면 편지지로', panelRoot.querySelectorAll('.im-paper.im-theirs').length === 2);
// 물품
clickIn(panelRoot, '.im-tabs button', '물품'); await tick();
ok('물품: 받은 것 2 / 보낸 것 1', panelRoot.textContent.includes('받은 것 · 2') && panelRoot.textContent.includes('보낸 것 · 1'));
ok('물품: 카드 3개', panelRoot.querySelectorAll('.im-item').length === 3);
// 모음
clickIn(panelRoot, '.im-tabs button', '모음'); await tick();
ok('모음: 편지 묶음 2', panelRoot.querySelectorAll('.im-bundle').length === 2);
ok('모음: 모든 물건 3', panelRoot.textContent.includes('모든 물건 · 3'));
clickIn(panelRoot, '.im-chip', '시드'); await tick();
ok('모음: 페르소나 고르면 묶음 1', panelRoot.querySelectorAll('.im-bundle').length === 1);
clickIn(panelRoot, '.im-bundle', '미렌'); await tick();
ok('묶음 누르면 편지첩', panelRoot.querySelector('.im-tabs .im-on')?.textContent === '편지첩');
// 보조창에서 쓰기
const tas = panelRoot.querySelectorAll('details textarea');
tas[0].value = '세 번째 편지'; tas[0].dispatchEvent(new window.Event('input'));
tas[1].value = '말린 꽃\n작은 종'; tas[1].dispatchEvent(new window.Event('input'));
clickIn(panelRoot, 'details button', '보내기'); await tick(8);
ok('보조창에서 보내기(동봉 2줄)', sentLog.length === 1 && sentLog[0].body === '세 번째 편지' && sentLog[0].enclosure === '말린 꽃\n작은 종');
stop();

let fail = 0;
for (const [n, pass] of checks) { console.log(`${pass ? 'ok  ' : 'FAIL'} ${n}`); if (!pass) fail++; }
process.exit(fail ? 1 : 0);
