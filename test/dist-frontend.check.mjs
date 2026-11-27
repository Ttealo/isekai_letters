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
// 실제 브라우저처럼 input.list는 읽기 전용(설정 화면 오류를 잡지 못했던 일 — 0.5.1~0.5.3)
Object.defineProperty(window.HTMLInputElement.prototype, 'list', { get() { return null; }, set() { throw new TypeError('Cannot set property list of HTMLInputElement which has only a getter'); }, configurable: true });
const { setup } = await import(pathToFileURL(resolve('dist/frontend.js')).href);

const now = Date.now();
const mk = (id, name, personaId, personaName, extra = {}) => ({
  id, name, personaId, personaName, ratio: 7, theirNowLabel: '만난 지 4일째 저녁', delivery: { min: 1, max: 2 }, writeDelay: { min: 6, max: 12 }, timeScale: 60, maxReplyRealHours: 24, brief: 'b', world: '', reply: null,
  letters: [], items: [], ...extra,
});
const miren = mk('c1', '미렌', 'p1', '시드', {
  art: { paper: { imageId: 'pp' }, stamp: { imageId: 'st' } },
  artJob: { state: 'running', total: 2, done: 0, targets: [{ kind: 'seal', itemId: '', label: '봉인', state: 'drawing' }, { kind: 'item', itemId: 'i3', label: '깃털', state: 'waiting' }] },
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
    { id: 'i4', name: '말린 꽃', note: '압화', from: 'them', state: 'arrived', letterId: 'l2', theirLabel: '3일째', arriveAt: now - 3e6, imageId: 'flower' },
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
  characters: () => ({ characters: [{ id: 'chx', name: '진', imageId: '', books: 2 }] }),
  matchDraft: (m) => { sentLog.push(m); return { draft: { mode: m.mode, name: '미렌', dice: m.mode === 'random' ? '사막의 대상로' : '', firstBy: 'them', characterId: m.characterId || '', warnings: ['카드가 깁니다'], card: m.mode === 'existing' ? null : { description: '# 미렌 / 34 / 여성', personality: 'p', never: 'Never x.' }, worldTitle: '얼어붙는 곶', entries: [{ title: '세계 개요', keys: [], content: '얼어붙는 바다', constant: true }, { title: '등대', keys: ['등대'], content: '돌 등대', constant: false }], mail: { ratio: 7, ratioReason: '느린 겨울', deliveryMin: 1, deliveryMax: 3, writeMin: 6, writeMax: 12, medium: '양피지', seal: '', stampMotif: '', scent: '', texture: '' }, firstLetter: { body: '누구냐.', ps: '', envelope: { medium: '양피지' }, enclosures: [] } } }; },
  matchConfirm: (m) => { sentLog.push(m); return { id: 'c1' }; },
  dossier: () => ({
    memory: {
      ledger: { calledMe: '시드 씨', calledThem: '칼렉', stage: '펜팔', mood: '궁금함', promises: [{ who: 'them', what: '닻줄 그림 보내기', state: 'open' }], openQuestions: [{ who: 'me', q: '별이 보여요?' }], knowsAboutMe: ['도시에 산다'], iKnow: [], anniversaries: [] },
      timeline: [{ when: '2일째', event: '닻줄 균열', open: true }], chapters: [], summaries: [{ letterId: 'l1', from: 'me', when: '1일째', text: '첫 인사' }],
      changes: [
        { id: 'x1', target: 'lore', op: 'add', key: '토마', before: '', after: '견습생', reason: '새 사실', state: 'applied' },
        { id: 'x2', target: 'card', op: 'edit', key: 'goal', before: '예산', after: '균열 원인', reason: '새 목표', state: 'pending' },
        { id: 'x3', target: 'conflict', op: 'note', key: '달력', before: '', after: '', reason: '계절이 안 맞음', state: 'conflict' },
      ],
    },
    locks: ['first_line', 'core'], applyMode: { loreAdd: 'auto', loreEdit: 'auto', cardAdd: 'auto', cardEdit: 'approve', origLore: 'off' }, organize: null,
    report: [{ layer: '상대 카드', chars: 900, tokens: 530, note: '' }, { layer: '편지 요약', chars: 40, tokens: 24, note: '1/1통' }], totalChars: 5000, totalTokens: 2941, prompt: '[system]\n<relationship>',
  }),
  change: (m) => { sentLog.push(m); return { change: {} }; },
  artStatus: () => ({ left: 5, perDay: 6 }),
  webpQueue: () => ({ queue: [] }),
  drawSet: (m) => { sentLog.push(m); return { started: m.kinds.length }; },
  drawItem: (m) => { sentLog.push(m); return { started: 1 }; },
  imageConnections: () => ({ connections: [{ id: 'ic1', name: '이미지 · Chroma', model: 'chroma' }] }),
  imageModels: (m) => { sentLog.push(m); return { connectionId: 'ic1', current: 'chroma', models: [{ id: 'chroma', label: 'Chroma' }, { id: 'flux-pro', label: 'Flux Pro' }] }; },
  setRules: (m) => { sentLog.push(m); return { locks: m.locks, applyMode: m.applyMode }; },
};
let badge = null;
const modals = [];
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
    showModal: (o) => { const root = document.createElement('div'); modals.push({ o, root }); return { root, dismiss() {}, setTitle() {}, onDismiss: () => () => {} }; },
  },
  dom: { addStyle: () => () => {} },
};
const tick = (n = 3) => new Promise((r) => setTimeout(r, 30 * n));
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
widgetRoot.querySelector('.im-box').dispatchEvent(new window.Event('click', { bubbles: true })); await tick(6);
ok('위젯 누르면 보조창 열림', collapsed === false);
// 보조창 편지첩
ok('편지첩: 상대 편지 편지지(꾸민 HTML)', !!panelRoot.querySelector('.im-themed.im-theirs'));
ok('편지첩: 날짜 구분선·상대 정보 카드', panelRoot.querySelectorAll('.im-divider').length >= 3 && !!panelRoot.querySelector('.im-info .im-seal'));
ok('편지첩: 내 편지 편지지', !!panelRoot.querySelector('.im-paper.im-mine'));
ok('편지첩: HTML은 글자로만', !panelRoot.querySelector('.im-paper b') && panelRoot.textContent.includes('<b>편지</b>'));
ok('편지첩: 편지지엔 우표 없음', !panelRoot.querySelector('.im-themed .im-tstamp'));
ok('편지첩: 받은 물건 그림은 편지 아래 썸네일', !!panelRoot.querySelector('.im-themed .im-thumbs img') || !panelRoot.querySelector('.im-item img'));
const themed = panelRoot.querySelector('.im-themed.im-theirs');
ok('편지지 꾸미기: 무늬 띠·모서리 장식 4개·글씨체', (themed?.getAttribute('style') || '').includes('data:image/svg+xml') && themed.querySelectorAll('.im-corners svg').length === 4 && /font-family/.test(themed.children[1]?.getAttribute('style') || ''));
ok('그림: 상대 우표는 안 씀', !panelRoot.querySelector('.im-env-stamp'));
ok('그림: 그리는 중 표시(대상별)', panelRoot.textContent.includes('그림을 그리는 중 0/2') && panelRoot.textContent.includes('· 봉인: 그리는 중…') && panelRoot.textContent.includes('· 깃털: 기다리는 중'));
ok('그림: 위젯에 그리는 중', widgetRoot.textContent.includes('그림'));
ok('편지첩: 동봉 줄', panelRoot.textContent.includes('동봉 · 조개 — 얼음 틈에서'));
ok('편지첩: 안 연 봉투', !!panelRoot.querySelector('.im-envelope') && panelRoot.textContent.includes('거칠다'));
ok('편지첩: 가는 중인 내 편지', panelRoot.textContent.includes('내 편지가 가는 중'));
// 편지를 쓰는 중에 뒤쪽 새로 고침이 와도 쓰기 칸이 닫히지 않고 커서가 남음
{
  const det = panelRoot.querySelector('details.im-compose');
  det.setAttribute('open', ''); det.dispatchEvent(new window.Event('toggle'));
  const ta = det.querySelector('textarea[data-keep]');
  ta.value = '쓰는 중'; ta.dispatchEvent(new window.Event('input')); ta.focus();
  backend({ type: 'changed' }); await tick(15);
  const det2 = panelRoot.querySelector('details.im-compose');
  const isOpen = (d) => !!d && (d.open === true || d.hasAttribute('open'));
  ok('쓰는 중 새로 고침: 쓰기 칸 열린 채·글 그대로', det2 !== det && isOpen(det2) && det2.querySelector('textarea[data-keep]').value === '쓰는 중');
}
clickIn(panelRoot, 'button', '봉투 열기'); await tick(8);
ok('봉투 열면 편지지로', panelRoot.querySelectorAll('.im-themed.im-theirs').length === 2);
{
  const folds = [...panelRoot.querySelectorAll('details.im-fold')];
  const isOpen = (d) => !!d && d.hasAttribute('open');
  ok('지난 편지는 한 줄로 접힘(맨 끝 2통·가는 중은 펼침)', folds.length === 2 && folds.every((d) => !isOpen(d)) && folds[0].getAttribute('data-lid') === 'l1' && folds[0].querySelector('summary').textContent.includes('처음 편지') && folds[1].querySelector('.im-fold-who').textContent.includes('받음'));
  ok('접힌 줄 위에 「지난 편지 2통 · 모두 펼치기」', panelRoot.querySelector('.im-fold-bar')?.textContent.includes('지난 편지 2통'));
  folds[0].setAttribute('open', ''); folds[0].dispatchEvent(new window.Event('toggle'));
  backend({ type: 'changed' }); await tick(15);
  const f2 = panelRoot.querySelector('details.im-fold[data-lid="l1"]');
  ok('펼친 지난 편지는 새로 고침 뒤에도 펼쳐진 채', f2 !== folds[0] && isOpen(f2) && !isOpen(panelRoot.querySelector('details.im-fold[data-lid="l2"]')));
  clickIn(panelRoot, '.im-fold-bar button', '모두 펼치기'); await tick();
  ok('모두 펼치기', [...panelRoot.querySelectorAll('details.im-fold')].every(isOpen) && panelRoot.querySelector('.im-fold-bar').textContent.includes('모두 접기'));
  clickIn(panelRoot, '.im-fold-bar button', '모두 접기'); await tick();
}
// 물품
clickIn(panelRoot, '.im-tabs button', '물건'); await tick();
ok('물품: 받은 것 3 / 보낸 것 1', panelRoot.textContent.includes('받은 것 · 3') && panelRoot.textContent.includes('보낸 것 · 1'));
ok('물품: 카드 4개', panelRoot.querySelectorAll('.im-item').length === 4);
const drawBtns = [...panelRoot.querySelectorAll('.im-item button')].filter((b) => b.textContent === '그리기');
ok('물품: 그리는 중인 물건은 표시만(버튼 없음)', drawBtns.length === 2 && [...panelRoot.querySelectorAll('.im-item')].find((x) => x.textContent.includes('깃털'))?.querySelector('.im-state')?.textContent === '기다리는 중');
drawBtns[0].dispatchEvent(new window.Event('click')); await tick(6);
ok('물품: 그리기 요청', sentLog.some((x) => x.type === 'drawItem' && x.id === 'c1'));
// 그림 크게 보기: 물건 그림 누르면 모달
const c1withImg = all.find((c) => c.id === 'c1');
const flowerImg = [...panelRoot.querySelectorAll('.im-item img')].find((i) => i.getAttribute('alt') === '말린 꽃');
flowerImg.dispatchEvent(new window.Event('click', { bubbles: true })); await tick();
ok('물품: 그림 누르면 크게 보기(모달)', modals.length === 1 && modals[0].o.title === '말린 꽃' && modals[0].root.querySelector('img')?.getAttribute('src') === '/api/v1/images/flower' && modals[0].root.textContent.includes('압화'));

