import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core.js';
import * as Y from '../src/memory.js';

const H = C.HOUR;
const base = { name: '칼렉', brief: '# 칼렉 / 44 / 남성\nreal:\n  look=176cm\n  job=닻줄 관리인\ncore=실용주의\nfixed=풍향부터 적음\nspeech=해오체', ratio: 3, deliveryMin: 1, deliveryMax: 1, writeMin: 0, writeMax: 0, origin: 'random' };

function withLetters() {
  let c = C.createCorrespondent(base, 0, () => 0);
  c = C.sendLetter(c, { body: '안녕하세요. 등대가 아니라 계류소군요. 밧줄은 얼마나 굵어요?', enclosure: '은행잎' }, 0, () => 0);
  c = C.advance(c, 2 * H, () => 0).c;
  c = C.applyReply(C.markGenerating(c), C.cleanReply({ body: '밧줄은 팔뚝만 하오. 토마가 오늘도 미끄러졌소.', between: [{ their_date: '2일째', event: '2번 닻줄 균열 발견', open: true }] }), 3 * H, () => 0);
  return C.advance(c, 9 * H).c;
}
const ORG = {
  summaries: [{ letter_id: '', text: '' }],
  ledger: { called_me: '시드 씨', called_them: '칼렉', stage: '조심스러운 펜팔', mood: '경계하면서도 궁금함', promises_add: [{ who: 'them', what: '닻줄 그림을 보내 주기', when: '' }], questions_add: [{ who: 'me', q: '계류소에서 별이 보이나요?' }], knows_about_me_add: ['늦가을 도시에 산다'], i_know_add: ['견습생 토마가 있다'] },
  timeline_add: [{ when: '2일째', event: '2번 닻줄 균열 발견', open: true }],
  lore_add: [{ title: '토마', keys: ['토마'], content: '19세 견습생. 고소공포증.' }, { title: '세계 개요', keys: [], content: '중복' }],
  lore_edit: [{ title: '제3계류소', after: '제3계류소: 2번 닻줄에 균열.', reason: '균열 발견' }, { title: '세계 개요', after: '바꾸면 안 됨', reason: 'x' }],
  card: [{ field: 'goal', value: '2번 닻줄 균열 원인 찾기', reason: '새 목표' }, { field: 'core', value: '바뀐 성격', reason: 'x' }, { field: 'outfit', value: '두꺼운 방한 외투', reason: '추워짐' }],
  conflicts: [{ target: '달력', why: '편지의 날짜가 계절과 맞지 않음' }],
  chapter: '',
};

test('정리 결과 정리·기억 반영: 요약·장부·사건, 중복 없이', () => {
  let c = Y.ensureMemory(withLetters());
  const ids = c.letters.map((l) => l.id);
  const raw = { ...ORG, summaries: [{ letter_id: ids[0], text: '시드가 첫 인사와 은행잎을 보냄.' }, { letter_id: ids[1], text: '칼렉이 밧줄과 토마 이야기를 함.' }, { letter_id: 'zzz', text: '없는 편지' }] };
  const org = Y.cleanOrganize(raw);
  c = Y.applyMemory(c, org, { letterIds: ids, now: 10 });
  assert.equal(c.memory.summaries.length, 2);
  assert.equal(c.memory.ledger.calledMe, '시드 씨');
  assert.equal(c.memory.ledger.promises[0].state, 'open');
  assert.deepEqual(c.memory.ledger.knowsAboutMe, ['늦가을 도시에 산다']);
  assert.equal(c.memory.timeline[0].open, true);
  // 같은 정리를 한 번 더 해도 늘지 않음, 약속 완료·사건 닫기
  const org2 = Y.cleanOrganize({ ...raw, ledger: { ...raw.ledger, promises_done: ['닻줄 그림을 보내 주기'], questions_answered: ['계류소에서 별이 보이나요?'] }, timeline_close: ['2번 닻줄 균열 발견'] });
  c = Y.applyMemory(c, org2, { letterIds: ids, now: 20 });
  assert.equal(c.memory.summaries.length, 2);
  assert.equal(c.memory.ledger.knowsAboutMe.length, 1);
  assert.equal(c.memory.ledger.promises[0].state, 'done');
  assert.equal(c.memory.ledger.openQuestions.length, 0);
  assert.equal(c.memory.timeline.filter((e) => e.event === '2번 닻줄 균열 발견').length, 1);
  assert.equal(c.memory.timeline[0].open, false);
});

