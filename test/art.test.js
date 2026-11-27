import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../src/art.js';

test('그림 설정 정리: 크기 형식, 상한 범위, 자동 그리기', () => {
  const a = A.cleanArt({ size: '768x1024', paperSize: 'big', perDay: '500', autoItems: 'all', style: '' });
  assert.equal(a.size, '768x1024');
  assert.equal(a.paperSize, '1024x1024');
  assert.equal(a.perDay, 100);
  assert.equal(a.autoItems, 'all');
  assert.equal(a.style, A.DEFAULT_STYLE);
  assert.equal(A.cleanArt({}).autoItems, 'all'); // 기본 켬
  assert.equal(A.cleanArt({ autoItems: 'off' }).autoItems, 'off');
  assert.equal(A.cleanArt({}).paperChange, 'event');
  assert.equal(A.cleanArt({ stampChange: 'season' }).stampChange, 'season');
  assert.equal(A.cleanArt({ stampChange: 'x' }).stampChange, 'event');
});

test('하루 상한: 날짜가 바뀌면 다시 채워짐', () => {
  const art = A.cleanArt({ perDay: 6 });
  const day1 = Date.UTC(2026, 10, 26, 10);
  let u = A.useQuota(null, 4, day1);
  assert.equal(A.quotaLeft(u, art, day1), 2);
  u = A.useQuota(u, 2, day1);
  assert.equal(A.quotaLeft(u, art, day1), 0);
  assert.equal(A.quotaLeft(u, art, day1 + 24 * 3600e3), 6);
});

test('그림 주제 프롬프트와 최종 프롬프트: 사람·글자 금지, 종류별 구도, 화풍', () => {
  const c = { name: '칼렉', mail: { medium: '산양 가죽', stampMotif: '도르래 문양', seal: '납 인장', imageKeywords: ['oiled parchment'] } };
  const [sys, user] = A.buildArtPromptMessages(c, [{ key: 'k0', kind: 'paper' }, { key: 'k1', kind: 'item', name: '놋쇠 나사못', note: '투하통 바닥' }]);
  assert.match(sys.content, /Never include people/);
  assert.match(user.content, /key=k0: decorative motifs for the border/);
  assert.match(user.content, /"놋쇠 나사못" \(투하통 바닥\)/);
  assert.match(user.content, /oiled parchment/);
  const got = A.cleanArtPrompts({ prompts: [{ key: 'k0', prompt: 'a sheet' }, { key: 'zz', prompt: 'x' }] }, ['k0', 'k1']);
  assert.deepEqual(got, { k0: 'a sheet' });
  const art = A.cleanArt({});
  const p = A.composePrompt('stamp', 'a winged pulley emblem', art);
  assert.match(p, /^flat 2D postage stamp design/);
  assert.match(p, /engraved illustration of a winged pulley emblem/);
  assert.match(p, /not a photograph/); // 전체 룩이 {style} 자리에
  assert.match(A.composePrompt('paper', 'clouds', art), /large completely blank center/);
  assert.match(A.composePrompt('item', '놋쇠 나사못', art), /^highly detailed illustration of 놋쇠 나사못/);
  // 사용자 양식: {subject}·{style} 없으면 앞뒤에 붙임
  const art2 = A.cleanArt({ style: 'ukiyo-e', kinds: { stamp: { template: 'tiny stamp', model: 'recraft/v4.1/flash/v2/text-to-image' } } });
  assert.equal(A.composePrompt('stamp', 'cat', art2), 'cat, tiny stamp, ukiyo-e');
  assert.equal(A.modelFor(art2, 'stamp'), 'recraft/v4.1/flash/v2/text-to-image');
  assert.equal(A.modelFor(art2, 'paper'), 'recraft/v4.1/flash/v2/text-to-image'); // 종류 기본 모델
  assert.equal(A.modelFor(art2, 'envelope'), 'chroma');
  assert.equal(A.modelFor(art2, 'emblem'), 'seedream-v5.0-lite');
  assert.equal(A.modelFor({ ...art2, model: 'flux' }, 'envelope'), 'flux'); // 전체 모델이 있으면 그것
  // 시도 순서: 금지어(켰을 때) → 크기만 → 연결 덮어쓰기도 비움
  let at = A.artParamAttempts('768x1024', art);
  assert.equal(at.length, 2);
  assert.deepEqual(JSON.parse(at[0].rawRequestOverride), { size: '768x1024' });
  assert.equal(at[1].rawRequestOverride, '{}');
  at = A.artParamAttempts('768x1024', A.cleanArt({ sendNegative: true }));
  assert.equal(JSON.parse(at[0].rawRequestOverride).negative_prompt, A.NEGATIVE);
  assert.ok(A.isParamRejection(new Error('Nano-GPT image generate failed (400): Chroma no longer supports seed, negative prompt')));
  assert.ok(!A.isParamRejection(new Error('Nano-GPT image generate failed (402): insufficient balance')));
  assert.equal(A.cleanArt({ paperStrength: '' }).paperStrength, 70);
  const pa = A.cleanArt({ paperBorder: 500, paperSlice: 0 });
  assert.equal(pa.paperBorder, 200);
  assert.equal(pa.paperSlice, 1);
  assert.equal(A.cleanArt({}).paperBorder, 64);
  assert.equal(A.cleanArt({}).paperSlice, 20);
  assert.match(A.NEGATIVE, /hands/);
});

