// 가짜 호스트로 백엔드 흐름 확인(실제 Lumiverse·모델 호출 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../src/backend.js';

const H = 3600 * 1000;
function fakeHost({ failTimes = 0 } = {}) {
  const files = new Map(); // `${user}|${path}`
  const shared = new Map();
  const handlers = [];
  const sent = [];
  const calls = [];
  let fails = failTimes;
  const us = {
    exists: async (p, u) => p === 'settings.json' || files.has(`${u}|${p}`) || [...files.keys()].some((k) => k.startsWith(`${u}|${p}/`)),
    getJson: async (p, o) => structuredClone(files.get(`${o.userId}|${p}`) ?? (p === 'settings.json' ? { lateChance: 0 } : o.fallback)), // 시험에서는 우체부 지연(무작위) 끔
    setJson: async (p, v, o) => { files.set(`${o.userId}|${p}`, structuredClone(v)); },
    list: async (prefix, u) => [...files.keys()].filter((k) => k.startsWith(`${u}|${prefix}/`)).map((k) => k.split('|')[1]),
    delete: async (p, u) => { files.delete(`${u}|${p}`); },
  };
  const api = {
    log: { info() {}, warn() {}, error() {} },
    userStorage: us,
    storage: {
      exists: async (p) => shared.has(p),
      getJson: async (p, o) => shared.get(p) ?? o.fallback,
      setJson: async (p, v) => { shared.set(p, v); },
    },
    onFrontendMessage: (h) => { handlers.push(h); return () => {}; },
    sendToFrontend: (m, u) => sent.push({ m, u }),
    personas: { getActive: async () => ({ name: '하루' }), get: async () => null },
    connections: { list: async () => [{ id: 'v', name: 'Vertex', model: 'gemini', is_default: true }] },
    generate: {
      quiet: async (req) => {
        calls.push(req);
        if (fails-- > 0) throw new Error('모의 실패');
        return { content: '```json\n{"between":[{"their_date":"3일","event":"폭풍","senses":"소금 냄새"}],"envelope":{"medium":"기름 먹인 천","scent":"소금"},"enclosures":[{"item":"조개"}],"body":"편지 잘 받았네.","ps":"춥군."}\n```' };
      },
      raw: async (req) => api.generate.quiet(req),
    },
  };
  let n = 0;
  const ask = async (user, type, extra = {}) => {
    const requestId = `r${n++}`;
    for (const h of handlers) await h({ requestId, type, ...extra }, user, 's1');
    const r = sent.filter((x) => x.m.requestId === requestId).pop()?.m;
    if (!r?.ok) throw new Error(r?.error || 'no reply');
    return r;
  };
  return { api, ask, calls, sent, files };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('백엔드 흐름: 보내기 → 도착 → 생성 → 배달 → 열기, 다른 사용자와 분리', async (t) => {
  const realNow = Date.now;
  let now = 1_000_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const host = fakeHost();
  const stop = start(host.api);
  t.after(stop);

  const { id } = await host.ask('u1', 'create', { input: { name: '등대지기', brief: '무뚝뚝', ratio: 7, deliveryMin: 1, deliveryMax: 1, writeMin: 7, writeMax: 7 } });
  await host.ask('u1', 'send', { id, body: '안녕하세요' });
  let g = await host.ask('u1', 'get', { id });
  assert.equal(g.c.letters[0].state, 'in_transit');
  assert.equal(g.c.letters[0].personaName, '하루');

  now += 1 * H; // 도착
  await host.ask('u1', 'load');
  g = await host.ask('u1', 'get', { id });
  assert.equal(g.c.reply.state, 'waiting');
  assert.equal(host.calls.length, 0);

  now += 1 * H; // 그쪽 7시간 = 현실 1시간 → 생성
  await host.ask('u1', 'load');
  await settle();
  assert.equal(host.calls.length, 1);
  assert.match(host.calls[0].messages[0].content, /their name is 하루/);
  assert.equal(host.calls[0].userId, 'u1');
  g = await host.ask('u1', 'get', { id });
  assert.equal(g.c.reply, null);
  assert.equal(g.c.letters[1].state, 'in_transit');
  assert.equal(g.c.letters[1].body, undefined); // 배송 중엔 본문 안 보임

  now += 1 * H; // 배달
  const home = await host.ask('u1', 'load');
  assert.equal(home.list[0].unread, 1);
  g = await host.ask('u1', 'get', { id });
  assert.equal(g.c.letters[1].state, 'delivered');
  assert.equal(g.c.letters[1].envelope.medium, '기름 먹인 천');
  await host.ask('u1', 'open', { id, letterId: g.c.letters[1].id });
  g = await host.ask('u1', 'get', { id });
  assert.equal(g.c.letters[1].state, 'opened');
  assert.equal(g.c.letters[1].between, undefined);

  // 다른 사용자에게는 안 보임
  const other = await host.ask('u2', 'load');
  assert.equal(other.list.length, 0);
  await assert.rejects(host.ask('u2', 'get', { id }));
});

test('백엔드 실패: 재시도 소진 → failed → 수동 다시 시도로 성공', async (t) => {
  const realNow = Date.now;
  let now = 2_000_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const host = fakeHost({ failTimes: 4 });
  const stop = start(host.api);
  t.after(stop);
  const { id } = await host.ask('u1', 'create', { input: { name: 'A', brief: 'b', deliveryMin: 1, deliveryMax: 1, writeMin: 0, writeMax: 0 } });
  await host.ask('u1', 'send', { id, body: 'x' });
  now += 1 * H;
  for (const wait of [0, 1, 5, 30]) {
    now += wait * 60 * 1000;
    await host.ask('u1', 'load');
    await settle();
  }
  assert.equal(host.calls.length, 4);
  let g = await host.ask('u1', 'get', { id });
  assert.equal(g.c.reply.state, 'failed');
  assert.match(g.c.reply.error, /모의 실패/);
  await host.ask('u1', 'retry', { id });
  await settle();
  g = await host.ask('u1', 'get', { id });
  assert.equal(host.calls.length, 5);
  assert.equal(g.c.reply, null);
  assert.equal(g.c.letters.length, 2);
});

test('재시작 복구: generating으로 남은 작업을 다시 생성', async (t) => {
  const realNow = Date.now;
  let now = 3_000_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const host = fakeHost();
  let stop = start(host.api);
  const { id } = await host.ask('u1', 'create', { input: { name: 'A', brief: 'b', deliveryMin: 1, deliveryMax: 1, writeMin: 0, writeMax: 0 } });
  await host.ask('u1', 'send', { id, body: 'x' });
  stop();
  // 생성 도중 꺼진 상태를 만든다
  const key = [...host.files.keys()].find((k) => k.includes(`c/${id}`));
  const c = host.files.get(key);
  c.letters[0].state = 'arrived';
  c.reply = { state: 'generating', dueAt: now, attempts: 0, nextTryAt: 0, error: '', forLetterIds: [c.letters[0].id] };
  host.files.set(key, c);
  // 새 런타임(핸들러 목록 초기화 효과를 위해 새 호스트 대신 같은 저장소로 다시 시작)
  const host2 = fakeHost();
  for (const [k, v] of host.files) host2.files.set(k, v);
  stop = start(host2.api);
  t.after(stop);
  now += 2 * H;
  await host2.ask('u1', 'load');
  await settle();
  assert.equal(host2.calls.length, 1);
  const g = await host2.ask('u1', 'get', { id });
  assert.equal(g.c.letters.length, 2);
});

test('페르소나: 상대에 묶으면 편지·프롬프트가 그 이름을 쓰고, 목록·모음 요청이 동작', async (t) => {
  const realNow = Date.now;
  let now = 4_000_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const host = fakeHost();
  host.api.personas.get = async (id) => (id === 'p1' ? { id: 'p1', name: '시드' } : null);
  host.api.personas.list = async () => ({ data: [{ id: 'p1', name: '시드', title: '반마', image_id: 'img1' }], total: 1 });
  const stop = start(host.api);
  t.after(stop);
  const ps = await host.ask('u1', 'personas');
  assert.deepEqual(ps.personas[0], { id: 'p1', name: '시드', title: '반마', imageId: 'img1', description: '' });
  await assert.rejects(host.ask('u1', 'create', { input: { name: 'A', brief: 'b', personaId: 'nope' } }), /페르소나/);
  const { id } = await host.ask('u1', 'create', { input: { name: 'A', brief: 'b', personaId: 'p1', deliveryMin: 1, deliveryMax: 1, writeMin: 0, writeMax: 0 } });
  await host.ask('u1', 'send', { id, body: 'x', enclosure: '은행잎\n클로버' });
  const all = await host.ask('u1', 'all');
  assert.equal(all.all[0].personaName, '시드');
  assert.equal(all.all[0].letters[0].personaName, '시드');
  assert.equal(all.all[0].items.length, 2);
  now += 1 * H;
  await host.ask('u1', 'load');
  await settle();
  assert.match(host.calls[0].messages[0].content, /their name is 시드/);
  const home = await host.ask('u1', 'load');
  assert.equal(home.list[0].personaId, 'p1');
});

function addLibrary(host, matchJson) {
  const books = new Map(); const entries = new Map(); const chars = new Map();
  let n = 0;
  host.api.world_books = {
    get: async (id) => books.get(id) || null,
    create: async (input) => { const b = { id: `wb${n++}`, ...input }; books.set(b.id, b); return b; },
    delete: async (id) => { books.delete(id); for (const [k, e] of entries) if (e.world_book_id === id) entries.delete(k); return true; },
    entries: {
      create: async (bookId, input) => { const e = { id: `e${n++}`, world_book_id: bookId, ...input }; entries.set(e.id, e); return e; },
      list: async (bookId) => { const data = [...entries.values()].filter((e) => e.world_book_id === bookId); return { data, total: data.length }; },
    },
  };
  host.api.characters = {
    create: async (input) => { const c = { id: `ch${n++}`, ...input }; chars.set(c.id, c); return c; },
    get: async (id) => chars.get(id) || null,
    delete: async (id) => chars.delete(id),
    list: async () => ({ data: [...chars.values()], total: chars.size }),
  };
  host.api.personas.get = async (id) => (id === 'p1' ? { id: 'p1', name: '시드' } : null);
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    if (/Isekai Mailbox/.test(req.messages[0].content)) { host.calls.push(req); return { content: JSON.stringify(matchJson) }; }
    return quiet(req);
  };
  return { books, entries, chars };
}
const MATCH = {
  name: '미렌',
  card: { description: '# 미렌 / 34 / 여성\ncore=무뚝뚝', personality: 'speech=반말', never: 'Never be cheerful.' },
  world_title: '얼어붙는 곶',
  entries: [
    { title: '세계 개요', content: '얼어붙는 바다.' },
    { title: '달력과 시간', content: '서리달.' },
    { title: '우편 수단', content: '철새 다리.' },
    { title: '등대', keys: ['등대'], content: '돌 등대 이야기.' },
    { title: '선술집', keys: ['선술집'], content: '항구 선술집 이야기.' },
  ],
  mail: { ratio: 7, delivery_min: 1, delivery_max: 1, write_min: 0, write_max: 0, medium: '기름 먹인 양피지', seal: '등대 도장' },
  first_letter: { body: '누구냐, 이 편지를 받은 사람은.', envelope: { medium: '양피지' }, enclosures: [{ item: '조개' }] },
};

