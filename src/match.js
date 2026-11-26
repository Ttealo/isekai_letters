

// 상대 자동 생성(매칭): 프롬프트, 결과 검사, 카드·로어북·우편 설정으로 나누기. 부수 효과 없음.
// 카드 양식은 D:\AI\Marinara-Engine_설정\CHARACTER_CARD_COMPACT.md(압축판) 요약. 원본이 바뀌면 여기도 맞춘다.

export const MATCH_MODES = ['prompt', 'random', 'existing'];

export const GENRE_DICE = [
  '눈과 얼음의 변방', '사막의 대상로', '바다 위 군도', '숲의 정령 마을', '하늘에 뜬 섬', '증기 기관 도시',
  '몰락한 왕국의 수도원', '별을 읽는 천문대', '지하 광산 도시', '마법 학원', '전쟁 중인 국경 요새', '유령이 사는 항구',
  '꽃이 지지 않는 계곡', '거대한 도서관 탑', '용이 잠든 산맥', '시간이 느리게 흐르는 호수', '인어와 등대', '사라져 가는 유목민',
];

const CARD_GUIDE = `
<card_format>
Follow this compact character card format exactly (Korean, keep spaces between words; one kind of information per line).
description (starts with the first line, then fields):
  # 이름 / 나이 / 성별
  real:
    look=키 / 체형 / 피부 / 머리 / 눈 / 눈에 띄는 특징
    outfit=평소 옷
    job=직업·소속 / {{user}}와의 접점(편지로만 이어짐)
    impression=처음 보는 사람이 받는 인상 한 줄
  core=성격 핵심 2~3개 (/로 구분)
  surface_inner: surface=겉으로 보이는 태도 / inner=실제로 움직이는 이유
  desire=원하는 것
  goal=지금 하려는 것
  fixed=무슨 일이 있어도 바뀌지 않는 행동 1~2개 (;로 구분)
  skill=할 줄 아는 일
personality:
  leak=호감·감정이 새는 단계 (첫 신호 → 갈등 → 전환 → 깊은 단계), each step a visible action
  voice=목소리 / 감정에 따라 어떻게 바뀌나 (for letters: how the handwriting and sentences change)
  speech=말투 규칙 (높임 / 길이 / 습관)
    - "예시 문장 1 (평소)"
    - "예시 문장 2 (감정이 흔들릴 때)"
never=One short English imperative sentence this character would most likely break (starts with "Never").
Rules: prefer actions over adjectives; surface and inner are layers, not contradictions; world facts, places and other people go to the lorebook, not the card; total card about 300~450 tokens; use {{user}} and {{char}} instead of names inside the card body.
</card_format>`;

const WORLD_GUIDE = `
<world_format>
lorebook entries (Korean). Each: title, keys (2~4 plain words that would appear in letters; no regex), content (40~200 words, facts only, compressed "key=value" or short sentences).
Required entries: "세계 개요" (constant), "달력과 시간" (constant: month names, seasons, day length, how {{char}} writes dates), "우편 수단" (constant: how letters travel between worlds, what the letter physically is in this world).
Add 2~5 more: places in {{char}}'s daily life, 1~3 people around {{char}}, one ongoing situation or tension.
</world_format>`;

const MAIL_GUIDE = `
<mail_format>
Time and post settings that fit this world (numbers):
ratio = their time / {{user}}'s time (1 = same speed, 7 = one of {{user}}'s days is a week there, 0.25 = a {{user}} day is 6 hours there). Choose from the world's nature; explain in ratio_reason (one Korean sentence).
delivery_min / delivery_max = real hours a letter travels (between 1 and 24).
write_min / write_max = hours in THEIR time that {{char}} usually takes to answer (depends on personality and circumstances).
medium = what a letter is in this world (paper is not the default: shell, leaf, oiled cloth, glass shard, map back...).
stamp_motif, seal, scent, texture = typical look/feel of {{char}}'s letters.
image_keywords = 6~10 English keywords for still-life illustrations of their letters and objects (materials, colors, light; no people).
</mail_format>`;