test('편지지·우표 바뀜 고르기: 사건/계절/끄기, 기본 세트 없으면 안 바꿈', () => {
  const art = A.cleanArt({});
  const has = { paper: true, stamp: true };
  assert.deepEqual(A.artChangeJobs(art, { hasSet: has }), []);
  let j = A.artChangeJobs(art, { change: { paper: false, stamp: true, reason: '축제', motif: '등불' }, hasSet: has });
  assert.deepEqual(j.map((x) => [x.kind, x.reason, x.motif]), [['stamp', '축제', '등불']]);
  j = A.artChangeJobs(art, { seasonChanged: true, hasSet: has });
  assert.deepEqual(j.map((x) => x.kind), ['paper', 'stamp']);
  assert.equal(j[0].reason, '그쪽 계절이 바뀜');
  const seasonOnly = A.cleanArt({ paperChange: 'season', stampChange: 'off' });
  assert.deepEqual(A.artChangeJobs(seasonOnly, { change: { paper: true, stamp: true, reason: '이사' }, hasSet: has }), []);
  assert.deepEqual(A.artChangeJobs(seasonOnly, { seasonChanged: true, hasSet: has }).map((x) => x.kind), ['paper']);
  assert.deepEqual(A.artChangeJobs(art, { seasonChanged: true, hasSet: { paper: false, stamp: true } }).map((x) => x.kind), ['stamp']);
});