test('매칭: 초안 → 확정하면 로어북·캐릭터·상대가 생기고, 첫 편지가 오고, 답장 프롬프트에 로어북이 들어간다', async (t) => {
  const realNow = Date.now;
  let now = 5_000_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const host = fakeHost();
  const lib = addLibrary(host, MATCH);
  const stop = start(host.api);
  t.after(stop);
  await assert.rejects(host.ask('u1', 'matchDraft', { mode: 'prompt', request: '  ' }), /원하는지/);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'prompt', request: '얼어붙는 곶의 등대지기', personaId: 'p1' });
  assert.equal(draft.name, '미렌');
  assert.match(host.calls[0].messages[0].content, /card_format/);
  assert.equal(lib.books.size, 0); // 초안만으로는 아무것도 안 만든다
  draft.name = '미렌 하트'; // 미리보기에서 고침
  const r = await host.ask('u1', 'matchConfirm', { draft, personaId: 'p1', timeScale: 1 });
  assert.equal(lib.books.size, 1);
  assert.equal(lib.entries.size, 5);
  const ch = lib.chars.get(r.characterId);
  assert.equal(ch.name, '미렌 하트');
  assert.deepEqual(ch.world_book_ids, [r.worldBookId]);
  assert.equal(ch.post_history_instructions, 'Never be cheerful.');
  const overview = [...lib.entries.values()].find((e) => e.comment === '세계 개요');
  assert.equal(overview.constant, true);
  let g = await host.ask('u1', 'get', { id: r.id });
  assert.equal(g.c.personaName, '시드');
  assert.equal(g.c.letters.length, 1);
  assert.equal(g.c.letters[0].from, 'them');
  assert.equal(g.c.mail.medium, '기름 먹인 양피지');
  // 첫 편지 도착 → 내가 등대 이야기로 답장 → 상대 답장 프롬프트에 등대 항목(키워드)·상시 항목은 들어가고 선술집은 안 들어감
  now += 1 * H;
  g = await host.ask('u1', 'get', { id: r.id });
  assert.equal(g.c.letters[0].state, 'delivered');
  await host.ask('u1', 'send', { id: r.id, body: '등대 불빛은 어떤 색이에요?' });
  now += 1 * H;
  await host.ask('u1', 'load');
  await settle();
  const replyReq = host.calls.find((c) => !/Isekai Mailbox|design the stationery/.test(c.messages[0].content));
  assert.ok(replyReq);
  const sys = replyReq.messages[0].content;
  assert.match(sys, /돌 등대 이야기/);
  assert.match(sys, /얼어붙는 바다/);
  assert.doesNotMatch(sys, /항구 선술집/);
  assert.match(sys, /medium=기름 먹인 양피지/);
  assert.doesNotMatch(sys, /\{\{char\}\}|\{\{user\}\}/);
});

