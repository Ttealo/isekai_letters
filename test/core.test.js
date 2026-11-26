import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/core.js';

const H = M.HOUR;
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const base = { name: '등대지기', brief: '# 등대지기 / 60 / 남성\ncore=무뚝뚝 / 꼼꼼', ratio: 7, deliveryMin: 2, deliveryMax: 4, writeMin: 24, writeMax: 24, maxReplyRealHours: 24 };

test('상대 시간: 1:7이면 현실 하루가 그쪽 일주일', () => {
  const c = M.createCorrespondent(base, 0, () => 0);
  assert.equal(c.anchor.theirAt, 8);
  assert.equal(M.theirNow(c, 24 * H), 8 + 168);
  assert.equal(M.theirHoursToReal(c, 168), 24 * H);
});

test('비율을 바꾸면 지금이 새 기준점이 되고 지난 시각은 그대로', () => {
  const c = M.createCorrespondent(base, 0, () => 0);
  const before = M.theirNow(c, 10 * H);
  const d = M.updateCorrespondent(c, { ratio: 2 }, 10 * H);
  assert.equal(M.theirNow(d, 10 * H), before);
  assert.equal(M.theirNow(d, 11 * H), before + 2);
  assert.equal(d.delivery.min, 2); // 다른 값 유지
});

test('입력 검사', () => {
  assert.throws(() => M.cleanCorrespondentInput({ name: '', brief: 'x' }));
  assert.throws(() => M.cleanCorrespondentInput({ name: 'a', brief: '' }));
  const x = M.cleanCorrespondentInput({ name: 'a', brief: 'b', deliveryMin: 5, deliveryMax: 1, ratio: -3 });
  assert.equal(x.delivery.max, 5); // 최대가 최소보다 작으면 최소로
  assert.equal(x.ratio, 0.01);
});

test('편지 한 통의 일생: 배송 → 도착 → 답장 대기 → 생성 → 배송 → 배달 → 열기', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  c = M.sendLetter(c, { body: '안녕하세요' }, 0, () => 0.5); // 배송 3시간
  const mine = c.letters[0];
  assert.equal(mine.arriveAt, 3 * H);
  assert.equal(mine.theirArriveAt - mine.theirSentAt, 21);

  let r = M.advance(c, 2 * H);
  assert.equal(r.generate, false);
  assert.equal(r.c.letters[0].state, 'in_transit');

  r = M.advance(r.c, 3 * H, () => 0);
  assert.equal(r.c.letters[0].state, 'arrived');
  // 그쪽 24시간 = 현실 24/7시간
  assert.equal(r.c.reply.dueAt, 3 * H + (24 / 7) * H);
  assert.equal(r.generate, false);

  r = M.advance(r.c, 3 * H + (24 / 7) * H);
  assert.equal(r.generate, true);
  c = M.markGenerating(r.c);
  assert.equal(M.advance(c, 10 * H).generate, false); // 생성 중엔 다시 안 함

  const reply = M.cleanReply({ body: '받았네.', envelope: { medium: '기름 먹인 천' }, enclosures: [{ item: '조개' }] });
  c = M.applyReply(c, reply, 7 * H, () => 0); // 배송 2시간
  assert.equal(c.reply, null);
  const theirs = c.letters[1];
  assert.equal(theirs.state, 'in_transit');
  assert.deepEqual(theirs.answers, [mine.id]);

  r = M.advance(c, 9 * H);
  assert.deepEqual(r.delivered, [theirs.id]);
  c = M.markOpened(r.c, theirs.id, 10 * H);
  assert.equal(c.letters[1].state, 'opened');
});

test('답장 대기 중에 도착한 편지는 같은 답장에서 함께 답한다', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  c = M.sendLetter(c, { body: '첫 편지' }, 0, () => 0);
  c = M.sendLetter(c, { body: '둘째 편지' }, 1 * H, () => 0);
  let r = M.advance(c, 2 * H, () => 0);
  const due = r.c.reply.dueAt;
  r = M.advance(r.c, 3 * H, () => 0);
  assert.equal(r.c.reply.forLetterIds.length, 2);
  assert.equal(r.c.reply.dueAt, due);
});