// 모음
const meChip = () => panelRoot.querySelector('.im-chip[data-me]');
ok('상대를 보면 탭은 편지첩·물건·추억 상자·기록부', [...panelRoot.querySelectorAll('.im-tabs button')].map((b) => b.textContent).join() === '편지첩,물건,추억 상자,기록부');
clickIn(panelRoot, '.im-tabs button', '기록부'); await tick();
ok('기록부: 아직 없으면 받기 버튼 + 편지로 이어진 일들 타임라인', panelRoot.textContent.includes('기록부 받기') && panelRoot.querySelectorAll('.im-timeline .im-tl').length >= 2);
clickIn(panelRoot, '.im-tabs button', '편지첩'); await tick();
meChip().dispatchEvent(new window.Event('click')); await tick();
ok('나: 탭은 내 모습·추억 상자·달력, 내 모습 칸', [...panelRoot.querySelectorAll('.im-tabs button')].map((b) => b.textContent).join() === '내 모습,추억 상자,달력' && panelRoot.querySelectorAll('.im-me').length >= 1);
clickIn(panelRoot, '.im-tabs button', '추억 상자'); await tick();
ok('나 → 추억 상자 2', panelRoot.querySelectorAll('.im-locker').length === 2);
clickIn(panelRoot, '.im-chip', '시드'); await tick();
ok('페르소나 고르면 상자 1', panelRoot.querySelectorAll('.im-locker').length === 1);
clickIn(panelRoot, '.im-locker', '미렌'); await tick();
ok('상자 누르면 그 상대의 추억 상자 탭(초상화·그림·봉투·물건)', panelRoot.querySelector('.im-tabs .im-on')?.textContent === '추억 상자' && ['초상화 ·', '그림·사진 ·', '봉투 ·', '물건 ·'].every((t) => panelRoot.textContent.includes(t)));
ok('추억 상자 탭: 모습 카드(초상화·상징물·봉투·추억 상자) 각자 그리기', panelRoot.querySelectorAll('.im-looks .im-look').length === 4 && ['초상화', '상징물', '봉투', '추억 상자'].every((t) => [...panelRoot.querySelectorAll('.im-looks .im-cap b')].some((b) => b.textContent === t)));
clickIn(panelRoot, 'button', '편지첩 열기'); await tick();
ok('사물함에서 편지첩', panelRoot.querySelector('.im-tabs .im-on')?.textContent === '편지첩');
// 편지 달력(내 쪽 날짜) — 「나」 아래
meChip().dispatchEvent(new window.Event('click')); await tick();
clickIn(panelRoot, '.im-tabs button', '달력'); await tick();
const nowD = new Date();
ok('달력: 이번 달 머리', panelRoot.textContent.includes(`${nowD.getFullYear()}년 ${nowD.getMonth() + 1}월`));
ok('달력: 받은·보낸 표시', panelRoot.querySelectorAll('.im-cal-mark').length >= 3 && !!panelRoot.querySelector('.im-cal-mark.im-out-mark'));
ok('달력: 이달 목록(받은 편지·본문 첫 줄·그쪽 날짜·동봉)', panelRoot.textContent.includes('미렌에게서 받음') && panelRoot.textContent.includes('잘 받았네') && panelRoot.textContent.includes('그쪽 3일째') && panelRoot.textContent.includes('동봉 · 조개'));
ok('달력: 도착 예정 표시 없음(도착한 것만+보낸 것)', panelRoot.textContent.includes('미렌에게 보냄'));
const evNode = [...panelRoot.querySelectorAll('.im-cal-ev')].find((x) => x.textContent.includes('미렌에게서 받음') && !x.textContent.includes('안 읽음'));
evNode.dispatchEvent(new window.Event('click')); await tick(4);
ok('달력: 항목 누르면 편지첩 그 편지로', panelRoot.querySelector('.im-tabs .im-on')?.textContent === '편지첩' && !!panelRoot.querySelector('[data-lid="l2"]'));
// 보조창에서 쓰기
const tas = panelRoot.querySelectorAll('details textarea');
tas[0].value = '세 번째 편지'; tas[0].dispatchEvent(new window.Event('input'));
tas[1].value = '말린 꽃\n작은 종'; tas[1].dispatchEvent(new window.Event('input'));
clickIn(panelRoot, 'details button', '보내기'); await tick(8);
const sendMsg = sentLog.filter((x) => x.type === 'send');
ok('보조창에서 보내기(동봉 2줄)', sendMsg.length === 1 && sendMsg[0].body === '세 번째 편지' && sendMsg[0].enclosure === '말린 꽃\n작은 종');
// 새 상대(매칭)
clickIn(drawerRoot, 'button', '← 우편함'); await tick();
clickIn(drawerRoot, 'button', '설정'); await tick(8);
ok('설정: 먼저 오는 편지·알림 칸', drawerRoot.textContent.includes('먼저 오는 편지') && drawerRoot.textContent.includes('편지가 도착하면 푸시 알림 보내기'));
ok('설정: 이미지 모델은 목록에서 고르기', [...drawerRoot.querySelectorAll('select')].some((sel) => [...sel.options].filter((o) => o.value).length >= 2 && [...sel.options].some((o) => o.value === 'chroma')) && drawerRoot.textContent.includes('이 연결의 기본 모델: chroma'));
ok('설정: 탭 5개(글·그림·초상화·편지 흐름·기억·기타)', drawerRoot.querySelectorAll('.im-subtabs button').length === 5);
clickIn(drawerRoot, 'button', '← 우편함'); await tick();
clickIn(drawerRoot, 'button', '새 상대'); await tick(6);
ok('매칭: 방식 4개', ['원하는 상대 적기', '무작위로 만나기', '기존 캐릭터', '직접 다 적기'].every((t) => drawerRoot.textContent.includes(t)));
ok('매칭: 페르소나 기본(활성=시드)', drawerRoot.querySelector('select')?.value === 'p1');
const req = drawerRoot.querySelector('textarea'); req.value = '얼어붙는 곶의 등대지기'; req.dispatchEvent(new window.Event('input'));
clickIn(drawerRoot, 'button', '만들기'); await tick(8);
const md = sentLog.find((x) => x.type === 'matchDraft');
ok('매칭: 초안 요청(원하는 상대·페르소나)', md && md.request === '얼어붙는 곶의 등대지기' && md.personaId === 'p1' && md.mode === 'prompt');
ok('미리보기: 경고·이름·카드·로어북·첫 편지', ['확인할 점: 카드가 깁니다', '캐릭터 카드', '로어북 「얼어붙는 곶」 · 2항목', '상대의 첫 편지', '누구냐.', '느린 겨울'].every((t) => drawerRoot.textContent.includes(t)));
const nameIn = drawerRoot.querySelector('label input'); nameIn.value = '미렌 하트'; nameIn.dispatchEvent(new window.Event('input'));
clickIn(drawerRoot, 'button', '빼기'); await tick();
ok('미리보기: 항목 빼기', drawerRoot.textContent.includes('· 1항목'));
clickIn(drawerRoot, 'button', '확정'); await tick(8);
const mc = sentLog.find((x) => x.type === 'matchConfirm');
ok('확정: 고친 초안이 그대로 감', mc && mc.draft.name === '미렌 하트' && mc.draft.entries.length === 1 && mc.personaId === 'p1');
ok('확정 뒤 상대 화면으로', drawerRoot.textContent.includes('보내는 사람'));
clickIn(drawerRoot, 'button', '← 우편함'); await tick();
clickIn(drawerRoot, 'button', '새 상대'); await tick(4);
clickIn(drawerRoot, 'button', '기존 캐릭터'); await tick(6);
ok('기존 캐릭터: 목록', drawerRoot.textContent.includes('진 (로어북 2)'));
// 서류함
clickIn(drawerRoot, 'button', '← 우편함'); await tick();
clickIn(drawerRoot, '.im-card', '미렌'); await tick(6);
clickIn(drawerRoot, 'button', '서류함'); await tick(6);
ok('서류함: 장부·연대기·변경·규칙·모의 조립', ['관계 장부', '나를 부르는 말: 시드 씨', '닻줄 그림 보내기', '상대가 아는 나', '● [2일째] 닻줄 균열', '변경 기록 · 확인 필요 2', '로어북 · 토마 (새로)', '승인 대기', '충돌', '규칙', '약 2,941토큰', '1/1통'].every((t) => drawerRoot.textContent.includes(t)));
ok('서류함: 달력 칸(없으면 만들기)', drawerRoot.textContent.includes('그쪽 달력') && drawerRoot.textContent.includes('달력 만들기(글 1회)'));
clickIn(drawerRoot, 'button', '되돌리기'); await tick(6);
ok('서류함: 되돌리기 요청', sentLog.some((x) => x.type === 'change' && x.changeId === 'x1' && x.action === 'revert'));
const lockIn = [...drawerRoot.querySelectorAll('input')].find((i) => i.value.startsWith('first_line'));
lockIn.value = 'first_line, core, fixed'; lockIn.dispatchEvent(new window.Event('input'));
clickIn(drawerRoot, 'button', '규칙 저장'); await tick(6);
const sr = sentLog.find((x) => x.type === 'setRules');
ok('서류함: 규칙 저장', sr && sr.locks.join(',') === 'first_line,core,fixed' && sr.applyMode.cardEdit === 'approve');
stop();

