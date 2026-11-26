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
    exists: async (p, u) => files.has(`${u}|${p}`) || [...files.keys()].some((k) => k.startsWith(`${u}|${p}/`)),
    getJson: async (p, o) => structuredClone(files.get(`${o.userId}|${p}`) ?? o.fallback),
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
  assert.deepEqual(ps.personas[0], { id: 'p1', name: '시드', title: '반마', imageId: 'img1' });
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
  const replyReq = host.calls.find((c) => !/Isekai Mailbox/.test(c.messages[0].content));
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