test('변경 계획: 잠금·중복 제목·충돌·적용 모드', () => {
  let c = Y.ensureMemory(withLetters());
  const org = Y.cleanOrganize(ORG);
  const loreIndex = [
    { title: '세계 개요', content: '구름 바다', ref: { entryId: 'e1' } },
    { title: '제3계류소', content: '일터', ref: { entryId: 'e2' } },
  ];
  let ch = Y.planChanges(c, org, { letterId: 'l', now: 1, loreIndex, cardText: c.brief });
  const by = (k) => ch.find((x) => x.key === k);
  assert.equal(by('토마').state, 'apply');
  assert.equal(ch.filter((x) => x.key === '세계 개요' && x.op === 'add').length, 0); // 이미 있는 제목
  assert.equal(ch.find((x) => x.key === '세계 개요' && x.op === 'edit').state, 'locked');
  assert.equal(by('제3계류소').state, 'apply');
  assert.equal(by('제3계류소').ref.entryId, 'e2');
  assert.equal(by('goal').op, 'add');
  assert.equal(by('core').state, 'locked');
  assert.equal(by('outfit').state, 'apply');
  assert.equal(ch.find((x) => x.target === 'conflict').state, 'conflict');
  // 기존 캐릭터 상대면 카드는 승인 대기, 원본 로어북 수정은 꺼짐
  c = { ...c, applyMode: Y.defaultApplyMode('existing') };
  ch = Y.planChanges(c, org, { letterId: 'l', now: 1, loreIndex: [{ ...loreIndex[1], original: true }], cardText: c.brief });
  assert.equal(ch.find((x) => x.key === 'goal').state, 'pending');
  assert.equal(ch.filter((x) => x.key === '제3계류소').length, 0);
});

test('카드 칸 읽기·쓰기: 있으면 바꾸고, real 칸은 real 아래에, 나머지는 끝에', () => {
  const t = base.brief;
  assert.equal(Y.readCardField(t, 'look'), '176cm');
  assert.equal(Y.readCardField(t, 'goal'), null);
  let u = Y.setCardField(t, 'look', '176cm / 왼뺨 흉터');
  assert.match(u, /^ {2}look=176cm \/ 왼뺨 흉터$/m);
  u = Y.setCardField(u, 'outfit', '방한 외투');
  assert.match(u, /job=닻줄 관리인\n {2}outfit=방한 외투\ncore=/);
  u = Y.setCardField(u, 'goal', '균열 원인');
  assert.match(u, /\ngoal=균열 원인$/);
});

test('기억 층: 최근 원문과 겹치는 요약은 빼고, 예산을 넘으면 빠진 수를 보고', () => {
  let c = Y.ensureMemory(withLetters());
  const ids = c.letters.map((l) => l.id);
  c = Y.applyMemory(c, Y.cleanOrganize({ summaries: ids.map((id, i) => ({ letter_id: id, text: `요약 ${i}` })) }), { letterIds: ids });
  let L = Y.memoryLayers(c, { recentLetters: 6 });
  assert.equal(L.summaries, ''); // 두 통 모두 최근 원문에 들어감
  L = Y.memoryLayers(c, { recentLetters: 1 });
  assert.match(L.summaries, /요약 0/);
  assert.doesNotMatch(L.summaries, /요약 1/);
  const big = { ...c, memory: { ...c.memory, summaries: Array.from({ length: 30 }, (_, i) => ({ letterId: `x${i}`, from: 'me', when: '', text: '가'.repeat(200) })) } };
  L = Y.memoryLayers(big, { recentLetters: 1, budgets: { summaryChars: 1000 } });
  const r = L.report.find((x) => x.layer === '편지 요약');
  assert.match(r.note, /통 빠짐/);
});

test('옛 편지 회상: 최근 내 편지 낱말과 겹치는 옛 문단', () => {
  const letters = [
    { id: 'a', from: 'them', state: 'opened', body: '토마가 닻줄 도르래에서 미끄러졌소.\n\n오늘은 바람이 없소.' },
    { id: 'b', from: 'me', state: 'arrived', body: '별 이야기' },
    { id: 'c', from: 'them', state: 'opened', body: '그렇소' },
    { id: 'd', from: 'me', state: 'arrived', body: '토마는 괜찮아요? 도르래 다친 데는요?' },
  ];
  const r = Y.recallOld(letters, 2, 500);
  assert.equal(r.count, 1);
  assert.match(r.text, /토마가 닻줄 도르래/);
  assert.equal(Y.recallOld(letters, 2, 0).text, '');
});

test('답장 프롬프트에 기억 층이 들어감', () => {
  let c = Y.ensureMemory(withLetters());
  c = Y.applyMemory(c, Y.cleanOrganize({ ...ORG, chapter: '첫 장: 서로를 경계하며 시작.' }), { letterIds: [] });
  const memory = Y.memoryLayers(c, { recentLetters: 6 });
  const [sys] = C.buildReplyMessages(c, { now: 9 * H, personaName: '시드', memory });
  assert.match(sys.content, /<relationship>/);
  assert.match(sys.content, /you call 시드 "시드 씨"/);
  assert.match(sys.content, /늦가을 도시에 산다/);
  assert.match(sys.content, /\[1장\] 첫 장/);
  assert.match(sys.content, /\(진행 중\) \[2일째\] 2번 닻줄 균열 발견/);
});

test('정리 대기열·시기 요약 시점', () => {
  let c = Y.ensureMemory(withLetters());
  c = Y.queueOrganize(c, ['a']);
  c = Y.queueOrganize(c, ['b', 'a']);
  assert.deepEqual(c.organize.forLetterIds, ['a', 'b']);
  const many = { ...c, memory: { ...c.memory, summaries: Array.from({ length: 8 }, (_, i) => ({ letterId: `x${i}` })) } };
  assert.equal(Y.chapterDue(many, { chapterEvery: 10 }), true);
  assert.equal(Y.chapterDue(c, { chapterEvery: 10 }), false);
});