test('매칭 확정 중 실패하면 이번에 만든 로어북·캐릭터를 지운다', async (t) => {
  const host = fakeHost();
  const lib = addLibrary(host, MATCH);
  host.api.characters.create = async () => { throw new Error('모의 캐릭터 실패'); };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  assert.ok(draft.dice);
  await assert.rejects(host.ask('u1', 'matchConfirm', { draft }), /모의 캐릭터 실패/);
  assert.equal(lib.books.size, 0);
  assert.equal(lib.entries.size, 0);
  const home = await host.ask('u1', 'load');
  assert.equal(home.list.length, 0);
});

test('기존 캐릭터로 매칭: 원본 카드는 그대로, 우체통 로어북만 따로', async (t) => {
  const host = fakeHost();
  const lib = addLibrary(host, { ...MATCH, name: '', card: null, entries: MATCH.entries.slice(1, 3), first_letter: null });
  const stop = start(host.api);
  t.after(stop);
  const orig = await host.api.characters.create({ name: '진', description: '진의 카드', world_book_ids: [] });
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'existing', characterId: orig.id, firstBy: 'me' });
  assert.equal(draft.name, '진');
  assert.match(host.calls[0].messages[1].content, /진의 카드/);
  const r = await host.ask('u1', 'matchConfirm', { draft });
  assert.equal(r.characterId, orig.id);
  assert.equal(lib.chars.size, 1);
  assert.deepEqual(lib.chars.get(orig.id).world_book_ids, []); // 원본에 붙이지 않음
  const g = await host.ask('u1', 'get', { id: r.id });
  assert.equal(g.c.letters.length, 0);
  assert.equal(g.c.worldBookId, r.worldBookId);
  assert.match(g.c.brief, /진의 카드/);
});

test('정리 단계: 답장 뒤 자동 정리 → 기억·로어북·카드 반영, 서류함 모의 조립, 되돌리기·승인', async (t) => {
  const realNow = Date.now;
  let now = 6_000_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const host = fakeHost();
  const lib = addLibrary(host, { ...MATCH, first_letter: null });
  host.api.world_books.entries.update = async (id, input) => { const e = lib.entries.get(id); Object.assign(e, input); return e; };
  host.api.world_books.entries.delete = async (id) => lib.entries.delete(id);
  host.api.characters.update = async (id, input) => { const c = lib.chars.get(id); Object.assign(c, input); return c; };
  let orgCalls = 0;
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    if (/archivist/.test(req.messages[0].content)) {
      orgCalls++;
      const ids = [...req.messages[1].content.matchAll(/<letter id="([^"]+)"/g)].map((m) => m[1]);
      return { content: JSON.stringify({
        summaries: ids.map((id) => ({ letter_id: id, text: `요약 ${id}` })),
        ledger: { called_me: '시드 씨', stage: '펜팔', knows_about_me_add: ['도시에 산다'] },
        timeline_add: [{ when: '2일째', event: '닻줄 균열', open: true }],
        lore_add: [{ title: '토마', keys: ['토마'], content: '견습생.' }],
        lore_edit: [{ title: '등대', after: '돌 등대가 금이 갔다.', reason: '사건' }],
        card: [{ field: 'goal', value: '균열 원인 찾기', reason: '새 목표' }, { field: 'core', value: '바뀜', reason: 'x' }],
        conflicts: [],
        chapter: '',
      }) };
    }
    return quiet(req);
  };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'prompt', request: 'x', personaId: 'p1' });
  const r = await host.ask('u1', 'matchConfirm', { draft, personaId: 'p1' });
  await host.ask('u1', 'send', { id: r.id, body: '토마는 누구예요?' });
  now += 1 * H; // 도착
  await host.ask('u1', 'load'); await settle();
  now += 1 * H; // 답장 생성 → 정리 대기
  await host.ask('u1', 'load'); await settle();
  let d = await host.ask('u1', 'dossier', { id: r.id });
  assert.ok(d.organize === null || d.organize?.state === 'waiting'); // 답장 시간이 0이라 이미 정리됐을 수 있음
  await host.ask('u1', 'load'); await settle(); await settle(); // 정리 실행
  assert.equal(orgCalls, 1);
  d = await host.ask('u1', 'dossier', { id: r.id });
  assert.equal(d.organize, null);
  assert.equal(d.memory.summaries.length, 2);
  assert.equal(d.memory.ledger.calledMe, '시드 씨');
  const st = Object.fromEntries(d.memory.changes.map((x) => [x.key, x.state]));
  assert.deepEqual(st, { 토마: 'applied', 등대: 'applied', goal: 'applied', core: 'locked' });
  const toma = [...lib.entries.values()].find((e) => e.comment === '토마');
  assert.ok(toma);
  assert.equal([...lib.entries.values()].find((e) => e.comment === '등대').content, '돌 등대가 금이 갔다.');
  const ch = lib.chars.get(r.characterId);
  assert.match(ch.description, /goal=균열 원인 찾기/);
  const g = await host.ask('u1', 'get', { id: r.id });
  assert.match(g.c.brief, /goal=균열 원인 찾기/);
  // 모의 조립 보고
  assert.ok(d.report.find((x) => x.layer === '관계 장부').chars > 0);
  assert.match(d.prompt, /<relationship>/);
  assert.match(d.prompt, /토마/);
  // 되돌리기: 로어북 추가 → 항목 삭제, 카드 → 원래대로
  const add = d.memory.changes.find((x) => x.key === '토마');
  await host.ask('u1', 'change', { id: r.id, changeId: add.id, action: 'revert' });
  assert.ok(![...lib.entries.values()].some((e) => e.comment === '토마'));
  const goal = d.memory.changes.find((x) => x.key === 'goal');
  await host.ask('u1', 'change', { id: r.id, changeId: goal.id, action: 'revert' });
  assert.doesNotMatch(lib.chars.get(r.characterId).description, /goal=/);
  // 잠긴 변경을 사람이 승인하면 적용
  const core = d.memory.changes.find((x) => x.key === 'core');
  await host.ask('u1', 'change', { id: r.id, changeId: core.id, action: 'approve' });
  assert.match(lib.chars.get(r.characterId).description, /core=바뀜/);
  // 규칙 바꾸기
  const rules = await host.ask('u1', 'setRules', { id: r.id, locks: ['first_line'], applyMode: { cardEdit: 'approve', loreAdd: 'nope' } });
  assert.deepEqual(rules.locks, ['first_line']);
  assert.equal(rules.applyMode.cardEdit, 'approve');
  assert.equal(rules.applyMode.loreAdd, 'auto');
  // 지금 정리하기: 정리할 편지 없음
  await assert.rejects(host.ask('u1', 'organizeNow', { id: r.id }), /정리할 편지가 없습니다/);
});

