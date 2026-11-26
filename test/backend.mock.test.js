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
