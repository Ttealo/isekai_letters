import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEpilogueMessages, buildEventMessages, resumeCorrespondence, endCorrespondence, addEvent, cleanEvent } from '../src/story.js';

const c = { id: 'c1', name: '미렌', brief: '등대지기', letters: [], anchor: { theirAt: 0, realAt: 1000 } };

test('마무리: 페르소나 없음이면 이쪽 삶은 쓰지 않음', () => {
  const m = buildEpilogueMessages({ ...c, noPersona: true }, { persona: { name: '시드', card: '서점 주인' }, myEvents: '- 서점에 불' });
  const all = m.map((x) => x.content).join('\n');
  assert.match(all, /Do NOT narrate/);
  assert.doesNotMatch(all, /서점/);
  const m2 = buildEpilogueMessages(c, { persona: { name: '시드', card: '서점 주인' }, myEvents: '- 서점에 불' });
  assert.match(m2.map((x) => x.content).join('\n'), /서점 주인[\s\S]*서점에 불/);
});

test('사건: 키워드 반영, 이쪽 사건은 페르소나 설명으로', () => {
  assert.match(buildEventMessages(c, { keywords: '축제' })[0].content, /축제/);
  const me = buildEventMessages(c, { side: 'me', persona: { name: '시드', card: '서점 주인' } });
  assert.match(me[0].content, /시드/);
  assert.match(me[1].content, /서점 주인/);
  const ev = cleanEvent({ title: 't', event: 'e' }, { side: 'them', when: '3일째', now: 5 });
  const c2 = addEvent({ ...c, memory: { timeline: [] } }, ev);
  assert.deepEqual(c2.memory.timeline[0], { when: '3일째', event: 't — e', open: true, gen: ev.id });
  assert.throws(() => cleanEvent({ title: 'x' }), /비어/);
});

test('다시 잇기: 멈춘 시간만큼 도착·답장·그쪽 시계를 미룸', () => {
  const live = { ...c, letters: [{ id: 'l', from: 'me', state: 'in_transit', arriveAt: 5000 }], reply: { state: 'waiting', dueAt: 6000, nextTryAt: 0 } };
  const ended = endCorrespondence(live, { at: 2000, text: 'x' }, 2000);
  assert.deepEqual(ended.ended, { at: 2000 });
  const back = resumeCorrespondence(ended, 9000);
  assert.equal(back.ended, null);
  assert.equal(back.letters[0].arriveAt, 12000);
  assert.equal(back.reply.dueAt, 13000);
  assert.equal(back.anchor.realAt, 8000);
  assert.equal(back.story.epilogue.length, 1);
});