test('그림: 세트 3장 → 상대에 기록·상한 소모·WebP 대기열 → WebP로 바꿔 끼우고 원본 삭제, 상한 넘으면 거절', async (t) => {
  const host = fakeHost();
  addLibrary(host, { ...MATCH, first_letter: null });
  const images = new Map(); let n = 0; const deleted = [];
  const genCalls = [];
  host.api.imageGen = {
    generate: async (req) => { genCalls.push(req); const id = `img${n++}`; images.set(id, { mime: 'image/png' }); return { imageId: id, imageUrl: `/x/${id}` }; },
    listConnections: async () => [{ id: 'ic1', name: '이미지 · Chroma', provider: 'nanogpt', model: 'chroma', is_default: false }],
  };
  host.api.images = {
    upload: async (input) => { const id = `webp${n++}`; images.set(id, { mime: input.mime_type, size: input.data.length }); return { id }; },
    delete: async (id) => { deleted.push(id); return images.delete(id); },
  };
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    if (/You write short English subject phrases/.test(req.messages[0].content)) {
      const keys = [...req.messages[1].content.matchAll(/key=(k\d+)/g)].map((m) => m[1]);
      return { content: JSON.stringify({ prompts: keys.map((k) => ({ key: k, prompt: `subject ${k}` })) }) };
    }
    return quiet(req);
  };
  const stop = start(host.api);
  t.after(stop);
  await host.ask('u1', 'saveSettings', { settings: { art: { connectionId: 'ic1', perDay: 4, size: '1024x1024', paperSize: '768x1024', paperMode: 'image' } } });
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'prompt', request: 'x' });
  const r = await host.ask('u1', 'matchConfirm', { draft });
  const ic = await host.ask('u1', 'imageConnections');
  assert.equal(ic.connections[0].model, 'chroma');
  const res = await host.ask('u1', 'drawSet', { id: r.id });
  assert.equal(res.started, 3);
  await settle(); await settle();
  assert.equal(genCalls.length, 3);
  assert.equal(genCalls[0].connection_id, 'ic1');
  assert.equal(genCalls[0].parameters.size, '768x1024'); // 편지지
  assert.equal(JSON.parse(genCalls[0].parameters.rawRequestOverride).size, '768x1024'); // 연결의 덮어쓰기보다 우선
  assert.equal(JSON.parse(genCalls[0].parameters.rawRequestOverride).negative_prompt, undefined); // 기본은 금지어 안 보냄
  assert.equal(genCalls[1].parameters.size, '1024x1024');
  assert.equal(genCalls[0].includeDataUrl, false);
  assert.match(genCalls[0].prompt, /^flat 2D stationery design/);
  assert.equal(genCalls[0].owner_character_id, r.characterId);
  let g = await host.ask('u1', 'get', { id: r.id });
  assert.ok(g.c.art.paper.imageId && g.c.art.stamp.imageId && g.c.art.seal.imageId);
  assert.equal(g.c.artJob, null);
  let st = await host.ask('u1', 'artStatus');
  assert.equal(st.left, 1);
  await assert.rejects(host.ask('u1', 'drawSet', { id: r.id }), /1장 남았습니다/);
  // WebP: 대기열 → 바꿔 끼우기
  const q = await host.ask('u1', 'webpQueue');
  assert.equal(q.queue.length, 3);
  const old = g.c.art.paper.imageId;
  const fake = Buffer.alloc(500, 7).toString('base64');
  const done = await host.ask('u1', 'webpDone', { imageId: old, data: fake, originalBytes: 2000 });
  assert.equal(done.after, 500);
  g = await host.ask('u1', 'get', { id: r.id });
  assert.equal(g.c.art.paper.imageId, done.id);
  assert.equal(images.get(done.id).mime, 'image/webp');
  assert.ok(deleted.includes(old));
  assert.equal((await host.ask('u1', 'webpQueue')).queue.length, 2);
  // 실패 3번이면 대기열에서 빠지고 png는 그대로
  const keep = g.c.art.stamp.imageId;
  for (let i = 0; i < 3; i++) await host.ask('u1', 'webpFail', { imageId: keep });
  assert.equal((await host.ask('u1', 'webpQueue')).queue.length, 1);
  assert.ok(images.has(keep));
  // 물건 하나 그리기: 모델이 금지어를 거절하면 빼고 다시(400) → 성공
  await host.ask('u1', 'saveSettings', { settings: { art: { connectionId: 'ic1', perDay: 4, sendNegative: true, kinds: { item: { model: 'seedream-v5.0-lite' } } } } });
  const realGen = host.api.imageGen.generate;
  host.api.imageGen.generate = async (req) => {
    if (JSON.parse(req.parameters.rawRequestOverride || '{}').negative_prompt) { genCalls.push(req); throw new Error('Nano-GPT image generate failed (400): no longer supports negative prompt'); }
    return realGen(req);
  };
  await host.ask('u1', 'send', { id: r.id, body: 'x', enclosure: '은행잎' });
  g = await host.ask('u1', 'get', { id: r.id });
  await host.ask('u1', 'drawItem', { id: r.id, itemId: g.c.items[0].id });
  await settle(); await settle();
  g = await host.ask('u1', 'get', { id: r.id });
  assert.ok(g.c.items[0].imageId);
  const itemCalls = genCalls.slice(-2);
  assert.equal(itemCalls[0].model, 'seedream-v5.0-lite');
  assert.ok(JSON.parse(itemCalls[0].parameters.rawRequestOverride).negative_prompt);
  assert.equal(JSON.parse(itemCalls[1].parameters.rawRequestOverride).negative_prompt, undefined);
  assert.equal(g.c.artJob, null);
  st = await host.ask('u1', 'artStatus');
  assert.equal(st.left, 0);
});

test('그림 상태: 대상마다 상태, 주제 글 실패 시 이름으로 대신 그림, 이미지 실패는 그 대상만 실패 + 알림', async (t) => {
  const host = fakeHost();
  addLibrary(host, { ...MATCH, first_letter: null });
  let n = 0;
  const toasts = [];
  host.api.toast = { success: (m, o) => toasts.push(['ok', m, o?.userId]), error: (m, o) => toasts.push(['err', m, o?.userId]) };
  host.api.imageGen = {
    generate: async (req) => { if (/stamp/.test(req.prompt)) throw new Error('Nano-GPT image generate failed (402): insufficient balance'); return { imageId: `img${n++}` }; },
    listConnections: async () => [],
  };
  host.api.images = { upload: async () => ({ id: 'w' }), delete: async () => true };
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    if (/You write short English subject phrases/.test(req.messages[0].content)) throw new Error('JSON 아님');
    return quiet(req);
  };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'prompt', request: 'x' });
  const r = await host.ask('u1', 'matchConfirm', { draft });
  await host.ask('u1', 'drawSet', { id: r.id, kinds: ['paper', 'stamp'] });
  await settle(); await settle();
  const g = await host.ask('u1', 'get', { id: r.id });
  assert.equal(g.c.artJob.state, 'failed');
  const ts = Object.fromEntries(g.c.artJob.targets.map((x) => [x.label, x]));
  assert.equal(ts['편지지'].state, 'done');
  assert.match(ts['편지지'].error, /대신/);
  assert.equal(ts['우표'].state, 'failed');
  assert.match(ts['우표'].error, /402/);
  assert.ok(g.c.art.paper.imageId);
  assert.equal(g.c.art.paper.subjectFallback, true);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][0], 'err');
  assert.equal(toasts[0][2], 'u1');
  await host.ask('u1', 'artDismiss', { id: r.id });
  assert.equal((await host.ask('u1', 'get', { id: r.id })).c.artJob, null);
});