test('답장까지 현실 시간 상한', () => {
  let c = M.createCorrespondent({ ...base, ratio: 0.04, writeMin: 48, writeMax: 48, maxReplyRealHours: 10 }, 0, () => 0);
  c = M.sendLetter(c, { body: 'x' }, 0, () => 0);
  const r = M.advance(c, 2 * H, () => 0);
  assert.equal(r.c.reply.dueAt, 2 * H + 10 * H);
});

test('회수는 배송 중에만', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  c = M.sendLetter(c, { body: 'x' }, 0, () => 0);
  const id = c.letters[0].id;
  assert.equal(M.recallLetter(c, id, 1 * H).letters.length, 0);
  assert.throws(() => M.recallLetter(c, id, 2 * H));
});

test('실패 재시도: 1분 → 5분 → 30분 → failed, 수동 재시도', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  c = M.sendLetter(c, { body: 'x' }, 0, () => 0);
  c = M.advance(c, 2 * H, () => 0).c;
  c = M.markGenerating(c);
  c = M.markFailed(c, new Error('a'), 100);
  assert.equal(c.reply.state, 'waiting');
  assert.equal(c.reply.nextTryAt, 100 + M.MINUTE);
  c = M.markFailed(M.markGenerating(c), new Error('b'), 200);
  c = M.markFailed(M.markGenerating(c), new Error('c'), 300);
  assert.equal(c.reply.nextTryAt, 300 + 30 * M.MINUTE);
  c = M.markFailed(M.markGenerating(c), new Error('d'), 400);
  assert.equal(c.reply.state, 'failed');
  assert.equal(M.advance(c, 999 * H).generate, false);
  c = M.retryReply(c, 500 * H);
  assert.equal(M.advance(c, 500 * H).generate, true);
});

test('재시작 복구: generating → waiting', () => {
  const c = { reply: { state: 'generating', nextTryAt: 5 } };
  assert.equal(M.recover(c).reply.state, 'waiting');
});

test('시험 가속: timeScale 60이면 배송·그쪽 시간이 60배 빠름', () => {
  let c = M.createCorrespondent({ ...base, timeScale: 60, ratio: 1 }, 0, () => 0);
  c = M.sendLetter(c, { body: 'x' }, 0, () => 0); // 배송 2시간 → 현실 2분
  assert.equal(c.letters[0].arriveAt, 2 * M.MINUTE);
  assert.equal(M.theirNow(c, 60 * M.MINUTE) - c.anchor.theirAt, 60);
});

test('JSON 읽기: 코드 울타리·앞뒤 말 허용, 본문 필수', () => {
  const r = M.cleanReply(M.parseJsonLoose('설명\n```json\n{"body":"안녕","between":[{"event":"비","their_date":"3일"}]}\n```'));
  assert.equal(r.body, '안녕');
  assert.equal(r.between[0].when, '3일');
  assert.throws(() => M.cleanReply({ body: '  ' }));
  assert.throws(() => M.parseJsonLoose('없음'));
});

test('프롬프트: 배송 중 편지는 빼고, 이름 치환, 생략 통수 표시', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  for (let i = 0; i < 3; i++) c = M.sendLetter(c, { body: `편지${i}` }, i * H, () => 0);
  c = M.advance(c, 10 * H, () => 0).c;
  c = M.sendLetter(c, { body: '아직 가는 중' }, 10 * H, () => 0);
  const [sys, user] = M.buildReplyMessages(c, { now: 10 * H, personaName: '하루', recent: 2 });
  assert.match(sys.content, /their name is 하루/);
  assert.doesNotMatch(sys.content + user.content, /\{\{user\}\}/);
  assert.match(sys.content, /older_letters_omitted=1통/);
  assert.doesNotMatch(user.content, /아직 가는 중/);
  assert.match(user.content, /편지2/);
  assert.match(sys.content, /letters_arrived=3통/);
});

