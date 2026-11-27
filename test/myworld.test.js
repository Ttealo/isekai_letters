import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanWorld, cleanWorldDraft, applyLife, skipCorrespondent, settleSkippedLetter, buildLifeMessages } from '../src/myworld.js';
import { myHours, myClockLabel } from '../src/core.js';

const H = 3600000;
test('내 쪽 시계: 현실과 같이 흐르고 감은 만큼 앞섬, 달력이 있으면 그 달력', () => {
  const w = { startAt: 1000, skipHours: 48 };
  assert.equal(myHours(w, 1000 + 2 * H), 50);
  const cal = { dayHours: 24, months: [{ name: '씨앗달', days: 30 }, { name: '불꽃달', days: 30 }], yearLabel: '년', start: { year: 3, month: 0, day: 1, hour: 9 }, style: 'calendar' };
  assert.match(myClockLabel({ startAt: 1000, skipHours: 24 * 30, calendar: cal }, 1000), /3년 불꽃달 1일/);
  assert.equal(cleanWorld({ startAt: 0 }), null);
});
test('초안: 현실 달력이면 calendar 없음, 세계 개요는 늘 켜짐', () => {
  const d = cleanWorldDraft({ entries: [{ title: '세계 개요', content: '항구 도시' }, { title: '', content: 'x' }], calendar: { real: true } });
  assert.equal(d.entries.length, 1);
  assert.equal(d.entries[0].constant, true);
  assert.equal(d.calendar, null);
  assert.throws(() => cleanWorldDraft({ entries: [], calendar: { real: true } }), /비어/);
});
test('연대기: 더하고 닫고 겹치면 하나', () => {
  let w = cleanWorld({ startAt: 1, life: [{ event: '공사', open: true }] });
  w = applyLife(w, { add: [{ event: '비', open: false }, { event: '공사' }], close: ['공사'] }, 30, 'manual');
  assert.equal(w.life.length, 2);
  assert.equal(w.life[0].open, false);
  assert.equal(w.lifeAt, 30);
});
test('시간 감기: 편지·답장·먼저 쓰기·그쪽 시계를 당기고, 감은 사이 쓰였어야 할 답장은 일찍 닿음', () => {
  const now = 100 * H;
  const c = { anchor: { theirAt: 0, realAt: 0 }, ratio: 2, letters: [{ state: 'in_transit', arriveAt: now + 5 * H }, { state: 'arrived', arriveAt: 1 }], reply: { state: 'waiting', dueAt: now + 2 * H }, initiativeAt: now + 9 * H };
  const s = skipCorrespondent(c, 24 * H, now);
  assert.equal(s.letters[0].arriveAt, now - 19 * H);
  assert.equal(s.letters[1].arriveAt, 1);
  assert.equal(s.reply.dueAt, now - 22 * H);
  assert.equal(s.initiativeAt, now - 15 * H);
  assert.equal(s.anchor.realAt, -24 * H);
  assert.equal(s.skipAt, now);
  const later = now + 60000;
  const L = settleSkippedLetter(s, { arriveAt: later + 3 * H }, s.reply.dueAt, later);
  assert.equal(L.arriveAt, later, '배송 3시간 < 밀린 22시간 → 바로');
  assert.equal(settleSkippedLetter(s, { arriveAt: 9 }, later + 1, later).arriveAt, 9, '감기 뒤에 생긴 답장은 그대로');
  assert.equal(skipCorrespondent({ ...c, ended: { at: 1 } }, H, now).anchor.realAt, 0, '마무리한 상대는 그대로');
});
test('내 쪽 연대기 글: 페르소나의 말·감정은 정하지 않음', () => {
  const m = buildLifeMessages({ name: '시드', card: '서점' }, { spanHours: 72, fromLabel: 'a', toLabel: 'b' });
  assert.match(m[0].content, /Never decide 시드's own words/);
  assert.match(m[1].content, /72 hours/);
});
