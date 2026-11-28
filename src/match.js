

import { cleanCalendar, cleanTrip } from './core.js';

// 상대 자동 생성(매칭): 프롬프트, 결과 검사, 카드·로어북·우편 설정으로 나누기. 부수 효과 없음.
// 카드 양식은 압축판 캐릭터 카드 양식(외형·핵심·겉과 속·욕구·말투·never)을 요약한 것.

export const MATCH_MODES = ['prompt', 'random', 'existing'];

// 무작위 만남은 세계·직업·나이·성별·기질·처지를 따로 굴린다(모델이 「외딴 곳의 외로운 지기」로 쏠리지 않게)
export const GENRE_DICE = [
  '눈과 얼음의 변방', '사막의 대상로', '바다 위 군도', '숲의 정령 마을', '하늘에 뜬 섬', '증기 기관 도시',
  '몰락한 왕국의 수도원', '지하 광산 도시', '마법 학원', '전쟁 중인 국경 요새', '유령이 사는 항구',
  '꽃이 지지 않는 계곡', '용이 잠든 산맥', '시간이 느리게 흐르는 호수', '사라져 가는 유목민',
  '시장이 북적이는 무역항', '왕도의 뒷골목', '축제가 한창인 운하 도시', '대륙 횡단 열차가 서는 역 마을', '거대한 나무 위 마을',
  '바닷속 돔 도시', '화산섬의 온천 마을', '해적 연합의 섬', '떠돌이 서커스단', '거인의 등 위에 세운 마을',
  '해가 뜨지 않는 밤의 도시', '버섯 숲 지하 왕국', '귀족 사교계가 있는 수도', '기계 인형이 일하는 공장 도시', '포도밭이 펼쳐진 영지',
  '초원의 기마 부족', '비가 그치지 않는 늪지 마을', '신들이 거리를 걷는 성도', '망명자들이 모인 국경 시장', '하늘을 나는 비행선 함대',
  '혁명 직후의 공화국 수도', '역병이 지나간 강변 도시', '정령과 계약하는 염전 마을', '수인들의 산악 연방', '학자보다 상인이 많은 섬',
];
export const MATCH_JOBS = [
  '빵집 주인', '대장장이', '약초 상인', '수습 기사', '서커스 곡예사', '은퇴한 용병', '견습 연금술사', '뱃사공', '양봉가', '궁정 요리사',
  '떠돌이 악사', '도박장 딜러', '조향사', '염색공', '시계공', '유리 세공사', '산파', '장의사', '소방대 대원', '열차 차장',
  '비행선 정비공', '광부 반장', '포도주 양조가', '양치기', '사냥꾼', '경매인', '통역사', '극단 배우', '초상화가', '신전 청소부',
  '세탁소 주인', '여관 주인', '마부', '궁정 정원사', '무두장이', '보석 감정사', '전당포 주인', '밀수꾼', '현상금 사냥꾼', '용 조련사',
  '거리 점술가', '인형극 장인', '군의관', '수습 수도사', '학생', '농부', '찻집 주인', '목수', '다리 건설 기술자', '순찰대원',
  '상단 회계원', '재봉사', '가면 장인', '이발사', '어부', '소금 장수', '경마 기수', '왕실 근위병', '고아원 원장', '하수도 관리인',
  '지도 제작자', '향신료 상인', '유모', '사형 집행인', '소매치기', '마술 도구 수리공', '양조장 견습생', '대사관 하급 서기', '투기장 검투사', '은세공사',
];
// 나이: 성인 이상 50세 아래(인외는 그에 맞는 성숙도)
export const MATCH_AGES = ['20대 초반', '20대 후반', '30대 초반', '30대 후반', '40대'];
export const MATCH_GENDERS = ['남성', '여성', '중성', '기타(그 세계 고유의 성, 성별이 없거나 바뀌는 존재 등)'];
// 종족: 인간이 아니어도 된다
export const MATCH_KINDS = [
  '인간', '인간', '인간', '인외(자유롭게)', '수인', '정령', '요정', '용족', '유령', '골렘·자동인형', '식물에서 난 존재',
  '바다 종족', '그림자 종족', '별에서 떨어진 존재', '오래된 물건에 깃든 혼', '거인', '마족', '이형의 생물',
];
// 세계와 함께 합칠 키워드(기질·처지·분위기를 한데 섞음)
export const MATCH_KEYWORDS = [
  '수다스러움', '냉소', '허세', '서툰 다정함', '장난기', '무뚝뚝', '걱정 많음', '오만', '낙천', '고지식', '감정 기복', '능청',
  '지나친 호기심', '소심한 고집', '계산적', '느긋함', '빚', '곧 결혼', '새 가게', '추격', '축제 준비', '시험', '아픈 가족', '징집',
  '이사', '짝사랑', '파산', '견습', '남의 비밀', '형제 다툼', '대회', '은퇴 직전', '맡게 된 아이', '귀향', '향기', '소리', '음식',
  '빛과 어둠', '물', '불', '금속', '비밀 취미', '거짓말', '약속', '내기', '수집', '라이벌', '동료들', '이웃 소동', '가업',
];
// 너무 자주 나오는 원형
const OVERUSED = '등대지기, 사서, 천문학자, 우편배달부, 은둔한 학자, 외딴 초소의 경비병, 마법사 탑의 견습생';
export function rollMatch(rand = Math.random, { setting = '' } = {}) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
  const kws = [];
  for (let i = 0; kws.length < 3 && i < 20; i++) { const k = pick(MATCH_KEYWORDS); if (!kws.includes(k)) kws.push(k); }
  return {
    setting: String(setting || '').trim() || pick(GENRE_DICE),
    keywords: kws, job: pick(MATCH_JOBS), age: pick(MATCH_AGES), gender: pick(MATCH_GENDERS), kind: pick(MATCH_KINDS),
  };
}
export const rollText = (r) => (r ? `세계 ${r.setting} · 키워드 ${(r.keywords || []).join(', ')} · ${r.kind} · ${r.gender} · ${r.age} · 직업 예시 ${r.job}` : '');

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
wait_hours = how many hours in THEIR time {{char}} would wait without a reply before writing again on their own (pride, loneliness, duty decide it).
calendar = the world's calendar, consistent with the "달력과 시간" lore entry: day_hours (length of a day in hours), months (2~16 named months or seasons with day counts), year_label (suffix or era name after the year number, may be ""), start_year, start_month (one of the month names), start_day = the date of {{char}}'s first letter.
</mail_format>`;

const OUT_SHAPE = '{"name":"","card":{"description":"","personality":"","never":""},"world_title":"","entries":[{"title":"","keys":[""],"content":"","constant":false}],"mail":{"ratio":1,"ratio_reason":"","delivery_min":1,"delivery_max":24,"write_min":2,"write_max":48,"medium":"","stamp_motif":"","seal":"","scent":"","texture":"","image_keywords":[""],"wait_hours":72},"calendar":{"day_hours":24,"months":[{"name":"","days":30}],"year_label":"","start_year":1,"start_month":"","start_day":1},"first_letter":null}';
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
export function buildMatchMessages({ mode, request = '', dice = '', roll = null, used = [], exclude = '', existing = null, personaName = '', noPersona = false, firstBy = 'them', ranges = null }) {
  const userName = (noPersona ? '' : personaName) || '편지의 주인';
  const system = [
    '<system>',
    'You design a correspondent for "Isekai Mailbox": a person in another world who exchanges only handwritten letters with {{user}} across worlds.',
    'They never meet. Time flows at a different speed on each side. Letters are physical objects of that world.',
    'Make the person specific, grounded and quietly interesting; give them a daily life, a reason to keep writing, and something unresolved.',
    'Avoid clichés of "chosen one" or instant romance. No real people or existing copyrighted characters.',
    noPersona
      ? 'The letter writer on this side is {{user}}: an ordinary person in the real world (Earth, the present day), writing as themselves, with no name or background given. Do not invent facts about {{user}}. Inside the card and the lorebook always use the literal macros {{user}} and {{char}}.'
      : `The letter writer on this side is {{user}} (current name: ${userName}). Inside the card and the lorebook, never write that name: always use the literal macros {{user}} and {{char}}.`,
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
      `Invent a new correspondent. Setting seed: ${roll?.setting || dice || '자유'}.`,
      roll ? [
        'Dice for inspiration (references, not rules): combine the world and the keywords, then interpret them creatively and expand them to fit that world.',
        `- keywords=${(roll.keywords || []).join(', ')}`,
        `- kind=${roll.kind} (non-human is welcome; if non-human, design how they live, think and write letters)`,
        `- gender=${roll.gender}`,
        `- age=${roll.age} (an adult under 50; for non-humans, an equivalent maturity)`,
        `- occupation example=${roll.job} (only a hint: keep it, twist it, or replace it with whatever fits the world better)`,
      ].join('\n') : '',
      exclude ? `Never use these: ${exclude}.` : '',
      `Avoid overused archetypes: ${OVERUSED}. The letters cross dimensions, so {{char}} need not be lonely or isolated: they may have a busy life, work, friends, family or rivals.`,
    ].filter(Boolean).join('\n');
  } else {
    task = `Expand the user's request into a full correspondent. Keep every detail the user gave; fill the rest consistently. Where the request leaves something open, avoid overused archetypes (${OVERUSED}).\n<request>\n${request}\n</request>`;
  }
  if (mode !== 'existing' && used.length) task += `\nAlready corresponding with (make this one clearly different in occupation, world and temperament unless the request says otherwise): ${used.slice(0, 20).join('; ')}.`;
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
    // 편지 한 통의 왕복(현실 시간). 사람이 미리보기에서 고친다
    ...(() => {
      const t = cleanTrip({ goMin: m.go_min, goMax: m.go_max, termMin: m.term_min, termMax: m.term_max, backMin: m.back_min, backMax: m.back_max, roundMax: m.round_max });
      return { goMin: t.go.min, goMax: t.go.max, termMin: t.term.min, termMax: t.term.max, backMin: t.back.min, backMax: t.back.max, roundMax: t.roundMax };
    })(),
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
  const cal = calendarFromRaw(raw?.calendar);
  if (!cal) warnings.push('달력이 없습니다(「만난 지 N일째」로 표시).');
  mail.waitHours = n(m.wait_hours, 0, 24 * 3650, Math.max(72, mail.writeMax * 3));
  return { mode, name, card, worldTitle: s(raw?.world_title, 80) || `${name}의 세계`, entries, mail, calendar: cal, firstLetter, warnings };
}