test('화면 사본: 배송 중 답장 본문과 사이 일지는 가린다', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  c = M.sendLetter(c, { body: 'x' }, 0, () => 0);
  c = M.advance(c, 2 * H, () => 0).c;
  c = M.applyReply(M.markGenerating(c), M.cleanReply({ body: '비밀 본문', between: [{ event: '숨은 일' }] }), 3 * H, () => 0);
  const v = M.publicView(c, 3 * H);
  assert.equal(v.letters[1].body, undefined);
  const d = M.publicView(M.advance(c, 99 * H).c, 99 * H);
  assert.equal(d.letters[1].body, '비밀 본문');
  assert.equal(d.letters[1].between, undefined);
});

test('시간 표기', () => {
  assert.equal(M.formatTheirTime(0), '만난 지 1일째 깊은 밤');
  assert.equal(M.formatTheirTime(24 + 19), '만난 지 2일째 저녁');
  assert.equal(M.formatSpan(24 * 21), '3주');
  assert.equal(M.etaLabel(5 * H, false), '도착까지 약 5시간');
  assert.equal(M.etaLabel(90 * M.MINUTE, true), '도착까지 1시간 30분');
});

test('물품 장부: 내 동봉물 여러 개 → 도착, 상대 동봉물 → 배송 중엔 숨김 → 도착', () => {
  let c = M.createCorrespondent({ ...base, personaId: 'p1', personaName: '시드' }, 0, () => 0);
  c = M.sendLetter(c, { body: 'x', enclosure: '은행잎 한 장\n\n  말린 클로버 ' }, 0, () => 0);
  assert.deepEqual(c.items.map((x) => [x.name, x.from, x.state]), [['은행잎 한 장', 'me', 'in_transit'], ['말린 클로버', 'me', 'in_transit']]);
  assert.equal(c.letters[0].enclosure, '은행잎 한 장, 말린 클로버');
  c = M.advance(c, 2 * H, () => 0).c;
  assert.ok(c.items.every((x) => x.state === 'arrived'));
  c = M.applyReply(M.markGenerating(c), M.cleanReply({ body: 'y', enclosures: [{ item: '조개', note: '얼음 틈에서' }] }), 3 * H, () => 0);
  assert.equal(M.publicView(c, 3 * H).items.length, 2); // 상대 물품은 아직 안 보임
  c = M.advance(c, 99 * H).c;
  const v = M.publicView(c, 99 * H);
  assert.equal(v.items.length, 3);
  assert.equal(v.items[2].note, '얼음 틈에서');
  const [sys] = M.buildReplyMessages(c, { now: 99 * H });
  assert.match(sys.content, /their name is 시드/);
  assert.match(sys.content, /시드 → you: 은행잎 한 장/);
  assert.match(sys.content, /you → 시드: 조개 \(얼음 틈에서\)/);
  assert.match(sys.content, /Time is fixed/);
});

test('회수하면 그 편지의 물품도 빠진다', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  c = M.sendLetter(c, { body: 'x', enclosure: '깃털' }, 0, () => 0);
  c = M.recallLetter(c, c.letters[0].id, 1 * H);
  assert.equal(c.items.length, 0);
});

test('0.1.0 저장본 → 물품 장부 채우기', () => {
  const old = { letters: [
    { id: 'a', from: 'me', enclosure: '은행잎 한 장', state: 'arrived', sentAt: 1, arriveAt: 2 },
    { id: 'b', from: 'them', enclosures: [{ item: '조개', note: 'n' }], state: 'opened', sentAt: 3, arriveAt: 4 },
    { id: 'c', from: 'them', enclosures: [{ item: '깃털' }], state: 'in_transit', sentAt: 5, arriveAt: 6 },
  ] };
  const n = M.normalize(old);
  assert.deepEqual(n.items.map((x) => [x.name, x.from, x.state]), [['은행잎 한 장', 'me', 'arrived'], ['조개', 'them', 'arrived'], ['깃털', 'them', 'in_transit']]);
  assert.equal(M.normalize(n), n);
});