const OUT_SHAPE = '{"name":"","card":{"description":"","personality":"","never":""},"world_title":"","entries":[{"title":"","keys":[""],"content":"","constant":false}],"mail":{"ratio":1,"ratio_reason":"","delivery_min":1,"delivery_max":24,"write_min":2,"write_max":48,"medium":"","stamp_motif":"","seal":"","scent":"","texture":"","image_keywords":[""]},"first_letter":null}';
const LETTER_SHAPE = '{"envelope":{"medium":"","texture":"","scent":"","marks":"","seal":"","stamp":""},"enclosures":[{"item":"","note":""}],"body":"","ps":""}';

const rangeText = (r) => {
  if (!r) return '';
  const parts = [];
  const pair = (lo, hi, label) => {
    const a = Number(lo); const b = Number(hi);
    if (Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0) parts.push(`${label} must be between ${Math.min(a, b)} and ${Math.max(a, b)}`);
  };
  pair(r.ratioMin, r.ratioMax, 'ratio');
  pair(r.deliveryMin, r.deliveryMax, 'delivery hours');
  return parts.length ? `\nConstraints from the user: ${parts.join('; ')}.` : '';
};

// 매칭 프롬프트
export function buildMatchMessages({ mode, request = '', dice = '', exclude = '', existing = null, personaName = '', firstBy = 'them', ranges = null }) {
  const userName = personaName || '편지의 주인';
  const system = [
    '<system>',
    'You design a correspondent for "Isekai Mailbox": a person in another world who exchanges only handwritten letters with {{user}} across worlds.',
    'They never meet. Time flows at a different speed on each side. Letters are physical objects of that world.',
    'Make the person specific, grounded and quietly interesting; give them a daily life, a reason to keep writing, and something unresolved.',
    'Avoid clichés of "chosen one" or instant romance. No real people or existing copyrighted characters.',
    `The letter writer on this side is {{user}} (current name: ${userName}). Inside the card and the lorebook, never write that name: always use the literal macros {{user}} and {{char}}.`,
    '</system>',
    mode === 'existing' ? '' : CARD_GUIDE,
    WORLD_GUIDE,
    MAIL_GUIDE,
  ].filter(Boolean).join('\n');

  let task;
  if (mode === 'existing') {
    task = [
      'The correspondent already exists. Do NOT rewrite their card. Read it and their lore, then:',
      '- set `name` to their name, `card` to null;',
      '- write only the three required lorebook entries ("세계 개요" only if the existing lore lacks one, "달력과 시간", "우편 수단") plus at most 2 entries the letters will need;',
      '- choose mail settings that fit them.',
      `<existing_card>\n${existing?.card || ''}\n</existing_card>`,
      existing?.lore ? `<existing_lore>\n${existing.lore}\n</existing_lore>` : '',
    ].filter(Boolean).join('\n');
  } else if (mode === 'random') {
    task = [
      `Invent a new correspondent. Setting seed: ${dice || '자유'}.`,
      exclude ? `Never use these: ${exclude}.` : '',
      'Vary gender, age, occupation and tone; do not default to a young woman or a lonely scholar.',
    ].filter(Boolean).join('\n');
  } else {
    task = `Expand the user's request into a full correspondent. Keep every detail the user gave; fill the rest consistently.\n<request>\n${request}\n</request>`;
  }
  const first = firstBy === 'them'
    ? `first_letter: {{char}} writes the very first letter to an unknown reader (they found a strange mailbox, or a letter appeared). {{char}} does not know the reader's name yet, so the letter must not use it. Use this shape: ${LETTER_SHAPE}`
    : 'first_letter: null ({{user}} will write first).';

  const user = [
    '<task>',
    task,
    rangeText(ranges),
    first,
    'Output JSON only, in Korean (image_keywords in English), with this shape:',
    OUT_SHAPE,
    '</task>',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const s = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const n = (v, lo, hi, d) => {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};
const keysOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，、]/) : [])
  .map((k) => s(typeof k === 'string' ? k : '', 40)).filter(Boolean).slice(0, 6);

