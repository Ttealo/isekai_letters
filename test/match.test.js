import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../src/match.js';

const goodRaw = {
  name: '미렌',
  card: {
    description: '# 미렌 / 34 / 여성\nreal:\n  look=작은 키\ncore=무뚝뚝 / 꼼꼼',
    personality: 'leak=답장이 길어짐 → …\nspeech=반말',
    never: 'Never write a cheerful letter without a reason.',
  },
  world_title: '얼어붙는 곶',
  entries: [
    { title: '세계 개요', keys: [], content: '바다가 겨울마다 얼어붙는 북쪽 해안.' },
    { title: '달력과 시간', keys: ['달력'], content: '서리달·눈달…' },
    { title: '우편 수단', keys: '철새, 노끈', content: '편지는 철새 다리에 묶어 보낸다.' },
    { title: '등대', keys: ['등대', '불빛'], content: '곶 끝의 돌 등대.' },
    { title: '선술집', keys: [], content: '항구의 선술집.' },
    { title: '', content: '제목 없음은 버림' },
  ],
  mail: { ratio: 7, ratio_reason: '느린 겨울', delivery_min: 30, delivery_max: 2, write_min: 6, write_max: 12, medium: '기름 먹인 양피지', image_keywords: ['oiled parchment', 'whale oil lamp'] },
  first_letter: { body: '누구냐.', envelope: { medium: '양피지' }, enclosures: [{ item: '조개' }] },
};

test('매칭 결과 정리: 필수 항목 상시, 키워드 문자열 나누기, 키 없는 항목은 제목을 키로, 배송 최소>최대 보정', () => {
  const d = X.cleanMatchDraft(goodRaw, { mode: 'prompt' });
  assert.equal(d.name, '미렌');
  assert.equal(d.entries.length, 5);
  assert.ok(d.entries.filter((e) => ['세계 개요', '달력과 시간', '우편 수단'].includes(e.title)).every((e) => e.constant));
  assert.deepEqual(d.entries.find((e) => e.title === '우편 수단').keys, ['철새', '노끈']);
  assert.deepEqual(d.entries.find((e) => e.title === '선술집').keys, ['선술집']);
  assert.equal(d.mail.deliveryMin, 30);
  assert.equal(d.mail.deliveryMax, 30);
  assert.equal(d.firstLetter.enclosures[0].item, '조개');
  assert.deepEqual(d.warnings, []);
});

test('매칭 결과 경고: 카드·로어북에 페르소나 이름이 그대로 들어오면', () => {
  const d = X.cleanMatchDraft({ ...goodRaw, card: { ...goodRaw.card, description: '# 미렌 / 34 / 여성\njob=등대지기 / 시드와 편지로만 이어짐' } }, { mode: 'prompt', personaName: '시드' });
  assert.ok(d.warnings.some((w) => w.includes('「시드」')));
  assert.equal(X.cleanMatchDraft(goodRaw, { mode: 'prompt', personaName: '시드' }).warnings.length, 0);
});

test('매칭 결과 경고: 형식 어긋남·필수 항목 빠짐', () => {
  const d = X.cleanMatchDraft({ ...goodRaw, card: { description: '미렌은 등대지기다', personality: '', never: '쾌활하게 쓰지 마라' }, entries: [] }, { mode: 'random' });
  assert.ok(d.warnings.some((w) => w.includes('첫 줄')));
  assert.ok(d.warnings.some((w) => w.includes('personality')));
  assert.ok(d.warnings.some((w) => w.includes('Never')));
  assert.ok(d.warnings.some((w) => w.includes('우편 수단')));
  assert.throws(() => X.cleanMatchDraft({ ...goodRaw, card: { description: '' } }, { mode: 'prompt' }));
  assert.throws(() => X.cleanMatchDraft({ ...goodRaw, name: '' }, { mode: 'prompt' }));
});