test('먼저 오는 편지·푸시 알림·달력 만들기', async (t) => {
  const realNow = Date.now;
  let now = 7_000_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const host = fakeHost();
  addLibrary(host, { ...MATCH, mail: { ...MATCH.mail, ratio: 1, write_min: 1, write_max: 1, wait_hours: 10 }, calendar: { day_hours: 28, months: [{ name: '백무기', days: 30 }, { name: '흑풍기', days: 30 }], year_label: '년', start_year: 312, start_month: '백무기', start_day: 8 } });
  const pushes = [];
  host.api.push = { send: async (input, u) => { pushes.push([input, u]); return { sent: 1 }; } };
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    if (/design the calendar/.test(req.messages[0].content)) return { content: JSON.stringify({ calendar: { day_hours: 24, months: [{ name: '서리달', days: 30 }], year_label: '', start_year: 1, start_month: '서리달', start_day: 5 } }) };
    return quiet(req);
  };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'prompt', request: 'x' });
  assert.equal(draft.calendar.dayHours, 28);
  const r = await host.ask('u1', 'matchConfirm', { draft });
  let g = await host.ask('u1', 'get', { id: r.id });
  assert.match(g.c.theirNowLabel, /^312년 백무기 8일 .* \(만난 지 1일째\)$/);
  assert.equal(g.c.waitHours, 10);
  // 상대의 첫 편지는 매칭하자마자 이미 도착(배송 기다림 없음, 화면에 있으니 푸시 없음)
  assert.equal(g.c.letters[0].from, 'them');
  assert.equal(g.c.letters[0].state, 'delivered');
  assert.ok(g.c.letters[0].body);
  now += 1 * H;
  await host.ask('u1', 'load'); await settle();
  assert.equal(pushes.length, 0);
  // 답장 안 하고 그쪽 10시간 넘게 기다리면 → 예약 → 먼저 씀
  const callsBefore = host.calls.length;
  for (let i = 0; i < 4; i++) { now += 6 * H; await host.ask('u1', 'load'); await settle(); }
  g = await host.ask('u1', 'get', { id: r.id });
  const theirs = g.c.letters.filter((l) => l.from === 'them');
  assert.equal(theirs.length, 2); // 첫 편지 + 먼저 쓴 편지
  const initCall = host.calls.slice(callsBefore).find((c) => /initiative=yes/.test(c.messages[0].content));
  assert.ok(initCall);
  assert.match(initCall.messages[0].content, /their_now=312년 백무기/);
  // 두 통 연달아면 더 안 씀(기본 2)
  for (let i = 0; i < 4; i++) { now += 12 * H; await host.ask('u1', 'load'); await settle(); }
  g = await host.ask('u1', 'get', { id: r.id });
  assert.equal(g.c.letters.filter((l) => l.from === 'them').length, 2);
  // 푸시 끄면 안 보냄
  await host.ask('u1', 'saveSettings', { settings: { pushEnabled: false, initiativeEnabled: false } });
  const pushCount = pushes.length;
  await host.ask('u1', 'send', { id: r.id, body: '답장' });
  for (let i = 0; i < 3; i++) { now += 3 * H; await host.ask('u1', 'load'); await settle(); }
  assert.equal(pushes.length, pushCount);
  // 달력 만들기(기존 상대용) + 표시 방식 바꾸기
  const mc = await host.ask('u1', 'makeCalendar', { id: r.id });
  assert.equal(mc.calendar.months[0].name, '서리달');
  const sc = await host.ask('u1', 'setCalendar', { id: r.id, calendar: { style: 'calendar' } });
  assert.equal(sc.calendar.style, 'calendar');
  g = await host.ask('u1', 'get', { id: r.id });
  assert.doesNotMatch(g.c.theirNowLabel, /만난 지/);
});

test('알림 시험: 기기가 없으면 거절, 있으면 몇 초 뒤 보냄', async (t) => {
  const host = fakeHost();
  const sent = [];
  let available = false;
  host.api.push = { getStatus: async () => ({ available }), send: async (i, u) => { sent.push([i, u]); return { sent: 1 }; } };
  const stop = start(host.api);
  t.after(stop);
  await assert.rejects(host.ask('u1', 'pushTest', { delaySec: 5 }), /등록돼 있지 않습니다/);
  available = true;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await host.ask('u1', 'pushTest', { delaySec: 5 });
  assert.equal(r.delaySec, 5);
  assert.equal(sent.length, 0);
  t.mock.timers.tick(5000);
  await new Promise((res) => setImmediate(res));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], 'u1');
  assert.match(sent[0][0].body, /알림 시험/);
});

