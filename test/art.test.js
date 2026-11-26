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
  assert.match(user.content, /key=k0: a sheet of 산양 가죽/);
  assert.match(user.content, /"놋쇠 나사못" \(투하통 바닥\)/);
  assert.match(user.content, /oiled parchment/);
  const got = A.cleanArtPrompts({ prompts: [{ key: 'k0', prompt: 'a sheet' }, { key: 'zz', prompt: 'x' }] }, ['k0', 'k1']);
  assert.deepEqual(got, { k0: 'a sheet' });
  const p = A.composePrompt('stamp', 'a lead seal stamp', A.cleanArt({}));
  assert.match(p, /perforated edges/);
  assert.match(p, /watercolor/);
  assert.match(p, /^delicate storybook illustration/); // 화풍이 맨 앞
  assert.match(p, /not a photograph/);
  assert.match(p, /without any writing or numbers$/);
  const ap = A.artParameters('768x1024');
  assert.equal(ap.size, '768x1024');
  assert.deepEqual(JSON.parse(ap.rawRequestOverride), { size: '768x1024', negative_prompt: A.NEGATIVE });
  assert.match(A.NEGATIVE, /hands/);
});