test('달력 표기: 하루 28시간, 달 넘어가기, 해 넘어가기, 표시 방식', () => {
  const cal = M.cleanCalendar({ dayHours: 28, months: [{ name: '부상절', days: 2 }, { name: '백무기', days: 3 }], yearLabel: '년', start: { year: 312, month: '백무기', day: 2, hour: 0 } });
  const c = { calendar: cal };
  assert.equal(M.theirLabel(c, 0), '312년 백무기 2일 깊은 밤 (만난 지 1일째)');
  assert.equal(M.theirLabel(c, 28 + 14), '312년 백무기 3일 한낮 (만난 지 2일째)');
  assert.equal(M.theirLabel(c, 28 * 2 + 1), '313년 부상절 1일 깊은 밤 (만난 지 3일째)');
  assert.equal(M.theirLabel({ calendar: { ...cal, style: 'calendar' } }, 0), '312년 백무기 2일 깊은 밤');
  assert.equal(M.theirLabel({ calendar: { ...cal, style: 'count' } }, 28 * 3), '만난 지 4일째 깊은 밤');
  assert.equal(M.theirLabel({}, 24 + 19), '만난 지 2일째 저녁');
  assert.equal(M.cleanCalendar({ months: [] }), null);
});

test('먼저 오는 편지: 기다림이 차면 무작위 시점에 시작, 내가 보내면 취소, 연달아 2통이면 멈춤', () => {
  let c = M.createCorrespondent({ ...base, ratio: 1, waitHours: 10 }, 0, () => 0);
  c = M.sendLetter(c, { body: 'x' }, 0, () => 0);
  c = M.advance(c, 2 * H, () => 0).c;
  c = M.applyReply(M.markGenerating(c), M.cleanReply({ body: 'y' }), 2 * H, () => 0); // 배송 2h
  c = M.advance(c, 4 * H).c; // 도착
  let r = M.initiativeCheck(c, 10 * H, {}, () => 0.5);
  assert.equal(r.start, false); // 그쪽 쓴 뒤 8시간 < 10
  r = M.initiativeCheck(c, 13 * H, {}, () => 0.5);
  assert.equal(r.start, false); // 기다림 찼고, 예약 = 13h + 2.5h
  assert.equal(r.c.initiativeAt, 13 * H + 2.5 * H);
  r = M.initiativeCheck(r.c, 16 * H, {}, () => 0.5);
  assert.equal(r.start, true);
  const s = M.startInitiative(r.c, 16 * H);
  assert.equal(s.reply.initiative, true);
  assert.deepEqual(s.reply.forLetterIds, []);
  const [sys] = M.buildReplyMessages(s, { now: 16 * H, personaName: '시드' });
  assert.match(sys.content, /initiative=yes/);
  assert.match(sys.content, /has not replied/);
  // 내가 보내면 예약 취소
  assert.equal(M.sendLetter(r.c, { body: 'z' }, 15 * H, () => 0).initiativeAt, 0);
  // 상대가 연달아 2통이면 더 안 씀
  let two = M.applyReply(M.markGenerating(s), M.cleanReply({ body: '또' }), 17 * H, () => 0);
  two = M.advance(two, 30 * H).c;
  assert.equal(M.initiativeCheck(two, 300 * H, { maxStreak: 2 }).start, false);
  // 기다림 0이면 끔
  assert.equal(M.initiativeCheck({ ...c, waitHours: 0 }, 999 * H).start, false);
});

test('달력 시작 맞춤: 첫 편지를 쓴 그쪽 시각이 몇 시간이든 그날이 「첫 편지 날짜」', () => {
  for (const dayHours of [12, 24, 28]) {
    const cal = M.cleanCalendar({ dayHours, months: [{ name: '백무기', days: 30 }], start: { year: 1, month: '백무기', day: 8, hour: Math.min(9, dayHours - 1) } });
    for (let h = 8; h <= 20; h++) {
      const c = { calendar: { ...M.shiftCalendarStart(cal, -h), style: 'calendar' } };
      assert.match(M.theirLabel(c, h), /^백무기 8일 /, `dayHours=${dayHours} h=${h}`);
    }
  }
});

