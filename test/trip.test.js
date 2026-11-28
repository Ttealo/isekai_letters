import test from 'node:test';
import assert from 'node:assert/strict';
import { createCorrespondent, sendLetter, advance, applyReply, planTrip, tripOf, cleanTrip, updateCorrespondent, summarize, startInitiative } from '../src/core.js';

const H = 3600000;
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const base = { name: '세렌', brief: '시계 수리공', ratio: 7 };

test('구간 시간: 기본 0~6시간씩, 왕복 최대 48, 구간마다 0~48로 묶음', () => {
  const t = cleanTrip({ goMin: 2 });
  assert.deepEqual(t, { go: { min: 2, max: 6 }, term: { min: 0, max: 6 }, back: { min: 0, max: 6 }, roundMax: 48 });
  assert.deepEqual(cleanTrip({ goMin: -3, goMax: 99, roundMax: 100 }).go, { min: 0, max: 48 });
  assert.equal(cleanTrip({ roundMax: 100 }).roundMax, 48);
});

test('왕복 최대를 넘으면 세 구간을 같은 비율로 줄임', () => {
  const c = createCorrespondent({ ...base, goMin: 20, goMax: 20, termMin: 20, termMax: 20, backMin: 20, backMax: 20, roundMax: 30 });
  const p = planTrip(c, () => 0.5);
  assert.ok(Math.abs(p.go + p.term + p.back - 30) < 1e-9);
  assert.ok(Math.abs(p.go - 10) < 1e-9);
});

test('보냄 → 건너가는 중 → 받음(답장까지 텀) → 답장 → 건너오는 중 → 도착, 각 구간이 정한 시간만큼', () => {
  const now = 1000 * H;
  // go 2, term 3, back 4 (min=max로 고정)
  let c = createCorrespondent({ ...base, goMin: 2, goMax: 2, termMin: 3, termMax: 3, backMin: 4, backMax: 4, roundMax: 48 }, now, () => 0.5);
  c = sendLetter(c, { body: '안녕' }, now, () => 0.5);
  const l = c.letters[0];
  assert.equal(l.arriveAt, now + 2 * H);
  assert.deepEqual(l.plan, { term: 3, back: 4 });
  assert.equal(summarize(c, now).status, '편지가 건너가는 중');
  let r = advance(c, now + 2 * H);
  assert.equal(r.c.reply.dueAt, now + 5 * H, '받고 3시간 뒤 답장');
  assert.equal(r.c.reply.back, 4);
  assert.equal(r.generate, false);
  assert.equal(summarize(r.c, now + 3 * H).status, '편지를 받았어요 · 답장을 고민하는 중');
  r = advance(r.c, now + 5 * H);
  assert.equal(r.generate, true);
  assert.equal(summarize(r.c, now + 5 * H).status, '답장을 쓰는 중');
  const after = applyReply(r.c, { body: '답장', envelope: {}, enclosures: [], between: [] }, now + 5 * H, () => 0.5);
  const back = after.letters.at(-1);
  assert.equal(back.arriveAt, now + 9 * H, '건너오는 데 4시간');
  assert.equal(summarize(after, now + 6 * H).status, '답장이 건너오는 중');
});

test('우체부가 늦어도 왕복 최대 안에서만', () => {
  const now = 1000 * H;
  let c = createCorrespondent({ ...base, goMin: 5, goMax: 5, termMin: 5, termMax: 5, backMin: 5, backMax: 5, roundMax: 16 }, now);
  // planTrip 3번, postLate: 확률 통과(0) → 늘어난 양 최대(1) → 사유(0)
  c = sendLetter(c, { body: 'x', lateChance: 100 }, now, seq(0.5, 0.5, 0.5, 0, 0.99, 0));
  assert.ok(c.letters[0].late, '늦음');
  assert.ok(Math.abs(c.letters[0].arriveAt - (now + 6 * H)) < 1, '15 + 늦음 → 왕복 16 안: 가는 길 5+1');
});

test('예전 상대는 배송·답장 쓰는 시간 그대로, 수정 화면에는 구간으로 풀어 보이고 저장하면 구간으로', () => {
  const now = 1000 * H;
  let c = createCorrespondent({ ...base, deliveryMin: 1, deliveryMax: 1, writeMin: 14, writeMax: 14, maxReplyRealHours: 24 }, now);
  assert.equal(c.trip, null);
  assert.deepEqual(tripOf(c), { go: { min: 1, max: 1 }, term: { min: 2, max: 2 }, back: { min: 1, max: 1 }, roundMax: 48 });
  c = sendLetter(c, { body: 'x' }, now, () => 0.5);
  assert.equal(c.letters[0].plan, undefined);
  assert.equal(c.letters[0].arriveAt, now + H);
  const u = updateCorrespondent(c, { goMin: 0, goMax: 6 }, now);
  assert.deepEqual(u.trip.go, { min: 0, max: 6 });
  assert.deepEqual(updateCorrespondent(u, { name: '세렌2' }, now).trip, u.trip, '다른 칸만 고쳐도 구간은 남음');
});

test('먼저 쓰는 편지: 오는 길만', () => {
  const now = 1000 * H;
  let c = createCorrespondent({ ...base, goMin: 1, goMax: 1, termMin: 1, termMax: 1, backMin: 3, backMax: 3 }, now);
  c = startInitiative(c, now);
  assert.equal(summarize(c, now).status, '그쪽이 먼저 편지를 쓰는 중인 듯해요');
  const a = applyReply(c, { body: 'x', envelope: {}, enclosures: [], between: [] }, now, () => 0.5);
  assert.equal(a.letters.at(-1).arriveAt, now + 3 * H);
});