const REQUIRED = ['달력과 시간', '우편 수단'];

// 생성 결과 검사·정리 → 초안. 문제는 warnings로 돌려준다(초안은 미리보기에서 사람이 고칠 수 있다).
export function cleanMatchDraft(raw, { mode, ranges = null, existingName = '', personaName = '' } = {}) {
  const warnings = [];
  const name = s(raw?.name, 80) || existingName;
  if (!name) throw new Error('생성 결과에 이름이 없습니다.');
  let card = null;
  if (mode !== 'existing') {
    const c = raw?.card || {};
    card = { description: s(c.description, 6000), personality: s(c.personality, 4000), never: s(c.never, 400) };
    if (!card.description) throw new Error('생성 결과에 카드 description이 없습니다.');
    if (!/^#\s*\S/.test(card.description)) warnings.push('description 첫 줄이 「# 이름 / 나이 / 성별」 형식이 아닙니다.');
    if (!card.personality) warnings.push('personality가 비어 있습니다.');
    if (card.never && !/^never\b/i.test(card.never)) warnings.push('never가 "Never …" 문장이 아닙니다.');
    const approxTokens = Math.round((card.description.length + card.personality.length + card.never.length) / 1.6);
    if (approxTokens > 700) warnings.push(`카드가 깁니다(대략 ${approxTokens}토큰, 권장 300~450).`);
  }
  const entries = (Array.isArray(raw?.entries) ? raw.entries : []).slice(0, 12).map((e) => ({
    title: s(e?.title, 80),
    keys: keysOf(e?.keys),
    content: s(e?.content, 3000),
    constant: !!e?.constant,
  })).filter((e) => e.title && e.content);
  for (const t of ['세계 개요', ...REQUIRED]) {
    const e = entries.find((x) => x.title.replace(/\s/g, '') === t.replace(/\s/g, ''));
    if (e) e.constant = true;
    else if (!(mode === 'existing' && t === '세계 개요')) warnings.push(`로어북에 「${t}」 항목이 없습니다.`);
  }
  for (const e of entries) if (!e.constant && !e.keys.length) e.keys = [e.title];
  if (personaName && personaName.length >= 2) {
    const blob = [card?.description, card?.personality, ...entries.map((e) => e.content)].join('\n');
    if (blob.includes(personaName)) warnings.push(`카드·로어북에 페르소나 이름 「${personaName}」이 그대로 들어 있습니다({{user}}로 바꾸는 것이 좋습니다).`);
  }
  const m = raw?.mail || {};
  let ratio = n(m.ratio, 0.01, 1000, 1);
  let dMin = n(m.delivery_min, 0.05, 72, 1);
  let dMax = n(m.delivery_max, dMin, 96, Math.max(dMin, 24));
  if (ranges) {
    const clampTo = (v, lo, hi) => {
      const a = Number(lo); const b = Number(hi);
      if (!(Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0)) return v;
      return Math.min(Math.max(a, b), Math.max(Math.min(a, b), v));
    };
    ratio = clampTo(ratio, ranges.ratioMin, ranges.ratioMax);
    dMin = clampTo(dMin, ranges.deliveryMin, ranges.deliveryMax);
    dMax = Math.max(dMin, clampTo(dMax, ranges.deliveryMin, ranges.deliveryMax));
  }
  const wMin = n(m.write_min, 0, 24 * 365, 2);
  const wMax = n(m.write_max, wMin, 24 * 365 * 2, Math.max(wMin, 48));
  const mail = {
    ratio: Math.round(ratio * 100) / 100,
    ratioReason: s(m.ratio_reason, 300),
    deliveryMin: Math.round(dMin * 10) / 10,
    deliveryMax: Math.round(dMax * 10) / 10,
    writeMin: Math.round(wMin * 10) / 10,
    writeMax: Math.round(wMax * 10) / 10,
    medium: s(m.medium, 200), stampMotif: s(m.stamp_motif, 200), seal: s(m.seal, 200), scent: s(m.scent, 200), texture: s(m.texture, 200),
    imageKeywords: (Array.isArray(m.image_keywords) ? m.image_keywords : []).map((k) => s(k, 40)).filter(Boolean).slice(0, 12),
  };
  let firstLetter = null;
  const f = raw?.first_letter;
  if (f && typeof f === 'object' && s(f.body, 20000)) {
    const e = f.envelope || {};
    firstLetter = {
      body: s(f.body, 20000), ps: s(f.ps, 2000),
      envelope: { medium: s(e.medium, 200), texture: s(e.texture, 500), scent: s(e.scent, 500), marks: s(e.marks, 500), seal: s(e.seal, 500), stamp: s(e.stamp, 500) },
      enclosures: (Array.isArray(f.enclosures) ? f.enclosures : []).slice(0, 5).map((x) => ({ item: s(x?.item, 200), note: s(x?.note, 500) })).filter((x) => x.item),
    };
  }
  return { mode, name, card, worldTitle: s(raw?.world_title, 80) || `${name}의 세계`, entries, mail, firstLetter, warnings };
}

// 미리보기에서 사람이 고친 초안을 다시 검사(같은 규칙, 경고는 버림)
export function cleanEditedDraft(d) {
  const raw = {
    name: d?.name,
    card: d?.card ? { description: d.card.description, personality: d.card.personality, never: d.card.never } : null,
    world_title: d?.worldTitle,
    entries: d?.entries,
    mail: {
      ratio: d?.mail?.ratio, ratio_reason: d?.mail?.ratioReason, delivery_min: d?.mail?.deliveryMin, delivery_max: d?.mail?.deliveryMax,
      write_min: d?.mail?.writeMin, write_max: d?.mail?.writeMax, medium: d?.mail?.medium, stamp_motif: d?.mail?.stampMotif,
      seal: d?.mail?.seal, scent: d?.mail?.scent, texture: d?.mail?.texture, image_keywords: d?.mail?.imageKeywords,
    },
    first_letter: d?.firstLetter,
  };
  return cleanMatchDraft(raw, { mode: d?.mode, existingName: d?.name });
}

// 카드 본문 → 편지 프롬프트용 상대 설명
export function briefFromCard(card) {
  return [card.description, card.personality, card.never ? `never=${card.never}` : ''].filter(Boolean).join('\n');
}

// 로어북 항목 → 앱 항목 생성 입력
export function entryInput(e, order = 100) {
  return {
    key: e.constant ? [] : e.keys,
    content: e.content,
    comment: e.title,
    constant: !!e.constant,
    selective: false,
    use_regex: false,
    case_sensitive: false,
    position: 0,
    order_value: order,
    disabled: false,
  };
}

// 편지 프롬프트용 로어북 고르기: 상시 항목 + 최근 편지 글에 키워드가 나온 항목. 글자 수 예산 안에서.
export function pickLore(entries, recentText, budgetChars = 6000) {
  const text = (recentText || '').toLowerCase();
  const usable = (entries || []).filter((e) => !e.disabled && e.content);
  const constant = usable.filter((e) => e.constant);
  const hit = usable.filter((e) => !e.constant && (e.key || []).some((k) => k && text.includes(String(k).toLowerCase())));
  const out = [];
  let used = 0;
  let dropped = 0;
  for (const e of [...constant, ...hit]) {
    const line = `[${e.comment || '항목'}]\n${e.content}`;
    if (used + line.length > budgetChars) { dropped++; continue; }
    out.push(line);
    used += line.length;
  }
  return { text: out.join('\n\n'), count: out.length, dropped };
}

// 상대가 먼저 쓴 첫 편지를 배송 상태로 넣는다(core의 applyReply와 같은 모양)
export function firstLetterReply(fl) {
  return { body: fl.body, ps: fl.ps, envelope: fl.envelope, enclosures: fl.enclosures, between: [], readAt: '', writtenAt: '' };
}