test('페르소나 없음: 이름 없이 현실의 나, 이쪽 현실 날짜·시각', () => {
  let c = M.createCorrespondent({ ...base, noPersona: true, personaId: 'p1', personaName: '하루', userTz: 'Asia/Seoul' }, 0, () => 0);
  assert.equal(c.noPersona, true);
  assert.equal(c.personaId, '');
  assert.equal(c.personaName, '');
  c = M.sendLetter(c, { body: '안녕하세요', personaName: '' }, 0, () => 0);
  c = M.advance(c, 10 * H).c;
  const now = Date.UTC(2026, 10, 27, 3, 5);
  const sys = M.buildReplyMessages(c, { now, personaName: "하루" })[0].content;
  assert.ok(!sys.includes('하루'), '페르소나 이름이 들어가면 안 됨');
  assert.match(sys, /real world/);
  assert.match(sys, /user_side_now=2026년 11월 27일.*12:05.*Asia\/Seoul/);
  const back = M.updateCorrespondent(c, { personaId: 'p2', noPersona: false }, now);
  assert.equal(back.noPersona, false);
  assert.equal(back.personaId, 'p2');
  const sys2 = M.buildReplyMessages(M.createCorrespondent(base, 0, () => 0), { now, personaName: "하루" })[0].content;
  assert.ok(!sys2.includes('user_side_now'));
});

test('JSON 고치기: 글 속 따옴표·줄바꿈, 끝 쉼표, 중간에 끊긴 응답', () => {
  const broken = '```json\n{"name":"레아","card":{"personality":"speech=반말\n  - "그거 내 거야", 하고 웃음\n  - "됐어"","never":"Never beg."},"entries":[{"title":"세계 개요","keys":["섬",],"content":"바다"},],}\n```';
  const j = M.parseJsonLoose(broken);
  assert.equal(j.name, '레아');
  assert.match(j.card.personality, /"그거 내 거야", 하고 웃음/);
  assert.equal(j.entries[0].keys[0], '섬');
  const cut = M.parseJsonLoose('{"name":"레아","entries":[{"title":"세계 개요","content":"바다가 얕');
  assert.equal(cut.name, '레아');
  assert.match(cut.entries[0].content, /바다가 얕/);
  assert.deepEqual(M.parseJsonLoose('{"a":1}'), { a: 1 });
  assert.throws(() => M.parseJsonLoose('그냥 글'), /JSON을 찾지 못했습니다/);
});

test('사진 동봉: 글 동봉과 함께 물건이 되고 그림 id를 갖는다', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  c = M.sendLetter(c, { body: '사진 보내요', enclosure: '단풍잎', photos: [{ imageId: 'img1', name: '우리 집 고양이' }, { imageId: '' }] }, 0, () => 0);
  const l = c.letters[0];
  assert.deepEqual(l.enclosures.map((x) => x.item), ['단풍잎', '사진 — 우리 집 고양이']);
  assert.equal(c.items[1].imageId, 'img1');
  assert.equal(c.items[1].photo, true);
  assert.ok(!c.items[0].imageId);
  assert.deepEqual(M.imageIdsOf(c), ['img1']);
  c = M.advance(c, 10 * H).c;
  const user = M.buildReplyMessages(c, { now: 10 * H, personaName: '하루' })[1].content;
  assert.match(user, /사진 — 우리 집 고양이/);
  assert.match(user, /하루의 세계에서 찍은 사진/);
});

test('답장 길이 규칙과 동봉은 가끔', () => {
  let c = M.createCorrespondent(base, 0, () => 0);
  c = M.sendLetter(c, { body: '안녕' }, 0, () => 0);
  c = M.advance(c, 10 * H).c;
  const sys = M.buildReplyMessages(c, { now: 10 * H, letterMin: 0, letterMax: 1000 })[0].content;
  assert.match(sys, /at most about 1000 Korean characters/);
  assert.match(sys, /Enclosures are occasional/);
  assert.match(M.buildReplyMessages(c, { now: 10 * H })[0].content, /at least about 1000/);
  assert.equal(M.cleanSettings({}).letterMin, 1000);
  assert.equal(M.cleanSettings({ letterMax: 1500 }).letterMax, 1500);
});