test('편지지·우표 바뀜: 정리 단계가 사건을 찾으면 그 편지에 새 우표, 예전 편지는 예전 우표 그대로 + 받은 물건 자동 그리기', async (t) => {
  const realNow = Date.now;
  let now = 8_000_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const host = fakeHost();
  const lib = addLibrary(host, { ...MATCH, mail: { ...MATCH.mail, ratio: 1, write_min: 0, write_max: 0 } });
  host.api.world_books.entries.update = async (id, input) => Object.assign(lib.entries.get(id), input);
  host.api.characters.update = async (id, input) => Object.assign(lib.chars.get(id), input);
  let n = 0;
  const gens = [];
  host.api.imageGen = { generate: async (req) => { gens.push(req); return { imageId: `img${n++}` }; }, listConnections: async () => [] };
  host.api.images = { upload: async () => ({ id: 'w' }), delete: async () => true };
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    const sys = req.messages[0].content;
    if (/You write short English subject phrases/.test(sys)) {
      const keys = [...req.messages[1].content.matchAll(/key=(k\d+)/g)].map((m) => m[1]);
      return { content: JSON.stringify({ prompts: keys.map((k) => ({ key: k, prompt: `subject ${k}` })) }) };
    }
    if (/archivist/.test(sys)) {
      return { content: JSON.stringify({ summaries: [], ledger: {}, timeline_add: [], lore_add: [], lore_edit: [], card: [], conflicts: [], art_change: { paper: false, stamp: true, reason: '등불 축제 기념 우표', motif: '등불' }, chapter: '' }) };
    }
    return quiet(req);
  };
  const stop = start(host.api);
  t.after(stop);
  await host.ask('u1', 'saveSettings', { settings: { art: { perDay: 20, paperMode: 'image' } } });
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'prompt', request: 'x' });
  const r = await host.ask('u1', 'matchConfirm', { draft });
  const q = await host.ask('u1', 'drawSet', { id: r.id, kinds: ['paper', 'stamp'] });
  assert.equal(q.queued, true); // 첫 편지 물건 자동 그리기가 도는 중이라 대기열로
  let g;
  for (let i = 0; i < 80; i++) { g = await host.ask('u1', 'get', { id: r.id }); if (g.c.art?.stamp?.imageId && !g.c.artJob) break; await new Promise((res) => setTimeout(res, 100)); }
  const firstStamp = g.c.art.stamp.imageId;
  const firstLetterId = g.c.letters[0].id; // 상대 첫 편지(배송 중)
  now += 1 * H; await host.ask('u1', 'load'); await settle(); // 첫 편지 도착
  await host.ask('u1', 'send', { id: r.id, body: '축제 이야기 들려줘요', enclosure: '' });
  now += 1 * H; await host.ask('u1', 'load'); await settle(); // 도착 → 답장 생성(조개 동봉 → 자동 그림)
  for (let i = 0; i < 40; i++) { await host.ask('u1', 'load'); await settle(); const x = await host.ask('u1', 'get', { id: r.id }); if (!x.c.organize && !x.c.reply) break; await new Promise((res) => setTimeout(res, 50)); } // 정리 → 우표 바뀜
  for (let i = 0; i < 200; i++) { const x = await host.ask('u1', 'get', { id: r.id }); const rl = [...x.c.letters].reverse().find((l) => l.from === 'them'); if (rl?.art?.stamp && !x.c.artJob) break; await new Promise((res) => setTimeout(res, 100)); } // 물건 그리기가 끝난 뒤 이어서 그리는 우표
  now += 2 * H; await host.ask('u1', 'load'); await settle(); // 답장 도착(배송 중엔 내용이 가려짐)
  g = await host.ask('u1', 'get', { id: r.id });
  const reply = [...g.c.letters].reverse().find((l) => l.from === 'them');
  assert.notEqual(reply.id, firstLetterId);
  assert.ok(reply.art?.stamp, '새 편지에 새 우표');
  assert.notEqual(reply.art.stamp, firstStamp);
  assert.match(reply.artNote, /새 우표 — 등불 축제/);
  const first = g.c.letters.find((l) => l.id === firstLetterId);
  assert.equal(first.art?.stamp, firstStamp, '예전 편지는 예전 우표');
  assert.equal(g.c.art.stamp.imageId, reply.art.stamp, '앞으로의 기본 우표도 새 것');
  assert.equal(reply.art.paper, undefined, '편지지는 그대로');
  const shells = g.c.items.filter((x) => x.name === '조개');
  assert.equal(shells.length, 2);
  assert.ok(shells.every((x) => x.imageId), '첫 편지·답장의 받은 물건 모두 자동 그림');
});

test('매칭 JSON이 고칠 수 없게 깨지면 한 번 더 받아 온다(JSON 전용 출력 요청)', async (t) => {
  const host = fakeHost();
  addLibrary(host, MATCH);
  const inner = host.api.generate.quiet;
  let n = 0; const params = [];
  host.api.generate.quiet = async (req) => {
    if (/Isekai Mailbox/.test(req.messages[0].content)) {
      params.push(req.parameters);
      if (n++ === 0) return { content: '{"name": 미렌 "card" }}}', finish_reason: 'stop' };
    }
    return inner(req);
  };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  assert.equal(draft.name, '미렌');
  assert.equal(params.length, 2);
  assert.equal(params[0].responseMimeType, 'application/json');
  assert.ok(draft.roll);
});

test('상대 지우기: 함께 지울 것 살펴보기, 고른 것만 지움', async (t) => {
  const host = fakeHost();
  const lib = addLibrary(host, MATCH);
  const gone = [];
  host.api.images = { ...(host.api.images || {}), delete: async (id) => { gone.push(id); return true; } };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  const r = await host.ask('u1', 'matchConfirm', { draft });
  const info = await host.ask('u1', 'deleteInfo', { id: r.id });
  assert.equal(info.character.made, true);
  assert.ok(info.book);
  assert.equal(info.sharedCharacter, 0);
  const done = await host.ask('u1', 'delete', { id: r.id, removeCharacter: false, removeBook: true, removeImages: true });
  assert.equal(done.book, true);
  assert.equal(done.character, false);
  assert.equal(lib.books.size, 0);
  assert.equal(lib.chars.size, 1);
  const home = await host.ask('u1', 'load');
  assert.ok(!(home.list || home.all || []).some?.((x) => x.id === r.id));
});

test('imageIdsOf: 편지지·우표·편지마다 고정된 그림·물건', async () => {
  const { imageIdsOf } = await import('../src/core.js');
  const ids = imageIdsOf({ art: { paper: { imageId: 'a' }, stamp: { imageId: 'b' } }, letters: [{ art: { paper: 'c' } }, { art: { paper: 'a' } }], items: [{ imageId: 'd' }, {}] });
  assert.deepEqual(ids.sort(), ['a', 'b', 'c', 'd']);
});

test('백업: 내보내고 다른 서버에 되살리면 캐릭터·로어북을 새로 만든다', async (t) => {
  const a = fakeHost();
  addLibrary(a, MATCH);
  const stopA = start(a.api);
  const { draft } = await a.ask('u1', 'matchDraft', { mode: 'random' });
  const r = await a.ask('u1', 'matchConfirm', { draft });
  const backup = await a.ask('u1', 'exportAll', {});
  stopA();
  assert.equal(backup.kind, 'isekai_mailbox_backup');
  assert.equal(backup.correspondents.length, 1);
  assert.ok(backup.correspondents[0].character.description);
  assert.ok(backup.correspondents[0].book.entries.length >= 3);
  const b = fakeHost();
  const lib = addLibrary(b, MATCH);
  const stopB = start(b.api);
  t.after(stopB);
  const res = await b.ask('u1', 'importAll', { backup: JSON.parse(JSON.stringify(backup)) });
  assert.deepEqual([res.added, res.characters, res.books], [1, 1, 1]);
  assert.equal(lib.chars.size, 1);
  const again = await b.ask('u1', 'importAll', { backup });
  assert.equal(again.skipped, 1);
  const c = (await b.ask('u1', 'get', { id: r.id })).c;
  assert.equal(c.name, draft.name);
  assert.ok(c.characterId && c.characterId === [...lib.chars.keys()][0]);
  await assert.rejects(b.ask('u1', 'importAll', { backup: { kind: 'x' } }), /백업 파일이 아닙니다/);
});

