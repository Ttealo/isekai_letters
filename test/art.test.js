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
  assert.equal(A.cleanArt({}).autoItems, 'off');
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
  assert.equal(A.modelFor(art2, 'paper'), '');
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
  assert.equal(A.cleanArt({}).paperBorder, 48);
  assert.match(A.NEGATIVE, /hands/);
});