// 생성 결과의 달력 → cleanCalendar 모양
export function calendarFromRaw(c) {
  if (!c || typeof c !== 'object') return null;
  if (Array.isArray(c.months) && c.dayHours !== undefined) return cleanCalendar(c); // 이미 정리된 모양(미리보기에서 고친 것)
  return cleanCalendar({
    dayHours: c.day_hours, months: c.months, yearLabel: c.year_label,
    start: { year: c.start_year, month: c.start_month, day: c.start_day, hour: 9 },
    style: 'both',
  });
}

// 기존 상대에 달력 붙이기: 로어북의 달력 항목과 편지에 쓴 날짜를 읽고 달력만 만든다(글 1회)
export function buildCalendarMessages(c, { loreText = '', letterDates = [] } = {}) {
  const system = 'You design the calendar of a fictional world from its lore. Output JSON only.';
  const user = [
    `World of ${c.name}.`,
    loreText ? `<lore>\n${loreText}\n</lore>` : '',
    letterDates.length ? `Dates ${c.name} has written in letters so far (oldest first):\n${letterDates.map((d) => `- ${d}`).join('\n')}` : '',
    'Give: day_hours (length of a day in hours), months (2~16 named months or seasons, each with days), year_label (suffix or era name after the year number, may be ""), start_year, start_month (one of the month names), start_day = the date of the FIRST letter above (or a plausible date if unknown).',
    'Keep names in Korean as the lore uses them. JSON only: {"calendar":{"day_hours":24,"months":[{"name":"","days":30}],"year_label":"","start_year":1,"start_month":"","start_day":1}}',
  ].filter(Boolean).join('\n\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
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
    calendar: d?.calendar,
  };
  raw.mail.wait_hours = d?.mail?.waitHours;
  Object.assign(raw.mail, { go_min: d?.mail?.goMin, go_max: d?.mail?.goMax, term_min: d?.mail?.termMin, term_max: d?.mail?.termMax, back_min: d?.mail?.backMin, back_max: d?.mail?.backMax, round_max: d?.mail?.roundMax });
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