test('초상화: NovelAI 연결로 그리고 WebP 뒤 아바타로', async (t) => {
  const host = fakeHost();
  addLibrary(host, { ...MATCH, first_letter: null });
  const gens = []; let n = 0; const avatars = [];
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    if (/NovelAI image prompts/.test(req.messages[0].content)) return { content: JSON.stringify({ character: '1girl, solo, black hair', scene: 'upper body', character_uc: '' }) };
    return quiet(req);
  };
  host.api.imageGen = { generate: async (req) => { gens.push(req); return { imageId: `img${n++}` }; }, listConnections: async () => [] };
  host.api.images = { upload: async () => ({ id: `webp${n++}` }), delete: async () => true };
  host.api.characters.setAvatar = async (id, av) => { avatars.push([id, av.mime_type]); return {}; };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  const { id } = await host.ask('u1', 'matchConfirm', { draft });
  await assert.rejects(host.ask('u1', 'drawPortrait', { id }), /NovelAI 이미지 연결/);
  const s = (await host.ask('u1', 'load')).settings;
  await host.ask('u1', 'saveSettings', { settings: { ...s, art: { ...(s.art || {}), perDay: 5, portrait: { connectionId: 'nai1' } } } });
  assert.equal((await host.ask('u1', 'drawPortrait', { id })).started, true);
  for (let i = 0; i < 50 && !(await host.ask('u1', 'get', { id })).c.art?.portrait; i++) await new Promise((r) => setTimeout(r, 20));
  const c = (await host.ask('u1', 'get', { id })).c;
  assert.equal(c.art.portrait.imageId, 'img0');
  assert.equal(c.portraitJob, null);
  assert.equal(gens[0].connection_id, 'nai1');
  assert.equal(gens[0].model, 'nai-diffusion-4-5-full');
  assert.deepEqual(gens[0].parameters.characterTags, [{ tags: '1girl, solo, black hair' }]);
  assert.equal(gens[0].parameters.resolution, '832x1216');
  assert.match(gens[0].prompt, /artist:ramsrar.*upper body$/s);
  await host.ask('u1', 'webpDone', { imageId: 'img0', data: Buffer.alloc(200, 1).toString('base64'), originalBytes: 1000 });
  assert.equal(avatars.length, 1);
  assert.equal(avatars[0][1], 'image/webp');
});

test('편지지 꾸미기(HTML): 매칭 뒤 테마, 사건이면 그 편지부터 새 테마·예전 편지는 예전 테마, 세트는 봉투·우표·봉인', async (t) => {
  const host = fakeHost();
  addLibrary(host, { ...MATCH, first_letter: null });
  const themes = [];
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    if (/design the stationery/.test(req.messages[0].content)) {
      const changed = /Something happened/.test(req.messages[1].content);
      themes.push(changed);
      return { content: JSON.stringify(changed ? { paper: '#1f1d24', ink: '#eeeeee', accent: '#c9a45a', texture: 'plain', edge: 'torn', font: 'brush', motif: 'moon', density: 1, note: '상중의 검은 종이' } : { paper: '#f4ead6', ink: '#3b2f22', accent: '#8a5a2b', texture: 'lined', edge: 'deckle', font: 'pen', motif: 'leaf', density: 2, note: '잎맥 무늬' }) };
    }
    return quiet(req);
  };
  const gens = []; let n = 0;
  host.api.imageGen = { generate: async (req) => { gens.push(req); return { imageId: `img${n++}` }; }, listConnections: async () => [] };
  host.api.images = { upload: async () => ({ id: `w${n++}` }), delete: async () => true };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  const { id } = await host.ask('u1', 'matchConfirm', { draft });
  for (let i = 0; i < 30 && !(await host.ask('u1', 'get', { id })).c.paperTheme; i++) await new Promise((r) => setTimeout(r, 10));
  let c = (await host.ask('u1', 'get', { id })).c;
  assert.equal(c.paperTheme.font, 'pen');
  assert.equal(c.paperTheme.motif, 'leaf');
  // 세트: 봉투·우표·봉인
  await host.ask('u1', 'saveSettings', { settings: { ...(await host.ask('u1', 'load')).settings, art: { perDay: 10 } } });
  await host.ask('u1', 'drawSet', { id });
  for (let i = 0; i < 50 && gens.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.match(gens[0].prompt, /closed letter as one object/);
  assert.ok(gens.some((g) => /iconic object that represents a person/.test(g.prompt)), '상징물');
  assert.equal(gens[0].parameters.size, '1536x1024');
  // 수동 테마 고치기(잘못된 값은 버림, 안 읽히는 잉크는 바꿈)
  const r2 = await host.ask('u1', 'setTheme', { id, theme: { ...c.paperTheme, font: 'nope', ink: '#f4ead6' } });
  assert.equal(r2.theme.font, 'pen');
  assert.notEqual(r2.theme.ink, '#f4ead6');
  assert.deepEqual(themes, [false]);
});

test('「우리의 편지」 로어북 항목: 만들고, 다시 누르면 갱신', async (t) => {
  const host = fakeHost();
  const lib = addLibrary(host, { ...MATCH, first_letter: null });
  host.api.world_books.entries.update = async (id, input) => Object.assign(lib.entries.get(id), input);
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  const { id } = await host.ask('u1', 'matchConfirm', { draft });
  const r1 = await host.ask('u1', 'syncOurLetters', { id });
  assert.equal(r1.updated, false);
  const e = [...lib.entries.values()].find((x) => x.comment === '우리의 편지');
  assert.ok(e && /편지만 주고받는다/.test(e.content) && e.key.includes('편지'));
  const r2 = await host.ask('u1', 'syncOurLetters', { id });
  assert.equal(r2.updated, true);
  assert.equal([...lib.entries.values()].filter((x) => x.comment === '우리의 편지').length, 1);
});

test('원래 연결이 계속 429면 같은 모델의 NanoGPT 연결로 넘긴다(끄면 안 넘김)', async (t) => {
  globalThis.__IM_FAST_RETRY = true;
  t.after(() => { delete globalThis.__IM_FAST_RETRY; });
  const host = fakeHost();
  addLibrary(host, { ...MATCH, first_letter: null });
  host.api.connections = { list: async () => [
    { id: 'vx', name: '[응답·버텍스] Gemini 4 Argon', provider: 'google_vertex', model: 'gemini-4-argon', is_default: true },
    { id: 'ng', name: '[RP·종량제] Gemini 4 Argon', provider: 'nanogpt', model: 'google/gemini-4-argon' },
    { id: 'ng2', name: 'Flash', provider: 'nanogpt', model: 'google/gemini-3.8-flash' },
  ] };
  const used = []; const models = [];
  const quiet = host.api.generate.quiet;
  host.api.generate.raw = async (req) => {
    used.push(req.connection_id); models.push(req.model);
    if (req.connection_id === 'vx') throw new Error('Vertex AI generate failed (429): Resource exhausted.');
    return quiet(req);
  };
  const stop = start(host.api);
  t.after(stop);
  const s0 = (await host.ask('u1', 'load')).settings;
  await host.ask('u1', 'saveSettings', { settings: { ...s0, createConnectionId: 'vx' } });
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  assert.ok(draft.name);
  assert.deepEqual(used, ['vx', 'vx', 'vx', 'ng']);
  assert.equal(models.at(-1), 'google/gemini-4-argon'); // 대체 연결의 모델을 함께 보냄
  assert.equal(models[0], 'gemini-4-argon');
  await host.ask('u1', 'saveSettings', { settings: { ...s0, createConnectionId: 'vx', fallbackMode: 'off' } });
  used.length = 0;
  await assert.rejects(host.ask('u1', 'matchDraft', { mode: 'random' }), /429/);
  assert.deepEqual(used, ['vx', 'vx', 'vx']);
});