// 떠 있는 창 방식
store.set('isekai_mailbox.panelMode', 'float');
const floats = [];
const ctx2 = {
  ...ctx,
  ui: {
    ...ctx.ui,
    requestDockPanel: () => { throw new Error('dock should not be used'); },
    createFloatWidget: (o) => { const root = document.createElement('div'); document.body.append(root); let vis = true; const w = { o, root, setVisible: (v) => { vis = v; }, isVisible: () => vis, onDragEnd: () => () => {}, destroy() {} }; floats.push(w); return w; },
  },
};
const stop2 = setup(ctx2);
await tick(6);
ok('떠 있는 창: 위젯 2개(편지첩 창 + 우체통)', floats.length === 2 && floats[0].o.chromeless === false && floats[1].o.chromeless === true);
ok('떠 있는 창: 처음엔 숨김', floats[0].isVisible() === false);
floats[1].root.querySelector('.im-box').dispatchEvent(new window.Event('click', { bubbles: true })); await tick(6);
ok('떠 있는 창: 우체통 누르면 보임 + 편지첩 내용', floats[0].isVisible() === true && floats[0].root.textContent.includes('편지첩'));
clickIn(floats[0].root, 'button', '닫기'); await tick();
ok('떠 있는 창: 닫기', floats[0].isVisible() === false);
stop2();