test('초상화: NAI 프롬프트 정리·합치기, 한글 제거, 기본 화풍', async () => {
  const P = await import('../src/portrait.js');
  const cfg = P.cleanPortrait({});
  assert.equal(cfg.model, 'nai-diffusion-4-5-full');
  assert.equal(cfg.size, '832x1216');
  assert.match(cfg.base, /artist:ramsrar/);
  assert.doesNotMatch(cfg.base, /1man/);
  assert.match(cfg.negative, /6::artist name::/);
  const pp = P.cleanPortraitPrompt({ character: '1girl, solo, 은발 silver hair,\nlong hair 😀', scene: 'upper body, holding letter', character_uc: 'youthful facial features' });
  assert.equal(pp.character, '1girl, solo, silver hair, long hair');
  const r = P.composePortrait(cfg, pp);
  assert.match(r.prompt, /bokeh, upper body, holding letter$/);
  assert.match(r.negative, /youthful facial features$/);
  assert.deepEqual(r.characterTags, [{ tags: pp.character }]);
  const [sys, user] = P.buildPortraitMessages({ name: '레아', brief: '# 레아 / 30 / 여성' }, { world: '섬' });
  assert.match(sys.content, /V4.5 Full/);
  assert.match(user.content, /# 레아/);
  assert.throws(() => P.cleanPortraitPrompt({ character: '한글만' }), /비어 있습니다/);
});

test('상대별 하루 그림 상한', () => {
  const art = A.cleanArt({ perDay: 6, perCorrespondentDay: 2 });
  const day1 = Date.UTC(2026, 10, 27);
  let u = A.useQuota(null, 2, day1, 'c1');
  assert.equal(A.quotaLeft(u, art, day1, 'c1'), 0);
  assert.equal(A.quotaLeft(u, art, day1, 'c2'), 2);
  assert.equal(A.quotaLeft(u, art, day1), 4);
  assert.equal(A.quotaLeft(u, A.cleanArt({ perDay: 6 }), day1, 'c1'), 4);
  assert.equal(A.quotaLeft(u, art, day1 + 24 * 3600e3, 'c1'), 2);
});

test('편지지 테마: 기본값 고정, 값 검사·대비, 화면용 스타일', async () => {
  const P = await import('../src/paper.js');
  const a = P.defaultTheme({ id: 'c1' });
  assert.deepEqual(P.defaultTheme({ id: 'c1' }), a);
  assert.ok(P.PAPER_FONTS[a.font] && P.PAPER_MOTIFS[a.motif]);
  const t = P.cleanTheme({ paper: '#ffffff', ink: '#fefefe', font: 'gaegu', motif: 'gear', texture: 'grid', edge: 'torn', density: 9 });
  assert.ok(P.contrast(t.paper, t.ink) >= 4.5);
  assert.equal(t.density, 3);
  const look = P.paperLook(t, { seed: 'l1' });
  assert.match(look.outer, /clip-path:polygon/);
  assert.match(look.inner, /Gaegu/);
  assert.equal((look.corners.match(/<svg/g) || []).length, 4);
  assert.equal(P.paperLook(t, { seed: 'l1' }).outer, look.outer);
  assert.match(P.PAPER_FONT_URL, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Nanum\+Myeongjo/);
  assert.deepEqual(A.setKinds(A.cleanArt({})), ['envelope', 'emblem']);
  assert.deepEqual(A.setKinds(A.cleanArt({ paperMode: 'image' })), ['paper', 'stamp', 'seal']);
});

test('엽서: 이름으로 알아보고 엽서 양식', () => {
  assert.ok(A.isPostcard('구름바다 그림엽서'));
  assert.ok(!A.isPostcard('납 조각'));
  assert.match(A.composePrompt('postcard', 'sea of clouds', A.cleanArt({})), /picture postcard illustration of sea of clouds/);
});

test('편지첩 HTML: 표지·차례·편지·기록부(가린 소문은 접힘)·모음·이어진 일들, 안 읽은 편지는 본문 숨김, 그림은 누르면 크게', async () => {
  const { buildLettersHtml } = await import('../src/exporthtml.js');
  const c = { id: 'c1', name: '레온', ratio: 2, art: { portrait: { imageId: 'p' }, emblem: { imageId: 'e' }, locker: { imageId: 'b' } },
    letters: [{ id: 'l1', from: 'them', state: 'opened', body: '안녕 <b>', arriveAt: 1, sentAt: 0 }, { id: 'l2', from: 'them', state: 'delivered', body: '비밀 본문', arriveAt: 2, sentAt: 1 }],
    items: [{ id: 'i', letterId: 'l1', name: '조각', imageId: 'x', from: 'them', state: 'arrived' }],
    reports: [{ at: 1, title: '첫 기척', note: '기록', facts: [], voices: [{ who: '로', relation: '형', says: '겁쟁이', hidden: true }], changed: '' }],
    memory: { timeline: [{ when: '어제', event: '숨은 일', open: false }] } };
  const h = buildLettersHtml(c, { img: (id) => `IMG-${id}`, myName: '시드', me: { title: '떠돌이 기록자', description: '검은 코트의 사람', portraitId: 'mp', history: [{ imageId: 'mo', at: 1 }] } });
  for (const t of ['href="#me"', '떠돌이 기록자', '검은 코트의 사람', 'IMG-mp', 'IMG-mo']) assert.ok(h.includes(t), t);
  for (const t of ['<h1>레온</h1>', '「첫 기척」', 'href="#letters"', 'href="#record"', 'href="#album"', 'href="#timeline"', 'IMG-p', 'IMG-e', 'IMG-b', 'IMG-x', 'data-zoom', '가려진 소문', '편지에 쓰지 않은 그쪽의 일']) assert.ok(h.includes(t), t);
  assert.ok(h.includes('안녕 &lt;b&gt;'));
  assert.ok(!h.includes('비밀 본문'));
  assert.ok(h.includes('아직 열지 않은 편지'));
});