test('내 초상화: 페르소나 설명으로 그리고, 지난 모습 남기고, 장면 그림의 「나」는 같은 태그로', async (t) => {
  const host = fakeHost();
  addLibrary(host, { ...MATCH, first_letter: null });
  host.api.personas.get = async (id) => (id === 'p1' ? { id: 'p1', name: '시드', description: '검은 머리, 붉은 눈, 검은 코트' } : null);
  host.api.personas.getActive = async () => ({ id: 'p1', name: '시드', description: '검은 머리, 붉은 눈, 검은 코트' });
  const sent = [];
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    const sys = req.messages[0].content;
    if (/NovelAI image prompts from character sheets/.test(sys)) { sent.push(req.messages[1].content); return { content: JSON.stringify({ character: '1boy, solo, black hair, red eyes, black coat', scene: 'upper body', character_uc: '' }) }; }
    if (/natural-language picture request/.test(sys)) { sent.push(req.messages[1].content); return { content: JSON.stringify({ scene: 'night, rain', characters: [{ who: 'me', tags: '1boy, black hair' }], character_uc: '' }) }; }
    return quiet(req);
  };
  let n = 0;
  host.api.imageGen = { generate: async () => ({ imageId: `img${n++}` }), listConnections: async () => [] };
  const stop = start(host.api);
  t.after(stop);
  const s0 = (await host.ask('u1', 'load')).settings;
  await host.ask('u1', 'saveSettings', { settings: { ...s0, art: { perDay: 10, portrait: { connectionId: 'nai1' } } } });
  const r1 = await host.ask('u1', 'drawMyPortrait', { personaId: 'p1', request: '안경' });
  assert.equal(r1.imageId, 'img0');
  assert.match(sent[0], /검은 코트/);
  assert.match(sent[0], /안경/);
  await host.ask('u1', 'drawMyPortrait', { personaId: 'p1' });
  const me = (await host.ask('u1', 'mePortraits')).me.p1;
  assert.equal(me.portrait.imageId, 'img1');
  assert.equal(me.history.length, 1);
  await host.ask('u1', 'setMyPortrait', { key: 'p1', imageId: 'sent9' });
  assert.equal((await host.ask('u1', 'mePortraits')).me.p1.portrait.imageId, 'sent9');
  await host.ask('u1', 'drawMyPortrait', { personaId: 'p1' });
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  const { id } = await host.ask('u1', 'matchConfirm', { draft, personaId: 'p1' });
  await host.ask('u1', 'drawScene', { id, request: '비 오는 밤의 나', includeMe: true });
  assert.match(sent.at(-1), /reuse them exactly.*1boy, solo, black hair, red eyes, black coat/s);
});

test('기록부: 받으면 쌓이고, 갱신하면 지난 기록을 알려 주며 새 기록', async (t) => {
  const host = fakeHost();
  addLibrary(host, { ...MATCH, first_letter: null });
  const prompts = [];
  const quiet = host.api.generate.quiet;
  let k = 0;
  host.api.generate.quiet = async (req) => {
    if (/lyrical record book/.test(req.messages[0].content)) {
      prompts.push(req.messages[1].content);
      return { content: JSON.stringify({ title: `기록 ${++k}`, note: '얼음 위에 등불을 놓는 사람.', facts: [{ label: '일', value: '등대지기' }], voices: [{ who: '하나', relation: '이웃', says: '말이 없지.', hidden: false }, { who: '로', relation: '형', says: '사실은 겁쟁이야.', hidden: true }], changed: k > 1 ? '편지가 길어졌다' : '' }) };
    }
    return quiet(req);
  };
  const stop = start(host.api);
  t.after(stop);
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  const { id } = await host.ask('u1', 'matchConfirm', { draft });
  const r1 = await host.ask('u1', 'makeReport', { id });
  assert.equal(r1.report.voices[1].hidden, true);
  assert.doesNotMatch(prompts[0], /previous_record/);
  const r2 = await host.ask('u1', 'makeReport', { id });
  assert.equal(r2.count, 2);
  assert.match(prompts[1], /previous_record[\s\S]*기록 1/);
  const c = (await host.ask('u1', 'get', { id })).c;
  assert.deepEqual(c.reports.map((r) => r.title), ['기록 1', '기록 2']);
});

test('그림 사용 안 함: 그리기는 안내하며 거절, 자동 그리기 없음, 모습은 글로(고른 문체)', async (t) => {
  const host = fakeHost();
  addLibrary(host, MATCH);
  const prompts = [];
  const quiet = host.api.generate.quiet;
  host.api.generate.quiet = async (req) => {
    if (/exact written substitutes for pictures/.test(req.messages[0].content)) { prompts.push(req.messages[0].content); return { content: JSON.stringify({ portrait: '마른 손에 잉크 얼룩.', emblem: '작은 놋쇠 열쇠.', envelope: '기름 먹인 천 봉투.', box: '삼나무 상자.' }) }; }
    return quiet(req);
  };
  const gens = [];
  host.api.imageGen = { generate: async (r) => { gens.push(r); return { imageId: 'x' }; }, listConnections: async () => [] };
  const stop = start(host.api);
  t.after(stop);
  const s0 = (await host.ask('u1', 'load')).settings;
  await host.ask('u1', 'saveSettings', { settings: { ...s0, art: { enabled: false, perDay: 10 }, proseStyle: 'aesthetic' } });
  const { draft } = await host.ask('u1', 'matchDraft', { mode: 'random' });
  const { id } = await host.ask('u1', 'matchConfirm', { draft });
  await assert.rejects(host.ask('u1', 'drawSet', { id, kinds: ['envelope'] }), /그림 사용을 꺼/);
  await assert.rejects(host.ask('u1', 'drawPortrait', { id }), /그림 사용을 꺼/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(gens.length, 0, '첫 편지 물건도 자동으로 그리지 않음');
  const r = await host.ask('u1', 'describeLooks', { id });
  assert.equal(r.looks.emblem, '작은 놋쇠 열쇠.');
  assert.equal(r.looks.style, 'aesthetic');
  assert.match(prompts[0], /aesthetic and sensuous/);
  assert.equal((await host.ask('u1', 'get', { id })).c.looksText.box, '삼나무 상자.');
});

test('바로 받기: 보낸 편지가 바로 닿고, 답장을 지금 써서 배송 없이 도착', async (t) => {
  const host = fakeHost();
  const stop = start(host.api);
  t.after(stop);
  const { id } = await host.ask('u1', 'create', { input: { name: '등대지기', brief: '무뚝뚝', ratio: 7, deliveryMin: 5, deliveryMax: 5, writeMin: 48, writeMax: 48 } });
  await host.ask('u1', 'send', { id, body: '안녕하세요' });
  await host.ask('u1', 'rush', { id });
  for (let i = 0; i < 60; i++) { const g = await host.ask('u1', 'get', { id }); if (g.c.letters.some((l) => l.from === 'them')) break; await new Promise((r) => setTimeout(r, 50)); }
  const g = await host.ask('u1', 'get', { id });
  const theirs = g.c.letters.find((l) => l.from === 'them');
  assert.ok(theirs, '답장이 생김');
  assert.equal(theirs.state, 'delivered');
  assert.equal(g.c.reply, null);
});