// 채팅창처럼 화면 가득(page) 방식
store.set('isekai_mailbox.panelMode', 'page');
store.set('isekai_mailbox.persona', '__all__');
let mountVis = null;
const mountRoot = document.createElement('div');
document.body.append(mountRoot);
const floats3 = [];
const ctx3 = {
  ...ctx,
  ui: {
    ...ctx.ui,
    requestDockPanel: () => { throw new Error('dock should not be used'); },
    mountApp: (o) => ({ root: mountRoot, setVisible: (v) => { mountVis = v; }, destroy() {}, o }),
    createFloatWidget: (o) => { const root = document.createElement('div'); document.body.append(root); const w = { o, root, setVisible() {}, isVisible: () => true, onDragEnd: () => () => {}, destroy() {} }; floats3.push(w); return w; },
  },
};
const stop3 = setup(ctx3);
await tick(6);
ok('화면 가득: 처음엔 숨김, 위젯은 우체통 하나', mountVis === false && floats3.length === 1);
floats3[0].root.querySelector('.im-box').dispatchEvent(new window.Event('click', { bubbles: true })); await tick(6);
ok('화면 가득: 우체통 누르면 보임', mountVis === true);
ok('화면 가득: 왼쪽 목록 = 페르소나 → 나 → 편지 상대', mountRoot.querySelectorAll('.im-page-list .im-row-card').length === 3 && !!mountRoot.querySelector('.im-page-list .im-me-row') && mountRoot.querySelector('.im-page-list').textContent.includes('미렌') && mountRoot.querySelector('.im-page-list').textContent.includes('편지 상대'));
[...mountRoot.querySelectorAll('.im-page-list .im-row-card')].find((x) => x.textContent.includes('미렌')).dispatchEvent(new window.Event('click')); await tick();
ok('화면 가득: 오른쪽 편지첩', !!mountRoot.querySelector('.im-page-main .im-paper'));
clickIn(mountRoot, '.im-row-card', '하르'); await tick();
ok('화면 가득: 목록에서 상대 고르기', mountRoot.querySelector('.im-row-card.im-on')?.textContent.includes('하르'));
{ const ev = new window.Event('keydown'); ev.key = 'Escape'; document.dispatchEvent(ev); } await tick();
ok('화면 가득: Esc로 닫기', mountVis === false);
stop3();

let fail = 0;
for (const [n, pass] of checks) { console.log(`${pass ? 'ok  ' : 'FAIL'} ${n}`); if (!pass) fail++; }
process.exit(fail ? 1 : 0);