test('사용자 범위로 비율·배송 시간 자르기', () => {
  const d = X.cleanMatchDraft({ ...goodRaw, mail: { ...goodRaw.mail, ratio: 30, delivery_min: 1, delivery_max: 20 } }, { mode: 'prompt', ranges: { ratioMin: 2, ratioMax: 10, deliveryMin: 3, deliveryMax: 12 } });
  assert.equal(d.mail.ratio, 10);
  assert.equal(d.mail.deliveryMin, 3);
  assert.equal(d.mail.deliveryMax, 12);
});

test('기존 상대 모드: 카드 없음, 이름은 원래 이름, 세계 개요 없어도 경고 없음', () => {
  const d = X.cleanMatchDraft({ name: '', card: null, entries: goodRaw.entries.slice(1, 3), mail: goodRaw.mail }, { mode: 'existing', existingName: '진' });
  assert.equal(d.card, null);
  assert.equal(d.name, '진');
  assert.deepEqual(d.warnings, []);
});

test('미리보기에서 고친 초안 다시 검사', () => {
  const d = X.cleanMatchDraft(goodRaw, { mode: 'prompt' });
  const edited = { ...d, name: '미렌 하트', mail: { ...d.mail, ratio: '3' } };
  const e = X.cleanEditedDraft(edited);
  assert.equal(e.name, '미렌 하트');
  assert.equal(e.mail.ratio, 3);
  assert.equal(e.entries.length, 5);
});

test('프롬프트: 모드별 과제, 이름 치환, 첫 편지 선택, 범위 조건', () => {
  const [sys, user] = X.buildMatchMessages({ mode: 'random', dice: '사막의 대상로', exclude: '용', personaName: '시드', firstBy: 'them', ranges: { ratioMin: 1, ratioMax: 3 } });
  assert.match(sys.content, /card_format/);
  assert.match(user.content, /사막의 대상로/);
  assert.match(user.content, /Never use these: 용/);
  assert.match(user.content, /ratio must be between 1 and 3/);
  assert.match(user.content, /first_letter: \{\{char\}\} writes/);
  assert.match(sys.content, /current name: 시드/);
  assert.match(sys.content, /never write that name/);
  assert.match(sys.content, /job=직업·소속 \/ \{\{user\}\}와의 접점/);
  assert.match(user.content, /does not know the reader's name/);
  const [sys2, user2] = X.buildMatchMessages({ mode: 'existing', existing: { card: '진의 카드', lore: '진의 세계' }, firstBy: 'me' });
  assert.doesNotMatch(sys2.content, /card_format/);
  assert.match(user2.content, /Do NOT rewrite their card/);
  assert.match(user2.content, /진의 카드/);
  assert.match(user2.content, /first_letter: null/);
});

test('로어북 고르기: 상시 + 키워드 일치, 예산 넘으면 빼고 수를 셈', () => {
  const entries = [
    { comment: '개요', content: 'A'.repeat(50), constant: true },
    { comment: '등대', key: ['등대'], content: '돌 등대' },
    { comment: '선술집', key: ['선술집'], content: '항구 선술집' },
    { comment: '꺼짐', key: ['등대'], content: 'x', disabled: true },
    { comment: '큰 항목', key: ['불빛'], content: 'B'.repeat(500) },
  ];
  const r = X.pickLore(entries, '어젯밤 등대 불빛이 보였어', 200);
  assert.match(r.text, /\[개요\]/);
  assert.match(r.text, /돌 등대/);
  assert.doesNotMatch(r.text, /선술집|꺼짐/);
  assert.equal(r.dropped, 1);
});

test('카드 → 편지용 설명, 항목 → 앱 입력', () => {
  assert.match(X.briefFromCard(goodRaw.card), /never=Never write/);
  const i = X.entryInput({ title: '등대', keys: ['등대'], content: 'c', constant: false }, 120);
  assert.deepEqual([i.comment, i.key, i.constant, i.use_regex, i.order_value], ['등대', ['등대'], false, false, 120]);
  assert.deepEqual(X.entryInput({ title: '개요', keys: ['x'], content: 'c', constant: true }).key, []);
});
