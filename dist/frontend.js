// 이세계 편지 공용 로직(백엔드·프런트·테스트가 같이 씀). 의존성 없음, 부수 효과 없음.
// 시각: 현실 시각은 ms(Date.now()), 상대 쪽 시각은 "만난 뒤 흐른 시간(시간 단위, 실수)".

export const HOUR = 3600 * 1000;
export const MINUTE = 60 * 1000;
export const RETRY_MINUTES = [1, 5, 30]; // 생성 실패 시 재시도 간격, 다 쓰면 failed
export const RECENT_LETTERS = 6; // 1단계: 프롬프트에 넣는 최근 원문 통수

export const DEFAULT_SETTINGS = {
  replyConnectionId: '', // 비면 사용자의 기본 연결(quiet)
  createConnectionId: '', // 상대 만들기 연결. 비면 답장 연결
  createTemperature: 1.0,
  temperature: 0.9,
  maxTokens: 6000,
  recentLetters: RECENT_LETTERS,
  showExactEta: false, // 배송 중 남은 시간을 정확히(분 단위) 보여 줄지
};

const num = (v, lo, hi, d) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v, max, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);

export function newId(prefix, now = Date.now(), rand = Math.random) {
  return `${prefix}${now.toString(36)}${Math.floor(rand() * 1e8).toString(36)}`;
}

export function cleanSettings(s) {
  return {
    replyConnectionId: str(s?.replyConnectionId, 200),
    createConnectionId: str(s?.createConnectionId, 200),
    createTemperature: num(s?.createTemperature, 0, 2, DEFAULT_SETTINGS.createTemperature),
    temperature: num(s?.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    maxTokens: Math.round(num(s?.maxTokens, 500, 32000, DEFAULT_SETTINGS.maxTokens)),
    recentLetters: Math.round(num(s?.recentLetters, 1, 20, RECENT_LETTERS)),
    // 편지 길이(본문 글자 수, 한국어 기준). max 0 = 위 제한 없음
    letterMin: Math.round(num(s?.letterMin, 0, 20000, 1000)),
    letterMax: Math.round(num(s?.letterMax, 0, 30000, 0)),
    lateChance: num(s?.lateChance, 0, 50, 8), // 우체부가 늦을 확률(%)
    myFont: str(s?.myFont, 40).trim(), // 내 편지 글씨체(편지지 글씨체 목록의 키, 비면 기본 명조)
    proseStyle: str(s?.proseStyle, 300).trim() || 'plain', // 묘사·기록부 문체: plain|aesthetic|lyrical|record 또는 직접 적은 말
    fallbackMode: s?.fallbackMode === 'off' ? 'off' : 'auto', // 원래 연결이 한도로 막히면 같은 모델의 NanoGPT 연결로
    fallbackConnectionId: str(s?.fallbackConnectionId, 200), // 비우면 자동(같은 모델 이름)
    showExactEta: !!s?.showExactEta,
    initiativeEnabled: s?.initiativeEnabled !== false, // 먼저 오는 편지
    initiativePerDay: Math.round(num(s?.initiativePerDay, 0, 50, 3)),
    initiativeStreak: Math.round(num(s?.initiativeStreak, 1, 10, 2)),
    pushEnabled: s?.pushEnabled !== false, // 편지 도착 푸시 알림
    organizeEnabled: s?.organizeEnabled !== false,
    organizeConnectionId: str(s?.organizeConnectionId, 200),
    organizeTemperature: num(s?.organizeTemperature, 0, 2, 0.3),
    art: s?.art && typeof s.art === 'object' && !Array.isArray(s.art) ? s.art : {},
    budgets: s?.budgets && typeof s.budgets === 'object' && !Array.isArray(s.budgets) ? Object.fromEntries(Object.entries(s.budgets).slice(0, 20).map(([k, v]) => [String(k).slice(0, 40), Number(v)])) : {},
  };
}

// ── 시간 ──

// timeScale: 시험용 가속(60이면 현실 1분이 1시간처럼 흐름). 실사용은 1.
const scaleOf = (c) => num(c?.timeScale, 1, 3600, 1);

// 현실 시각 → 상대 쪽 시각(만난 뒤 흐른 시간)
export function theirNow(c, now) {
  const a = c.anchor;
  return a.theirAt + ((now - a.realAt) / HOUR) * scaleOf(c) * c.ratio;
}

// 상대 쪽 시간(시간 단위) → 현실 ms
export function theirHoursToReal(c, theirHours) {
  return (theirHours / c.ratio / scaleOf(c)) * HOUR;
}

// 현실 시간(시간 단위) → 현실 ms (가속 반영)
export function realHours(c, hours) {
  return (hours / scaleOf(c)) * HOUR;
}

export function pickBetween(lo, hi, rand = Math.random) {
  return lo + (hi - lo) * rand();
}

// 상대 쪽 시각을 사람이 읽는 말로: "만난 지 12일째 저녁"
export function formatTheirTime(theirHours, dayHours = 24) {
  const dh = dayHours || 24;
  const h = Math.max(0, theirHours);
  const day = Math.floor(h / dh) + 1;
  const hour = Math.floor(((h % dh) / dh) * 24);
  const part = hour < 5 ? '깊은 밤' : hour < 9 ? '새벽' : hour < 12 ? '아침' : hour < 14 ? '한낮' : hour < 18 ? '오후' : hour < 21 ? '저녁' : '밤';
  return `만난 지 ${day}일째 ${part}`;
}

// ── 그쪽 달력 ──
// calendar = { dayHours, months:[{name, days}], yearLabel, start:{year, month, day, hour}, style:'both'|'calendar'|'count' }
// 그쪽 시각(만난 뒤 흐른 시간) → 그 세계의 날짜. 달력이 없으면 「만난 지 N일째」.
export function cleanCalendar(cal) {
  if (!cal || typeof cal !== 'object') return null;
  const months = (Array.isArray(cal.months) ? cal.months : []).slice(0, 24)
    .map((m) => ({ name: str(m?.name, 24).trim(), days: Math.round(num(m?.days, 1, 100, 30)) })).filter((m) => m.name);
  if (!months.length) return null;
  const st = cal.start || {};
  const mi = typeof st.month === 'string' ? Math.max(0, months.findIndex((m) => m.name === st.month.trim())) : Math.round(num(st.month, 0, months.length - 1, 0));
  return {
    dayHours: num(cal.dayHours, 6, 100, 24),
    months,
    yearLabel: str(cal.yearLabel, 24).trim(),
    start: { year: Math.round(num(st.year, -100000, 100000, 1)), month: mi, day: Math.round(num(st.day, 1, months[mi].days, 1)), hour: num(st.hour, 0, 100, 9) },
    style: ['both', 'calendar', 'count'].includes(cal.style) ? cal.style : 'both',
  };
}

export function calendarDate(cal, theirHours) {
  const yearDays = cal.months.reduce((n, m) => n + m.days, 0);
  let startDoy = 0;
  for (let i = 0; i < cal.start.month; i++) startDoy += cal.months[i].days;
  startDoy += cal.start.day - 1;
  const total = startDoy * cal.dayHours + cal.start.hour + Math.max(0, theirHours);
  const dayIndex = Math.floor(total / cal.dayHours);
  const hour = total - dayIndex * cal.dayHours;
  const year = cal.start.year + Math.floor(dayIndex / yearDays);
  let doy = dayIndex % yearDays;
  let m = 0;
  while (doy >= cal.months[m].days) { doy -= cal.months[m].days; m++; }
  return { year, month: m, monthName: cal.months[m].name, day: doy + 1, hour24: (hour / cal.dayHours) * 24 };
}

const partOfDay = (h24) => (h24 < 5 ? '깊은 밤' : h24 < 9 ? '새벽' : h24 < 12 ? '아침' : h24 < 14 ? '한낮' : h24 < 18 ? '오후' : h24 < 21 ? '저녁' : '밤');

// 달력 시작을 그쪽 시간(hours)만큼 옮긴다(음수면 앞당김) — 「첫 편지 날짜」를 만난 시각 기준으로 맞출 때
export function shiftCalendarStart(cal, hours) {
  if (!cal) return cal;
  const d = calendarDate({ ...cal }, 0);
  const yearDays = cal.months.reduce((n, m) => n + m.days, 0);
  let doy = 0;
  for (let i = 0; i < d.month; i++) doy += cal.months[i].days;
  doy += d.day - 1;
  let total = (d.year * yearDays + doy) * cal.dayHours + cal.start.hour + hours;
  const dayAll = Math.floor(total / cal.dayHours);
  const hour = total - dayAll * cal.dayHours;
  const year = Math.floor(dayAll / yearDays);
  let rest = dayAll - year * yearDays;
  let m = 0;
  while (rest >= cal.months[m].days) { rest -= cal.months[m].days; m++; }
  return { ...cal, start: { year, month: m, day: rest + 1, hour } };
}

// 상대의 달력으로 그쪽 시각 표기
export function theirLabel(c, theirHours) {
  const cal = c?.calendar;
  if (!cal?.months?.length || cal.style === 'count') return formatTheirTime(theirHours, cal?.dayHours);
  const d = calendarDate(cal, theirHours);
  const date = `${cal.yearLabel ? `${d.year}${cal.yearLabel} ` : ''}${d.monthName} ${d.day}일 ${partOfDay(d.hour24)}`;
  return cal.style === 'both' ? `${date} (만난 지 ${Math.floor(Math.max(0, theirHours) / cal.dayHours) + 1}일째)` : date;
}

// 흐른 시간 길이(시간 단위)를 말로
export function formatSpan(hours) {
  const h = Math.max(0, hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분`;
  if (h < 48) return `${Math.round(h)}시간`;
  const d = h / 24;
  if (d < 14) return `${Math.round(d)}일`;
  if (d < 60) return `${Math.round(d / 7)}주`;
  if (d < 730) return `${Math.round(d / 30)}달`;
  return `${(d / 365).toFixed(1)}년`;
}

// ── 상대 ──

export function cleanCorrespondentInput(p) {
  const name = str(p?.name, 80).trim();
  if (!name) throw new Error('상대 이름이 비어 있습니다.');
  const brief = str(p?.brief, 4000).trim();
  if (!brief) throw new Error('상대 설명이 비어 있습니다.');
  const dMin = num(p?.deliveryMin, 0.05, 72, 1);
  const dMax = num(p?.deliveryMax, dMin, 96, Math.max(dMin, 24));
  const wMin = num(p?.writeMin, 0, 24 * 365, 2);
  const wMax = num(p?.writeMax, wMin, 24 * 365 * 2, Math.max(wMin, 48));
  return {
    name,
    brief,
    world: str(p?.world, 4000).trim(),
    ratio: num(p?.ratio, 0.01, 1000, 1),
    delivery: { min: dMin, max: dMax },
    writeDelay: { min: wMin, max: wMax },
    maxReplyRealHours: num(p?.maxReplyRealHours, 0.1, 168, 24),
    timeScale: num(p?.timeScale, 1, 3600, 1),
    // 페르소나 없음: 현실의 나 자신으로(이름·설정 없이, 이쪽 시간은 현실 날짜·시각)
    noPersona: !!p?.noPersona,
    personaId: p?.noPersona ? '' : str(p?.personaId, 200),
    personaName: p?.noPersona ? '' : str(p?.personaName, 80),
    userTz: str(p?.userTz, 60),
    // 매칭으로 만든 상대: 앱의 캐릭터·로어북과 우편 설정
    characterId: str(p?.characterId, 200),
    worldBookId: str(p?.worldBookId, 200),
    origin: ['manual', 'prompt', 'random', 'existing'].includes(p?.origin) ? p.origin : 'manual',
    mail: cleanMail(p?.mail),
    calendar: cleanCalendar(p?.calendar),
    // 먼저 오는 편지: 내 답이 없을 때 그쪽 시간으로 이만큼 기다리면 먼저 쓴다(0이면 안 씀)
    waitHours: num(p?.waitHours, 0, 24 * 3650, Math.max(72, num(p?.writeMax, 0, 24 * 365 * 2, 48) * 3)),
  };
}

export function cleanMail(m) {
  return {
    ratioReason: str(m?.ratioReason, 300),
    medium: str(m?.medium, 200), stampMotif: str(m?.stampMotif, 200), seal: str(m?.seal, 200),
    scent: str(m?.scent, 200), texture: str(m?.texture, 200),
    imageKeywords: Array.isArray(m?.imageKeywords) ? m.imageKeywords.map((k) => str(k, 40)).filter(Boolean).slice(0, 12) : [],
  };
}

// 동봉물: 한 줄에 하나(최대 5개)
export function splitEnclosures(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
  return list.map((x) => str(typeof x === 'string' ? x : x?.item, 200).trim()).filter(Boolean).slice(0, 5);
}

// 예전(0.1.0) 저장본에 물품 장부를 채우고 기본값을 맞춘다. 이미 있으면 그대로.
export function normalize(c) {
  if (Array.isArray(c.items)) return c;
  const items = [];
  for (const l of c.letters || []) {
    const names = l.from === 'me' ? splitEnclosures(l.enclosures?.length ? l.enclosures : l.enclosure) : (l.enclosures || []).map((x) => x.item);
    const notes = l.from === 'me' ? [] : (l.enclosures || []).map((x) => x.note || '');
    names.forEach((name, i) => items.push(makeItem(l, name, notes[i] || '', i)));
  }
  return { ...c, items };
}

function makeItem(l, name, note, i) {
  return {
    id: `${l.id}_${i}`,
    name, note,
    from: l.from,
    letterId: l.id,
    sentAt: l.sentAt,
    arriveAt: l.arriveAt,
    state: l.state === 'in_transit' ? 'in_transit' : 'arrived',
    imageId: null,
  };
}

export function createCorrespondent(input, now = Date.now(), rand = Math.random) {
  const c = cleanCorrespondentInput(input);
  return {
    version: 1,
    id: newId('c', now, rand),
    ...c,
    anchor: { realAt: now, theirAt: pickBetween(8, 20, rand) }, // 그쪽은 1일째 아침~저녁 어딘가에서 시작
    createdAt: now,
    letters: [],
    items: [],
    reply: null, // { state:'waiting'|'generating'|'failed', dueAt, attempts, nextTryAt, error, forLetterIds }
  };
}

// 이 상대가 쓰는 그림 id 전부(편지지·우표·봉인, 편지마다 고정된 그림, 물건)
export function imageIdsOf(c) {
  const ids = new Set();
  for (const v of Object.values(c?.art || {})) {
    if (Array.isArray(v)) { for (const h of v) if (h?.imageId) ids.add(h.imageId); } else if (v?.imageId) ids.add(v.imageId);
  }
  for (const l of c?.letters || []) for (const v of Object.values(l.art || {})) if (typeof v === 'string' && v) ids.add(v);
  for (const x of c?.items || []) if (x.imageId) ids.add(x.imageId);
  return [...ids];
}

// 저장된 상대 → 입력 양식(수정 화면용)
export function toInput(c) {
  return {
    name: c.name, brief: c.brief, world: c.world, ratio: c.ratio,
    deliveryMin: c.delivery.min, deliveryMax: c.delivery.max,
    writeMin: c.writeDelay.min, writeMax: c.writeDelay.max,
    maxReplyRealHours: c.maxReplyRealHours, timeScale: scaleOf(c), personaId: c.personaId, personaName: c.personaName || '', noPersona: !!c.noPersona, userTz: c.userTz || '',
    characterId: c.characterId || '', worldBookId: c.worldBookId || '', origin: c.origin || 'manual', mail: c.mail || {}, calendar: c.calendar || null, waitHours: c.waitHours ?? '',
  };
}

export function updateCorrespondent(c, input, now = Date.now()) {
  const next = cleanCorrespondentInput({ ...toInput(c), ...input });
  const out = { ...c, ...next };
  // 비율이나 가속이 바뀌면 지금을 새 기준점으로(지난 날짜는 그대로)
  if (next.ratio !== c.ratio || next.timeScale !== scaleOf(c)) {
    out.anchor = { realAt: now, theirAt: theirNow(c, now) };
  }
  return out;
}

// ── 편지 ──

export function cleanLetterBody(v) {
  const body = str(v, 20000).trim();
  if (!body) throw new Error('편지 본문이 비어 있습니다.');
  return body;
}

// 우체부가 늦었다: 가끔 배송이 50~200% 더 걸린다(사유는 차원 우편다운 것)
export const LATE_REASONS = [
  '차원 사이에 폭풍이 불어 우편선이 묶였다', '우체부가 길을 잃고 다른 세계를 한 바퀴 돌았다', '봉투가 엉뚱한 세계로 갔다가 되돌아왔다',
  '경계 검문소에서 편지를 오래 들여다봤다', '우체부가 도중에 낮잠을 잤다', '우편 가방이 젖어 말리느라 늦었다',
  '축제 때문에 우편이 밀렸다', '새로 온 우체부가 주소를 잘못 읽었다', '봉투가 다른 편지 사이에 끼어 있었다',
];
export function postLate(hours, chancePct = 0, rand = Math.random) {
  if (!(chancePct > 0)) return null;
  if (rand() * 100 >= chancePct) return null;
  const extra = hours * (0.5 + rand() * 1.5);
  return { extra, reason: LATE_REASONS[Math.floor(rand() * LATE_REASONS.length) % LATE_REASONS.length] };
}

// 내가 보내는 편지
export function sendLetter(c, { body, enclosure, personaName, photos = [], lateChance = 0 }, now = Date.now(), rand = Math.random) {
  c = normalize(c);
  const base0 = realHours(c, pickBetween(c.delivery.min, c.delivery.max, rand));
  const late = postLate(base0, lateChance, rand);
  const travel = base0 + (late ? late.extra : 0);
  // 사진 동봉: 이쪽 세계의 사진(설명이 이름). 글 동봉과 합쳐 5개까지
  const pics = (Array.isArray(photos) ? photos : []).map((x) => ({ imageId: str(x?.imageId, 200), name: str(x?.name, 120).trim() || '사진 한 장' })).filter((x) => x.imageId).slice(0, 3);
  const names = [...splitEnclosures(enclosure).slice(0, 5 - pics.length), ...pics.map((x) => `사진 — ${x.name}`)];
  const letter = {
    id: newId('l', now, rand),
    from: 'me',
    personaName: str(personaName, 80),
    body: cleanLetterBody(body),
    enclosure: names.join(', '),
    enclosures: names.map((item) => ({ item, note: '' })),
    ...(pics.length ? { photos: pics } : {}),
    ...(late ? { late: late.reason } : {}),
    sentAt: now,
    arriveAt: now + travel,
    theirSentAt: theirNow(c, now),
    theirArriveAt: theirNow(c, now + travel),
    state: 'in_transit',
  };
  const nText = names.length - pics.length;
  const items = names.map((n, i) => {
    const it = makeItem(letter, n, '', i);
    return i >= nText ? { ...it, imageId: pics[i - nText].imageId, photo: true, note: '{{user}}의 세계에서 찍은 사진' } : it;
  });
  return { ...c, letters: [...c.letters, letter], items: [...c.items, ...items], initiativeAt: 0 };
}

// 배송 중일 때만 회수
// 바로 받기: 배송 중인 편지는 지금 도착, 답장을 기다리는 중이면 지금 쓰고 바로 도착하게(rush)
export function rushLetters(c, now = Date.now()) {
  c = normalize(c);
  const pending = c.letters.some((l) => l.state === 'in_transit') || (c.reply && c.reply.state !== 'failed');
  if (!pending) throw new Error('지금 기다리는 편지가 없어요.');
  let out = { ...c, letters: c.letters.map((l) => (l.state === 'in_transit' ? { ...l, arriveAt: Math.min(l.arriveAt, now) } : l)) };
  out = advance(out, now).c;
  if (out.reply && out.reply.state !== 'failed') out = { ...out, reply: { ...out.reply, dueAt: Math.min(out.reply.dueAt, now), nextTryAt: 0, rush: true } };
  return out;
}

export function recallLetter(c, letterId, now = Date.now()) {
  const l = c.letters.find((x) => x.id === letterId);
  if (!l || l.from !== 'me') throw new Error('회수할 편지를 찾지 못했습니다.');
  if (l.state !== 'in_transit' || now >= l.arriveAt) throw new Error('이미 도착한 편지는 회수할 수 없습니다.');
  return { ...c, letters: c.letters.filter((x) => x.id !== letterId), items: (c.items || []).filter((x) => x.letterId !== letterId) };
}

// 받은 편지 고치기(모델이 글자를 깨뜨렸을 때 등). 본문·추신만, 원문은 한 번만 남긴다
export function editLetter(c, letterId, { body, ps } = {}, now = Date.now()) {
  const l = c.letters.find((x) => x.id === letterId);
  if (!l) throw new Error('편지를 찾지 못했습니다.');
  if (l.state === 'in_transit') throw new Error('배송 중인 편지는 고칠 수 없습니다.');
  const nb = cleanLetterBody(body);
  const np = str(ps ?? l.ps ?? '', 2000).trim();
  return { ...c, letters: c.letters.map((x) => (x.id === letterId ? { ...x, body: nb, ps: np, editedAt: now, original: x.original || { body: x.body, ps: x.ps || '' } } : x)) };
}

export function markOpened(c, letterId, now = Date.now()) {
  return {
    ...c,
    letters: c.letters.map((l) => (l.id === letterId && l.from === 'them' && l.state === 'delivered' ? { ...l, state: 'opened', openedAt: now } : l)),
  };
}

// ── 시간 진행: 저장된 상대 하나를 지금 시각까지 진행시킨다 ──
// 반환: { c, generate: bool(답장 생성이 필요), delivered: [letterId] }
export function advance(c, now = Date.now(), rand = Math.random) {
  c = normalize(c);
  let out = c;
  const delivered = [];
  // 1) 내 편지 도착
  const arrivedNow = [];
  const letters = out.letters.map((l) => {
    if (l.from === 'me' && l.state === 'in_transit' && now >= l.arriveAt) {
      arrivedNow.push(l);
      return { ...l, state: 'arrived' };
    }
    return l;
  });
  out = { ...out, letters };
  // 2) 답장 작업 만들기(이미 기다리는 작업이 있으면 그 작업이 새 편지까지 함께 답한다)
  if (arrivedNow.length) {
    const ids = arrivedNow.map((l) => l.id);
    if (out.reply && out.reply.state !== 'failed') {
      out = { ...out, reply: { ...out.reply, forLetterIds: [...new Set([...out.reply.forLetterIds, ...ids])] } };
    } else {
      const first = arrivedNow.reduce((a, b) => (a.arriveAt <= b.arriveAt ? a : b));
      const theirWrite = pickBetween(c.writeDelay.min, c.writeDelay.max, rand);
      const realWrite = Math.min(theirHoursToReal(out, theirWrite), realHours(out, out.maxReplyRealHours));
      out = {
        ...out,
        reply: { state: 'waiting', dueAt: first.arriveAt + realWrite, attempts: 0, nextTryAt: 0, error: '', forLetterIds: ids },
      };
    }
  }
  // 3) 상대 편지 배달
  out = {
    ...out,
    letters: out.letters.map((l) => {
      if (l.from === 'them' && l.state === 'in_transit' && now >= l.arriveAt) {
        delivered.push(l.id);
        return { ...l, state: 'delivered' };
      }
      return l;
    }),
  };
  // 4) 물품: 실린 편지가 도착했으면 물품도 도착
  const landed = new Set(out.letters.filter((l) => l.state !== 'in_transit').map((l) => l.id));
  if (out.items.some((x) => x.state === 'in_transit' && landed.has(x.letterId))) {
    out = { ...out, items: out.items.map((x) => (x.state === 'in_transit' && landed.has(x.letterId) ? { ...x, state: 'arrived' } : x)) };
  }
  const r = out.reply;
  const generate = !!r && r.state === 'waiting' && now >= r.dueAt && now >= (r.nextTryAt || 0);
  return { c: out, generate, delivered };
}

// ── 먼저 오는 편지 ──
// 내 답이 없는 채 그쪽 시간으로 waitHours가 지나면, 그 뒤 무작위 시점(기다림의 0~50%)에 상대가 먼저 쓴다.
// 상대가 연달아 쓴 편지가 maxStreak통이면 더 쓰지 않는다(침묵도 연출). 반환: { c, start }
export function initiativeCheck(c, now = Date.now(), { maxStreak = 2 } = {}, rand = Math.random) {
  // 예전 상대(값 없음)는 답장 쓰는 시간 최대의 3배(최소 72시간)
  const wait = c.waitHours ?? Math.max(72, (c.writeDelay?.max || 48) * 3);
  if (!wait || c.reply) return { c, start: false };
  if (c.letters.some((l) => l.state === 'in_transit')) return { c, start: false };
  const lastTheirs = [...c.letters].reverse().find((l) => l.from === 'them');
  if (!lastTheirs) return { c, start: false };
  let streak = 0;
  for (let i = c.letters.length - 1; i >= 0 && c.letters[i].from === 'them'; i--) streak++;
  if (streak === 0 || streak >= maxStreak) return { c: c.initiativeAt ? { ...c, initiativeAt: 0 } : c, start: false };
  const waited = theirNow(c, now) - lastTheirs.theirWrittenAt;
  if (waited < wait) return { c, start: false };
  if (!c.initiativeAt) {
    const at = now + theirHoursToReal(c, wait * 0.5 * rand());
    return { c: { ...c, initiativeAt: at }, start: now >= at };
  }
  return { c, start: now >= c.initiativeAt };
}
export function startInitiative(c, now = Date.now()) {
  return { ...c, initiativeAt: 0, reply: { state: 'waiting', dueAt: now, attempts: 0, nextTryAt: 0, error: '', forLetterIds: [], initiative: true } };
}

// 생성 중에 서버가 꺼졌던 작업을 되돌린다(시작할 때 한 번)
export function recover(c) {
  if (c.reply?.state === 'generating') return { ...c, reply: { ...c.reply, state: 'waiting', nextTryAt: 0 } };
  return c;
}

export function markGenerating(c) {
  return { ...c, reply: { ...c.reply, state: 'generating' } };
}

export function markFailed(c, error, now = Date.now()) {
  const r = c.reply;
  const attempts = (r?.attempts || 0) + 1;
  const wait = RETRY_MINUTES[attempts - 1];
  const msg = str(error?.message || String(error), 500);
  if (wait === undefined) return { ...c, reply: { ...r, state: 'failed', attempts, error: msg } };
  return { ...c, reply: { ...r, state: 'waiting', attempts, nextTryAt: now + wait * MINUTE, error: msg } };
}

// 실패한 답장을 다시 시도
export function retryReply(c, now = Date.now()) {
  if (c.reply?.state !== 'failed') throw new Error('다시 시도할 답장이 없습니다.');
  return { ...c, reply: { ...c.reply, state: 'waiting', attempts: 0, nextTryAt: 0, dueAt: Math.min(c.reply.dueAt, now), error: '' } };
}

// 생성 결과를 상대 편지로 넣고 배송을 시작한다
// immediate: 바로 도착(매칭 때 상대의 첫 편지 — 만나자마자 우체통에 들어 있음)
export function applyReply(c, reply, now = Date.now(), rand = Math.random, { lateChance = 0, immediate = false } = {}) {
  c = normalize(c);
  const base0 = immediate ? 0 : realHours(c, pickBetween(c.delivery.min, c.delivery.max, rand));
  const late = immediate ? null : postLate(base0, lateChance, rand);
  const travel = base0 + (late ? late.extra : 0);
  const letter = {
    id: newId('l', now, rand),
    from: 'them',
    body: reply.body,
    ps: reply.ps,
    envelope: reply.envelope,
    enclosures: reply.enclosures,
    between: reply.between,
    theirWrittenAt: theirNow(c, now),
    theirReadAt: reply.readAt,
    writtenLabel: reply.writtenAt,
    answers: c.reply?.forLetterIds || [],
    ...(late ? { late: late.reason } : {}),
    sentAt: now,
    arriveAt: now + travel,
    state: 'in_transit',
  };
  const items = (reply.enclosures || []).map((x, i) => makeItem(letter, x.item, x.note || '', i));
  return { ...c, letters: [...c.letters, letter], items: [...c.items, ...items], reply: null };
}

// ── 생성 결과 읽기 ──

export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new Error('응답이 글이 아닙니다.');
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0) throw new Error('응답에서 JSON을 찾지 못했습니다.');
  const body = b > a ? t.slice(a, b + 1) : t.slice(a);
  try { return JSON.parse(body); } catch (e1) {
    // 흔한 고장: 글 안의 따옴표·줄바꿈을 이스케이프하지 않음, 끝 쉼표, 중간에 끊김
    try { return JSON.parse(repairJson(t.slice(a))); } catch {}
    throw new Error(`모델 응답의 JSON이 깨졌습니다(${e1.message}).`);
  }
}

// 글 안의 이스케이프 안 된 따옴표·제어 문자, 끝 쉼표, 끊긴 끝을 고친다(완벽하지 않음 — 실패하면 원래 오류)
export function repairJson(src) {
  let out = '';
  let inStr = false;
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { out += ch + (src[i + 1] ?? ''); i++; continue; }
      if (ch === '"') {
        // 다음 의미 있는 글자가 , : } ] 이거나 끝이면 문자열의 끝, 아니면 글 속 따옴표
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        const nx = src[j];
        let ends = nx === undefined || nx === ':' || nx === '}' || nx === ']';
        if (nx === ',') {
          let k = j + 1;
          while (k < src.length && /\s/.test(src[k])) k++;
          ends = k >= src.length || /["{\[\]}\-0-9tfn]/.test(src[k]);
        }
        if (ends) { inStr = false; out += ch; } else out += '\\"';
        continue;
      }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
    out += ch;
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const cleanList = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).map(fn).filter(Boolean) : []);

export function cleanReply(raw) {
  const body = str(raw?.body, 20000).trim();
  if (!body) throw new Error('답장 본문이 비어 있습니다.');
  const e = raw?.envelope || {};
  return {
    body,
    ps: str(raw?.ps, 2000).trim(),
    readAt: str(raw?.read_at, 200),
    writtenAt: str(raw?.written_at, 200),
    envelope: {
      medium: str(e.medium, 200), texture: str(e.texture, 500), scent: str(e.scent, 500),
      marks: str(e.marks, 500), seal: str(e.seal, 500), stamp: str(e.stamp, 500),
    },
    enclosures: cleanList(raw?.enclosures, 5, (x) => (str(x?.item, 200) ? { item: str(x.item, 200), note: str(x?.note, 500) } : null)),
    between: cleanList(raw?.between, 30, (x) => (str(x?.event, 1000) ? { when: str(x?.their_date, 200), event: str(x.event, 1000), senses: str(x?.senses, 500), open: !!x?.open } : null)),
  };
}

// ── 프롬프트 ──

const letterText = (l, c) => {
  if (l.from === 'me') {
    const head = `[{{user}} → ${c.name}] 보낸 날(그쪽 기준) ${theirLabel(c, l.theirSentAt)} / 도착 ${theirLabel(c, l.theirArriveAt)}`;
    const enc = l.enclosures?.length ? l.enclosures.map((x) => x.item).join(', ') : l.enclosure;
    return `${head}${l.late ? ` (배달이 늦었다: ${l.late})` : ''}\n${l.body}${enc ? `\n(동봉: ${enc})` : ''}${l.photos?.length ? `\n(「사진 — …」은 {{user}}의 세계에서 찍은 사진 — 그쪽 세계에는 낯선 물건일 수 있다. 무엇이 찍혔는지는 설명만큼만 안다)` : ''}`;
  }
  const head = `[${c.name} → {{user}}] 쓴 날 ${theirLabel(c, l.theirWrittenAt)}`;
  return `${head}\n${l.body}${l.ps ? `\n추신: ${l.ps}` : ''}${l.enclosures?.length ? `\n(동봉: ${l.enclosures.map((x) => x.item).join(', ')})` : ''}`;
};

// 묘사 문체 → 지시문
export const PROSE_STYLES = { plain: '담백하게', aesthetic: '탐미적으로', lyrical: '서정적으로', record: '건조한 기록체로' };
export function proseRule(style = 'plain') {
  const m = {
    plain: 'Style: plain and precise. Short clear sentences, concrete visible details, no flourish.',
    aesthetic: 'Style: aesthetic and sensuous. Linger on texture, light, color and material; rich but controlled imagery.',
    lyrical: 'Style: lyrical and gentle, like a diary note. Soft images and feelings, still concrete.',
    record: 'Style: a dry archivist\'s record. Factual, itemized feel, measured and exact, no emotion words.',
  };
  return m[style] || `Style (as the reader asked, in Korean): ${String(style).slice(0, 300)}`;
}

// 현실 날짜·시각(상대가 고른 시간대, 없으면 서울)
export function realNowLabel(now = Date.now(), tz = '') {
  const fmt = (zone) => new Date(now).toLocaleString('ko-KR', { timeZone: zone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  try { return `${fmt(tz || 'Asia/Seoul')} (${tz || 'Asia/Seoul'})`; } catch { return `${fmt('Asia/Seoul')} (Asia/Seoul)`; }
}

export function letterLengthRule(min = 1000, max = 0) {
  if (!min && !max) return 'Length: whatever fits the moment and the character.';
  if (min && max) return `Length of \`body\`: about ${min}~${Math.max(min, max)} Korean characters. Stay in that range.`;
  if (max) return `Length of \`body\`: at most about ${max} Korean characters; short letters are fine.`;
  return `Length of \`body\`: at least about ${min} Korean characters; write longer when much happened or feelings run high.`;
}

export function buildReplyMessages(c, { now = Date.now(), personaName = '', recent = RECENT_LETTERS, lore = '', memory = null, letterMin = 1000, letterMax = 0 } = {}) {
  c = normalize(c);
  const userName = (c.noPersona ? '' : personaName || c.personaName) || '편지의 주인';
  const realNow = c.noPersona ? realNowLabel(now, c.userTz) : '';
  const gifts = c.items.filter((x) => x.state === 'arrived').slice(-12)
    .map((x) => `${x.from === 'me' ? '{{user}} → you' : 'you → {{user}}'}: ${x.name}${x.note ? ` (${x.note})` : ''}`);
  const answered = new Set(c.reply?.forLetterIds || []);
  const unanswered = c.letters.filter((l) => l.from === 'me' && answered.has(l.id));
  const firstArrival = unanswered.length ? Math.min(...unanswered.map((l) => l.theirArriveAt)) : theirNow(c, now);
  const lastTheirs = [...c.letters].reverse().find((l) => l.from === 'them');
  const tNow = theirNow(c, now);
  const pastLetters = c.letters.filter((l) => !(l.from === 'me' && l.state === 'in_transit'));
  const shown = pastLetters.slice(-recent);
  const omitted = pastLetters.length - shown.length;

  const system = [
    '<system>',
    `You are ${c.name}, living in another world, writing a letter by hand to {{user}}.`,
    'This is correspondence, not chat. You never see {{user}}; you only know what their letters said.',
    'Write only as yourself. Never decide {{user}}\'s actions, feelings, or replies.',
    '</system>',
    '',
    '<character>',
    c.brief,
    '</character>',
    c.world || lore ? `\n<world>\n${[c.world, lore].filter(Boolean).join('\n\n')}\n</world>` : '',
    c.mail?.medium ? `\n<your_letters>\nmedium=${c.mail.medium}${c.mail.texture ? `\ntexture=${c.mail.texture}` : ''}${c.mail.scent ? `\nscent=${c.mail.scent}` : ''}${c.mail.seal ? `\nseal=${c.mail.seal}` : ''}${c.mail.stampMotif ? `\nstamp=${c.mail.stampMotif}` : ''}\n(keep these unless events change them)\n</your_letters>` : '',
    '',
    '<correspondence>',
    `their_now=${theirLabel(c, tNow)}`,
    `days_since_first_contact=${Math.floor(tNow / (c.calendar?.dayHours || 24)) + 1}${c.calendar?.dayHours && c.calendar.dayHours !== 24 ? ` (a day in your world is ${c.calendar.dayHours} hours)` : ''}`,
    `ratio=1:${c.ratio} (your time / {{user}}'s time; ${c.ratio > 1 ? `one day for {{user}} is ${formatSpan(24 * c.ratio)} for you` : c.ratio < 1 ? `one day for {{user}} is only ${formatSpan(24 * c.ratio)} for you` : 'same speed'})`,
    `letters_arrived=${unanswered.length}통, first arrived ${theirLabel(c, firstArrival)}`,
    `time_since_arrival=${formatSpan(tNow - firstArrival)} (everything in \`between\` happened within this span)`,
    c.reply?.initiative ? `initiative=yes: {{user}} has not written back since your last letter. You are writing again on your own, ${formatSpan(tNow - (lastTheirs?.theirWrittenAt || 0))} after your last letter (your time).` : '',
    lastTheirs ? `since_your_last_letter=${formatSpan(tNow - lastTheirs.theirWrittenAt)} (exactly; do not exaggerate)` : 'first_reply=yes (this is your first letter to {{user}})',
    gifts.length ? `gifts_exchanged=\n${gifts.map((g) => `- ${g}`).join('\n')}` : '',
    c.noPersona
      ? `knows_about_user=only what their letters said. {{user}} is an ordinary person living in the real world (Earth, the present day), writing as themselves. No name was given: use a name only if their letters signed one, otherwise address them without a name.`
      : `knows_about_user=only what their letters said; their name is ${userName}`,
    realNow ? `user_side_now=${realNow} (real calendar and clock on {{user}}'s side; use only if it matters, e.g. their season or time of day)` : '',
    memory?.ledger ? `\n<relationship>\n${memory.ledger}\n</relationship>` : '',
    omitted > 0 ? `older_letters_omitted=${omitted}통 (not shown here${memory?.summaries || memory?.chapters ? '; see <history>' : ''})` : '',
    '</correspondence>',
    memory?.chapters || memory?.summaries ? `\n<history>\n${[memory.chapters && `chapters=\n${memory.chapters}`, memory.summaries && `earlier_letters=\n${memory.summaries}`].filter(Boolean).join('\n')}\n</history>` : '',
    memory?.timeline ? `\n<your_life>\n${memory.timeline}\n</your_life>` : '',
    memory?.recall ? `\n<recall>\nPassages from older letters that relate to {{user}}'s latest letter:\n${memory.recall}\n</recall>` : '',
    '',
    '<task>',
    '1. First write `between`: what happened to you from receiving the letter until finishing this reply, in your own time. Scale detail to the elapsed time; summarize long spans coarsely. Include at least one sensory detail per event.',
    '2. Then write the letter. Let only some of `between` show through, the way people actually write letters: hints, omissions, a shaky hand.',
    c.reply?.initiative
      ? '3. {{user}} has not replied. Write because you want to: share what happened, wonder about them, or keep a promise — in a way that fits your character and the relationship (pride, worry, teasing, restraint). Do not invent anything {{user}} said.'
      : '3. Respond to what {{user}} actually wrote. Answer or deliberately avoid their questions.',
    '4. The letter must feel like a physical object from your world: describe `envelope` in concrete sensory terms.',
    '   Enclosures are occasional, not a habit: include one only when there is a real reason (a promise, an answer to something {{user}} sent, an event, a gift that means something). Most letters have none (`enclosures`: []). Never more than 2.',
    '5. Stay consistent with the character and world above. New facts are allowed when they follow from events.',
    `6. Time is fixed by <correspondence>. \`read_at\`, \`written_at\`, and every \`their_date\` must fall between the first arrival and their_now, written in the same form as their_now ("${theirLabel(c, tNow)}"). When mentioning how long you waited or how many days passed, use only those numbers.`,
    `7. ${letterLengthRule(letterMin, letterMax)}`,
    'Output JSON only, in Korean, with this shape:',
    '{"between":[{"their_date":"","event":"","senses":"","open":false}],"read_at":"","written_at":"","envelope":{"medium":"","texture":"","scent":"","marks":"","seal":"","stamp":""},"enclosures":[{"item":"","note":""}],"body":"","ps":""}',
    '</task>',
  ].filter((x) => x !== '').join('\n').replaceAll('{{user}}', userName).replaceAll('{{char}}', c.name);

  const history = shown.map((l) => letterText(l, c)).join('\n\n---\n\n').replaceAll('{{user}}', userName);
  const user = `<letters>\n${history || '(아직 편지 없음)'}\n</letters>\n\n위 편지에 답장을 쓴다. JSON만 출력.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ── 화면용 요약 ──

export function summarize(c, now = Date.now()) {
  const unread = c.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length;
  const inTransit = c.letters.filter((l) => l.state === 'in_transit').length;
  const lastLetter = c.letters[c.letters.length - 1] || null;
  const lastThem = [...c.letters].reverse().find((l) => l.from === 'them');
  const lastMine = [...c.letters].reverse().find((l) => l.from === 'me');
  const tNow = theirNow(c, now);
  let status = '아직 편지가 없습니다';
  if (c.reply?.state === 'failed') status = '우편 사고 — 답장을 만들지 못했습니다';
  else if (c.reply) status = '답장을 쓰는 중인 듯합니다';
  else if (lastMine && lastMine.state === 'in_transit') status = '편지가 가는 중';
  else if (lastLetter?.from === 'them' && lastLetter.state === 'in_transit') status = '답장이 오는 중';
  else if (lastThem && (!lastMine || lastMine.sentAt < lastThem.sentAt)) status = `그쪽은 ${formatSpan(tNow - lastThem.theirWrittenAt)}째 내 답장을 기다리는 중`;
  return {
    id: c.id, name: c.name, ratio: c.ratio, theirNow: theirLabel(c, tNow),
    personaId: c.personaId || '', personaName: c.personaName || '', noPersona: !!c.noPersona,
    items: (c.items || []).filter((x) => x.state === 'arrived').length,
    unread, inTransit, status, failed: c.reply?.state === 'failed', error: c.reply?.error || '',
    lastAt: lastLetter ? lastLetter.sentAt : c.createdAt,
  };
}

// 상대에게 보이지 않는 정보(생성 전 답장, 배송 중 답장의 본문)를 가린 사본
export function publicView(c, now = Date.now()) {
  c = normalize(c);
  const letterOf = new Map(c.letters.map((l) => [l.id, l]));
  return {
    ...c,
    items: c.items.filter((x) => !(x.from === 'them' && x.state === 'in_transit')).map((x) => {
      const l = letterOf.get(x.letterId);
      return { ...x, theirLabel: l ? theirLabel(c, l.from === 'me' ? l.theirSentAt : l.theirWrittenAt) : '' };
    }),
    theirNowLabel: theirLabel(c, theirNow(c, now)),
    letters: c.letters.map((l) => {
      if (l.from === 'them' && l.state === 'in_transit') return { id: l.id, from: 'them', state: 'in_transit', sentAt: l.sentAt, arriveAt: l.arriveAt };
      if (l.from === 'them') {
        const { between, ...rest } = l; // 사이 일지는 상대의 사정 — 화면에는 내지 않는다(3단계 연대기에서 일부 공개)
        return { ...rest, theirWrittenLabel: theirLabel(c, l.theirWrittenAt) };
      }
      return { ...l, theirSentLabel: theirLabel(c, l.theirSentAt), theirArriveLabel: theirLabel(c, l.theirArriveAt) };
    }),
  };
}

export function etaLabel(ms, exact) {
  if (ms <= 0) return '곧 도착';
  const h = ms / HOUR;
  if (exact) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `도착까지 ${hh ? `${hh}시간 ` : ''}${mm}분`;
  }
  if (h < 1) return '거의 다 왔습니다';
  if (h < 3) return '도착까지 두어 시간';
  return `도착까지 약 ${Math.round(h)}시간`;
}

// 편지지 꾸미기(그림 대신 HTML·SVG): 상대마다 테마(종이색·잉크·결·가장자리·글꼴·장식 무늬)를 정하고 화면·HTML 저장에 같이 쓴다. 부수 효과 없음.

export const PAPER_FONTS = {
  myeongjo: { family: 'Nanum Myeongjo', label: '나눔명조 (단정한 명조)', size: 1, google: 'Nanum+Myeongjo:wght@400;700' },
  gowun: { family: 'Gowun Batang', label: '고운바탕 (부드러운 바탕)', size: 1, google: 'Gowun+Batang:wght@400;700' },
  hahmlet: { family: 'Hahmlet', label: '함렡 (고전 활자)', size: 1, google: 'Hahmlet:wght@400;600' },
  songmyung: { family: 'Song Myung', label: '송명 (옛 인쇄체)', size: 1.02, google: 'Song+Myung' },
  pen: { family: 'Nanum Pen Script', label: '나눔손글씨 펜 (빠른 손글씨)', size: 1.32, google: 'Nanum+Pen+Script' },
  brush: { family: 'Nanum Brush Script', label: '나눔손글씨 붓 (굵은 붓)', size: 1.3, google: 'Nanum+Brush+Script' },
  gaegu: { family: 'Gaegu', label: '개구 (둥근 손글씨)', size: 1.12, google: 'Gaegu:wght@400;700' },
  dokdo: { family: 'East Sea Dokdo', label: '동해독도 (거친 손글씨)', size: 1.45, google: 'East+Sea+Dokdo' },
  himelody: { family: 'Hi Melody', label: '하이멜로디 (가벼운 손글씨)', size: 1.22, google: 'Hi+Melody' },
  poor: { family: 'Poor Story', label: '푸어스토리 (삐뚤한 손글씨)', size: 1.12, google: 'Poor+Story' },
  yeonsung: { family: 'Yeon Sung', label: '연성 (단단한 손글씨)', size: 1.15, google: 'Yeon+Sung' },
  gamja: { family: 'Gamja Flower', label: '감자꽃 (동글한 손글씨)', size: 1.2, google: 'Gamja+Flower' },
};
export const PAPER_FONT_URL = `https://fonts.googleapis.com/css2?${Object.values(PAPER_FONTS).map((f) => `family=${f.google}`).join('&')}&display=swap`;

// 24×24 선 무늬
export const PAPER_MOTIFS = {
  leaf: 'M4 20C4 10 10 4 20 4C20 14 14 20 4 20Z M4 20L14 10',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  wave: 'M2 10c3-4 6-4 9 0s6 4 9 0 M2 16c3-4 6-4 9 0s6 4 9 0',
  gear: 'M12 8a4 4 0 1 0 .01 0 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  snow: 'M12 2v20 M3.3 7l17.4 10 M3.3 17l17.4-10 M9 3.5l3 2 3-2 M9 20.5l3-2 3 2',
  vine: 'M2 16c5 0 6-8 10-8s5 8 10 8 M8 11c-1-3 1-5 3-5 M16 11c1-3-1-5-3-5',
  rune: 'M8 3v18 M8 4l8 6-8 6 M16 14v7',
  feather: 'M20 4C10 4 5 10 4 20 M20 4c0 8-6 13-14 14 M9 15l6-1 M11 11l6-1',
  scale: 'M2 12a5 5 0 0 1 10 0a5 5 0 0 1 10 0 M7 18a5 5 0 0 1 10 0',
  flower: 'M12 9a3 3 0 1 0 .01 0 M12 3c2 2 2 4 0 6c-2-2-2-4 0-6 M12 15c2 2 2 4 0 6c-2-2-2-4 0-6 M3 12c2-2 4-2 6 0c-2 2-4 2-6 0 M15 12c2-2 4-2 6 0c-2 2-4 2-6 0',
  moon: 'M15 3a9 9 0 1 0 6 13a7 7 0 1 1-6-13Z',
  shell: 'M12 20L3 9c3-4 15-4 18 0Z M12 20L8 7 M12 20V6 M12 20l4-13',
  flame: 'M12 21c-4 0-6-3-6-6 0-4 4-6 4-10 3 2 4 5 4 7 1-1 2-2 2-4 2 2 2 4 2 7 0 3-2 6-6 6Z',
  key: 'M7 9a3 3 0 1 0 .01 0 M10 12h11 M17 12v3 M20 12v2',
};
export const PAPER_MOTIF_LABEL = {
  leaf: '잎', star: '별', wave: '물결', gear: '톱니바퀴', snow: '눈꽃', vine: '덩굴', rune: '룬 문자', feather: '깃털',
  scale: '비늘', flower: '꽃', moon: '달', shell: '조개', flame: '불꽃', key: '열쇠',
};
export const PAPER_TEXTURES = { lined: '줄', grid: '모눈', parchment: '양피지 얼룩', fiber: '섬유 결', dots: '점', plain: '민무늬' };
export const PAPER_EDGES = { straight: '곧은 가장자리', deckle: '손으로 뜬 종이(울퉁불퉁)', torn: '찢어 낸 가장자리', stitched: '바느질 테두리' };

const hexOk = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : '');
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PALETTES = [
  ['#f4ead6', '#3b2f22', '#8a5a2b'], ['#eef1e6', '#24331f', '#5f7d3a'], ['#f3ede4', '#2d2a3a', '#6b4e8a'], ['#e9eef3', '#1f2e3d', '#3d6c8f'],
  ['#f6e9e4', '#3a2420', '#a0473b'], ['#efe6cf', '#2f2a1d', '#8b7330'], ['#2a2630', '#ece2cf', '#c9a45a'], ['#f2f0ea', '#262626', '#7a7a7a'],
];
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// 글 생성 전에도 보기 좋게: 상대 id로 고정된 기본 테마
export function defaultTheme(c) {
  const h = hashStr(c?.id || c?.name || 'x');
  const pal = PALETTES[h % PALETTES.length];
  const pick = (obj, k) => Object.keys(obj)[(h >>> k) % Object.keys(obj).length];
  return { paper: pal[0], ink: pal[1], accent: pal[2], texture: pick(PAPER_TEXTURES, 3), edge: pick(PAPER_EDGES, 7), font: pick(PAPER_FONTS, 11), motif: pick(PAPER_MOTIFS, 15), density: 2, note: '', auto: true };
}

export function cleanTheme(t, fallback = null) {
  const f = fallback || defaultTheme({});
  const paper = hexOk(t?.paper) || f.paper;
  let ink = hexOk(t?.ink) || f.ink;
  if (contrast(paper, ink) < 4.5) ink = lum(paper) > 0.4 ? '#2b2420' : '#f1e9da'; // 글씨가 안 읽히면 바꿈
  const accent = hexOk(t?.accent) || f.accent;
  const one = (v, obj, d) => (typeof v === 'string' && Object.hasOwn(obj, v) ? v : d);
  const dn = Math.round(Number(t?.density));
  return {
    paper, ink, accent,
    texture: one(t?.texture, PAPER_TEXTURES, f.texture),
    edge: one(t?.edge, PAPER_EDGES, f.edge),
    font: one(t?.font, PAPER_FONTS, f.font),
    motif: one(t?.motif, PAPER_MOTIFS, f.motif),
    density: Number.isFinite(dn) ? Math.min(3, Math.max(1, dn)) : 2,
    note: typeof t?.note === 'string' ? t.note.trim().slice(0, 200) : '',
    ...(t?.auto ? { auto: true } : {}),
  };
}

// 글 생성 1회로 테마를 고른다(사건이 있으면 이전 테마에서 조금 바꿈)
export function buildThemeMessages(c, { reason = '', prev = null } = {}) {
  const m = c.mail || {};
  const system = [
    'You design the stationery of a correspondent from another world, as data for an HTML letter page (no image).',
    'Pick values that fit their world, letter medium and personality. Colors are hex; ink must be easy to read on paper.',
    `font (handwriting/typeface of their letters): ${Object.entries(PAPER_FONTS).map(([k, v]) => `${k}=${v.label}`).join(', ')}`,
    `texture: ${Object.keys(PAPER_TEXTURES).join(' / ')}; edge: ${Object.keys(PAPER_EDGES).join(' / ')}`,
    `motif (border ornament): ${Object.keys(PAPER_MOTIFS).join(' / ')}; density 1 (sparse) ~ 3 (rich)`,
    'note: one short Korean phrase describing the stationery.',
  ].join('\n');
  const user = [
    `<correspondent name="${c.name}">`,
    String(c.brief || '').slice(0, 1500),
    '</correspondent>',
    `letter medium=${m.medium || '-'}; texture=${m.texture || '-'}; scent=${m.scent || '-'}; seal=${m.seal || '-'}`,
    m.imageKeywords?.length ? `world keywords=${m.imageKeywords.join(', ')}` : '',
    prev ? `current stationery=${JSON.stringify(prev)}` : '',
    reason ? `Something happened, so this letter's stationery changes: ${reason}. Change only what the event would change (1~3 values).` : '',
    'Output JSON only: {"paper":"#","ink":"#","accent":"#","texture":"","edge":"","font":"","motif":"","density":2,"note":""}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// ── 그리기(화면·HTML 저장 공용): 스타일 글과 SVG 문자열 ──
const enc = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const motifSvg = (t, size, opacity) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-6 -6 36 36"><path d="${PAPER_MOTIFS[t.motif]}" fill="none" stroke="${t.accent}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/></svg>`;
const TEXTURE_CSS = (t) => ({
  lined: `repeating-linear-gradient(transparent 0 27px, ${t.ink}22 27px 28px, transparent 28px 30px)`,
  grid: `repeating-linear-gradient(transparent 0 23px, ${t.ink}1a 23px 24px), repeating-linear-gradient(90deg, transparent 0 23px, ${t.ink}1a 23px 24px)`,
  parchment: `radial-gradient(circle at 18% 22%, ${t.ink}12, transparent 38%), radial-gradient(circle at 82% 68%, ${t.ink}10, transparent 42%), radial-gradient(circle at 55% 95%, ${t.accent}14, transparent 35%)`,
  fiber: `repeating-linear-gradient(37deg, transparent 0 3px, ${t.ink}08 3px 4px), repeating-linear-gradient(-53deg, transparent 0 5px, ${t.ink}06 5px 6px)`,
  dots: `radial-gradient(${t.ink}26 1px, transparent 1.3px) 0 0 / 18px 18px`,
  plain: 'none',
}[t.texture]);
// 가장자리: 정해진 씨앗으로 울퉁불퉁한 다각형(매번 같은 모양)
function edgePath(t, seed) {
  if (t.edge !== 'deckle' && t.edge !== 'torn') return '';
  let s = hashStr(seed) || 1;
  const r = () => { s = (s * 1103515245 + 12345) >>> 0; return (s % 1000) / 1000; };
  const amp = t.edge === 'torn' ? 1.4 : 0.6;
  const pts = [];
  const N = 28;
  for (let i = 0; i <= N; i++) pts.push(`${(i / N) * 100}% ${(r() * amp).toFixed(2)}%`);
  for (let i = 1; i <= N; i++) pts.push(`${100 - (r() * amp * 0.6).toFixed(2)}% ${(i / N) * 100}%`);
  for (let i = N - 1; i >= 0; i--) pts.push(`${(i / N) * 100}% ${(100 - r() * amp).toFixed(2)}%`);
  for (let i = N - 1; i >= 1; i--) pts.push(`${(r() * amp * 0.6).toFixed(2)}% ${(i / N) * 100}%`);
  return `polygon(${pts.join(',')})`;
}
export function paperLook(theme, { seed = '', narrow = false } = {}) {
  const t = cleanTheme(theme);
  const f = PAPER_FONTS[t.font];
  const band = narrow ? 18 : [0, 20, 28, 36][t.density];
  const tile = [0, 40, 30, 24][t.density];
  const clip = edgePath(t, seed);
  const outer = [
    `background:${t.paper} ${enc(motifSvg(t, tile, 0.55))} repeat`,
    `background-size:${tile}px ${tile}px`,
    `padding:${band}px`,
    'position:relative',
    clip ? `clip-path:${clip}` : '',
    t.edge === 'stitched' ? `outline:2px dashed ${t.accent}99;outline-offset:-7px` : '',
    `box-shadow:0 10px 22px -12px #0008`,
    'margin:4px 0 14px',
  ].filter(Boolean).join(';');
  const inner = [
    `background-color:${t.paper}`,
    `background-image:${TEXTURE_CSS(t)}`,
    `color:${t.ink}`,
    `font-family:"${f.family}","Nanum Myeongjo","Noto Serif KR",Georgia,serif`,
    `font-size:${(14.5 * f.size).toFixed(1)}px`,
    // 줄·모눈 종이는 글줄을 줄 간격(30px·24px)에 맞춘다
    t.texture === 'lined' ? 'line-height:30px' : t.texture === 'grid' ? 'line-height:24px' : `line-height:${f.size > 1.1 ? 1.75 : 1.95}`,
    `border:1px solid ${t.accent}55`,
    `padding:${narrow ? '14px 12px' : '22px 24px 18px'}`,
    'white-space:pre-wrap',
    'position:relative',
  ].join(';');
  const corner = (rot) => `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="-6 -6 36 36" style="position:absolute;${rot}"><path d="${PAPER_MOTIFS[t.motif]}" fill="${t.accent}22" stroke="${t.accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const corners = narrow ? '' : [corner('top:4px;left:4px'), corner('top:4px;right:4px;transform:scaleX(-1)'), corner('bottom:4px;left:4px;transform:scaleY(-1)'), corner('bottom:4px;right:4px;transform:scale(-1,-1)')].join('');
  return { theme: t, outer, inner, corners, metaColor: `${t.ink}aa`, accent: t.accent };
}


// 편지첩 HTML(한 장짜리 책): 표지 → 차례 → 편지 → 기록부 → 모음 → 이어진 일들. 그림은 img(id, size)가 준 주소를 쓰고, 누르면 크게.
// 부수 효과 없음 — 그림 주소는 호출하는 쪽이 data URL로 바꿔 넣는다.
const exEsc = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const exDt = (ms, withTime = false) => (ms ? new Date(ms).toLocaleString('ko-KR', withTime ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export function buildLettersHtml(c, { img = () => '', myFaceId = '', myName = '', now = Date.now(), htmlPaper = true, me = null, myFont = '' } = {}) {
  const mf = PAPER_FONTS[myFont];
  const myStyle = mf ? ` style="font-family:'${mf.family}','Nanum Myeongjo',serif;font-size:${(15.5 * mf.size).toFixed(1)}px"` : '';
  const letters = (c.letters || []).filter((l) => !(l.from === 'them' && l.state === 'in_transit'));
  const itemsOf = (l) => (c.items || []).filter((x) => x.letterId === l.id && x.imageId);
  const pic = (id, size, alt, cls = '') => (id && img(id, size) ? `<img class="${cls}" src="${img(id, size)}" alt="${exEsc(alt)}" data-zoom="${exEsc(alt)}" loading="lazy">` : '');
  const envId = (l) => l.art?.envelope || c.art?.envelope?.imageId || '';
  const theirTitle = (l) => l.writtenLabel || l.theirWrittenLabel || '';
  const reports = c.reports || [];
  const rep = reports.at(-1);

  // ── 편지 ──
  const letterHtml = letters.map((l) => {
    const mine = l.from === 'me';
    const unread = !mine && l.state === 'delivered';
    const thumbs = unread ? '' : itemsOf(l).map((x) => `<figure class="thumb">${pic(x.imageId, 'lg', x.name)}<figcaption>${exEsc(x.name)}</figcaption></figure>`).join('');
    const enc = unread ? '' : (l.enclosures || []).map((x) => `<li>${exEsc(x.item)}${x.note ? ` — ${exEsc(x.note)}` : ''}</li>`).join('');
    const text = unread ? '<p class="unread">아직 열지 않은 편지</p>' : `<div class="text">${exEsc(l.body + (l.ps ? `\n\n추신. ${l.ps}` : ''))}</div>`;
    const divider = `<div class="divider"><span>${exEsc(exDt(mine ? l.sentAt : l.arriveAt))}${mine ? (l.theirArriveLabel ? ` · 그쪽 ${exEsc(l.theirArriveLabel)} 도착` : '') : (theirTitle(l) ? ` · 그쪽 ${exEsc(theirTitle(l))}` : '')}</span></div>`;
    if (mine) {
      return `${divider}<article class="letter mine"${myStyle}>${myFaceId ? pic(myFaceId, 'sm', '나', 'face') : ''}<div class="meta">${exEsc(l.personaName || myName || '나')}의 편지${l.late ? ` · 늦게 닿음(${exEsc(l.late)})` : ''}</div>${text}${enc ? `<ul class="encl">${enc}</ul>` : ''}${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}</article>`;
    }
    const e = l.envelope || {};
    const env = envId(l) ? `<details class="env"><summary>✉ 봉투 보기</summary>${pic(envId(l), 'lg', `${c.name}의 봉투`, 'envimg')}</details>` : '';
    const meta = `<div class="meta">${exEsc([`${c.name}의 편지`, e.medium, e.scent].filter(Boolean).join(' · '))}</div>`;
    const notes = [l.artNote && `✦ ${exEsc(l.artNote)}`, l.late && `✦ 우체부가 늦었다 — ${exEsc(l.late)}`, l.editedAt && '(고친 편지)'].filter(Boolean).map((x) => `<div class="note">${x}</div>`).join('');
    if (htmlPaper && !l.art?.paper) {
      const look = paperLook(l.theme || c.paperTheme || defaultTheme(c), { seed: l.id });
      return `${divider}${env}<article class="letter theirs themed" style="${exEsc(look.outer)}"><span class="corners">${look.corners}</span><div style="${exEsc(look.inner)}"><div class="meta" style="color:${look.metaColor}">${exEsc([`${c.name}의 편지`, e.medium, e.scent].filter(Boolean).join(' · '))}</div>${text}${enc ? `<ul class="encl" style="border-color:${look.accent}88">${enc}</ul>` : ''}${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}${notes}</div></article>`;
    }
    return `${divider}${env}<article class="letter theirs plain">${meta}${text}${enc ? `<ul class="encl">${enc}</ul>` : ''}${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}${notes}</article>`;
  }).join('\n');

  // ── 기록부 ──
  const voices = (r) => r.voices.map((v) => (v.hidden
    ? `<details class="voice secret"><summary>가려진 소문 — 눌러서 듣기</summary><p>“${exEsc(v.says)}”</p><div class="who">— ${exEsc(v.who)}${v.relation ? `, ${exEsc(v.relation)}` : ''}</div></details>`
    : `<div class="voice"><p>“${exEsc(v.says)}”</p><div class="who">— ${exEsc(v.who)}${v.relation ? `, ${exEsc(v.relation)}` : ''}</div></div>`)).join('');
  const reportHtml = rep ? `
<div class="record"><div class="rdate">${exEsc(exDt(rep.at))}의 기록</div>${rep.changed ? `<div class="changed">지난 기록 뒤로 — ${exEsc(rep.changed)}</div>` : ''}<div class="rnote">${exEsc(rep.note)}</div></div>
${rep.facts.length ? `<h3>알려진 것</h3><dl class="facts">${rep.facts.map((f) => `<dt>${exEsc(f.label)}</dt><dd>${exEsc(f.value)}</dd>`).join('')}</dl>` : ''}
${rep.voices.length ? `<h3>그쪽 사람들이 하는 말</h3><div class="voices">${voices(rep)}</div>` : ''}
${reports.length > 1 ? `<h3>지난 기록</h3>${reports.slice(0, -1).reverse().map((r) => `<details class="old"><summary>${exEsc(exDt(r.at))} · 「${exEsc(r.title)}」</summary><div class="rnote">${exEsc(r.note)}</div></details>`).join('')}` : ''}` : '<p class="empty">아직 받은 기록부가 없어요.</p>';

  // ── 모음 ──
  const fig = (id, cap, sub = '', cls = '') => (id && img(id, 'lg') ? `<figure class="${cls}">${pic(id, 'lg', cap)}<figcaption><b>${exEsc(cap)}</b>${sub ? `<small>${exEsc(sub)}</small>` : ''}</figcaption></figure>` : '');
  const portraits = [...(c.art?.portrait ? [{ ...c.art.portrait, now: true }] : []), ...[...(c.art?.portraitHistory || [])].reverse()];
  const drawn = (c.items || []).filter((x) => x.imageId && (x.nai || x.photo) && x.state !== 'in_transit');
  const things = (c.items || []).filter((x) => x.imageId && !x.nai && !x.photo && x.state !== 'in_transit');
  const envs = letters.filter((l) => l.from === 'them' && envId(l) && l.state !== 'delivered');
  const block = (title, inner) => (inner ? `<h3>${title}</h3>${inner}` : '');
  const albumHtml = [
    c.art?.locker?.imageId ? `<div class="box">${pic(c.art.locker.imageId, 'lg', '추억 상자')}</div>` : '',
    block(`초상화 · ${portraits.length}`, portraits.length ? `<div class="grid tall">${portraits.map((p) => fig(p.imageId, p.now ? '지금 모습' : '예전 모습', exDt(p.at))).join('')}</div>` : ''),
    block(`그림·사진 · ${drawn.length}`, drawn.length ? `<div class="grid">${drawn.map((x) => fig(x.imageId, x.name, x.from === 'me' ? '내가 보냄' : `${c.name}이(가) 보냄`)).join('')}</div>` : ''),
    block(`봉투 · ${envs.length}`, envs.length ? `<div class="grid wide">${envs.map((l) => fig(envId(l), theirTitle(l) || exDt(l.arriveAt))).join('')}</div>` : ''),
    block(`물건 · ${things.length}`, things.length ? `<div class="grid">${things.map((x) => fig(x.imageId, x.name, [x.note, x.from === 'me' ? '내가 보냄' : `${c.name}이(가) 보냄`].filter(Boolean).join(' · '))).join('')}</div>` : ''),
  ].join('\n');

  // ── 이어진 일들 ──
  const tl = letters.map((l) => ({ t: l.from === 'me' ? l.sentAt : l.arriveAt, cls: l.from === 'me' ? 'me' : 'them', text: l.from === 'me' ? '내가 편지를 보냄' : `${c.name}의 편지가 닿음${l.enclosures?.length ? ` · 동봉 ${l.enclosures.map((x) => x.item).join(', ')}` : ''}`, when: l.from === 'me' ? l.theirSentLabel : theirTitle(l) }));
  const ev = (c.memory?.timeline || []);
  const tlHtml = `<ol class="tl">${tl.map((x) => `<li class="${x.cls}"><span class="when">${exEsc(exDt(x.t))}${x.when ? ` · 그쪽 ${exEsc(x.when)}` : ''}</span>${exEsc(x.text)}</li>`).join('')}</ol>
${ev.length ? `<h3>그쪽 연대기</h3><ol class="tl">${ev.map((e) => (e.open ? `<li class="event"><span class="when">${exEsc(e.when || '')}</span>${exEsc(e.event)}</li>` : `<li class="secret"><span class="when">${exEsc(e.when || '')}</span><details><summary>편지에 쓰지 않은 그쪽의 일</summary>${exEsc(e.event)}</details></li>`)).join('')}</ol>` : ''}`;

  // ── 나(페르소나) ──
  const meHtml = (() => {
    if (!me && !myFaceId && !myName) return '';
    const hist = (me?.history || []).slice().reverse();
    const faceBig = me?.portraitId || myFaceId;
    return `<div class="mebox">
${faceBig ? pic(faceBig, 'lg', `${myName || '나'} 초상화`, 'meface') : ''}
<div class="meinfo"><div class="mename">${exEsc(myName || '나')}</div>${me?.title ? `<div class="metitle">${exEsc(me.title)}</div>` : ''}${me?.noPersona ? '<div class="metitle">페르소나 없이, 이 세계의 나 자신으로</div>' : ''}
${me?.description ? `<div class="medesc">${exEsc(me.description)}</div>` : ''}
<div class="mestats">${exEsc(c.name)}에게 보낸 편지 ${letters.filter((l) => l.from === 'me').length}통 · 보낸 물건·사진 ${(c.items || []).filter((x) => x.from === 'me').length}개</div></div></div>
${hist.length ? `<h3>지난 모습 · ${hist.length}</h3><div class="grid tall">${hist.map((h) => fig(h.imageId, '예전 모습', exDt(h.at))).join('')}</div>` : ''}`;
  })();
  const first = letters[0]?.sentAt; const last = letters.at(-1)?.sentAt;
  const emb = c.art?.emblem?.imageId || c.art?.seal?.imageId;
  const sections = [['letters', '편지', letterHtml || '<p class="empty">아직 주고받은 편지가 없어요.</p>'], ['record', '기록부', reportHtml], ...(meHtml ? [['me', '나', meHtml]] : []), ['album', '모음', albumHtml || '<p class="empty">아직 모인 그림이 없어요.</p>'], ['timeline', '이어진 일들', tlHtml]];
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${exEsc(c.name)} — 이세계 편지첩</title>
<link rel="stylesheet" href="${PAPER_FONT_URL}">
<style>
*{box-sizing:border-box}
body{margin:0;background:#ebe3d3;background-image:radial-gradient(#dccfb6 1px,transparent 1px);background-size:18px 18px;color:#3b2f22;font-family:"Gowun Batang","Nanum Myeongjo","Noto Serif KR",Georgia,serif}
main{max-width:780px;margin:0 auto;padding:36px 18px 90px}
.cover{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center;background:#f7f1e4;border-radius:10px;padding:24px;box-shadow:0 14px 30px -18px #0009}
.cover .faces{position:relative;width:170px;height:200px}
.cover .portrait{position:absolute;left:0;top:0;width:140px;aspect-ratio:832/1216;object-fit:cover;border:6px solid #fff;box-shadow:0 8px 18px -10px #0008;transform:rotate(-3deg)}
.cover .emblem{position:absolute;right:0;bottom:0;width:78px;height:78px;border-radius:50%;object-fit:cover;background:#f6efe2;box-shadow:0 0 0 3px #fff,0 6px 14px -6px #0008}
h1{margin:0;font-size:32px;letter-spacing:.02em}
.ctitle{font-size:17px;margin:6px 0 10px;color:#6b4e2a}
.stats{font:13px/1.7 system-ui,sans-serif;color:#7a6a52}
.me{display:flex;align-items:center;gap:8px;margin-top:10px;font:13px system-ui,sans-serif;color:#5d6b78}
.me img{width:30px;height:30px;border-radius:50%;object-fit:cover;object-position:50% 15%}
nav{position:sticky;top:0;z-index:5;display:flex;gap:6px;justify-content:center;margin:22px 0 8px;padding:8px;background:#ebe3d3e6;backdrop-filter:blur(4px)}
nav a{font:14px system-ui,sans-serif;color:#3b2f22;text-decoration:none;padding:6px 14px;border-radius:999px;background:#fff8}
nav a:hover{background:#fff}
section{scroll-margin-top:60px}
h2{font-size:22px;margin:40px 0 14px;display:flex;align-items:center;gap:10px}
h2::after{content:"";flex:1;height:1px;background:#c9b38c}
h3{font-size:16px;margin:26px 0 10px;color:#6b4e2a}
.divider{text-align:center;margin:28px 0 10px;font:12px system-ui,sans-serif;color:#8a7458}
.divider span{background:#ebe3d3;padding:0 10px}
.letter{position:relative;white-space:normal}
.letter .text{white-space:pre-wrap}
.letter.mine,.letter.plain{background:#eef1f4;color:#26313b;border:1px solid #c5ced8;border-radius:4px;padding:20px 22px;margin-left:8%;background-image:repeating-linear-gradient(transparent 0 29px,#b8c4d055 29px 30px);line-height:30px;font-size:15.5px;box-shadow:0 10px 22px -14px #0007}
.letter.plain{background:#f4ead6;color:#3b2f22;border-color:#d6c3a0;margin:0 8% 0 0;background-image:repeating-linear-gradient(transparent 0 29px,#d9c7a455 29px 30px)}
.letter.themed{margin-right:8%}
.letter .corners{position:absolute;inset:0;pointer-events:none}
.letter .face{float:right;width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:50% 15%;margin:0 0 6px 10px;box-shadow:0 2px 6px #0004}
.meta{font:12px/1.5 system-ui,sans-serif;color:#7a6a52;margin-bottom:8px;white-space:normal}
.unread{font-style:italic;color:#8a7458}
.encl{margin:12px 0 0;padding:8px 0 0 18px;border-top:1px dashed #c9b38c;font-size:.92em}
.note{font:12px system-ui,sans-serif;color:#a8322a;margin-top:8px}
.thumbs{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}
.thumb{margin:0;width:130px;background:#fffd;padding:5px;box-shadow:0 4px 10px -6px #0008;transform:rotate(-1deg)}
.thumb:nth-child(even){transform:rotate(1.2deg)}
.thumb img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.thumb figcaption{font:11px/1.3 system-ui,sans-serif;color:#555;text-align:center;padding-top:4px}
.env{margin:0 8% 8px 0;font:13px system-ui,sans-serif;color:#6b4e2a}
.env summary{cursor:pointer}
.env .envimg{display:block;width:100%;max-width:520px;margin:8px 0;border-radius:6px;box-shadow:0 8px 20px -12px #0008}
.record{background:#f7f1e4;border-radius:6px;padding:22px 24px;box-shadow:0 10px 22px -16px #0008;background-image:repeating-linear-gradient(transparent 0 29px,#d9c7a440 29px 30px)}
.rdate{font:12px system-ui,sans-serif;color:#8a7458;margin-bottom:6px}
.changed{font-family:"Nanum Pen Script",cursive;font-size:20px;color:#a8322a;margin-bottom:6px}
.rnote{white-space:pre-wrap;font-size:15.5px;line-height:30px}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:14px}
.facts dt{color:#8a7458}.facts dd{margin:0}
.voices{display:flex;flex-direction:column;gap:10px}
.voice{background:#fff8;border-left:3px solid #c9b38c;padding:10px 14px;border-radius:0 8px 8px 0}
.voice p{margin:0;line-height:1.75}
.voice .who{font:12px system-ui,sans-serif;color:#8a7458;text-align:right;margin-top:4px}
.voice.secret{border-left-color:#7d2019}
.voice.secret summary{cursor:pointer;font-style:italic;color:#8a7458}
details.old{margin:6px 0}details.old summary{cursor:pointer;font:13px system-ui,sans-serif;color:#8a7458}
.box{max-width:380px;margin:0 auto 10px}.box img{width:100%;display:block;border-radius:12px;background:#fff;box-shadow:0 10px 24px -14px #0008}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}
.grid.wide{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.grid figure{margin:0;background:#fbf6ec;padding:7px;box-shadow:0 6px 14px -10px #0008}
.grid img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.grid.tall img{aspect-ratio:832/1216}.grid.wide img{aspect-ratio:3/2}
.grid figcaption{font:12.5px/1.45 system-ui,sans-serif;padding:6px 2px 0}.grid figcaption small{display:block;color:#8a7458}
.tl{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid #c9b38c}
.tl li{position:relative;margin:0 0 12px;font-size:14px}
.tl li::before{content:"";position:absolute;left:-25px;top:6px;width:10px;height:10px;border-radius:50%;background:#c9b38c}
.tl li.them::before{background:#8a5a2b}.tl li.me::before{background:#3d6c8f}.tl li.event::before{background:#5f7d3a}.tl li.secret::before{background:#7d2019}
.tl .when{display:block;font:11.5px system-ui,sans-serif;color:#8a7458}
.tl summary{cursor:pointer;font-style:italic;color:#8a7458}
.empty{color:#8a7458;font-style:italic}
.mebox{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:start;background:#eef1f4;border-radius:10px;padding:20px;box-shadow:0 10px 22px -16px #0008;color:#26313b}
.meface{width:150px;aspect-ratio:832/1216;object-fit:cover;border:5px solid #fff;box-shadow:0 8px 18px -10px #0008;transform:rotate(2deg)}
.mename{font-size:22px;font-weight:700}.metitle{font:13px system-ui,sans-serif;color:#5d6b78;margin:2px 0 8px}
.medesc{white-space:pre-wrap;font-size:14.5px;line-height:1.8;margin:6px 0}.mestats{font:12.5px system-ui,sans-serif;color:#5d6b78;margin-top:8px}
@media (max-width:560px){.mebox{grid-template-columns:1fr}}
img[data-zoom]{cursor:zoom-in}
#zoom{position:fixed;inset:0;background:#000c;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:9;cursor:zoom-out;padding:20px}
#zoom img{max-width:94vw;max-height:84vh;border-radius:6px}#zoom div{color:#f3ead8;font:13px system-ui,sans-serif}
footer{margin-top:60px;text-align:center;font:12px system-ui,sans-serif;color:#9a8a70}
@media (max-width:560px){.cover{grid-template-columns:1fr}.letter.mine,.letter.plain,.letter.themed,.env{margin-left:0;margin-right:0}}
@media print{nav,#zoom{display:none}body{background:#fff}.letter{break-inside:avoid}}
</style></head><body><main>
<header class="cover">
<div class="faces">${c.art?.portrait?.imageId ? pic(c.art.portrait.imageId, 'lg', `${c.name} 초상화`, 'portrait') : ''}${emb ? pic(emb, 'lg', `${c.name} 상징물`, 'emblem') : ''}</div>
<div><h1>${exEsc(c.name)}</h1>${rep ? `<div class="ctitle">「${exEsc(rep.title)}」</div>` : ''}
<div class="stats">편지 ${letters.length}통${first ? ` · ${exEsc(exDt(first))} ~ ${exEsc(exDt(last))}` : ''}<br>그쪽 시간 1:${exEsc(c.ratio)}${c.mail?.medium ? ` · 편지: ${exEsc(c.mail.medium)}` : ''}${c.theirNowLabel ? `<br>그쪽은 지금 ${exEsc(c.theirNowLabel)}` : ''}</div>
${myFaceId || myName ? `<div class="me">${myFaceId ? pic(myFaceId, 'sm', '나') : ''}<span>${exEsc(myName || '나')}의 편지 상대</span></div>` : ''}</div>
</header>
<nav>${sections.map(([k, t]) => `<a href="#${k}">${t}</a>`).join('')}</nav>
${sections.map(([k, t, h]) => `<section id="${k}"><h2>${t}</h2>${h}</section>`).join('\n')}
<footer>이세계 편지 · ${exEsc(exDt(now, true))} 저장</footer>
</main>
<div id="zoom"><img alt=""><div></div></div>
<script>
const z=document.getElementById('zoom');
document.addEventListener('click',(e)=>{const t=e.target;if(t.matches&&t.matches('img[data-zoom]')){z.querySelector('img').src=t.src;z.querySelector('div').textContent=t.dataset.zoom||'';z.style.display='flex';}else if(z.contains(t)){z.style.display='none';}});
</script>
</body></html>`;
}


// 이세계 편지 프런트
// 1) 서랍 탭: 페르소나별 상대 목록, 새 상대·수정, 편지 쓰기, 설정
// 2) 우체통 위젯(플로트, ui_panels): 새 편지면 깃발과 숫자. 누르면 보조창을 열고 닫음
// 3) 보조창(오른쪽 도크, ui_panels): 페르소나 → 상대 → 편지첩 / 물품 / 모음
// 모든 글은 textContent로만 넣는다(생성된 글에 HTML이 섞여도 실행되지 않게).

const CSS = `
.im-tab,.im-panel{display:flex;flex-direction:column;gap:12px;padding:12px;color:var(--lumiverse-text);font-size:13px;line-height:1.6;box-sizing:border-box}
.im-panel{height:100%;overflow:auto;padding:12px 14px 20px}
.im-tab h3,.im-panel h3{margin:0;font-size:15px}
.im-tab h4,.im-panel h4{margin:4px 0 0;font-size:13px}
.im-muted{color:var(--lumiverse-text-muted);font-size:12px}
.im-err{color:var(--lumiverse-danger);font-size:12px}
.im-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.im-grow{flex:1;min-width:0}
.im-tab textarea,.im-tab input,.im-tab select,.im-panel textarea,.im-panel input,.im-panel select{width:100%;box-sizing:border-box;background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,6px);padding:6px 8px;font:inherit}
.im-tab textarea,.im-panel textarea{min-height:90px;resize:vertical}
.im-tab label,.im-panel label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--lumiverse-text-muted)}
.im-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.im-btn{background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,6px);padding:5px 12px;cursor:pointer;font:inherit}
.im-btn.im-primary{background:var(--lumiverse-primary);color:#fff;border-color:transparent}
.im-btn:disabled{opacity:.5;cursor:default}
.im-link{background:none;border:none;color:var(--lumiverse-primary);cursor:pointer;padding:0;font:inherit}
.im-card{border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,8px);padding:10px 12px;background:var(--lumiverse-fill-subtle,transparent);cursor:pointer;display:flex;flex-direction:column;gap:2px}
.im-card:hover{border-color:var(--lumiverse-primary)}
.im-badge{display:inline-block;min-width:18px;padding:0 6px;border-radius:9px;background:var(--lumiverse-primary);color:#fff;font-size:11px;text-align:center}
.im-letter{border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,8px);padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.im-letter.im-mine{margin-left:18px}
.im-letter.im-theirs{margin-right:18px;cursor:pointer}
.im-chips{display:flex;gap:6px;flex-wrap:wrap}
.im-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 4px;border:1px solid var(--lumiverse-border);border-radius:999px;background:var(--lumiverse-fill);color:var(--lumiverse-text);cursor:pointer;font:inherit;font-size:12px}
.im-chip.im-on{border-color:var(--lumiverse-primary);box-shadow:0 0 0 1px var(--lumiverse-primary) inset}
.im-chip.im-plain{padding:3px 10px}
.im-ava{width:22px;height:22px;border-radius:50%;object-fit:cover;background:var(--lumiverse-fill-subtle,#8884);display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:none}
.im-tabs{display:flex;gap:2px;border-bottom:1px solid var(--lumiverse-border)}
.im-tabs button{background:none;border:none;border-bottom:2px solid transparent;color:var(--lumiverse-text-muted);padding:6px 12px;cursor:pointer;font:inherit}
.im-tabs button.im-on{color:var(--lumiverse-text);border-bottom-color:var(--lumiverse-primary)}
.im-paper{position:relative;font-family:"Nanum Myeongjo","Noto Serif KR","Batang",Georgia,serif;white-space:pre-wrap;font-size:14.5px;line-height:1.9;padding:18px 20px 16px;border-radius:4px;color:#3b2f22;background:#f4ead6;background-image:repeating-linear-gradient(transparent 0 27px,#d9c7a455 27px 28px);border:1px solid #d6c3a0;box-shadow:0 1px 0 #c9b38c,0 6px 14px -8px #0006}
.im-paper.im-has-paper{border-color:#cbb48a}
.im-paper.im-mine{color:#26313b;background:#eef1f4;background-image:repeating-linear-gradient(transparent 0 27px,#b8c4d055 27px 28px);border-color:#c5ced8;box-shadow:0 1px 0 #b8c2cc,0 6px 14px -8px #0005;margin-left:22px}
.im-paper.im-theirs{margin-right:22px}
.im-paper .im-meta{font-family:system-ui,sans-serif;font-size:11px;color:#7a6a52;white-space:normal;margin:0 54px 8px 0;line-height:1.5}
.im-paper.im-mine .im-meta{color:#5d6b78;margin-right:0}
.im-stamp{position:absolute;right:12px;top:12px;width:38px;height:46px;border:2px dashed #b08a5a;border-radius:3px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:system-ui,sans-serif;font-size:9px;line-height:1.2;color:#8a6a40;padding:2px;box-sizing:border-box;overflow:hidden;background:#efe2c6}
.im-stamp img{width:100%;height:100%;object-fit:cover}
.im-encl{font-family:system-ui,sans-serif;white-space:normal;margin-top:10px;padding-top:8px;border-top:1px dashed #c9b38c;font-size:12px;color:#6b5a40}
.im-paper.im-mine .im-encl{border-color:#b8c2cc;color:#55626e}
.im-envelope{display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:6px;border:1px solid #cdb68e;background:#e9d9b8;color:#3b2f22;margin-right:22px;position:relative}
.im-envelope dt{font-size:11px;color:#7a6a52}
.im-env-art{position:relative;aspect-ratio:3/2;background-size:cover;background-position:center;border-radius:4px;color:#6b2f2a}
.im-env-stamp{position:absolute;top:7%;right:5%;width:15%;aspect-ratio:5/6;object-fit:cover;transform:rotate(3deg);box-shadow:0 2px 4px #0005;background:#fff;padding:2px;border-radius:2px}
.im-env-face .im-env-stamp{top:10px;right:12px;width:44px}
.im-env-post{position:absolute;top:9%;right:17%;opacity:.55;transform:rotate(-12deg)}
.im-env-postdate{position:absolute;top:calc(9% + 28px);right:calc(17% + 18px);font:700 11px system-ui,sans-serif;opacity:.65;transform:rotate(-12deg)}
.im-env-seal2{position:absolute;left:50%;top:52%;width:17%;transform:translate(-50%,-50%);border-radius:50%;filter:drop-shadow(0 2px 3px #0006)}
.im-themed{position:relative;margin-right:22px}
.im-face{object-fit:cover;object-position:50% 12%;cursor:zoom-in;background:#ddd}
.im-lockers{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:8px}
.im-locker{cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border-radius:12px;background:var(--lumiverse-bg-elevated,#fff);box-shadow:0 4px 12px -8px #0007;transition:transform .15s}
.im-locker:hover{transform:translateY(-2px)}
.im-locker img{width:100%;aspect-ratio:1;object-fit:contain;border-radius:8px;background:#fff}
.im-locker-empty{width:100%;aspect-ratio:1;border-radius:8px;display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(90deg,#c8a46a33 0 2px,transparent 2px 46%),linear-gradient(#e9d9b8,#d9c39a);box-shadow:inset 0 0 0 3px #b08a5a55}
.im-emblem{object-fit:cover;background:#f6efe2;box-shadow:inset 0 0 0 2px #fff8,0 2px 6px #0003}
.im-row-card .im-emblem,.im-row-card .im-face{width:46px;height:46px}
.im-info .im-face{width:56px;height:56px}
.im-themed-wrap{display:flex;flex-direction:column}
.im-rush{padding:8px 18px;border-radius:999px;font-weight:600;background:var(--im-ink,#3b2f22);color:var(--lumiverse-bg-elevated,#fff);border-color:transparent;min-height:40px;touch-action:manipulation}
.im-font-prev{padding:10px 14px;border-radius:8px;background:#eef1f4;color:#26313b;margin:-4px 0 6px}
.im-looks-text{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.im-look-text{background:var(--lumiverse-bg-elevated,#fff);border-radius:10px;padding:12px 14px;box-shadow:0 4px 12px -8px #0007;font-family:"Gowun Batang","Nanum Myeongjo",serif;font-size:14px;line-height:1.75;white-space:pre-wrap}
.im-look-text b{display:block;font-family:inherit;font-size:13px;color:var(--im-ink);margin-bottom:4px}
.im-pic-text{display:flex;align-items:center;justify-content:center;padding:12px;font-family:"Gowun Batang","Nanum Myeongjo",serif;font-size:13px;line-height:1.6;text-align:center;color:var(--im-ink);overflow:auto}
.im-box-big{max-width:340px;margin:4px auto 8px}.im-box-big img{width:100%;display:block;border-radius:12px;background:#fff;cursor:zoom-in;box-shadow:0 10px 24px -14px #0008}
.im-looks{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}
.im-look-tall .im-pic img{object-position:50% 15%}
.im-rep-head{display:flex;gap:16px;align-items:center;margin:6px 0 12px}
.im-rep-emblem{width:120px;height:120px;border-radius:50%;object-fit:cover;cursor:zoom-in;background:#f6efe2;box-shadow:inset 0 0 0 3px #fff8,0 6px 16px -8px #0008;flex:none;display:flex;align-items:center;justify-content:center;font-size:11px}
.im-rep-name{font-size:20px;font-weight:700;color:var(--im-ink)}
.im-rep-title{font-family:"Gowun Batang","Nanum Myeongjo",serif;font-size:15px;color:var(--im-ink);margin:2px 0}
.im-rep-paper{background:#f7f1e4;color:#3b2f22;border-radius:6px;padding:20px 22px;box-shadow:0 8px 20px -14px #0008;background-image:repeating-linear-gradient(transparent 0 29px,#d9c7a440 29px 30px)}
.im-rep-date{font:12px system-ui,sans-serif;color:#8a7458;margin-bottom:8px}
.im-rep-changed{font-family:"Nanum Pen Script",cursive;font-size:19px;color:#a8322a;margin-bottom:8px}
.im-rep-note{font-family:"Gowun Batang","Nanum Myeongjo",serif;font-size:15px;line-height:30px;white-space:pre-wrap}
.im-rep-facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;font-size:13.5px}
.im-voices{display:flex;flex-direction:column;gap:10px}
.im-voice{padding:10px 14px;border-left:3px solid var(--im-line);background:var(--lumiverse-fill);border-radius:0 8px 8px 0}
.im-voice-secret{border-left-color:#7d2019}
.im-voice-says{font-family:"Gowun Batang","Nanum Myeongjo",serif;font-size:14.5px;line-height:1.7}
.im-voice-who{font-size:12px;color:var(--lumiverse-text-muted);margin-top:4px;text-align:right}
.im-hidden{filter:blur(0);color:var(--lumiverse-text-muted);font-style:italic;cursor:pointer;background:repeating-linear-gradient(135deg,#0000 0 6px,#0000000d 6px 12px);border-radius:4px;padding:2px 6px}
.im-rep-old summary{cursor:pointer;font-size:13px;color:var(--lumiverse-text-muted);margin:4px 0}
.im-timeline{border-left:2px solid var(--im-line);margin-left:8px;padding-left:16px;display:flex;flex-direction:column;gap:10px}
.im-tl{position:relative}
.im-tl::before{content:"";position:absolute;left:-22px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--im-line)}
.im-tl-them::before{background:#8a5a2b}.im-tl-me::before{background:#3d6c8f}.im-tl-art::before{background:#c9a45a}.im-tl-secret::before{background:#7d2019}.im-tl-event::before{background:#5f7d3a}
.im-tl-when{font:11px system-ui,sans-serif;color:var(--lumiverse-text-muted)}
.im-tl-text{font-size:13.5px}
.im-tl-sep{font:600 11px system-ui,sans-serif;color:var(--lumiverse-text-muted);margin-top:6px}
.im-list-label{font:600 11px system-ui,sans-serif;letter-spacing:.04em;color:var(--lumiverse-text-muted);margin:10px 4px 4px}
.im-me-row{border-style:dashed}
.im-view-head{display:flex;gap:12px;align-items:center;margin:4px 0 10px}
.im-myface{width:28px;height:28px;border-radius:50%;object-fit:cover;object-position:50% 15%;cursor:zoom-in;box-shadow:0 1px 3px #0004}
.im-myface-letter{float:right;width:40px;height:40px;margin:0 0 6px 10px}
.im-me{padding:10px;border-radius:12px;background:var(--lumiverse-bg-elevated,#fff);box-shadow:0 4px 12px -8px #0007;margin-bottom:10px}
.im-me-big{width:120px;aspect-ratio:832/1216;object-fit:cover;border-radius:8px;cursor:zoom-in;flex:none}
.im-me-empty{display:flex;align-items:center;justify-content:center;background:var(--lumiverse-fill);color:var(--lumiverse-text-muted);font-size:12px}
.im-tsum{font-size:12.5px;line-height:1.6;padding:8px 10px;border-radius:8px;background:var(--lumiverse-fill);color:var(--lumiverse-text);margin-bottom:6px}
.im-thumbs{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;white-space:normal}
.im-thumbs figure{margin:0;width:120px;cursor:zoom-in;background:#fffa;padding:4px;box-shadow:0 3px 8px -4px #0007;transform:rotate(-1deg)}
.im-thumbs figure:nth-child(even){transform:rotate(1.2deg)}
.im-thumbs img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.im-thumbs figcaption{font:11px/1.3 system-ui,sans-serif;color:#555;padding-top:3px;text-align:center}
.im-env-btn{align-self:flex-start;font-size:12px;margin:0 0 4px 2px}
.im-env-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.im-env-card{cursor:zoom-in;border-radius:3px;box-shadow:0 3px 8px -3px #0006}
.im-env-big .im-env-postdate{color:#6b2f2a}
.im-env-thumb{float:left;width:96px;margin:0 12px 6px 0;cursor:zoom-in;border-radius:3px;box-shadow:0 2px 6px #0004;transform:rotate(-2deg)}
.im-env-overlay{position:fixed;inset:0;z-index:99999;background:#000b;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;cursor:zoom-out;padding:20px}
.im-env-big{width:min(92vw,760px);border-radius:6px;box-shadow:0 10px 30px #000a}
.im-env-cap{color:#f3ead8;font:13px system-ui,sans-serif;text-align:center}
.im-themed .im-corners{position:absolute;inset:0;pointer-events:none}
.im-tstamp{float:right;width:44px;height:52px;object-fit:cover;margin:0 0 6px 10px;transform:rotate(2deg);box-shadow:0 2px 4px #0004;cursor:zoom-in;background:#fff;padding:2px}
.im-tmeta{font-family:system-ui,sans-serif;font-size:11px;white-space:normal;margin:0 0 10px;line-height:1.5}
.im-tencl{margin-top:12px;padding-top:8px;border-top:1px dashed;font-size:.9em}
.im-envelope dd{margin:0 0 4px}
.im-envelope .im-btn{align-self:flex-start;background:#8a5a2b;color:#fff;border-color:transparent}
.im-transit{border:1px dashed var(--lumiverse-border);border-radius:6px;padding:8px 12px;color:var(--lumiverse-text-muted);font-size:12px}
.im-transit.im-mine{margin-left:22px;text-align:right}
.im-transit.im-theirs{margin-right:22px}
.im-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px}
.im-item{border:1px solid var(--lumiverse-border);border-radius:8px;overflow:hidden;background:var(--lumiverse-fill-subtle,transparent);display:flex;flex-direction:column}
.im-item .im-pic{aspect-ratio:1/1;background:#efe2c6;display:flex;align-items:center;justify-content:center;color:#a88a5e}
.im-item .im-pic img{width:100%;height:100%;object-fit:cover}
.im-item .im-pic{position:relative}
.im-state{position:absolute;left:0;right:0;bottom:0;padding:4px 6px;font-size:11px;line-height:1.35;text-align:center;color:#fff;background:rgba(40,30,20,.72)}
.im-state.im-bad{background:rgba(150,40,30,.85)}
.im-spin{display:inline-block;width:9px;height:9px;margin-right:5px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:im-spin 1s linear infinite;vertical-align:-1px}
@keyframes im-spin{to{transform:rotate(360deg)}}
.im-pill{position:absolute;left:-6px;top:58px;padding:1px 6px;border-radius:9px;font:600 10px/16px system-ui,sans-serif;color:#fff;white-space:nowrap}
.im-item .im-cap{padding:6px 8px;font-size:12px;line-height:1.4}
.im-item .im-cap b{display:block;font-size:12.5px}
.im-bundle{display:flex;gap:10px;align-items:center;border:1px solid var(--lumiverse-border);border-radius:8px;padding:10px;cursor:pointer;background:var(--lumiverse-fill-subtle,transparent)}
.im-bundle:hover{border-color:var(--lumiverse-primary)}
.im-bundle .im-stack{width:44px;height:36px;position:relative;flex:none}
.im-bundle .im-stack i{position:absolute;inset:0;border:1px solid #cdb68e;background:#f4ead6;border-radius:2px}
.im-bundle .im-stack i:nth-child(1){transform:rotate(-8deg)}
.im-bundle .im-stack i:nth-child(2){transform:rotate(5deg)}
.im-sep{border:none;border-top:1px solid var(--lumiverse-border);margin:4px 0}
.im-page{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;background:var(--lumiverse-bg,var(--lumiverse-fill));color:var(--lumiverse-text)}
.im-page-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--lumiverse-border);background:var(--lumiverse-fill)}
.im-page-head b{font-size:15px}
.im-page-body{flex:1;min-height:0;display:flex}
.im-page-list{width:280px;flex:none;border-right:1px solid var(--lumiverse-border);overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box}
.im-page-main{flex:1;min-width:0;overflow:auto}
.im-page-main .im-panel{max-width:760px;margin:0 auto;height:auto;overflow:visible;padding:16px 20px 40px}
.im-row-card{border:1px solid var(--lumiverse-border);border-radius:8px;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;gap:2px;background:var(--lumiverse-fill-subtle,transparent)}
.im-row-card.im-on{border-color:var(--lumiverse-primary);box-shadow:0 0 0 1px var(--lumiverse-primary) inset}
.im-page-chips{display:none;flex-direction:column;gap:8px}
@media (max-width:760px){.im-page-list{display:none}.im-page-main .im-panel{padding:12px}.im-page-chips{display:flex}}
.im-box{cursor:pointer;user-select:none;width:76px;height:96px;display:block}
.im-box svg{display:block;filter:drop-shadow(0 3px 4px #0005)}
.im-note{position:absolute;right:0;bottom:100%;margin-bottom:6px;white-space:nowrap;background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:6px;padding:4px 8px;font-size:11px;pointer-events:none}
`;
const CSS2 = `
.im-tab,.im-panel,.im-page{--im-ink:color-mix(in srgb,var(--lumiverse-text) 72%,#6b4a2b 28%);--im-wax:#a8322a;--im-wax2:#c7493b;--im-cream:color-mix(in srgb,var(--lumiverse-bg-elevated,#fff) 84%,#d9b98a 16%);--im-cream2:color-mix(in srgb,var(--lumiverse-bg,#f4f4f6) 88%,#c8a46a 12%);--im-line:color-mix(in srgb,var(--lumiverse-border) 55%,#b08a5a 45%);--im-serif:inherit}
.im-page{background:radial-gradient(1200px 600px at 20% -10%,color-mix(in srgb,var(--im-cream2) 70%,transparent),transparent),var(--im-cream2)}
.im-page-head{gap:12px;padding:12px 20px;background:color-mix(in srgb,var(--lumiverse-bg-elevated,#fff) 80%,transparent);backdrop-filter:blur(6px)}
.im-page-head .im-title{font-family:var(--im-serif);font-size:18px;font-weight:700;letter-spacing:.02em;color:var(--im-ink)}
.im-page-head .im-sub{font-size:12px;color:var(--lumiverse-text-muted)}
.im-page-head .im-mini{width:30px;height:38px;flex:none}
.im-close{width:34px;height:34px;border-radius:50%;border:1px solid var(--im-line);background:var(--lumiverse-bg-elevated,#fff);color:var(--lumiverse-text);cursor:pointer;font-size:16px;line-height:1}
.im-close:hover{border-color:var(--im-wax);color:var(--im-wax)}
.im-page-list{background:color-mix(in srgb,var(--lumiverse-bg-elevated,#fff) 55%,transparent);padding:14px 12px;gap:6px}
.im-row-card{flex-direction:row;align-items:flex-start;gap:10px;padding:10px;border-color:transparent;background:transparent;border-radius:10px;transition:background .15s}
.im-row-card:hover{background:var(--lumiverse-fill-subtle)}
.im-row-card.im-on{background:var(--lumiverse-bg-elevated,#fff);border-color:var(--im-line);box-shadow:inset 3px 0 0 var(--im-wax),var(--lumiverse-shadow-sm,0 2px 8px #0001)}
.im-seal{width:38px;height:38px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--im-serif);font-weight:700;font-size:16px;color:#fff6ea;background:radial-gradient(circle at 35% 30%,var(--im-wax2),var(--im-wax) 60%,#7d2019);box-shadow:inset 0 0 0 3px #ffffff22,0 2px 4px #0003}
.im-row-card .im-name{font-family:var(--im-serif);font-weight:700;font-size:14.5px;color:var(--im-ink)}
.im-row-card .im-excerpt{font-family:var(--im-serif);font-size:12px;color:var(--lumiverse-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.im-badge{background:var(--im-wax);box-shadow:0 1px 2px #0003}
.im-panel .im-tabs{display:inline-flex;gap:0;border:1px solid var(--im-line);border-radius:999px;padding:3px;background:var(--lumiverse-bg-elevated,#fff);align-self:flex-start}
.im-panel .im-tabs button{border:none;border-radius:999px;padding:5px 16px;font-family:var(--im-serif);color:var(--lumiverse-text-muted)}
.im-panel .im-tabs button.im-on{background:var(--im-ink);color:var(--lumiverse-bg-elevated,#fff);border-bottom:none}
.im-info{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--im-line);border-radius:12px;background:var(--lumiverse-bg-elevated,#fff)}
.im-info .im-name{font-family:var(--im-serif);font-size:17px;font-weight:700;color:var(--im-ink)}
.im-divider{display:flex;align-items:center;gap:10px;margin:10px 0 2px;font-size:11px;letter-spacing:.06em;color:var(--lumiverse-text-dim,var(--lumiverse-text-muted))}
.im-divider::before,.im-divider::after{content:"";flex:1;height:1px;background:var(--im-line)}
.im-paper.im-mine{margin-left:auto;max-width:86%;margin-right:0}
.im-paper{border-radius:3px}
.im-envelope{margin-right:0;padding:0;border:none;background:none;gap:0;overflow:hidden;border-radius:10px;box-shadow:var(--lumiverse-shadow-sm,0 2px 8px #0002)}
.im-env-face{position:relative;height:120px;background:linear-gradient(160deg,#ead8b4,#dcc49a);border:1px solid #c9ad80;border-bottom:none;border-radius:10px 10px 0 0;overflow:hidden}
.im-env-face::before{content:"";position:absolute;left:-1px;right:-1px;top:0;height:118px;background:linear-gradient(to bottom right,transparent 49.5%,#cdb184 50%,transparent 51%) left/50% 100% no-repeat,linear-gradient(to bottom left,transparent 49.5%,#cdb184 50%,transparent 51%) right/50% 100% no-repeat;opacity:.9}
.im-env-face::after{content:"";position:absolute;left:0;right:0;top:0;height:64px;background:linear-gradient(170deg,#f1e2c4,#e3cda6);clip-path:polygon(0 0,100% 0,50% 100%);filter:drop-shadow(0 2px 2px #0002)}
.im-env-seal{position:absolute;left:50%;top:46px;transform:translateX(-50%);z-index:2;width:46px;height:46px;border-radius:50%;object-fit:cover;background:radial-gradient(circle at 35% 30%,var(--im-wax2),var(--im-wax) 60%,#7d2019);box-shadow:0 2px 5px #0005;display:flex;align-items:center;justify-content:center;color:#ffe9d6;font-family:var(--im-serif);font-weight:700}
.im-env-body{display:flex;flex-direction:column;gap:6px;padding:12px 16px 14px;background:#efe2c6;border:1px solid #c9ad80;border-top:none;border-radius:0 0 10px 10px;color:#3b2f22}
.im-env-body .im-btn{align-self:center;background:var(--im-wax);color:#fff;border-color:transparent;border-radius:999px;padding:6px 20px;font-family:var(--im-serif)}
.im-compose>summary{list-style:none;display:inline-flex;align-items:center;gap:6px;padding:7px 18px;border-radius:999px;background:var(--im-ink);color:var(--lumiverse-bg-elevated,#fff);cursor:pointer;font-family:var(--im-serif);font-size:13.5px;margin-top:6px}
.im-compose>summary::-webkit-details-marker{display:none}
.im-compose[open]>summary{background:transparent;color:var(--im-ink);border:1px solid var(--im-line)}
.im-panel .im-letter textarea:first-of-type{font-family:var(--im-serif);font-size:14.5px;line-height:28px;background:var(--im-cream) repeating-linear-gradient(transparent 0 27px,color-mix(in srgb,var(--im-line) 70%,transparent) 27px 28px);background-attachment:local;border-color:var(--im-line);min-height:200px;padding:2px 12px 8px;background-position:0 2px}
.im-panel .im-btn.im-primary{background:var(--im-wax);border-radius:999px;padding:6px 20px;font-family:var(--im-serif)}
.im-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.im-item{border:none;border-radius:6px;background:var(--lumiverse-bg-elevated,#fff);padding:8px 8px 0;box-shadow:var(--lumiverse-shadow-sm,0 2px 8px #0002);transition:transform .15s,box-shadow .15s}
.im-item:hover{transform:translateY(-2px) rotate(-.4deg);box-shadow:var(--lumiverse-shadow-md,0 8px 24px #0003)}
.im-item .im-pic{border-radius:3px;overflow:hidden;background:var(--im-cream)}
.im-item .im-pic img{cursor:zoom-in}
.im-item .im-cap{padding:8px 4px 10px}
.im-item .im-cap b{font-family:var(--im-serif);font-size:13px;color:var(--im-ink)}
.im-bundle{border:none;background:var(--lumiverse-bg-elevated,#fff);box-shadow:var(--lumiverse-shadow-sm,0 2px 8px #0002);border-radius:10px;padding:12px 14px}
.im-bundle b{font-family:var(--im-serif);color:var(--im-ink)}
.im-bundle .im-stack i{background:var(--im-cream)}
.im-bundle .im-stack::after{content:"";position:absolute;left:-3px;right:-3px;top:50%;height:4px;margin-top:-2px;background:var(--im-wax);border-radius:2px;opacity:.85}
.im-panel h4{font-family:var(--im-serif);color:var(--im-ink);font-size:14px}
.im-cal{display:flex;flex-direction:column;gap:10px}
.im-cal-head{display:flex;align-items:center;gap:8px}
.im-cal-head b{flex:1;text-align:center;font-family:var(--im-serif);font-size:16px;color:var(--im-ink)}
.im-cal-nav{width:32px;height:32px;border-radius:50%;border:1px solid var(--im-line);background:var(--lumiverse-bg-elevated,#fff);color:var(--lumiverse-text);cursor:pointer}
.im-cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.im-cal-dow{text-align:center;font-size:11px;color:var(--lumiverse-text-muted);padding:2px 0}
.im-cal-dow:first-child{color:var(--im-wax)}
.im-cal-day{min-height:64px;border:1px solid transparent;border-radius:8px;padding:4px 5px;background:var(--lumiverse-bg-elevated,#fff);cursor:pointer;display:flex;flex-direction:column;gap:3px;box-sizing:border-box;text-align:left;font:inherit;color:var(--lumiverse-text)}
.im-cal-day:hover{border-color:var(--im-line)}
.im-cal-day.im-out{opacity:.35;background:transparent}
.im-cal-day.im-today .im-cal-n{background:var(--im-wax);color:#fff;border-radius:999px;padding:0 6px}
.im-cal-day.im-sel{border-color:var(--im-ink);box-shadow:inset 0 0 0 1px var(--im-ink)}
.im-cal-n{font-size:12px;font-weight:700;align-self:flex-start}
.im-cal-marks{display:flex;flex-wrap:wrap;gap:2px;align-items:center}
.im-cal-mark{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 3px;border-radius:8px;font-size:10px;line-height:16px;color:#fff;box-sizing:border-box}
.im-cal-mark.im-out-mark{background:transparent;border:1.5px solid currentColor}
.im-cal-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11.5px;color:var(--lumiverse-text-muted)}
.im-cal-legend span{display:inline-flex;align-items:center;gap:4px}
.im-cal-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.im-cal-events{display:flex;flex-direction:column;gap:6px}
.im-cal-ev{display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border-radius:10px;background:var(--lumiverse-bg-elevated,#fff);border:1px solid var(--im-line);cursor:pointer}
.im-cal-ev:hover{border-color:var(--im-ink)}
.im-cal-ev .im-t{font-variant-numeric:tabular-nums;font-size:12px;color:var(--lumiverse-text-muted);min-width:40px}
.im-cal-ev .im-x{font-family:var(--im-serif);font-size:12.5px;color:var(--lumiverse-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.im-flash{animation:im-flash 1.6s ease}
[data-lid]{scroll-margin-top:72px}
@keyframes im-flash{0%,40%{box-shadow:0 0 0 3px var(--im-wax)}100%{box-shadow:none}}
@media (max-width:520px){.im-cal-day{min-height:48px;padding:3px}.im-cal-mark{min-width:12px;height:12px;font-size:9px;line-height:12px}}
.im-zoom{display:flex;flex-direction:column;align-items:center;gap:10px}
.im-zoom img{max-width:100%;max-height:70vh;border-radius:6px;box-shadow:0 6px 24px #0004;background:#f4ead6}
.im-zoom .im-cap{font-family:var(--im-serif);text-align:center;color:var(--lumiverse-text)}
`;
const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/><path d="M15 3.5l2 1.2"/></svg>';
const MINI_BOX = '<svg viewBox="0 0 76 96" width="30" height="38" aria-hidden="true"><rect x="33" y="58" width="9" height="36" rx="1" fill="#6b5a48"/><path d="M8 34a22 22 0 0 1 44 0v26H8z" fill="#c8553a"/><rect x="8" y="50" width="44" height="10" fill="#b44a31"/><rect x="15" y="38" width="30" height="5" rx="2.5" fill="#5a2516"/><rect x="53" y="12" width="3.5" height="30" fill="#57524c"/><path d="M53.5 12h15l-3 5 3 5h-15z" fill="#f0a53a"/></svg>';
const PIC = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z"/></svg>';
const NO_PERSONA = '__none__';
const ALL = '__all__';
const LS_PERSONA = 'isekai_mailbox.persona';
const LS_PANEL = 'isekai_mailbox.panel';
const LS_PANEL_MODE = 'isekai_mailbox.panelMode';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // 우리 코드의 고정 SVG에만 쓴다
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    // 읽기 전용 속성(style·list·form 등)은 속성으로. 그 밖에도 지정이 실패하면 속성으로 넘긴다
    else if (k === 'style' || k === 'list' || k === 'form') node.setAttribute(k, v);
    else if (k in node) { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}
const btn = (text, onclick, opts = {}) => el('button', { class: `im-btn${opts.primary ? ' im-primary' : ''}`, type: 'button', text, disabled: !!opts.disabled, onclick });
const link = (text, onclick) => el('button', { class: 'im-link', type: 'button', text, onclick });
const field = (label, input) => el('label', {}, [label, input]);
const when = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const calSummary = (cal) => (cal?.months?.length
  ? `하루 ${cal.dayHours}시간 · ${cal.months.map((m) => `${m.name}(${m.days})`).join(' ')} · 한 해 ${cal.months.reduce((n, m) => n + m.days, 0)}일`
  : '달력 없음 — 「만난 지 N일째」로 표시');
// 「이름 | 일수」 줄 ↔ 달 목록
const monthsToText = (cal) => (cal?.months || []).map((m) => `${m.name} | ${m.days}`).join('\n');
const textToMonths = (t) => String(t || '').split(/\r?\n/).map((line) => { const [name, days] = line.split('|').map((x) => x.trim()); return name ? { name, days: Number(days) || 30 } : null; }).filter(Boolean);
const imgUrl = (id, size = 'sm') => `/api/v1/images/${encodeURIComponent(id)}?size=${size}`;
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const short = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);

// 배송 시간을 실제(가속 반영) 시간으로
function deliveryLabel(c) {
  const s = Math.max(1, Number(c.timeScale) || 1);
  const f = (h) => (s > 1 ? formatSpan(h / s) : `${h}시간`);
  const range = c.delivery.min === c.delivery.max ? f(c.delivery.min) : `${f(c.delivery.min)}~${f(c.delivery.max)}`;
  return `배송 ${range}${s > 1 ? ` (시험 가속 ${s}배)` : ''}`;
}

export function setup(ctx) {
  // ── 백엔드 요청 ──
  const waits = new Map();
  let seq = 0;
  const offBack = ctx.onBackendMessage((msg) => {
    if (msg?.type === 'changed' && !msg.requestId) { refreshSoon(); return; }
    const w = msg && waits.get(msg.requestId);
    if (!w) return;
    waits.delete(msg.requestId);
    if (msg.ok) w.resolve(msg); else w.reject(new Error(msg.error || '실패'));
  });
  const ask = (type, extra = {}, timeout = 20000) => new Promise((resolve, reject) => {
    const requestId = `im${Date.now()}_${seq++}`;
    waits.set(requestId, { resolve, reject });
    ctx.sendToBackend({ requestId, type, ...extra });
    setTimeout(() => { if (waits.delete(requestId)) reject(new Error('응답 없음')); }, timeout);
  });

  // ── 공용 상태 ──
  const S = {
    list: [], all: [], settings: null, personas: [], activePersonaId: '',
    persona: lsGet(LS_PERSONA, ALL), // 보고 있는 페르소나(서랍·보조창 공유)
    error: '',
  };
  const views = new Set(); // 다시 그릴 화면들
  const renderAll = () => { for (const v of views) v.render(); };
  const byId = (id) => S.all.find((c) => c.id === id) || null;
  const personaOf = (id) => S.personas.find((p) => p.id === id) || null;
  const inPersona = (x) => S.persona === ALL || (S.persona === NO_PERSONA ? !x.personaId : x.personaId === S.persona);
  const NONE_OPT = '__none__'; // 고르기 칸의 「페르소나 없음」
  const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
  const personaPick = (pid) => (pid === NONE_OPT ? { personaId: '', noPersona: true, userTz: myTz() } : { personaId: pid, noPersona: false });
  const personaOptions = (selected) => [
    el('option', { value: NONE_OPT, text: '페르소나 없음', selected: selected === NONE_OPT }),
    el('option', { value: '', text: '활성 페르소나(보낼 때 정함)', selected: selected === '' }),
    ...S.personas.map((p) => el('option', { value: p.id, text: p.title ? `${p.name} — ${p.title}` : p.name, selected: p.id === selected })),
  ];
  const defaultPick = () => (S.persona === NO_PERSONA ? NONE_OPT : S.persona !== ALL ? S.persona : S.activePersonaId);
  const setPersona = (id) => { S.persona = id; lsSet(LS_PERSONA, id); renderAll(); };

  async function refresh() {
    try {
      const [r, p] = await Promise.all([ask('all'), S.personas.length ? null : ask('personas').catch(() => null)]);
      S.all = r.all;
      S.settings = r.settings;
      if (p) { S.personas = p.personas; S.activePersonaId = p.activeId; }
      const l = await ask('load');
      S.list = l.list;
      ask('mePortraits').then((m) => { S.me = m.me || {}; renderAll(); }).catch(() => {});
      S.error = '';
      ask('artStatus').then((a) => { S.art = a; }).catch(() => {});
      convertWebp();
    } catch (e) { S.error = e.message || String(e); }
    const unread = S.list.reduce((n, x) => n + x.unread, 0);
    tab.setBadge(unread ? String(unread) : null);
    renderAll();
  }
  // 백엔드가 만든 png를 이 브라우저에서 WebP로 바꿔 돌려준다(백엔드에는 변환 도구가 없음)
  let converting = false;
  async function toWebp(blob) {
    const bmp = await createImageBitmap(blob);
    const MAX = 1280;
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const W = Math.round(bmp.width * k);
    const H = Math.round(bmp.height * k);
    let out;
    if (typeof OffscreenCanvas !== 'undefined') {
      const cv = new OffscreenCanvas(W, H);
      cv.getContext('2d').drawImage(bmp, 0, 0, W, H);
      out = await cv.convertToBlob({ type: 'image/webp', quality: 0.85 });
    } else {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(bmp, 0, 0, W, H);
      out = await new Promise((res) => cv.toBlob(res, 'image/webp', 0.85));
    }
    bmp.close?.();
    if (!out || out.type !== 'image/webp') throw new Error('이 브라우저는 WebP로 저장하지 못합니다.');
    return out;
  }
  const b64 = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  async function convertWebp() {
    if (converting || typeof createImageBitmap !== 'function') return;
    converting = true;
    try {
      const { queue } = await ask('webpQueue');
      for (const row of queue || []) {
        try {
          const r = await fetch(`/api/v1/images/${encodeURIComponent(row.imageId)}`, { credentials: 'include' });
          if (!r.ok) throw new Error(`원본을 못 받음(${r.status})`);
          const src = await r.blob();
          const webp = await toWebp(src);
          await ask('webpDone', { imageId: row.imageId, data: await b64(webp), originalBytes: src.size }, 60000);
        } catch (e) {
          await ask('webpFail', { imageId: row.imageId, error: String(e?.message || e) }).catch(() => {});
        }
      }
    } catch {} finally { converting = false; }
  }
  let soon = null;
  const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(refresh, 300); };
  const reloadPersonas = async () => { try { const p = await ask('personas'); S.personas = p.personas; S.activePersonaId = p.activeId; } catch {} };

  // 페르소나 고르기 줄(서랍·보조창 공용)
  function personaChips() {
    const used = new Set(S.list.map((x) => x.personaId || NO_PERSONA));
    const chips = [el('button', { class: `im-chip im-plain${S.persona === ALL ? ' im-on' : ''}`, type: 'button', text: '모두', onclick: () => setPersona(ALL) })];
    for (const p of S.personas) {
      const count = S.list.filter((x) => x.personaId === p.id).length;
      if (!count && p.id !== S.persona) continue; // 편지 상대가 있는 페르소나만(고른 것은 유지)
      chips.push(el('button', { class: `im-chip${S.persona === p.id ? ' im-on' : ''}`, type: 'button', title: p.title || p.name, onclick: () => setPersona(p.id) }, [
        myPortrait(p.id) ? el('img', { class: 'im-ava', src: imgUrl(myPortrait(p.id).imageId, 'sm'), alt: '' }) : p.imageId ? el('img', { class: 'im-ava', src: imgUrl(p.imageId), alt: '' }) : el('span', { class: 'im-ava', text: p.name.slice(0, 1) }),
        `${p.name} · ${count}`,
      ]));
    }
    if (used.has(NO_PERSONA)) chips.push(el('button', { class: `im-chip im-plain${S.persona === NO_PERSONA ? ' im-on' : ''}`, type: 'button', text: '페르소나 없음', onclick: () => setPersona(NO_PERSONA) }));
    return el('div', { class: 'im-chips' }, chips);
  }

  // 편지 쓰기 칸(서랍·보조창 공용)
  const drafts = new Map(); // 상대 id → { body, enclosure, photos }
  function composeBox(c, { busyRef, act, onSent }) {
    const d = drafts.get(c.id) || { body: '', enclosure: '', photos: [] };
    if (!d.photos) d.photos = [];
    drafts.set(c.id, d);
    const photoIn = el('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: (e) => act(async () => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (d.photos.length >= 3) throw new Error('사진은 편지 한 통에 3장까지예요.');
      let blob = f;
      try { blob = await toWebp(f); } catch {}
      const name = (prompt('사진에 붙일 설명 (상대는 이 설명만큼 사진을 압니다)', '') || '').trim() || '사진 한 장';
      const r = await ask('uploadPhoto', { id: c.id, data: await b64(blob), mime: blob.type }, 60000);
      d.photos.push({ imageId: r.imageId, name });
    }) });
    const photoRow = d.photos.length ? el('div', { class: 'im-row', style: 'flex-wrap:wrap;gap:8px' }, d.photos.map((ph, i) => el('div', { class: 'im-chip', style: 'display:flex;align-items:center;gap:6px' }, [
      el('img', { src: imgUrl(ph.imageId, 'sm'), alt: ph.name, style: 'width:36px;height:36px;object-fit:cover;border-radius:4px' }),
      el('span', { text: short(ph.name, 24) }),
      el('button', { class: 'im-link', type: 'button', text: '빼기', onclick: () => act(async () => { d.photos.splice(i, 1); await ask('dropPhoto', { id: c.id, imageId: ph.imageId }).catch(() => {}); }) }),
    ]))) : null;
    const sender = c.noPersona ? '나 (페르소나 없음)' : c.personaId ? (personaOf(c.personaId)?.name || c.personaName || '(지워진 페르소나)') : '활성 페르소나';
    return el('div', { class: 'im-letter' }, [
      el('div', { class: 'im-row' }, [el('h4', { class: 'im-grow', text: `${c.name}에게` }), el('span', { class: 'im-row', style: 'gap:6px;align-items:center' }, [myFace(meKeyOf(c)), el('span', { class: 'im-muted', text: `보내는 사람: ${sender}` })])]),
      el('textarea', { value: d.body, placeholder: '편지 본문', rows: 7, oninput: (e) => { d.body = e.target.value; } }),
      el('textarea', { value: d.enclosure, placeholder: '동봉할 것(선택, 한 줄에 하나) — 예: 말린 네잎클로버 한 장', rows: 2, style: 'min-height:48px', oninput: (e) => { d.enclosure = e.target.value; } }),
      el('div', { class: 'im-row' }, [photoIn, btn('사진 동봉…', () => photoIn.click(), { disabled: busyRef() || d.photos.length >= 3 }), el('span', { class: 'im-muted', text: '내 세계의 사진(3장까지). 상대는 붙인 설명만큼 압니다.' })]),
      !artOn() ? null : el('details', { class: 'im-scene', open: working.has(`scene:${c.id}`) || undefined }, [
        el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '그림 그려서 동봉 (NovelAI)' }),
        (() => {
          const req = el('textarea', { rows: 2, placeholder: '어떤 그림인지 자연어로 — 예: 비 오는 창가에서 편지를 읽는 나, 창밖엔 네온 간판' });
          const me = el('input', { type: 'checkbox', style: 'width:auto', checked: true });
          const them = el('input', { type: 'checkbox', style: 'width:auto' });
          return el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
            req,
            el('div', { class: 'im-row', style: 'gap:14px' }, [el('label', { class: 'im-row', style: 'flex-direction:row' }, [me, '나(페르소나)']), el('label', { class: 'im-row', style: 'flex-direction:row' }, [them, `${c.name}`])]),
            working.has(`scene:${c.id}`) ? workingBox(`scene:${c.id}`) : btn('그려서 넣기 (글 1회 + 그림 1장)', () => {
              const text = req.value.trim();
              if (!text) { act(async () => { throw new Error('어떤 그림인지 적어 주세요.'); }); return; }
              if (d.photos.length >= 3) { act(async () => { throw new Error('그림·사진은 편지 한 통에 3장까지예요.'); }); return; }
              runSlow(`scene:${c.id}`, '그림을 그리는 중이에요…', act, async () => {
                const r = await ask('drawScene', { id: c.id, request: text, includeMe: me.checked, includeThem: them.checked }, 300000);
                d.photos.push({ imageId: r.imageId, name: short(text, 60) });
              });
            }, { disabled: busyRef() || d.photos.length >= 3 }),
            el('div', { class: 'im-muted', style: 'font-size:11px', text: '적은 글을 지침대로 NovelAI 프롬프트로 바꿔 그립니다. 다 그리면 아래 동봉 칸에 붙어요(빼기 가능).' }),
          ]);
        })(),
      ]),
      photoRow,
      el('div', { class: 'im-row' }, [
        el('span', { class: 'im-muted im-grow', text: `${deliveryLabel(c)}. 도착 전에는 회수할 수 있습니다.` }),
        btn(busyRef() ? '보내는 중…' : '보내기', () => act(async () => {
          if (!d.body.trim()) throw new Error('본문을 적어 주세요.');
          await ask('send', { id: c.id, body: d.body, enclosure: d.enclosure, photos: d.photos, userTz: c.noPersona ? myTz() : '' });
          drafts.set(c.id, { body: '', enclosure: '', photos: [] });
          await refresh();
          onSent?.();
        }), { primary: true, disabled: busyRef() }),
      ]),
    ]);
  }

  // ══════════════ 서랍 탭 ══════════════
  const tab = ctx.ui.registerDrawerTab({
    id: 'isekai-mailbox', title: '이세계 편지', shortName: '이세계 편지',
    description: '다른 세계의 누군가와 주고받는 편지',
    keywords: ['letter', 'mail', 'post', '편지', '우체통', '이세계', '이세계 편지'],
    headerTitle: '이세계 편지', iconSvg: ICON,
  });
  const removeStyle = typeof ctx.dom?.addStyle === 'function' ? ctx.dom.addStyle(CSS + CSS2) : null;
  let fontLink = null;
  try {
    if (typeof document !== 'undefined' && !document.getElementById('im-paper-fonts')) {
      fontLink = el('link', { id: 'im-paper-fonts', rel: 'stylesheet', href: PAPER_FONT_URL });
      document.head.append(fontLink);
    }
  } catch {}
  const htmlPaper = () => (S.settings?.art?.paperMode || 'html') !== 'image';
  // 확인창: 루미버스 앱 확인창(모바일에서도 뜸). 없으면 브라우저 confirm
  const confirmBox = async (message, { title = '이세계 편지', ok = '확인', cancel = '취소', danger = false } = {}) => {
    try {
      if (typeof ctx.ui?.showConfirm === 'function') {
        const r = await ctx.ui.showConfirm({ title, message: String(message), variant: danger ? 'danger' : 'info', confirmLabel: ok, cancelLabel: cancel });
        return !!r?.confirmed;
      }
    } catch {}
    try { return window.confirm(String(message)); } catch { return false; }
  };
  // 내 편지 글씨체(설정에서 고름)
  const myFontStyle = () => {
    const f = PAPER_FONTS[S.settings?.myFont || ''];
    return f ? `font-family:"${f.family}","Nanum Myeongjo","Noto Serif KR",Georgia,serif;font-size:${(14.5 * f.size).toFixed(1)}px;line-height:28px` : undefined; // 줄 간격은 편지지 줄(28px)에 맞춤
  };
  const artOn = () => S.settings?.art?.enabled !== false;
  const setKindsUi = () => (htmlPaper() ? ['envelope', 'emblem'] : ['paper', 'stamp', 'seal']);
  // 상대 얼굴: 초상화 → 봉인 → 이름 첫 글자
  const avatarEl = (c, cls = 'im-seal', { portraitFirst = false } = {}) => (!portraitFirst && (c.art?.emblem?.imageId || c.art?.seal?.imageId) ? el('img', { class: `${cls} im-emblem`, src: imgUrl(c.art.emblem?.imageId || c.art.seal.imageId, 'sm'), alt: '' })
    : c.art?.portrait?.imageId ? el('img', { class: `${cls} im-face`, src: imgUrl(c.art.portrait.imageId, 'sm'), alt: c.name, title: '눌러서 초상화 크게 보기', onclick: (e) => { e.stopPropagation(); openImage(c.art.portrait.imageId, `${c.name} · 초상화`, ''); } })
    : c.art?.seal?.imageId ? el('img', { class: cls, src: imgUrl(c.art.seal.imageId, 'sm'), alt: '' }) : el('span', { class: cls, text: c.name.replace(/^[[^]]*]s*/, '').slice(0, 1) }));
  const KIND_LABEL = { envelope: '봉투', emblem: '상징물', locker: '추억 상자', paper: '편지지', stamp: '우표', seal: '봉인' };
  const themeOf = (c, l) => (l?.theme || c?.paperTheme || defaultTheme(c));
  // ── 내 초상화 ──
  const meKeyOf = (c) => (c?.noPersona ? 'none' : (c?.personaId || S.activePersonaId || 'none')).replace(/[^\w-]/g, '_');
  const myPortrait = (key) => S.me?.[String(key || 'none').replace(/[^\w-]/g, '_')]?.portrait || null;
  const myFace = (key, cls = 'im-myface') => {
    const pt = myPortrait(key);
    return pt?.imageId ? el('img', { class: cls, src: imgUrl(pt.imageId, 'sm'), alt: '내 모습', title: '내 초상화 — 눌러서 크게', onclick: (e) => { e.stopPropagation(); openImage(pt.imageId, '내 초상화', ''); } }) : null;
  };
  // 내 모습 칸(모음): 지금 초상화, 지난 모습, 그리기(페르소나 설명 + 메모), 보낸 그림에서 고르기
  function meCard(key, label, opts, act) {
    const m = S.me?.[String(key).replace(/[^\w-]/g, '_')] || {};
    const note = el('textarea', { rows: 2, placeholder: '내 모습 메모(선택) — 예: 어깨까지 오는 갈색 머리, 안경, 회색 니트. 페르소나 설명에 더해져요.' });
    return el('div', { class: 'im-me' }, [
      el('div', { class: 'im-row', style: 'gap:12px;align-items:flex-start' }, [
        m.portrait?.imageId ? el('img', { class: 'im-me-big', src: imgUrl(m.portrait.imageId, 'lg'), alt: '내 초상화', onclick: () => openImage(m.portrait.imageId, `${label} · 초상화`, m.portrait.character || '') }) : el('div', { class: 'im-me-big im-me-empty', text: '아직 없음' }),
        el('div', { class: 'im-grow', style: 'display:flex;flex-direction:column;gap:6px' }, [
          el('b', { text: `${label}의 모습` }),
          note,
          !artOn() ? el('div', { class: 'im-muted', text: '그림 사용을 꺼 두어서 초상화는 그리지 않아요. 페르소나 설명이 내 모습이에요.' }) : working.has(`me:${key}`) ? workingBox(`me:${key}`) : btn(m.portrait ? '다시 그리기 (글 1회 + NovelAI 1장)' : '초상화 그리기 (글 1회 + NovelAI 1장)', () => runSlow(`me:${key}`, '내 초상화를 그리는 중이에요…', act, async () => {
            await ask('drawMyPortrait', { ...opts, request: note.value }, 300000);
            const r = await ask('mePortraits'); S.me = r.me || {};
          })),
          el('div', { class: 'im-muted', style: 'font-size:11px', text: '그린 모습은 내 편지·편지 쓰기 칸·페르소나 칩에 보이고, 「그림 그려서 동봉」에서 나를 그릴 때 같은 모습으로 그려요.' }),
        ]),
      ]),
      m.history?.length ? el('div', { class: 'im-thumbs' }, [...m.history].reverse().map((h) => el('figure', { onclick: () => openImage(h.imageId, '예전 모습', h.at ? new Date(h.at).toLocaleDateString('ko-KR') : '') }, [el('img', { src: imgUrl(h.imageId, 'lg'), alt: '예전 모습' }), el('figcaption', { text: h.at ? new Date(h.at).toLocaleDateString('ko-KR') : '예전' })]))) : null,
    ]);
  }
  let editingLetter = '';
  const rerenderAll = () => { try { renderAll(); } catch {} };
  // 편지에 딸린 그림(받은 물건·사진 그림, 내 사진): 편지지 아래 썸네일, 누르면 크게
  const attachThumbs = (c, l) => {
    const pics = (c.items || []).filter((x) => x.letterId === l.id && x.imageId).map((x) => ({ id: x.imageId, name: x.name, note: x.note || '' }));
    if (!pics.length) return null;
    return el('div', { class: 'im-thumbs' }, pics.map((x) => el('figure', { onclick: (e) => { e.stopPropagation(); openImage(x.id, x.name, x.note); } }, [
      el('img', { src: imgUrl(x.id, 'lg'), alt: x.name, loading: 'lazy' }),
      el('figcaption', { text: short(x.name, 24) }),
    ])));
  };
  // 연 편지에도 봉투가 보이게: 작은 봉투(우표·봉인 붙은 채), 누르면 크게
  const envelopeFace = (c, l, cls) => {
    const envImg = l?.art?.envelope || c.art?.envelope?.imageId;
    if (!envImg) return null;
    return el('div', { class: `im-env-art ${cls}`, style: `background-image:url("${imgUrl(envImg, 'lg')}")` }, [
    ]);
  };
  const showEnvelope = (c, l) => {
    const big = envelopeFace(c, l, 'im-env-big');
    if (!big) return;
    const cap = [`${c.name}의 봉투`, l?.writtenLabel || l?.theirWrittenLabel, l?.envelope?.medium].filter(Boolean).join(' · ');
    // 앱 모달로(전체 화면 모드의 레이어 위에 뜸). 없으면 화면 위 덮개
    try {
      if (typeof ctx.ui.showModal !== 'function') throw new Error('no modal');
      const m = ctx.ui.showModal({ title: cap, width: Math.min(820, window.innerWidth - 32), maxHeight: Math.min(900, window.innerHeight - 40) });
      big.style.width = '100%';
      big.addEventListener('click', () => m.dismiss());
      m.root.append(el('div', { class: 'im-zoom' }, [big]));
    } catch {
      const box = el('div', { class: 'im-env-overlay', onclick: () => box.remove() }, [big, el('div', { class: 'im-env-cap', text: cap })]);
      document.body.append(box);
    }
  };
  if (!removeStyle) tab.root.append(el('style', { text: CSS + CSS2 }));
  const root = el('div', { class: 'im-tab' });
  tab.root.append(root);

  const drawer = (() => {
    let view = { name: 'home' };
    let busy = false;
    let error = '';
    let connections = null;
    let imageConns = null;
    const modelCache = {};
    const go = (v) => { view = v; error = ''; render(); if (v.name === 'home' || v.name === 'c') refresh(); };
    const act = async (fn) => {
      if (busy) return;
      busy = true; error = ''; render();
      try { await fn(); } catch (e) { error = e.message || String(e); }
      busy = false; render();
    };

    function render() {
      const body = { home: homeView, c: cView, letter: letterView, form: formView, remove: removeView, report: () => { const c = byId(view.id); return c ? [el('div', { class: 'im-row' }, [link(`← ${c.name}`, () => go({ name: 'c', id: c.id }))]), ...reportView(c, act)] : [el('div', { class: 'im-muted', text: '불러오는 중…' })]; }, settings: settingsView, match: matchView, preview: previewView, dossier: dossierView }[view.name]?.() || [];
      const err = error || S.error;
      root.replaceChildren(...[].concat(body, err ? el('div', { class: 'im-err', text: err }) : null).filter(Boolean));
    }

    function homeView() {
      const shown = S.list.filter(inPersona);
      return [
        el('div', { class: 'im-row' }, [
          el('h3', { class: 'im-grow', text: '우편함' }),
          btn('새 상대', async () => { await reloadPersonas(); go({ name: 'match' }); }, { primary: true }),
          btn('설정', () => go({ name: 'settings' })),
        ]),
        S.list.length ? personaChips() : null,
        panel ? link(panel.isCollapsed() ? '보조창(편지첩) 열기' : '보조창 닫기', () => togglePanel()) : el('div', { class: 'im-muted', text: '우체통 위젯과 보조창은 확장 패널에서 ui_panels 권한을 승인하면 나타납니다.' }),
        S.list.length ? null : el('div', { class: 'im-muted', text: '아직 편지를 주고받는 상대가 없습니다. 「새 상대」에서 누구에게 편지를 보낼지 적어 주세요.' }),
        ...shown.map((x) => el('div', { class: 'im-card', onclick: () => go({ name: 'c', id: x.id }) }, [
          el('div', { class: 'im-row' }, [
            el('b', { class: 'im-grow', text: x.name }),
            x.unread ? el('span', { class: 'im-badge', text: String(x.unread) }) : null,
          ]),
          el('div', { class: 'im-muted', text: `${x.personaName ? `${x.personaName}의 상대 · ` : ''}그쪽은 지금 ${x.theirNow} · 시간 1:${x.ratio}` }),
          el('div', { class: x.failed ? 'im-err' : 'im-muted', text: x.status }),
        ])),
      ];
    }

    function cView() {
      const c = byId(view.id);
      if (!c) return [link('← 우편함', () => go({ name: 'home' })), el('div', { class: 'im-muted', text: '불러오는 중…' })];
      const now = Date.now();
      const exact = !!S.settings?.showExactEta;
      const s = S.list.find((x) => x.id === c.id);
      const items = c.letters.slice().reverse().map((l) => {
        if (l.from === 'me') {
          return el('div', { class: 'im-letter im-mine' }, [
            el('div', { class: 'im-muted', text: `보낸 편지 · ${when(l.sentAt)} · 그쪽 ${l.theirSentLabel}` }),
            el('div', { text: short(l.body, 140) }),
            l.state === 'in_transit'
              ? el('div', { class: 'im-row' }, [el('span', { class: 'im-muted im-grow', text: etaLabel(l.arriveAt - now, exact) }), link('회수하기', () => act(async () => {
                if (!(await confirmBox('이 편지를 회수할까요? 상대에게 가지 않습니다.'))) return;
                await ask('recall', { id: c.id, letterId: l.id });
                await refresh();
              }))])
              : el('div', { class: 'im-muted', text: `도착함 · 그쪽 ${l.theirArriveLabel}` }),
          ]);
        }
        if (l.state === 'in_transit') {
          return el('div', { class: 'im-letter' }, [
            el('div', { class: 'im-muted', text: `${c.name}의 편지가 오는 중` }),
            el('div', { text: exact ? etaLabel(l.arriveAt - now, true) : '어딘가를 건너는 중…' }),
          ]);
        }
        return el('div', { class: 'im-letter im-theirs', onclick: () => { view = { name: 'letter', id: c.id, letterId: l.id }; render(); } }, [
          el('div', { class: 'im-row' }, [
            el('b', { class: 'im-grow', text: l.state === 'delivered' ? '새 편지' : `${c.name}의 편지` }),
            l.state === 'delivered' ? el('span', { class: 'im-badge', text: '!' }) : null,
          ]),
          el('div', { class: 'im-muted', text: `도착 ${when(l.arriveAt)} · 그쪽 ${l.theirWrittenLabel}에 씀` }),
          l.state === 'opened' ? el('div', { text: short(l.body, 100) }) : el('div', { class: 'im-muted', text: l.envelope?.medium ? `봉투: ${l.envelope.medium}` : '봉투가 닫혀 있습니다' }),
        ]);
      });
      return [
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' })), el('span', { class: 'im-grow' }), panel ? link('편지첩으로 보기', () => openPanelFor(c.id)) : null, link('기록부', () => go({ name: 'report', id: c.id })), link('서류함', () => openDossier(c.id)), link('상대 정보 수정', async () => { await reloadPersonas(); go({ name: 'form', id: c.id }); })]),
        el('h3', { text: c.name }),
        el('div', { class: 'im-muted', text: `그쪽은 지금 ${c.theirNowLabel} · 시간 1:${c.ratio} (나의 하루 = 그쪽 ${formatSpan(24 * c.ratio)})` }),
        s ? el('div', { class: s.failed ? 'im-err' : 'im-muted', text: s.status }) : null,
        c.reply?.state === 'failed' ? el('div', { class: 'im-row' }, [
          el('span', { class: 'im-err im-grow', text: `사유: ${c.reply.error || '알 수 없음'}` }),
          btn('다시 시도', () => act(async () => { await ask('retry', { id: c.id }); await refresh(); })),
        ]) : null,
        composeBox(c, { busyRef: () => busy, act }),
        el('hr', { class: 'im-sep' }),
        ...(items.length ? items : [el('div', { class: 'im-muted', text: '아직 주고받은 편지가 없습니다.' })]),
      ];
    }

    function letterView() {
      const c = byId(view.id);
      const l = c?.letters.find((x) => x.id === view.letterId);
      if (!l) return [link('← 돌아가기', () => go({ name: 'c', id: view.id }))];
      return [
        el('div', { class: 'im-row' }, [link(`← ${c.name}`, () => go({ name: 'c', id: c.id }))]),
        theirLetterNode(c, l, { act }),
      ];
    }

    // 새 상대 / 수정
    // 상대 지우기: 무엇을 함께 지울지 고른다
    let removeInfo = null;
    function removeView() {
      if (!removeInfo || removeInfo.id !== view.id) {
        removeInfo = { id: view.id, loading: true };
        ask('deleteInfo', { id: view.id }).then((r) => { removeInfo = { id: view.id, ...r, pick: { removeCharacter: !!r.character?.made && !r.sharedCharacter, removeBook: !!r.book && !!r.character?.made, removeImages: true } }; render(); })
          .catch((e) => { removeInfo = { id: view.id, failed: e.message }; render(); });
      }
      const r = removeInfo;
      const back = el('div', { class: 'im-row' }, [link('← 돌아가기', () => go({ name: 'form', id: view.id }))]);
      if (r.loading) return [back, el('div', { class: 'im-muted', text: '살펴보는 중…' })];
      if (r.failed) return [back, el('div', { class: 'im-err', text: r.failed })];
      const box = (k, label, note, disabled = false) => el('label', { class: 'im-row', style: 'gap:8px;align-items:flex-start' }, [
        el('input', { type: 'checkbox', checked: !!r.pick[k], disabled, onchange: (e) => { r.pick[k] = e.target.checked; } }),
        el('div', {}, [el('div', { text: label }), note ? el('div', { class: 'im-muted', text: note }) : null]),
      ]);
      return [
        back,
        el('h3', { text: `${r.name} 지우기` }),
        el('div', { class: 'im-muted', text: `편지 ${r.letters}통 · 물건 ${r.items}개의 편지 기록은 지워집니다. 되돌릴 수 없습니다.` }),
        el('h4', { text: '함께 지울 것' }),
        r.images ? box('removeImages', `그림 ${r.images}장`, '편지지·우표·봉인·물건 그림') : el('div', { class: 'im-muted', text: '그림 없음' }),
        r.character ? box('removeCharacter', `캐릭터 「${r.character.name}」`, r.sharedCharacter ? `다른 상대 ${r.sharedCharacter}명이 이 캐릭터를 씁니다 — 남겨 두는 것이 좋아요.` : r.character.made ? '매칭으로 만든 캐릭터' : '원래 있던 캐릭터입니다(기존 캐릭터로 시작) — 보통은 남겨 둡니다.') : el('div', { class: 'im-muted', text: '연결된 캐릭터 없음' }),
        r.book ? box('removeBook', `로어북 「${r.book.name}」`, '매칭 때 만든 세계·달력·우편 로어북') : el('div', { class: 'im-muted', text: '연결된 로어북 없음' }),
        el('div', { class: 'im-row' }, [
          btn('지우기', () => act(async () => {
            if (!(await confirmBox(`${r.name}의 편지 기록${r.pick.removeImages && r.images ? '·그림' : ''}${r.pick.removeCharacter && r.character ? '·캐릭터' : ''}${r.pick.removeBook && r.book ? '·로어북' : ''}을 지울까요? 되돌릴 수 없습니다.`))) return;
            await ask('delete', { id: view.id, ...r.pick }, 60000);
            removeInfo = null;
            await refresh();
            go({ name: 'home' });
          }), { primary: true, disabled: busy }),
        ]),
      ];
    }
    // 편지지 테마 편집(미리보기 + 글 생성으로 다시 만들기 + 직접 고르기)
    function themeEditor(c, doAct) {
      const t = { ...themeOf(c) };
      const narrow = typeof window !== 'undefined' && window.innerWidth < 520;
      const preview = el('div', {});
      const draw = () => {
        const look = paperLook(t, { seed: `${c.id}-preview`, narrow });
        preview.replaceChildren(el('div', { class: 'im-themed', style: look.outer }, [
          el('span', { class: 'im-corners', html: look.corners }),
          el('div', { style: look.inner }, [el('div', { class: 'im-tmeta', style: `color:${look.metaColor}`, text: `${c.name}의 편지지 미리보기${t.note ? ` · ${t.note}` : ''}` }), el('div', { text: '바람이 바뀌는 계절이에요.\n당신 쪽에도 이런 냄새가 나는지 궁금합니다.' })]),
        ]));
      };
      const sel = (k, obj, labelOf = (v) => v) => el('select', { onchange: (e) => { t[k] = e.target.value; draw(); } }, Object.keys(obj).map((v) => el('option', { value: v, text: labelOf(v), selected: t[k] === v })));
      const color = (k) => el('input', { type: 'color', value: t[k], style: 'width:48px;height:30px;padding:0', oninput: (e) => { t[k] = e.target.value; draw(); } });
      draw();
      return el('div', { style: 'margin:4px 0 12px' }, [
        el('div', { class: 'im-row' }, [
          el('b', { class: 'im-grow', text: `편지지 꾸미기${c.paperTheme ? '' : ' (기본값 — 아직 만들지 않음)'}` }),
          link(c.paperTheme ? '다시 만들기(글 1회)' : '세계에 맞게 만들기(글 1회)', () => doAct(async () => { await ask('makeTheme', { id: c.id }, 120000); })),
        ]),
        preview,
        el('details', {}, [
          el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '직접 고르기' }),
          el('div', { class: 'im-pair' }, [
            field('글씨체', sel('font', PAPER_FONTS, (v) => PAPER_FONTS[v].label)),
            field('장식 무늬', sel('motif', PAPER_MOTIFS, (v) => PAPER_MOTIF_LABEL[v] || v)),
            field('종이 결', sel('texture', PAPER_TEXTURES, (v) => PAPER_TEXTURES[v])),
            field('가장자리', sel('edge', PAPER_EDGES, (v) => PAPER_EDGES[v])),
            field('장식 양', el('select', { onchange: (e) => { t.density = Number(e.target.value); draw(); } }, [[1, '적게'], [2, '보통'], [3, '많이']].map(([v, n]) => el('option', { value: String(v), text: n, selected: t.density === v })))),
          ]),
          el('div', { class: 'im-row', style: 'gap:12px;flex-wrap:wrap' }, [el('label', {}, ['종이 ', color('paper')]), el('label', {}, ['잉크 ', color('ink')]), el('label', {}, ['장식 ', color('accent')])]),
          btn('이 편지지로 저장', () => doAct(async () => { await ask('setTheme', { id: c.id, theme: t }); })),
          el('div', { class: 'im-muted', text: '예전 편지는 그때 편지지 그대로 남습니다(사건으로 바뀐 경우). 글씨체는 구글 글꼴을 불러오며, 막히면 기본 명조로 보입니다.' }),
        ]),
      ]);
    }
    function formView() {
      const editing = !!view.id;
      const cur = editing ? byId(view.id) : null;
      const v = cur ? {
        name: cur.name, brief: cur.brief, world: cur.world, ratio: cur.ratio, deliveryMin: cur.delivery.min, deliveryMax: cur.delivery.max,
        writeMin: cur.writeDelay.min, writeMax: cur.writeDelay.max, maxReplyRealHours: cur.maxReplyRealHours, timeScale: cur.timeScale || 1, personaId: cur.noPersona ? NONE_OPT : cur.personaId || '', waitHours: cur.waitHours ?? Math.max(72, cur.writeDelay.max * 3),
      } : {
        name: '', brief: '', world: '', ratio: 1, deliveryMin: 1, deliveryMax: 24, writeMin: 2, writeMax: 48, maxReplyRealHours: 24, timeScale: 1,
        personaId: defaultPick(),
      };
      const inputs = {};
      const text = (k, ph, rows) => (inputs[k] = rows ? el('textarea', { value: v[k] || '', placeholder: ph, rows }) : el('input', { value: v[k] ?? '', placeholder: ph }));
      const numIn = (k, step = 'any') => (inputs[k] = el('input', { type: 'number', step, min: '0', value: String(v[k] ?? '') }));
      inputs.personaId = el('select', {}, personaOptions(v.personaId));
      // 시간 칸을 사람 말로 풀어 보여 줌
      const tsum = el('div', { class: 'im-tsum' });
      const span = (h) => (h >= 48 ? `${Math.round(h / 24 * 10) / 10}일` : `${Math.round(h * 10) / 10}시간`);
      const updT = () => {
        const n = (k) => Number(inputs[k]?.value) || 0;
        const r = n('ratio') || 1;
        tsum.textContent = [
          `내 하루 = 그쪽 ${span(24 * r)}`,
          `편지는 현실 ${n('deliveryMin')}~${n('deliveryMax')}시간 걸려 닿음`,
          `상대는 받고 그쪽 시간 ${span(n('writeMin'))}~${span(n('writeMax'))} 뒤 답장(현실로는 최대 ${n('maxReplyRealHours')}시간)`,
          n('waitHours') ? `내가 답이 없으면 그쪽 시간 ${span(n('waitHours'))} 뒤 먼저 씀` : '먼저 쓰지 않음',
        ].join(' · ');
      };
      const read = () => { const o = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])); return { ...o, ...personaPick(o.personaId) }; };
      return [
        el('div', { class: 'im-row' }, [link('← 돌아가기', () => (editing ? go({ name: 'c', id: view.id }) : go({ name: 'home' })))]),
        (setTimeout(updT, 0), el('h3', { text: editing ? '상대 정보 수정' : '새 상대' })),
        field('편지를 쓰는 나 (페르소나)', inputs.personaId),
        el('div', { class: 'im-muted', text: '상대를 직접 적습니다. 캐릭터 카드·로어북 자동 생성과 무작위 매칭은 다음 단계에서 붙습니다.' }),
        field('이름', text('name', '예: 하르텐')),
        field('상대 설명 (성격·말투·처지 — 캐릭터 카드처럼 적어도 됩니다)', text('brief', '운하 도시의 빵집 주인. 수다스럽고 편지마다 오늘 구운 빵 얘기를 한다…', 6)),
        field('그쪽 세계 (선택)', text('world', '바다가 얼어붙는 북쪽 해안. 우편은 철새 다리에 묶어 보낸다…', 4)),
        el('h4', { text: '시간' }),
        tsum,
        el('div', { class: 'im-pair', oninput: updT }, [
          field('시간 비율 (나의 1 = 그쪽 ?)', numIn('ratio')),
          field('답장까지 현실 최대(시간)', numIn('maxReplyRealHours')),
          field('배송 최소(현실 시간)', numIn('deliveryMin')),
          field('배송 최대(현실 시간)', numIn('deliveryMax')),
          field('답장 쓰는 데 최소(그쪽 시간)', numIn('writeMin')),
          field('답장 쓰는 데 최대(그쪽 시간)', numIn('writeMax')),
          field('답 없으면 먼저 쓰기까지(그쪽 시간, 0=안 씀)', numIn('waitHours')),
        ]),
        el('details', {}, [
          el('summary', { class: 'im-muted', text: '시험용' }),
          field('시간 가속 (1=실제, 60=현실 1분이 1시간)', numIn('timeScale')),
        ]),
        el('div', { class: 'im-row' }, [
          btn(editing ? '저장' : '만들기', () => act(async () => {
            if (editing) {
              await ask('update', { id: view.id, input: read() });
              await refresh();
              go({ name: 'c', id: view.id });
            } else {
              const r = await ask('create', { input: read() });
              const pid = inputs.personaId.value;
              if (S.persona !== ALL) { if (pid === NONE_OPT) setPersona(NO_PERSONA); else if (pid) setPersona(pid); }
              await refresh();
              go({ name: 'c', id: r.id });
            }
          }), { primary: true, disabled: busy }),
          editing ? btn('상대 지우기…', () => go({ name: 'remove', id: view.id })) : null,
        ]),
      ];
    }

    let settingsTab = 'text';
    function settingsView() {
      const s = { ...(S.settings || {}) };
      if (!connections) {
        connections = [];
        ask('connections').then((r) => { connections = r.connections; render(); }).catch((e) => { error = e.message; render(); });
      }
      const sel = el('select', {}, [
        el('option', { value: '', text: '기본 연결 사용' }),
        ...connections.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}${x.is_default ? ' (기본)' : ''}`, selected: x.id === s.replyConnectionId })),
      ]);
      const temp = el('input', { type: 'number', step: '0.05', min: '0', max: '2', value: String(s.temperature ?? 0.9) });
      const csel = el('select', {}, [
        el('option', { value: '', text: '답장 연결과 같게' }),
        ...connections.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}`, selected: x.id === s.createConnectionId })),
      ]);
      const ctemp = el('input', { type: 'number', step: '0.05', min: '0', max: '2', value: String(s.createTemperature ?? 1) });
      const orgOn = el('input', { type: 'checkbox', style: 'width:auto', checked: s.organizeEnabled !== false });
      const initOn = el('input', { type: 'checkbox', style: 'width:auto', checked: s.initiativeEnabled !== false });
      const initDay = el('input', { type: 'number', min: '0', max: '50', step: '1', value: String(s.initiativePerDay ?? 3) });
      const initStreak = el('input', { type: 'number', min: '1', max: '10', step: '1', value: String(s.initiativeStreak ?? 2) });
      const pushOn = el('input', { type: 'checkbox', style: 'width:auto', checked: s.pushEnabled !== false });
      const A = { connectionId: '', model: '', style: '', size: '1024x1024', paperSize: '1024x1024', perDay: 6, autoItems: 'off', ...(s.art || {}) };
      if (!imageConns) { imageConns = []; ask('imageConnections').then((r) => { imageConns = r.connections; render(); }).catch(() => {}); }
      const isel = el('select', {}, [
        el('option', { value: '', text: '앱 기본 이미지 연결' }),
        ...imageConns.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}${x.is_default ? ' (기본)' : ''}`, selected: x.id === A.connectionId })),
      ]);
      // 모델은 고르기만(연결이 알려 준 목록). 목록에 없는 예전 값도 남겨 둠
      const modelSelects = [];
      const modelSel = (value, emptyText) => {
        const sel = el('select', {});
        sel.dataset.v = value || '';
        sel.dataset.empty = emptyText;
        modelSelects.push(sel);
        fillModelSel(sel, null);
        return sel;
      };
      const fillModelSel = (sel, models) => {
        const cur = (sel.options.length ? sel.value : '') || sel.dataset.v || '';
        sel.dataset.v = cur;
        const ids = (models || []).map((m) => m.id);
        sel.replaceChildren(
          el('option', { value: '', text: sel.dataset.empty }),
          ...(cur && !ids.includes(cur) ? [el('option', { value: cur, text: cur })] : []),
          ...(models || []).map((m) => el('option', { value: m.id, text: m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id })),
        );
        for (const o of sel.options) o.selected = o.value === cur;
      };
      const imodel = modelSel(A.model, '종류마다 정해 둔 모델 (비우기)');
      const ilist = el('span', {});
      const imodelNote = el('div', { class: 'im-muted', text: '' });
      const showModels = (r) => {
        for (const sel of modelSelects) fillModelSel(sel, r.models);
        imodelNote.textContent = `모델 ${r.models.length}개${r.current ? ` · 이 연결의 기본 모델: ${r.current}` : ''}.`;
      };
      const loadModels = (connId) => {
        if (modelCache[connId || '']) { showModels(modelCache[connId || '']); return; }
        imodelNote.textContent = '모델 목록을 불러오는 중…';
        ask('imageModels', { connectionId: connId }, 30000).then((r) => {
          modelCache[connId || ''] = r;
          showModels(r);
        }).catch((e) => { imodelNote.textContent = `모델 목록을 못 불러왔습니다: ${e.message}`; });
      };
      isel.addEventListener('change', () => loadModels(isel.value));
      loadModels(isel.value);
      const istyle = el('textarea', { value: A.style, rows: 3, placeholder: 'hand-painted storybook illustration, delicate ink linework, soft watercolor washes, …' });
      const KINDS = [['envelope', '봉투'], ['emblem', '상징물'], ['locker', '추억 상자'], ['item', '물건'], ['paper', '편지지 (그림 방식)'], ['stamp', '우표 (그림 방식)'], ['seal', '봉인 (그림 방식)']];
      const DEF_MODEL = { envelope: 'chroma', locker: 'chroma', emblem: 'seedream-v5.0-lite', item: 'seedream-v5.0-lite', paper: 'recraft/v4.1/flash/v2/text-to-image', stamp: 'recraft/v4.1/flash/v2/text-to-image', seal: 'recraft/v4.1/flash/v2/text-to-image' };
      const DEF_T = {
        envelope: 'closed letter as one object … its closure and postal marks are part of the picture, {style}',
        emblem: 'single small iconic object that represents a person, ornate, round vignette, {subject}, {style}',
        locker: 'shallow open tray box with no lid, front and slightly above, packed full of {subject}, {style}',
        paper: 'flat 2D stationery design … ornamental border and small corner vignettes showing {subject}, large blank center …, {style}',
        stamp: 'flat 2D postage stamp design … vintage engraved illustration of {subject} …, {style}',
        seal: 'flat 2D illustration of a seal impression seen from directly above, {subject} …, {style}',
        item: 'highly detailed illustration of {subject}, intricate textures … single object on plain paper background, {style}',
      };
      const kIn = Object.fromEntries(KINDS.map(([k]) => [k, {
        conn: el('select', {}, [el('option', { value: '', text: '위 이미지 연결' }), ...imageConns.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}`, selected: x.id === A.kinds?.[k]?.connectionId }))]),
        model: modelSel(A.kinds?.[k]?.model || '', `기본 (${DEF_MODEL[k] || '연결 기본'}, 종류 연결을 고르면 그 연결의 모델)`),
        template: el('textarea', { value: A.kinds?.[k]?.template || '', rows: 3, placeholder: `비우면 기본 양식: ${DEF_T[k]}` }),
      }]));
      const ineg = el('input', { type: 'checkbox', style: 'width:auto', checked: !!A.sendNegative });
      const inegText = el('textarea', { value: A.negative || '', rows: 2, placeholder: '비우면 기본 금지어(사진·탁자·사람·글자·숫자 등)' });
      const istrength = el('input', { type: 'number', min: '0', max: '100', step: '5', value: String(A.paperStrength ?? 70) });
      const iborder = el('input', { type: 'number', min: '0', max: '200', step: '2', value: String(A.paperBorder ?? 64) });
      const islice = el('input', { type: 'number', min: '1', max: '45', step: '1', value: String(A.paperSlice ?? 20) });
      const isize = el('input', { value: A.size, placeholder: '1024x1024' });
      const ipsize = el('input', { value: A.paperSize, placeholder: '1024x1024' });
      const iday = el('input', { type: 'number', min: '0', step: '1', value: String(A.perDay) });
      const icday = el('input', { type: 'number', min: '0', step: '1', value: String(A.perCorrespondentDay ?? 0) });
      const ion = el('select', {}, [el('option', { value: 'on', text: '씀 — 봉투·상징물·추억 상자·초상화·물건을 그림으로', selected: A.enabled !== false }), el('option', { value: 'off', text: '안 씀 — 그림 없이 모습은 글로 묘사', selected: A.enabled === false })]);
      const ipmode = el('select', {}, [
        el('option', { value: 'html', text: '꾸미기 — 편지지는 글씨체·무늬로 꾸미고, 봉투를 그림', selected: A.paperMode !== 'image' }),
        el('option', { value: 'image', text: '그림 — 예전처럼 편지지를 그림으로', selected: A.paperMode === 'image' }),
      ]);
      const iesize = el('input', { value: A.envelopeSize || '1536x1024', placeholder: '1536x1024' });
      const PP = A.portrait || {};
      const psel = el('select', {}, [
        el('option', { value: '', text: '(고르기 — NovelAI 연결)' }),
        ...imageConns.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}`, selected: x.id === PP.connectionId })),
      ]);
      const NAI_MODELS = [['nai-diffusion-4-5-full', 'NAI Diffusion V4.5 Full'], ['nai-diffusion-4-5-curated', 'NAI Diffusion V4.5 Curated'], ['nai-diffusion-5-full', 'NAI Diffusion V5 Full'], ['nai-diffusion-5-curated', 'NAI Diffusion V5 Curated']];
      const pmodel = el('select', {}, NAI_MODELS.map(([v, t]) => el('option', { value: v, text: t, selected: (PP.model || 'nai-diffusion-4-5-full') === v })));
      const pbase = el('textarea', { value: PP.base || '', rows: 5, placeholder: '비우면 기본(받은 화풍·품질 프롬프트)' });
      const pneg = el('textarea', { value: PP.negative || '', rows: 4, placeholder: '비우면 기본(받은 네거티브)' });
      const psize = el('input', { value: PP.size || '832x1216', placeholder: '832x1216' });
      const pav = el('input', { type: 'checkbox', style: 'width:auto', checked: PP.avatar !== false });
      const pavx = el('input', { type: 'checkbox', style: 'width:auto', checked: !!PP.avatarExisting });
      const prefresh = el('input', { type: 'number', min: '0', max: '100', step: '1', value: String(PP.refreshEvery ?? 8) });
      const ppic = el('input', { type: 'checkbox', style: 'width:auto', checked: PP.pictureItems !== false });
      const iauto = el('select', {}, [el('option', { value: 'all', text: '켬', selected: A.autoItems !== 'off' }), el('option', { value: 'off', text: '끔', selected: A.autoItems === 'off' })]);
      const CHG = [['event', '사건이 있을 때 (계절 변화 포함)'], ['season', '그쪽 계절이 바뀔 때만'], ['off', '끄기']];
      const ipch = el('select', {}, CHG.map(([v, t]) => el('option', { value: v, text: t, selected: (A.paperChange || 'event') === v })));
      const isch = el('select', {}, CHG.map(([v, t]) => el('option', { value: v, text: t, selected: (A.stampChange || 'event') === v })));
      const osel = el('select', {}, [
        el('option', { value: '', text: '답장 연결과 같게' }),
        ...connections.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}`, selected: x.id === s.organizeConnectionId })),
      ]);
      const otemp = el('input', { type: 'number', step: '0.05', min: '0', max: '2', value: String(s.organizeTemperature ?? 0.3) });
      const B = { summaries: 20, summaryChars: 2400, chapterChars: 1600, chapterEvery: 10, timelineItems: 12, ledgerChars: 1600, loreChars: 6000, recallChars: 1800, ...(s.budgets || {}) };
      const BL = [['summaries', '편지 요약 통수'], ['summaryChars', '편지 요약 글자'], ['chapterChars', '시기 요약 글자'], ['chapterEvery', '시기 요약 간격(통)'], ['timelineItems', '그쪽 사건 개수'], ['ledgerChars', '관계 장부 글자'], ['loreChars', '로어북 글자'], ['recallChars', '옛 편지 회상 글자(0=끔)']];
      const bIn = Object.fromEntries(BL.map(([k]) => [k, el('input', { type: 'number', step: '1', min: '0', value: String(B[k]) })]));
      const maxT = el('input', { type: 'number', step: '100', min: '500', value: String(s.maxTokens ?? 6000) });
      const recent = el('input', { type: 'number', step: '1', min: '1', max: '20', value: String(s.recentLetters ?? 6) });
      const exact = el('input', { type: 'checkbox', checked: !!s.showExactEta, style: 'width:auto' });
      const fontPrev = el('div', { class: 'im-font-prev', text: '오늘은 창가에 앉아 당신 편지를 다시 읽었어요.' });
      const setPrev = (k) => { const f = PAPER_FONTS[k]; fontPrev.style.fontFamily = f ? `"${f.family}","Nanum Myeongjo",serif` : '"Nanum Myeongjo","Noto Serif KR",serif'; fontPrev.style.fontSize = f ? `${(15 * f.size).toFixed(1)}px` : '15px'; };
      const fontSel = el('select', { onchange: (e) => setPrev(e.target.value) }, [el('option', { value: '', text: '기본 (나눔명조)', selected: !s.myFont }), ...Object.entries(PAPER_FONTS).map(([k, f]) => el('option', { value: k, text: f.label, selected: s.myFont === k }))]);
      setPrev(s.myFont || '');
      const STY = Object.keys(PROSE_STYLES);
      const styCur = s.proseStyle || 'plain';
      const stySel = el('select', {}, [...STY.map((k) => el('option', { value: k, text: PROSE_STYLES[k], selected: styCur === k })), el('option', { value: 'custom', text: '직접 적기', selected: !STY.includes(styCur) })]);
      const styText = el('input', { value: STY.includes(styCur) ? '' : styCur, placeholder: '예: 오래된 박물관 도록처럼 / 시인의 메모처럼 짧게' });
      const lMin = el('input', { type: 'number', step: '100', min: '0', value: String(s.letterMin ?? 1000) });
      const lMax = el('input', { type: 'number', step: '100', min: '0', value: String(s.letterMax ?? 0) });
      const lateIn = el('input', { type: 'number', step: '1', min: '0', max: '50', value: String(s.lateChance ?? 8) });
      const fbMode = el('select', {}, [el('option', { value: 'auto', text: '켬', selected: s.fallbackMode !== 'off' }), el('option', { value: 'off', text: '끔', selected: s.fallbackMode === 'off' })]);
      const fbSel = el('select', {}, [
        el('option', { value: '', text: '자동 — 다른 공급자의 같은 모델 연결을 찾음' }),
        ...(connections || []).map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}`, selected: x.id === s.fallbackConnectionId })),
      ]);
      // 탭으로 나눔(입력칸은 한 번만 만들고 보이기만 바꿔서, 탭을 오가도 적던 값이 남음)
      const groups = {
        text: el('div', {}, [
        field('답장 쓰기 연결', sel),
        el('div', { class: 'im-pair' }, [field('막히면 대체 연결 쓰기', fbMode), field('대체 연결', fbSel)]),
        el('div', { class: 'im-muted', text: '원래 연결(Vertex 등)이 한도(429)·서버 오류로 막히면 8초·20초 뒤 다시 해 보고, 그래도 안 되면 대체 연결로 보냅니다(답장·정리·상대 만들기·그림 프롬프트 모두). 대체 연결은 루미버스 연결 목록에서 고르세요 — 연결 설정에서 하나 복사해 대체용으로 만들어 두면 편합니다. 「자동」은 공급자가 다르고 모델 이름이 같은 연결을 찾습니다.' }),
        field('상대 만들기 연결 (비우면 답장 연결)', csel),
        field('상대 만들기 온도', ctemp),
        el('h4', { text: '정리 단계 (답장마다 1회 더 생성)' }),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [orgOn, '답장이 오면 요약·관계 장부·로어북·카드를 정리하기']),
        field('정리 연결 (비우면 답장 연결)', osel),
        field('정리 온도', otemp),
        el('div', { class: 'im-pair' }, [field('온도', temp), field('최대 출력 토큰', maxT)]),
        field('프롬프트에 넣는 최근 편지 수(양쪽 합)', recent),
        el('div', { class: 'im-pair' }, [field('답장 본문 최소 글자 (0=자유)', lMin), field('답장 본문 최대 글자 (0=제한 없음)', lMax)]),
        el('div', { class: 'im-pair' }, [field('묘사·기록부 문체', stySel), field('직접 적는 문체 (「직접 적기」일 때)', styText)]),
        field('내 편지 글씨체', fontSel),
        fontPrev,
        el('div', { class: 'im-muted', text: '모습 글(그림을 안 쓸 때)과 기록부에 쓰는 문체예요. 편지 자체의 말투는 상대 성격을 따라요.' }),
        el('div', { class: 'im-muted', text: '예: 최소 1000 · 최대 0 = 1000자 이상, 일이 많으면 더 길게. 짧은 편지를 원하면 최소 0 · 최대 1000. 길게 쓰려면 최대 출력 토큰도 넉넉히(한국어 1000자 ≈ 1500토큰 + 사이 일 기록).' }),
        el('div', { class: 'im-muted', text: '연결에 붙은 프리셋은 쓰지 않고, 이세계 편지가 자기 지시문과 위 값을 보냅니다.' }),
        ]),
        img: el('div', {}, [
        el('h4', { text: '그림 (NanoGPT 등 이미지 연결)' }),
        field('그림 사용', ion),
        el('div', { class: 'im-muted', text: '안 쓰면 그리기 버튼이 사라지고, 상대의 모습·상징물·봉투·추억 상자는 「모습을 글로 받기」(글 1회)로 고른 문체의 글이 돼요. 편지지 꾸미기(글씨체·무늬)는 그대로예요.' }),
        field('이미지 연결', isel),
        field('전체 기본 모델 (비우면 종류마다 정해 둔 모델)', imodel),
        ilist,
        imodelNote,
        el('div', { class: 'im-pair' }, [field('편지지 방식', ipmode), field('받은 물건 자동 그리기', iauto), field('하루 최대 장수', iday), field('상대 한 명 하루 최대(0=제한 없음)', icday), field('편지지 바뀜 (꾸미기면 테마·봉투가 바뀜)', ipch)]),
        el('div', { class: 'im-muted', text: '편지지 「꾸미기」: 편지지는 글씨체·무늬로 꾸미고 봉투·상징물·추억 상자를 그림으로. 사건이 생기면 그 편지부터 편지지 테마와 봉투가 바뀝니다.' }),
        field('전체 룩 (영어, 양식의 {style} 자리에 들어감)', istyle),
        el('details', {}, [
          el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '종류별 모델·양식 (봉투·상징물·추억 상자·물건 …)' }),
          el('div', { class: 'im-muted', text: '모델 칸을 비우면 종류마다 정해 둔 모델(봉투·상자: chroma, 상징물·물건: seedream-v5.0-lite)을 씁니다. {subject}는 글 생성이 써 주는 주제, {style}은 전체 룩.' }),
          ...KINDS.flatMap(([k, t]) => [el('h4', { text: t }), el('div', { class: 'im-pair' }, [field('연결', kIn[k].conn), field('모델 (위 이미지 연결의 목록)', kIn[k].model)]), field('양식', kIn[k].template)]),
          el('label', { class: 'im-row', style: 'flex-direction:row' }, [ineg, '금지어를 negative prompt로 보내기 (받지 않는 모델이 많아요. 거절되면 빼고 다시 시도합니다)']),
          field('금지어', inegText),
          field('그림 크기', isize), field('봉투 크기', iesize),
        ]),
        el('details', {}, [
          el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '편지지를 그림으로 쓸 때 (그림 방식 전용)' }),
          el('div', { class: 'im-pair' }, [
            field('편지지 크기', ipsize), field('우표 바뀜', isch),
            field('편지지 테두리 두께(px) — 글씨는 이 안쪽에만', iborder),
            field('그림에서 테두리로 쓸 비율(%)', islice),
            field('글씨 칸 선명도 (100=그림 그대로, 낮을수록 크림색으로 덮음)', istrength),
          ]),
        ]),
        el('div', { class: 'im-muted', text: '만든 그림은 이 브라우저에서 WebP로 바꿔 다시 저장합니다(원본 png는 지움).' }),
        ]),
        portrait: el('div', {}, [
        el('h4', { text: '초상화 (NovelAI V4.5 Full)' }),
        el('div', { class: 'im-muted', text: '상대의 카드를 읽어 글 생성이 NovelAI 태그 프롬프트(외형 고정 → 캐릭터 칸, 구도·배경 → 기본 칸)를 쓰고, 아래 화풍 프롬프트와 합쳐 그립니다. 상대 서류함의 「초상화 그리기」로 시작합니다. 글 1회 + 그림 1장.' }),
        field('NovelAI 이미지 연결', psel),
        el('div', { class: 'im-pair' }, [field('모델', pmodel), field('크기', psize)]),
        field('화풍·품질 프롬프트 (기본 칸 앞에 붙음 — 인원 태그는 캐릭터 쪽이 정함)', pbase),
        field('네거티브', pneg),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [pav, '매칭으로 만든 캐릭터의 아바타로 쓰기']),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [pavx, '원래 있던 캐릭터(기존 캐릭터로 시작)도 아바타 바꾸기']),
        field('초상화를 요즘 모습으로 새로 그리기: 상대 편지 몇 통마다 (0=안 함)', prefresh),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [ppic, '상대가 보낸 사진·그림·초상류 동봉은 NovelAI로 그리기']),
        ]),
        flow: el('div', {}, [
        el('h4', { text: '배송' }),
        el('div', { class: 'im-pair' }, [field('우체부가 늦을 확률(%, 0=끔)', lateIn)]),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [exact, '배송 중 남은 시간을 분 단위로 보기']),
        el('h4', { text: '먼저 오는 편지' }),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [initOn, '내가 오래 답장하지 않으면 상대가 먼저 쓰기']),
        el('div', { class: 'im-pair' }, [field('하루 최대(전체)', initDay), field('답 없이 연달아 쓰는 최대 통수', initStreak)]),
        el('div', { class: 'im-muted', text: '얼마나 기다릴지는 상대마다 다릅니다(그쪽 시간 기준, 상대 정보 수정에서 바꿈). 기다림이 차면 그 뒤 무작위 시점에 씁니다. 답장 생성 1회가 듭니다.' }),
        el('h4', { text: '알림' }),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [pushOn, '편지가 도착하면 푸시 알림 보내기']),
        el('div', { class: 'im-muted', text: '알림을 받을 기기에서 루미버스 설정의 알림 등록을 해 두어야 합니다. 앱 화면이 열려 있으면 알림은 생략됩니다.' }),
        btn('알림 시험 (30초 뒤 보냄)', () => act(async () => {
          const r = await ask('pushTest', { delaySec: 30 });
          error = `${r.delaySec}초 뒤에 시험 알림을 보냅니다. 그사이 루미버스 화면(모든 탭·창)을 닫거나 다른 앱으로 가 주세요.`;
        })),
        ]),
        etc: el('div', {}, [
        el('h4', { text: '기억 예산 (프롬프트에 넣는 양)' }),
        el('div', { class: 'im-pair' }, BL.map(([k, t]) => field(t, bIn[k]))),
        el('div', { class: 'im-muted', text: '최근 원문 통수는 「글」 탭의 최근 편지 수입니다. 예산을 넘어 빠진 양은 상대 서류함 → 고급의 모의 조립에서 보입니다.' }),
        el('h4', { text: '백업' }),
        el('div', { class: 'im-muted', text: '모든 상대의 편지·물건·기억·설정과 캐릭터 카드·로어북 사본을 파일 하나로 저장합니다. 그림은 루미버스에 남아 있는 것만 다시 보입니다.' }),
        el('div', { class: 'im-row' }, [
          btn('백업 파일 받기', () => act(async () => {
            const data = await ask('exportAll', {}, 120000);
            const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
            const a = el('a', { href: URL.createObjectURL(blob), download: `isekai-mailbox-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            error = `상대 ${data.correspondents.length}명을 백업했습니다.`;
          })),
          (() => {
            const file = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: (e) => act(async () => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              let backup;
              try { backup = JSON.parse(await f.text()); } catch { throw new Error('JSON 파일을 읽지 못했습니다.'); }
              if (backup?.kind !== 'isekai_mailbox_backup') throw new Error('이세계 편지 백업 파일이 아닙니다.');
              const n = backup.correspondents?.length || 0;
              const replace = await confirmBox(`백업의 상대 ${n}명을 되살립니다.\n\n이미 있는 상대를 백업 내용으로 덮어쓸까요?\n확인 = 덮어쓰기 / 취소 = 없는 상대만 추가`);
              const withSettings = await confirmBox('백업의 설정도 되살릴까요? (취소 = 지금 설정 유지)');
              const r = await ask('importAll', { backup, replace, withSettings }, 300000);
              await refresh();
              error = `되살렸습니다: 추가 ${r.added} · 덮어씀 ${r.replaced} · 건너뜀 ${r.skipped}${r.characters ? ` · 캐릭터 새로 ${r.characters}` : ''}${r.books ? ` · 로어북 새로 ${r.books}` : ''}`;
            }) });
            return el('span', {}, [file, btn('백업 파일 되살리기', () => file.click())]);
          })(),
        ]),
        el('h4', { text: '편지첩 여는 방식 (이 기기, 새로 고침 뒤 적용)' }),
        el('select', { onchange: (e) => { lsSet(LS_PANEL_MODE, e.target.value); error = '여는 방식을 바꿨습니다. 페이지를 새로 고치면 적용됩니다.'; render(); } }, [
          el('option', { value: 'page', text: '채팅창처럼 화면 가득 (왼쪽 상대 목록 + 편지첩) — 권한 app_manipulation 필요', selected: lsGet(LS_PANEL_MODE, 'page') === 'page' }),
          el('option', { value: 'dock', text: '오른쪽에 붙이기 (메인 화면이 옆으로 밀림)', selected: lsGet(LS_PANEL_MODE, 'page') === 'dock' }),
          el('option', { value: 'float', text: '떠 있는 창 (메인 화면 위에 겹침, 끌어서 옮김)', selected: lsGet(LS_PANEL_MODE, 'page') === 'float' }),
        ]),
        el('div', { class: 'im-muted', text: pageMode ? '지금: 채팅창처럼 화면 가득' : panelMode === 'float' ? '지금: 떠 있는 창' : (lsGet(LS_PANEL_MODE, 'page') === 'page' ? '지금: 오른쪽에 붙이기 (화면 가득 방식은 확장 패널에서 app_manipulation 권한을 승인해야 합니다)' : '지금: 오른쪽에 붙이기') }),
        ]),
      };
      const TABS = [["text","글"],["img","그림"],["portrait","초상화"],["flow","편지 흐름"],["etc","기억·기타"]];
      const tabBtns = TABS.map(([k, t]) => el('button', { type: 'button', class: settingsTab === k ? 'im-on' : '', text: t, onclick: () => { settingsTab = k; for (const [g, node] of Object.entries(groups)) node.style.display = g === k ? '' : 'none'; tabBtns.forEach((b, i) => { b.className = TABS[i][0] === k ? 'im-on' : ''; }); } }));
      for (const [g, node] of Object.entries(groups)) node.style.display = g === settingsTab ? '' : 'none';
      return [
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' }))]),
        el('h3', { text: '설정' }),
        el('div', { class: 'im-tabs im-subtabs' }, tabBtns),
        ...Object.values(groups),
        el('div', { class: 'im-muted', style: 'margin-top:10px', text: '저장은 모든 탭의 값을 한꺼번에 저장합니다.' }),
        btn('저장', () => act(async () => {
          S.settings = (await ask('saveSettings', { settings: { replyConnectionId: sel.value, createConnectionId: csel.value, createTemperature: ctemp.value, art: { connectionId: isel.value, model: imodel.value, style: istyle.value, size: isize.value, paperSize: ipsize.value, perDay: Number(iday.value), perCorrespondentDay: Number(icday.value), enabled: ion.value !== 'off', paperMode: ipmode.value, envelopeSize: iesize.value, autoItems: iauto.value, paperChange: ipch.value, stampChange: isch.value, sendNegative: ineg.checked, negative: inegText.value, paperStrength: Number(istrength.value), paperBorder: Number(iborder.value), paperSlice: Number(islice.value), kinds: Object.fromEntries(Object.entries(kIn).map(([k, v]) => [k, { model: v.model.value, template: v.template.value, connectionId: v.conn.value }])), portrait: { connectionId: psel.value, model: pmodel.value, base: pbase.value, negative: pneg.value, size: psize.value, avatar: pav.checked, avatarExisting: pavx.checked, refreshEvery: Number(prefresh.value), pictureItems: ppic.checked } }, initiativeEnabled: initOn.checked, initiativePerDay: Number(initDay.value), initiativeStreak: Number(initStreak.value), pushEnabled: pushOn.checked, organizeEnabled: orgOn.checked, organizeConnectionId: osel.value, organizeTemperature: otemp.value, budgets: Object.fromEntries(Object.entries(bIn).map(([k, i]) => [k, Number(i.value)])), temperature: temp.value, maxTokens: maxT.value, recentLetters: recent.value, letterMin: Number(lMin.value), letterMax: Number(lMax.value), lateChance: Number(lateIn.value), myFont: fontSel.value, proseStyle: stySel.value === 'custom' ? (styText.value.trim() || 'plain') : stySel.value, fallbackMode: fbMode.value, fallbackConnectionId: fbSel.value, showExactEta: exact.checked } })).settings;
          go({ name: 'home' });
        }), { primary: true }),
      ];
    }

    // ── 새 상대(매칭) ──
    const M = { mode: 'prompt', request: '', dice: '', exclude: '', characterId: '', personaId: '', firstBy: 'them', ratioMin: '', ratioMax: '', deliveryMin: '', deliveryMax: '', timeScale: '1', characters: null, draft: null };
    const MODES = [['prompt', '원하는 상대 적기'], ['random', '무작위로 만나기'], ['existing', '기존 캐릭터'], ['manual', '직접 다 적기']];
    function matchView() {
      if (!M.personaId) M.personaId = defaultPick();
      if (M.mode === 'existing' && !M.characters) {
        M.characters = [];
        ask('characters').then((r) => { M.characters = r.characters; render(); }).catch((e) => { error = e.message; render(); });
      }
      const bind = (k, tag = 'input', props = {}) => el(tag, { ...props, value: M[k], oninput: (e) => { M[k] = e.target.value; } });
      const personaSel = el('select', { onchange: (e) => { M.personaId = e.target.value; } }, personaOptions(M.personaId));
      const body = [];
      if (M.mode === 'prompt') {
        body.push(field('어떤 상대와 편지하고 싶나요?', bind('request', 'textarea', { rows: 5, placeholder: '예: 왕도 뒷골목 전당포의 젊은 주인. 능청스럽고 손님 험담을 즐긴다. 편지는 장부 뒷면에 쓴다.' })));
      } else if (M.mode === 'random') {
        body.push(field('세계의 씨앗 (비우면 주사위)', bind('dice', 'input', { placeholder: '예: 사막의 대상로 / 하늘에 뜬 섬' })));
        body.push(el('div', { class: 'im-muted', text: '세계·키워드·종족(인외 포함)·성별·나이(성인~40대)·직업 예시를 주사위로 굴려 참고만 하고, 세계에 맞게 창의적으로 만듭니다. 이미 편지하는 상대와는 겹치지 않게 합니다.' }));
        body.push(field('빼고 싶은 소재 (선택)', bind('exclude', 'input', { placeholder: '예: 전쟁, 용' })));
      } else if (M.mode === 'existing') {
        body.push(field('편지할 캐릭터', el('select', { onchange: (e) => { M.characterId = e.target.value; } }, [
          el('option', { value: '', text: M.characters?.length ? '고르기' : '불러오는 중…' }),
          ...(M.characters || []).map((c) => el('option', { value: c.id, text: c.books ? `${c.name} (로어북 ${c.books})` : c.name, selected: c.id === M.characterId })),
        ])));
        body.push(el('div', { class: 'im-muted', text: '원본 카드와 로어북은 바꾸지 않고, 우편 설정과 「〈이름〉 · 이세계 편지」 로어북만 새로 만듭니다.' }));
      }
      return [
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' }))]),
        el('h3', { text: '새 상대' }),
        el('div', { class: 'im-chips' }, MODES.map(([k, t]) => el('button', { class: `im-chip im-plain${M.mode === k ? ' im-on' : ''}`, type: 'button', text: t, onclick: () => {
          if (k === 'manual') { go({ name: 'form' }); return; }
          M.mode = k; render();
        } }))),
        field('편지를 쓰는 나 (페르소나)', personaSel),
        ...body,
        field('첫 편지', el('select', { onchange: (e) => { M.firstBy = e.target.value; } }, [
          el('option', { value: 'them', text: '상대가 먼저 (낯선 편지가 도착)', selected: M.firstBy === 'them' }),
          el('option', { value: 'me', text: '내가 먼저', selected: M.firstBy === 'me' }),
        ])),
        el('details', {}, [
          el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '시간 범위 정하기 (비우면 세계에 맞춰 AI가 정함)' }),
          el('div', { class: 'im-pair' }, [
            field('시간 비율 최소', bind('ratioMin', 'input', { type: 'number', step: 'any', min: '0' })),
            field('시간 비율 최대', bind('ratioMax', 'input', { type: 'number', step: 'any', min: '0' })),
            field('배송 최소(시간)', bind('deliveryMin', 'input', { type: 'number', step: 'any', min: '0' })),
            field('배송 최대(시간)', bind('deliveryMax', 'input', { type: 'number', step: 'any', min: '0' })),
          ]),
          field('시험용 시간 가속 (1=실제)', bind('timeScale', 'input', { type: 'number', step: '1', min: '1' })),
        ]),
        el('div', { class: 'im-muted', text: '「만들기」를 누르면 상대 만들기 연결로 생성을 1회 합니다. 미리보기에서 고치고 확정해야 캐릭터·로어북이 만들어집니다.' }),
        btn(busy ? '만드는 중… (30초~1분)' : '만들기', () => act(async () => {
          const r = await ask('matchDraft', {
            mode: M.mode, request: M.request, dice: M.dice, exclude: M.exclude, characterId: M.characterId, ...personaPick(M.personaId), firstBy: M.firstBy,
            ranges: { ratioMin: M.ratioMin, ratioMax: M.ratioMax, deliveryMin: M.deliveryMin, deliveryMax: M.deliveryMax },
          }, 240000);
          M.draft = r.draft;
          view = { name: 'preview' };
        }), { primary: true, disabled: busy }),
      ];
    }

    // 미리보기: 모든 칸을 고칠 수 있다
    function previewView() {
      const d = M.draft;
      if (!d) return [link('← 새 상대', () => go({ name: 'match' }))];
      const txt = (obj, k, rows, ph = '') => el(rows ? 'textarea' : 'input', { value: obj[k] ?? '', rows, placeholder: ph, oninput: (e) => { obj[k] = e.target.value; } });
      const numIn = (obj, k) => el('input', { type: 'number', step: 'any', min: '0', value: String(obj[k] ?? ''), oninput: (e) => { obj[k] = e.target.value; } });
      const entryNodes = d.entries.map((e, i) => el('div', { class: 'im-letter' }, [
        el('div', { class: 'im-row' }, [
          el('input', { value: e.title, class: 'im-grow', style: 'flex:1', oninput: (ev) => { e.title = ev.target.value; } }),
          el('label', { class: 'im-row', style: 'flex-direction:row;white-space:nowrap' }, [el('input', { type: 'checkbox', style: 'width:auto', checked: e.constant, onchange: (ev) => { e.constant = ev.target.checked; render(); } }), '항상']),
          link('빼기', () => { d.entries.splice(i, 1); render(); }),
        ]),
        e.constant ? null : el('input', { value: e.keys.join(', '), placeholder: '키워드(쉼표로)', oninput: (ev) => { e.keys = ev.target.value.split(',').map((x) => x.trim()).filter(Boolean); } }),
        el('textarea', { value: e.content, rows: 4, oninput: (ev) => { e.content = ev.target.value; } }),
      ]));
      const fl = d.firstLetter;
      return [
        el('div', { class: 'im-row' }, [link('← 다시 적기', () => go({ name: 'match' })), el('span', { class: 'im-grow' }), btn(busy ? '…' : '다시 만들기(1회)', () => act(async () => {
          const r = await ask('matchDraft', {
            mode: M.mode, request: M.request, dice: M.dice, exclude: M.exclude, characterId: M.characterId, ...personaPick(M.personaId), firstBy: M.firstBy,
            ranges: { ratioMin: M.ratioMin, ratioMax: M.ratioMax, deliveryMin: M.deliveryMin, deliveryMax: M.deliveryMax },
          }, 240000);
          M.draft = r.draft;
        }), { disabled: busy })]),
        el('h3', { text: '미리보기' }),
        d.roll ? el('div', { class: 'im-muted', text: `주사위: ${d.roll}` }) : d.dice ? el('div', { class: 'im-muted', text: `세계의 씨앗: ${d.dice}` }) : null,
        d.warnings?.length ? el('div', { class: 'im-err', text: `확인할 점: ${d.warnings.join(' / ')}` }) : null,
        field('이름', txt(d, 'name')),
        d.card ? el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
          el('h4', { text: '캐릭터 카드' }),
          field('description', txt(d.card, 'description', 10)),
          field('personality', txt(d.card, 'personality', 6)),
          field('never (post_history_instructions)', txt(d.card, 'never')),
        ]) : el('div', { class: 'im-muted', text: '기존 캐릭터 카드를 그대로 씁니다.' }),
        el('h4', { text: '시간과 우편' }),
        d.mail.ratioReason ? el('div', { class: 'im-muted', text: d.mail.ratioReason }) : null,
        el('div', { class: 'im-pair' }, [
          field('시간 비율 (나의 1 = 그쪽 ?)', numIn(d.mail, 'ratio')),
          field('배송 최소(현실 시간)', numIn(d.mail, 'deliveryMin')),
          field('배송 최대(현실 시간)', numIn(d.mail, 'deliveryMax')),
          field('답장 쓰는 데 최소(그쪽 시간)', numIn(d.mail, 'writeMin')),
          field('답장 쓰는 데 최대(그쪽 시간)', numIn(d.mail, 'writeMax')),
          field('답 없으면 먼저 쓰기까지(그쪽 시간)', numIn(d.mail, 'waitHours')),
          field('편지 매체', txt(d.mail, 'medium')),
          field('봉인', txt(d.mail, 'seal')),
          field('우표·표식', txt(d.mail, 'stampMotif')),
          field('냄새', txt(d.mail, 'scent')),
          field('감촉', txt(d.mail, 'texture')),
        ]),
        el('h4', { text: '그쪽 달력' }),
        el('div', { class: 'im-muted', text: calSummary(d.calendar) }),
        d.calendar ? el('div', { class: 'im-pair' }, [
          field('하루 길이(시간)', el('input', { type: 'number', min: '6', max: '100', value: String(d.calendar.dayHours), oninput: (e) => { d.calendar.dayHours = Number(e.target.value) || 24; } })),
          field('연도 표기(숫자 뒤)', el('input', { value: d.calendar.yearLabel || '', oninput: (e) => { d.calendar.yearLabel = e.target.value; } })),
        ]) : null,
        d.calendar ? field('달 (한 줄에 「이름 | 일수」)', el('textarea', { rows: 4, value: monthsToText(d.calendar), oninput: (e) => { d.calendar.months = textToMonths(e.target.value); } })) : null,
        el('h4', { text: `로어북 「${d.worldTitle}」 · ${d.entries.length}항목` }),
        ...entryNodes,
        link('+ 항목 더하기', () => { d.entries.push({ title: '새 항목', keys: [], content: '', constant: false }); render(); }),
        fl ? el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
          el('h4', { text: '상대의 첫 편지' }),
          el('div', { class: 'im-paper im-theirs' }, [
            el('div', { class: 'im-meta', text: [fl.envelope?.medium, fl.envelope?.scent].filter(Boolean).join(' · ') }),
            el('div', { text: fl.body + (fl.ps ? `\n\n추신. ${fl.ps}` : '') }),
            fl.enclosures?.length ? el('div', { class: 'im-encl' }, fl.enclosures.map((x) => el('div', { text: `동봉 · ${x.item}` }))) : null,
          ]),
          el('div', { class: 'im-muted', text: '확정하면 이 편지가 배송되기 시작합니다(미리 읽은 셈이지만, 도착하면 봉투부터 다시 열어 볼 수 있어요).' }),
        ]) : el('div', { class: 'im-muted', text: '첫 편지는 내가 씁니다.' }),
        btn(busy ? '만드는 중…' : '확정 — 캐릭터·로어북 만들기', () => act(async () => {
          const r = await ask('matchConfirm', { draft: d, ...personaPick(M.personaId), timeScale: M.timeScale }, 60000);
          M.draft = null;
          await refresh();
          go({ name: 'c', id: r.id });
        }), { primary: true, disabled: busy }),
      ];
    }

    // ── 상대 서류함 ──
    let D = null; // { id, data }
    async function openDossier(id) {
      view = { name: 'dossier', id };
      D = null; render();
      try { D = { id, data: await ask('dossier', { id }) }; } catch (e) { error = e.message; }
      render();
    }
    const STATE = { applied: '적용됨', pending: '승인 대기', apply: '적용 중', failed: '실패', reverted: '되돌림', rejected: '거절', locked: '잠김(제안만)', conflict: '충돌' };
    const MODE_LABEL = { auto: '자동', approve: '승인 후', off: '끔' };
    let dossierTab = 'look';
    function dossierView() {
      const c = byId(view.id);
      const back = el('div', { class: 'im-row' }, [link(`← ${c?.name || '상대'}`, () => go({ name: 'c', id: view.id })), el('span', { class: 'im-grow' }), link('새로 고침', () => openDossier(view.id))]);
      if (!D || D.id !== view.id) return [back, el('div', { class: 'im-muted', text: '불러오는 중…' })];
      const d = D.data;
      const L = d.memory.ledger || {};
      const list = (title, items, fmt) => (items?.length ? el('div', {}, [el('b', { text: title }), ...items.map((x) => el('div', { class: 'im-muted', text: `· ${fmt ? fmt(x) : x}` }))]) : null);
      const o = d.organize;
      const doAct = (fn) => act(async () => { await fn(); await openDossier(view.id); });
      const changeRow = (x) => el('div', { class: 'im-letter' }, [
        el('div', { class: 'im-row' }, [
          el('b', { class: 'im-grow', text: `${x.target === 'lore' ? '로어북' : x.target === 'card' ? '카드' : '충돌'} · ${x.key}${x.op === 'add' ? ' (새로)' : ''}` }),
          el('span', { class: x.state === 'failed' || x.state === 'conflict' ? 'im-err' : 'im-muted', text: STATE[x.state] || x.state }),
        ]),
        x.reason ? el('div', { class: 'im-muted', text: `이유: ${x.reason}` }) : null,
        x.before ? el('div', { class: 'im-muted', style: 'text-decoration:line-through', text: short(x.before, 300) }) : null,
        x.after ? el('div', { text: short(x.after, 400) }) : null,
        x.error ? el('div', { class: 'im-err', text: x.error }) : null,
        el('div', { class: 'im-row' }, [
          ['pending', 'locked', 'failed'].includes(x.state) && x.target !== 'conflict' ? btn('적용', () => doAct(() => ask('change', { id: view.id, changeId: x.id, action: 'approve' }))) : null,
          ['pending', 'locked', 'failed', 'conflict'].includes(x.state) ? btn(x.state === 'conflict' ? '확인함' : '거절', () => doAct(() => ask('change', { id: view.id, changeId: x.id, action: 'reject' }))) : null,
          x.state === 'applied' ? btn('되돌리기', () => doAct(() => ask('change', { id: view.id, changeId: x.id, action: 'revert' }))) : null,
        ]),
      ]);
      const changes = [...(d.memory.changes || [])].reverse();
      const waiting = changes.filter((x) => ['pending', 'conflict', 'failed'].includes(x.state));
      // 규칙
      const lockText = el('input', { value: d.locks.join(', '), placeholder: 'first_line, core, fixed, never, 세계 개요' });
      const modeSel = (k, label) => field(label, el('select', { 'data-k': k }, ['auto', 'approve', 'off'].map((m) => el('option', { value: m, text: MODE_LABEL[m], selected: d.applyMode[k] === m }))));
      const modes = el('div', { class: 'im-pair' }, [
        modeSel('loreAdd', '로어북 추가'), modeSel('loreEdit', '로어북 수정'), modeSel('cardAdd', '카드 칸 추가'), modeSel('cardEdit', '카드 칸 수정'), modeSel('origLore', '원본 캐릭터 로어북 수정'),
      ]);
      // 탭: 모습·편지지 / 기억 / 달력 / 고급(규칙·모의 조립). 다시 그려져도 고른 탭 유지
      const groups = {
        look: el('div', {}, [
        // 그림
        el('h4', { text: `그림${S.art?.left !== undefined ? ` · 오늘 남은 ${S.art.left}장` : ''}` }),
        c && !artOn() ? lookCards(c, doAct) : null,
        c && artOn() ? artBar(c, doAct) : null,
        c && artOn() ? (() => {
          const pimg = c.art?.portrait?.imageId;
          const job = c.portraitJob;
          const sec = job?.startedAt ? Math.max(0, Math.round((Date.now() - job.startedAt) / 1000)) : 0;
          const st = job?.state === 'drawing' ? `그리는 중… ${sec < 60 ? `${sec}초째` : `${Math.floor(sec / 60)}분 ${sec % 60}초째`}` : job?.state === 'failed' ? `실패 — ${short(job.error || '', 80)}` : '';
          return el('div', { class: 'im-row', style: 'align-items:flex-start;gap:12px;margin:6px 0 10px' }, [
            el('div', { class: 'im-pic', style: 'width:120px;aspect-ratio:832/1216;flex:none' }, [pimg ? el('img', { src: imgUrl(pimg, 'lg'), alt: `${c.name} 초상화`, style: 'cursor:zoom-in;object-fit:cover;width:100%;height:100%', onclick: () => openImage(pimg, `${c.name} · 초상화`, c.art.portrait.character || '') }) : el('span', { html: PIC })]),
            el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
              el('b', { text: '초상화 (NovelAI)' }),
              st ? el('div', { class: job.state === 'failed' ? 'im-err' : 'im-muted', text: st }) : null,
              btn(pimg ? '초상화 다시 그리기' : '초상화 그리기', () => doAct(async () => {
                if (!(await confirmBox(`${c.name}의 초상화를 ${pimg ? '다시 ' : ''}그립니다. 글 생성 1회 + 그림 1장(NovelAI). 계속할까요?`))) return;
                await ask('drawPortrait', { id: view.id });
              }), { disabled: job?.state === 'drawing' }),
              c.art?.portrait?.character ? el('details', {}, [el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '쓴 프롬프트' }), el('div', { class: 'im-muted', style: 'font-size:11px;white-space:pre-wrap', text: `[캐릭터]\n${c.art.portrait.character}\n\n[기본]\n${c.art.portrait.prompt}` })]) : null,
            ]),
          ]);
        })() : null,
        c && htmlPaper() ? themeEditor(c, doAct) : null,
        !artOn() ? null : el('div', { class: 'im-grid' }, [...setKindsUi(), 'locker'].map((k) => {
          const img = c?.art?.[k]?.imageId;
          const label = KIND_LABEL[k];
          return el('div', { class: 'im-item' }, [
            el('div', { class: 'im-pic' }, [img ? el('img', { src: imgUrl(img, 'lg'), alt: label, loading: 'lazy', style: 'cursor:zoom-in', title: '눌러서 크게 보기', onclick: () => openImage(img, `${c?.name || ''} · ${label}`) }) : el('span', { html: PIC }), stateOverlay(artTarget(c, k))]),
            el('div', { class: 'im-cap' }, [el('b', { text: label }), link(img ? '다시 그리기' : '그리기', () => doAct(async () => {
              if (!(await confirmBox(`${label}을(를) ${img ? '다시 ' : ''}그립니다. 이미지 1장 + 글 생성 1회. 계속할까요?`))) return;
              await ask('drawSet', { id: view.id, kinds: [k] });
            }))]),
          ]);
        })),
        ]),
        memory: el('div', {}, [
        // 정리 상태
        o ? el('div', { class: o.state === 'failed' ? 'im-err' : 'im-muted', text: o.state === 'failed' ? `정리 실패: ${o.error || ''}` : `정리 대기 중 · 편지 ${o.forLetterIds.length}통${o.error ? ` (재시도: ${o.error})` : ''}` }) : null,
        el('div', { class: 'im-row' }, [btn('아직 정리 안 된 편지 정리하기(생성 1회)', () => doAct(() => ask('organizeNow', { id: view.id })))]),
        // 관계 장부
        el('h4', { text: '관계 장부' }),
        c?.worldBookId ? el('div', { class: 'im-row' }, [
          el('span', { class: 'im-muted im-grow', text: '「우리의 편지」 로어북 항목: 이 캐릭터와 일반 채팅을 할 때도 편지로 쌓은 관계·약속·지난 이야기를 알게 합니다(글 생성 없음).' }),
          link('로어북에 넣기·갱신', () => doAct(async () => { const r = await ask('syncOurLetters', { id: view.id }, 60000); error = `「우리의 편지」 항목을 ${r.updated ? '갱신' : '만들'}었습니다(${r.chars}자).`; })),
        ]) : null,
        L.stage || L.mood || L.calledMe ? el('div', { class: 'im-muted', text: [L.stage && `거리: ${L.stage}`, L.mood && `상대 마음: ${L.mood}`, L.calledMe && `나를 부르는 말: ${L.calledMe}`, L.calledThem && `내가 부르는 말: ${L.calledThem}`].filter(Boolean).join(' · ') }) : el('div', { class: 'im-muted', text: '아직 기록이 없습니다.' }),
        list('약속', L.promises, (x) => `${x.who === 'me' ? '나' : '상대'}: ${x.what}${x.state === 'done' ? ' (지킴)' : ''}`),
        list('아직 답 못 받은 질문', L.openQuestions, (x) => `${x.who === 'me' ? '내가' : '상대가'} 물음: ${x.q}`),
        list('상대가 아는 나', L.knowsAboutMe),
        list('내가 아는 상대', L.iKnow),
        list('기억할 날', L.anniversaries),
        // 연대기
        el('h4', { text: '그쪽 연대기' }),
        d.memory.timeline?.length ? el('div', {}, [...d.memory.timeline].reverse().slice(0, 40).map((e) => el('div', { class: e.open ? '' : 'im-muted', text: `${e.open ? '● ' : '· '}${e.when ? `[${e.when}] ` : ''}${e.event}` }))) : el('div', { class: 'im-muted', text: '아직 기록이 없습니다.' }),
        d.memory.chapters?.length ? el('div', {}, [el('h4', { text: '시기 요약' }), ...d.memory.chapters.map((x, i) => el('div', { class: 'im-muted', text: `${i + 1}장 · ${x.text}` }))]) : null,
        d.memory.summaries?.length ? el('details', {}, [el('summary', { class: 'im-muted', style: 'cursor:pointer', text: `편지 요약 ${d.memory.summaries.length}통` }), ...d.memory.summaries.map((x) => el('div', { class: 'im-muted', text: `[${x.when}] ${x.from === 'me' ? '나' : '상대'}: ${x.text}` }))]) : null,
        // 변경 기록
        el('h4', { text: `변경 기록 · 확인 필요 ${waiting.length}` }),
        ...(changes.length ? changes.slice(0, 60).map(changeRow) : [el('div', { class: 'im-muted', text: '아직 변경이 없습니다.' })]),
        ]),
        cal: el('div', {}, [
        // 달력
        el('h4', { text: '그쪽 달력' }),
        el('div', { class: 'im-muted', text: calSummary(c?.calendar) }),
        el('div', { class: 'im-row' }, [
          c?.calendar ? el('select', { onchange: (e) => doAct(() => ask('setCalendar', { id: view.id, calendar: { style: e.target.value } })) }, [
            el('option', { value: 'both', text: '달력 + 만난 지 N일째', selected: c.calendar.style === 'both' }),
            el('option', { value: 'calendar', text: '달력만', selected: c.calendar.style === 'calendar' }),
            el('option', { value: 'count', text: '만난 지 N일째만', selected: c.calendar.style === 'count' }),
          ]) : null,
          btn(c?.calendar ? '달력 다시 만들기(글 1회)' : '달력 만들기(글 1회)', () => doAct(async () => {
            if (!(await confirmBox('로어북의 달력·시간 항목과 편지에 쓴 날짜를 읽어 그쪽 달력을 만듭니다. 글 생성 1회. 계속할까요?'))) return;
            await ask('makeCalendar', { id: view.id }, 120000);
          })),
          c?.calendar ? link('달력 지우기', () => doAct(async () => { if (await confirmBox('달력을 지우고 「만난 지 N일째」로 표시할까요?')) await ask('setCalendar', { id: view.id, calendar: null }); })) : null,
        ]),
        c?.calendar ? (() => {
          // 달력 직접 고치기: 하루 길이·연도·연도 표기·달 목록(만난 날의 달·일은 그대로)
          const cal = c.calendar;
          const dh = el('input', { type: 'number', min: '6', max: '100', value: String(cal.dayHours) });
          const yr = el('input', { type: 'number', value: String(cal.start?.year ?? 1) });
          const yl = el('input', { value: cal.yearLabel || '', placeholder: '비우면 연도를 표시하지 않음' });
          const ms = el('textarea', { rows: 3, value: monthsToText(cal) });
          return el('details', {}, [
            el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '달력 고치기' }),
            el('div', { class: 'im-pair' }, [field('하루 길이(시간)', dh), field('만난 해(숫자)', yr), field('연도 표기(숫자 뒤, 예: 년·대륙력)', yl)]),
            field('달 (한 줄에 「이름 | 일수」)', ms),
            btn('달력 저장', () => doAct(() => ask('setCalendar', { id: view.id, calendar: { dayHours: Number(dh.value), yearLabel: yl.value, months: textToMonths(ms.value), start: { ...cal.start, year: Number(yr.value) } } }))),
          ]);
        })() : null,
        ]),
        adv: el('div', {}, [
        // 규칙
        el('h4', { text: '규칙' }),
        field('잠근 칸 (쉼표로: first_line, core, fixed, never, look, … 또는 로어북 항목 제목)', lockText),
        modes,
        btn('규칙 저장', () => doAct(async () => {
          const applyMode = Object.fromEntries([...modes.querySelectorAll('select')].map((x) => [x.getAttribute('data-k'), x.value]));
          await ask('setRules', { id: view.id, locks: lockText.value.split(',').map((x) => x.trim()).filter(Boolean), applyMode });
        })),
        // 모의 조립
        el('h4', { text: `다음 답장 모의 조립 · 약 ${d.totalTokens.toLocaleString()}토큰` }),
        el('div', {}, d.report.map((r) => el('div', { class: 'im-row' }, [el('span', { class: 'im-grow', text: r.layer }), el('span', { class: 'im-muted', text: `${r.chars.toLocaleString()}자 · 약 ${r.tokens.toLocaleString()}토큰${r.note ? ` · ${r.note}` : ''}` })]))),
        el('details', {}, [el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '실제로 보낼 프롬프트 전체 보기' }), el('pre', { style: 'white-space:pre-wrap;font-size:11px;max-height:420px;overflow:auto', text: d.prompt })]),
        ]),
      };
      const TABS = [["look","모습·편지지"],["memory","기억"],["cal","달력"],["adv","고급"]];
      const tabBtns = TABS.map(([k, t]) => el('button', { type: 'button', class: dossierTab === k ? 'im-on' : '', text: t, onclick: () => { dossierTab = k; for (const [g, node] of Object.entries(groups)) node.style.display = g === k ? '' : 'none'; tabBtns.forEach((x, i) => { x.className = TABS[i][0] === k ? 'im-on' : ''; }); } }));
      for (const [g, node] of Object.entries(groups)) node.style.display = g === dossierTab ? '' : 'none';
      return [
        back,
        el('div', { class: 'im-row', style: 'gap:12px;align-items:center' }, [c ? avatarEl(c, 'im-seal', { portraitFirst: true }) : null, el('h3', { class: 'im-grow', style: 'margin:0', text: `${c?.name || ''} 서류함` }), c ? link('상대 정보 수정', () => go({ name: 'form', id: view.id })) : null]),
        el('div', { class: 'im-tabs im-subtabs' }, tabBtns),
        ...Object.values(groups),
      ];
    }

    return { render, go };
  })();
  views.add(drawer);

  // 상대 편지 한 통(봉투 → 편지지). 서랍·보조창 공용
  function theirLetterNode(c, l, { act }) {
    const e = l.envelope || {};
    if (l.state === 'delivered') {
      const rows = [['매체', e.medium], ['손끝에 닿는 것', e.texture], ['냄새', e.scent], ['흔적', e.marks], ['봉인', e.seal], ['우표', e.stamp]].filter(([, v]) => v);
      const sealImg = c.art?.seal?.imageId;
      const envImg = l?.art?.envelope || c.art?.envelope?.imageId;
      const stampImg0 = l.art?.stamp || c.art?.stamp?.imageId;
      const face = envImg
        ? el('div', { class: 'im-env-art', style: `background-image:url("${imgUrl(envImg, 'lg')}")` }, [
        ])
        : el('div', { class: 'im-env-face' }, [sealImg ? el('img', { class: 'im-env-seal', src: imgUrl(sealImg, 'sm'), alt: '봉인' }) : el('span', { class: 'im-env-seal', text: c.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 1) })]);
      return el('div', { class: 'im-envelope' }, [
        face,
        el('div', { class: 'im-env-body' }, [
        el('div', { style: 'font-size:12px;color:#7a6a52;text-align:center', text: `${c.name}에게서 · ${when(l.arriveAt)} 도착` }),
        el('dl', { style: 'margin:0' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
        l.enclosures?.length ? el('div', { style: 'font-size:12px;color:#7a6a52', text: `안에 무언가 더 들어 있는 것 같습니다 (${l.enclosures.length})` }) : null,
        btn('봉투 열기', () => act(async () => { await ask('open', { id: c.id, letterId: l.id }); await refresh(); })),
        ]),
      ]);
    }
    const meta = [l.writtenLabel || l.theirWrittenLabel, e.medium, e.scent].filter(Boolean).join(' · ');
    // 편지마다 자기 그림(바뀐 때)이 있으면 그것, 없으면 상대의 기본 그림
    const paperImg = l.art?.paper || c.art?.paper?.imageId;
    const stampImg = l.art?.stamp || c.art?.stamp?.imageId;
    const A = S.settings?.art || {};
    const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null && v !== undefined ? Number(v) : d);
    const fade = Math.max(0, Math.min(0.9, (100 - num(A.paperStrength, 70)) / 100));
    // 좁은 화면(휴대폰)에서는 테두리·여백을 줄여 글씨 칸을 넓힌다
    const narrow = typeof window !== 'undefined' && window.innerWidth < 520;
    const bw = Math.round(Math.max(0, Math.min(200, num(A.paperBorder, 64))) * (narrow ? 0.6 : 1));
    const slice = Math.max(1, Math.min(45, num(A.paperSlice, 20)));
    const paperStyle = paperImg
      ? `border:${bw}px solid transparent;border-image:url("${imgUrl(paperImg, 'lg')}") ${slice}% fill / ${bw}px stretch;background:${fade ? `rgba(246,238,222,${fade})` : 'transparent'};background-clip:padding-box;box-shadow:none;border-radius:0;padding:${narrow ? '10px 8px' : '16px 18px'}`
      : undefined;
    if (htmlPaper() && !l.art?.paper) {
      const look = paperLook(themeOf(c, l), { seed: l.id, narrow });
      const envBtn = (l.art?.envelope || c.art?.envelope?.imageId) ? el('button', { class: 'im-link im-env-btn', type: 'button', text: '✉ 봉투 보기', onclick: () => showEnvelope(c, l) }) : null;
      // 고치기: 글자가 깨졌을 때(다른 언어 섞임 등)
      const editing = editingLetter === l.id;
      const editBtn = el('button', { class: 'im-link im-env-btn', type: 'button', text: editing ? '고치기 닫기' : '✎ 고치기', onclick: () => { editingLetter = editing ? '' : l.id; rerenderAll(); } });
      if (editing) {
        const bIn = el('textarea', { value: l.body, rows: 14 });
        const pIn = el('textarea', { value: l.ps || '', rows: 2, placeholder: '추신(선택)' });
        return el('div', { class: 'im-themed-wrap' }, [el('div', { class: 'im-row', style: 'gap:12px' }, [envBtn, editBtn]), el('div', { class: 'im-letter', style: 'display:flex;flex-direction:column;gap:6px' }, [
          el('div', { class: 'im-muted', text: '받은 편지를 고칩니다. 원문은 따로 남고, 앞으로의 답장·기억에는 고친 글이 쓰입니다.' }),
          bIn, pIn,
          el('div', { class: 'im-row' }, [
            btn('저장', () => act(async () => { await ask('editLetter', { id: c.id, letterId: l.id, body: bIn.value, ps: pIn.value }); editingLetter = ''; await refresh(); }), { primary: true }),
            l.original ? link('원문으로 되돌리기', () => act(async () => { await ask('editLetter', { id: c.id, letterId: l.id, body: l.original.body, ps: l.original.ps }); editingLetter = ''; await refresh(); })) : null,
          ]),
        ])]);
      }
      return el('div', { class: 'im-themed-wrap' }, [el('div', { class: 'im-row', style: 'gap:12px' }, [envBtn, editBtn, l.editedAt ? el('span', { class: 'im-muted', style: 'font-size:11px', text: '(고친 편지)' }) : null]), el('div', { class: 'im-themed im-theirs', style: look.outer }, [
        el('span', { class: 'im-corners', html: look.corners }),
        el('div', { style: look.inner }, [
          el('div', { class: 'im-tmeta', style: `color:${look.metaColor}`, text: `${c.name}의 편지 · ${meta}` }),
          el('div', { text: l.body + (l.ps ? `\n\n추신. ${l.ps}` : '') }),
          l.enclosures?.length ? el('div', { class: 'im-tencl', style: `border-color:${look.accent}88` }, l.enclosures.map((x) => el('div', { text: `동봉 · ${x.item}${x.note ? ` — ${x.note}` : ''}` }))) : null,
          attachThumbs(c, l),
          l.artNote ? el('div', { class: 'im-tmeta', style: `margin:10px 0 0;color:${look.accent}`, text: `✦ ${l.artNote}` }) : null,
          l.late ? el('div', { class: 'im-tmeta', style: `margin:6px 0 0;color:${look.accent}`, text: `✦ 우체부가 늦었다 — ${l.late}` }) : null,
          el('div', { class: 'im-tmeta', style: `margin:10px 0 0;color:${look.metaColor}`, text: `받은 시각 ${when(l.arriveAt)}` }),
        ]),
      ])]);
    }
    return el('div', { class: `im-paper im-theirs${paperImg ? ' im-has-paper' : ''}`, style: paperStyle }, [
      el('div', { class: 'im-stamp', title: [e.stamp && `우표: ${e.stamp}`, e.seal && `봉인: ${e.seal}`].filter(Boolean).join('\n') }, [
        stampImg ? el('img', { src: imgUrl(stampImg, 'sm'), alt: '우표', style: 'cursor:zoom-in', onclick: () => openImage(stampImg, `${c.name} · 우표`, e.stamp || '') }) : el('span', { style: 'font-size:18px;line-height:1', text: '✉' }),
      ]),
      el('div', { class: 'im-meta', text: `${c.name}의 편지 · ${meta}` }),
      el('div', { text: l.body + (l.ps ? `\n\n추신. ${l.ps}` : '') }),
      l.enclosures?.length ? el('div', { class: 'im-encl' }, l.enclosures.map((x) => el('div', { text: `동봉 · ${x.item}${x.note ? ` — ${x.note}` : ''}` }))) : null,
      l.artNote ? el('div', { class: 'im-meta', style: 'margin:8px 0 0;color:var(--im-wax)', text: `✦ ${l.artNote}` }) : null,
      l.late ? el('div', { class: 'im-meta', style: 'margin:8px 0 0;color:var(--im-wax)', text: `✦ 우체부가 늦었다 — ${l.late}` }) : null,
      el('div', { class: 'im-meta', style: 'margin:8px 0 0', text: `받은 시각 ${when(l.arriveAt)}` }),
    ]);
  }

  // ══════════════ 편지첩 HTML로 저장 ══════════════
  // 편지지 그림을 테두리로 깐 편지들을 차례로 늘어놓은 한 장짜리 HTML(그림은 파일 안에 넣어 따로 열어도 보임)
  const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const dataUrlOf = async (id, size = 'lg') => {
    try {
      const r = await fetch(imgUrl(id, size), { credentials: 'include' });
      if (!r.ok) return '';
      const b = await r.blob();
      return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.onerror = () => res(''); fr.readAsDataURL(b); });
    } catch { return ''; }
  };
  async function exportLettersHtml(c) {
    // 그림은 표시용 자리표(@@IMG:id:size@@)로 한 번 만들고, 쓰인 그림만 data URL로 바꿔 넣는다
    const tok = (id, size) => `@@IMG:${id}:${size}@@`;
    const k = meKeyOf(c);
    const myName = c.noPersona ? '' : (personaOf(c.personaId)?.name || c.personaName || '');
    const pz = c.noPersona ? null : personaOf(c.personaId || S.activePersonaId);
    const mine = S.me?.[k] || {};
    const me = { noPersona: !!c.noPersona, title: pz?.title || '', description: pz?.description || '', portraitId: mine.portrait?.imageId || pz?.imageId || '', history: mine.history || [] };
    let html = buildLettersHtml(c, { myFont: S.settings?.myFont || '', img: tok, myFaceId: myPortrait(k)?.imageId || pz?.imageId || '', myName: myName || pz?.name || '', htmlPaper: htmlPaper(), me });
    const keys = [...new Set(html.match(/@@IMG:[^@]+@@/g) || [])];
    const urls = {};
    await Promise.all(keys.map(async (t) => { const [, id, size] = t.slice(2, -2).split(':'); urls[t] = await dataUrlOf(id, size); }));
    html = html.replace(/@@IMG:[^@]+@@/g, (t) => urls[t] || '');
    const blob = new Blob([html], { type: 'text/html' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `편지첩-${c.name.replace(/[\/:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 10)}.html` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return { letters: (c.letters || []).filter((l) => !(l.from === 'them' && l.state === 'in_transit')).length, images: Object.values(urls).filter(Boolean).length };
  }


  // ══════════════ 보조창(도크) + 우체통 위젯 ══════════════
  let panel = null;
  let widget = null;
  const P = { tab: lsGet(`${LS_PANEL}.tab`, 'book'), id: lsGet(`${LS_PANEL}.id`, ''), busy: false, error: '', locker: '', view: lsGet(`${LS_PANEL}.view`, 'c'), meTab: lsGet(`${LS_PANEL}.meTab`, 'me') };
  if (!['book', 'items', 'box', 'report'].includes(P.tab)) { P.view = 'me'; P.meTab = P.tab === 'cal' ? 'cal' : 'boxes'; P.tab = 'book'; }
  const panelRoot = el('div', { class: 'im-panel' });
  // 보조창 방식: page=채팅창처럼 앱 화면을 채움(기본, app_manipulation 필요) / dock=오른쪽에 붙이기 / float=떠 있는 창. 새로 고침 뒤 적용
  let panelMode = ['page', 'dock', 'float'].includes(lsGet(LS_PANEL_MODE, 'page')) ? lsGet(LS_PANEL_MODE, 'page') : 'page';
  let pageMode = false;
  if (panelMode === 'page') {
    try {
      if (typeof ctx.ui.mountApp !== 'function') throw new Error('mountApp 없음');
      const mount = ctx.ui.mountApp({ className: 'im-page-mount', position: 'app-overlay' });
      const closeBtn = el('button', { class: 'im-close', type: 'button', text: '✕', title: '닫기 (Esc)', 'aria-label': '닫기', onclick: () => togglePanel(false) });
      const pageSub = el('div', { class: 'im-sub', text: '' });
      const listCol = el('div', { class: 'im-page-list' });
      const mainCol = el('div', { class: 'im-page-main' }, [panelRoot]);
      const page = el('div', { class: 'im-page' }, [
        el('div', { class: 'im-page-head' }, [el('span', { class: 'im-mini', html: MINI_BOX }), el('div', { class: 'im-grow' }, [el('div', { class: 'im-title', text: '이세계 편지' }), pageSub]), closeBtn]),
        el('div', { class: 'im-page-body' }, [listCol, mainCol]),
      ]);
      mount.root.append(page);
      if (!removeStyle) mount.root.append(el('style', { text: CSS + CSS2 }));
      mount.setVisible(false);
      let visible = false;
      panel = {
        root: mount.root,
        listCol,
        pageSub,
        isCollapsed: () => !visible,
        expand: () => { visible = true; mount.setVisible(true); },
        collapse: () => { visible = false; mount.setVisible(false); },
        destroy: () => mount.destroy(),
      };
      // Esc로 닫기
      const onKey = (e) => { if (e.key === 'Escape' && visible) togglePanel(false); };
      document.addEventListener('keydown', onKey);
      const d0 = panel.destroy;
      panel.destroy = () => { document.removeEventListener('keydown', onKey); d0(); };
      pageMode = true;
    } catch {
      panelMode = 'dock'; // 권한이 없거나 오래된 앱이면 오른쪽에 붙이기로
    }
  }
  try {
    if (pageMode) {
      // 위에서 만듦
    } else if (panelMode === 'float') {
      const w = Math.min(460, Math.max(320, window.innerWidth - 40));
      const h = Math.min(700, Math.max(360, window.innerHeight - 80));
      const fw = ctx.ui.createFloatWidget({ width: w, height: h, initialPosition: { x: Math.max(8, window.innerWidth - w - 24), y: 40 }, snapToEdge: false, tooltip: '이세계 편지 · 편지첩', chromeless: false, touchScrollMode: 'native' });
      fw.setVisible(false);
      const head = el('div', { class: 'im-row', style: 'padding:6px 10px;border-bottom:1px solid var(--lumiverse-border);cursor:move;font-size:12px' }, [
        el('b', { class: 'im-grow', text: '이세계 편지 · 편지첩' }),
        el('button', { class: 'im-link', type: 'button', text: '닫기', onclick: () => togglePanel(false) }),
      ]);
      // 창은 머리줄로만 옮긴다: 내용 칸에서 누르기가 위젯 끌기로 번지지 않게 막는다(글 고르기·스크롤·입력칸)
      const content = el('div', { class: 'im-float-content', style: 'flex:1;min-height:0;overflow:auto' }, [panelRoot]);
      for (const ev of ['pointerdown', 'mousedown', 'touchstart']) content.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      const box = el('div', { style: `display:flex;flex-direction:column;width:${w}px;height:${h}px;background:var(--lumiverse-fill);color:var(--lumiverse-text)` }, [head, content]);
      fw.root.append(box);
      if (!removeStyle) fw.root.append(el('style', { text: CSS + CSS2 }));
      panel = {
        root: fw.root,
        isCollapsed: () => !fw.isVisible(),
        expand: () => fw.setVisible(true),
        collapse: () => fw.setVisible(false),
        destroy: () => fw.destroy(),
      };
    } else {
      panel = ctx.ui.requestDockPanel({ edge: 'right', title: '이세계 편지 · 편지첩', size: 440, minSize: 320, maxSize: 760, resizable: true, startCollapsed: true });
      panel.root.append(panelRoot);
      if (!removeStyle) panel.root.append(el('style', { text: CSS + CSS2 }));
      panel.onVisibilityChange?.((visible) => { if (visible) refresh(); renderWidget(); drawer.render(); });
    }
  } catch { panel = null; }

  function togglePanel(force) {
    if (!panel) return;
    const open = force ?? panel.isCollapsed();
    if (open) { panel.expand(); refresh(); } else panel.collapse();
    renderWidget();
    drawer.render();
  }
  function openPanelFor(id) {
    P.id = id; P.tab = 'book'; P.view = 'c'; lsSet(`${LS_PANEL}.view`, 'c'); lsSet(`${LS_PANEL}.id`, id); lsSet(`${LS_PANEL}.tab`, 'book');
    togglePanel(true);
  }

  const panelView = {
    render() {
      if (!panel) return;
      const pact = async (fn) => {
        if (P.busy) return;
        P.busy = true; P.error = ''; panelView.render();
        try { await fn(); } catch (e) { P.error = e.message || String(e); }
        P.busy = false; panelView.render();
      };
      const mine = S.all.filter(inPersona);
      if (!mine.some((c) => c.id === P.id)) P.id = mine[0]?.id || '';
      if (!mine.length) P.view = 'me';
      const c = byId(P.id);
      const save = () => { lsSet(`${LS_PANEL}.tab`, P.tab); lsSet(`${LS_PANEL}.id`, P.id); lsSet(`${LS_PANEL}.view`, P.view); lsSet(`${LS_PANEL}.meTab`, P.meTab); };
      const openC = (id, tab) => { P.view = 'c'; P.id = id; if (tab) P.tab = tab; save(); panelView.render(); };
      const openMe = (tab) => { P.view = 'me'; if (tab) P.meTab = tab; save(); panelView.render(); };
      // 「나」: 고른 페르소나(모두면 상대가 있는 페르소나들)
      const meKeys = [...new Set((mine.length ? mine : S.all).map((x) => meKeyOf(x)))];
      if (S.persona !== ALL && S.persona !== NO_PERSONA && !meKeys.includes(S.persona.replace(/[^\w-]/g, '_'))) meKeys.unshift(S.persona.replace(/[^\w-]/g, '_'));
      if (S.persona === NO_PERSONA && !meKeys.includes('none')) meKeys.unshift('none');
      const meLabel = (k) => (k === 'none' ? '나 (페르소나 없음)' : (S.personas.find((x) => x.id.replace(/[^\w-]/g, '_') === k)?.name || '나'));
      const mePersonaOpts = (k) => (k === 'none' ? { noPersona: true } : { personaId: S.personas.find((x) => x.id.replace(/[^\w-]/g, '_') === k)?.id || '' });
      const meRowLabel = meKeys.length === 1 ? `${meLabel(meKeys[0])}` : '나';
      // 탭: 보고 있는 것에 따라
      const TABS = P.view === 'me' ? [['me', '내 모습'], ['boxes', '추억 상자'], ['cal', '달력']] : [['book', '편지첩'], ['items', '물건'], ['box', '추억 상자'], ['report', '기록부']];
      const cur = P.view === 'me' ? P.meTab : P.tab;
      const tabs = el('div', { class: 'im-tabs' }, TABS.map(([k, t]) => el('button', { type: 'button', class: cur === k ? 'im-on' : '', text: t, onclick: () => { if (P.view === 'me') P.meTab = k; else P.tab = k; save(); panelView.render(); } })));
      const head = P.view === 'me'
        ? el('div', { class: 'im-view-head' }, [myFace(meKeys[0], 'im-seal im-face') || el('span', { class: 'im-seal', text: '나' }), el('div', { class: 'im-grow' }, [el('div', { class: 'im-name', text: meRowLabel }), el('div', { class: 'im-muted', text: `편지 상대 ${mine.length}명` })])])
        : null;
      let body = [];
      if (P.view === 'me') {
        if (P.meTab === 'cal') body = lettersCalendar(mine);
        else if (P.meTab === 'boxes') body = boxesView(mine, (id) => openC(id, 'box'));
        else body = meKeys.map((k) => meCard(k, meLabel(k), mePersonaOpts(k), pact));
      } else if (!c) body = [el('div', { class: 'im-muted', text: S.all.length ? '이 페르소나와 편지를 주고받는 상대가 없습니다.' : '아직 상대가 없습니다. 서랍의 「이세계 편지」 탭에서 새 상대를 만들어 주세요.' })];
      else if (P.tab === 'items') body = itemsView(c);
      else if (P.tab === 'box') body = lockerView(c, pact, null);
      else if (P.tab === 'report') body = reportView(c, pact);
      else body = bookView(c, pact);
      // 편지첩이 아닌 탭에서도 그리는 중·실패 막대
      if (P.view === 'c' && c && P.tab !== 'book' && (c.artJob?.state === 'running' || c.artJob?.state === 'failed')) body = [artBar(c, pact), ...body];
      if (pageMode && panel.pageSub) {
        const pn = S.persona === ALL ? '모든 페르소나' : S.persona === NO_PERSONA ? '페르소나 없음' : (personaOf(S.persona)?.name || '');
        panel.pageSub.textContent = `${pn ? `${pn}의 편지함 · ` : ''}상대 ${mine.length}명${S.list.reduce((n, x) => n + x.unread, 0) ? ` · 새 편지 ${S.list.reduce((n, x) => n + x.unread, 0)}통` : ''}`;
      }
      // 목록: 페르소나 → 나 → 편지 상대
      const meRow = el('div', { class: `im-row-card im-me-row${P.view === 'me' ? ' im-on' : ''}`, onclick: () => openMe() }, [
        myFace(meKeys[0], 'im-seal im-face') || el('span', { class: 'im-seal', text: '나' }),
        el('div', { class: 'im-grow', style: 'display:flex;flex-direction:column;gap:2px;min-width:0' }, [
          el('span', { class: 'im-name', text: meRowLabel }),
          el('div', { class: 'im-muted', style: 'font-size:11.5px', text: '내 모습 · 추억 상자 · 달력' }),
        ]),
      ]);
      const rowOf = (x) => {
        const unread = x.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length;
        const st = S.list.find((y) => y.id === x.id);
        const last = [...x.letters].reverse().find((l) => l.body);
        return el('div', { class: `im-row-card${P.view === 'c' && x.id === P.id ? ' im-on' : ''}`, onclick: () => openC(x.id) }, [
          avatarEl(x),
          el('div', { class: 'im-grow', style: 'display:flex;flex-direction:column;gap:2px;min-width:0' }, [
            el('div', { class: 'im-row', style: 'flex-wrap:nowrap' }, [el('span', { class: 'im-name im-grow', text: x.name }), x.artJob?.state === 'running' ? el('span', { class: 'im-spin', title: '그림 그리는 중' }) : null, unread ? el('span', { class: 'im-badge', text: String(unread) }) : null]),
            el('div', { class: 'im-muted', style: 'font-size:11.5px', text: st?.status || '' }),
            last ? el('div', { class: 'im-excerpt', text: last.body.replace(/\s+/g, ' ') }) : null,
          ]),
        ]);
      };
      if (pageMode && panel.listCol) {
        panel.listCol.replaceChildren(
          el('div', { class: 'im-list-label', text: '페르소나' }),
          personaChips(),
          meRow,
          el('div', { class: 'im-list-label', text: `편지 상대 · ${mine.length}` }),
          ...(mine.length ? mine.map(rowOf) : [el('div', { class: 'im-muted', text: '편지 상대가 없습니다.' })]),
          el('div', { class: 'im-muted', style: 'margin-top:8px', text: '새 상대·설정·서류함은 서랍의 「이세계 편지」 탭에 있어요.' }),
        );
      }
      // 좁은 창(도크·떠 있는 창·휴대폰): 위쪽에 페르소나 칩, 그 아래 [나] + 상대 칩
      const people = el('div', { class: 'im-chips' }, [
        el('button', { class: `im-chip im-plain${P.view === 'me' ? ' im-on' : ''}`, type: 'button', 'data-me': '1', onclick: () => openMe() }, [myFace(meKeys[0], 'im-ava') || el('span', { class: 'im-ava', text: '✒' }), '나']),
        ...mine.map((x) => {
          const unread = x.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length;
          return el('button', { class: `im-chip im-plain${P.view === 'c' && x.id === P.id ? ' im-on' : ''}`, type: 'button', onclick: () => openC(x.id) }, [x.name, unread ? el('span', { class: 'im-badge', text: String(unread) }) : null]);
        }),
      ]);
      panelRoot.replaceChildren(...[
        pageMode ? el('div', { class: 'im-page-chips' }, [personaChips(), people]) : personaChips(),
        !pageMode ? people : null,
        head,
        tabs,
        ...body,
        P.error || S.error ? el('div', { class: 'im-err', text: P.error || S.error }) : null,
      ].filter(Boolean));
      if (P.focusLetter && P.view === 'c' && P.tab === 'book') {
        const target = panelRoot.querySelector(`[data-lid="${P.focusLetter}"]`);
        P.focusLetter = '';
        if (target) setTimeout(() => { target.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); target.classList.add('im-flash'); }, 30);
      }
    },
  };
  views.add(panelView);

  // 편지첩: 오래된 편지부터 아래로, 맨 아래에 쓰기
  function bookView(c, act) {
    const now = Date.now();
    const exact = !!S.settings?.showExactEta;
    const nodes = c.letters.flatMap((l) => [
      el('div', { class: 'im-divider', text: l.from === 'me' ? (l.theirSentLabel ? `그쪽 ${l.theirSentLabel.replace('만난 지 ', '')} 무렵 · 내가 보냄` : '내가 보냄') : (l.theirWrittenLabel ? `그쪽 ${l.theirWrittenLabel.replace('만난 지 ', '')} · ${c.name}` : `${c.name}`) }),
      (() => { const n = letterNode(l); n?.setAttribute?.('data-lid', l.id); return n; })(),
    ]);
    function letterNode(l) {
      if (l.from === 'me') {
        if (l.state === 'in_transit') {
          return el('div', { class: 'im-transit im-mine' }, [
            el('div', { text: `내 편지가 가는 중 · ${etaLabel(l.arriveAt - now, exact)}` }),
            l.late ? el('div', { style: 'color:var(--im-wax)', text: `✦ 우체부가 늦어지고 있어요 — ${l.late}` }) : null,
            el('div', { text: short(l.body, 60) }),
            link('회수하기', () => act(async () => {
              if (!(await confirmBox('이 편지를 회수할까요? 상대에게 가지 않습니다.'))) return;
              await ask('recall', { id: c.id, letterId: l.id });
              await refresh();
            })),
          ]);
        }
        const enc = l.enclosures?.length ? l.enclosures.map((x) => x.item) : (l.enclosure ? [l.enclosure] : []);
        return el('div', { class: 'im-paper im-mine', style: myFontStyle() }, [
          myFace(meKeyOf(c), 'im-myface im-myface-letter'),
          el('div', { class: 'im-meta', text: `${l.personaName || '나'}의 편지 · ${when(l.sentAt)} 보냄 · 그쪽 ${l.theirArriveLabel} 도착${l.late ? ` · 늦게 닿음(${l.late})` : ''}` }),
          el('div', { text: l.body }),
          enc.length ? el('div', { class: 'im-encl' }, enc.map((x) => el('div', { text: `동봉 · ${x}` }))) : null,
          attachThumbs(c, l),
        ]);
      }
      if (l.state === 'in_transit') return el('div', { class: 'im-transit im-theirs', text: `${c.name}의 편지가 ${exact ? etaLabel(l.arriveAt - now, true).replace('도착까지', '도착까지') : '어딘가를 건너는 중…'}${l.late ? ` · ✦ 우체부가 늦어지고 있어요(${l.late})` : ''}` });
      return theirLetterNode(c, l, { act });
    }
    const sealImg = c.art?.seal?.imageId;
    return [
      el('div', { class: 'im-info' }, [
        avatarEl(c, 'im-seal', { portraitFirst: true }),
        el('div', { class: 'im-grow' }, [
          el('div', { class: 'im-name', text: c.name }),
          el('div', { class: 'im-muted', text: `${c.personaName ? `${c.personaName}의 편지 상대 · ` : ''}그쪽은 지금 ${c.theirNowLabel} · 시간 1:${c.ratio}` }),
        ]),
        el('button', { class: 'im-link', type: 'button', text: '편지첩 저장(HTML)', title: '편지지 모양으로 늘어놓은 한 장짜리 HTML 파일로 저장', onclick: () => act(async () => { const r = await exportLettersHtml(c); P.error = `편지 ${r.letters}통을 HTML로 저장했습니다(그림 ${r.images}장 포함).`; }) }),
      ]),
      artBar(c, act),
      c.reply?.state === 'failed' ? el('div', { class: 'im-row' }, [el('span', { class: 'im-err im-grow', text: `우편 사고: ${c.reply.error || ''}` }), btn('다시 시도', () => act(async () => { await ask('retry', { id: c.id }); await refresh(); }))]) : null,
      ...(nodes.length ? nodes : [el('div', { class: 'im-muted', text: '아직 주고받은 편지가 없습니다. 첫 편지를 써 보세요.' })]),
      c.reply && c.reply.state !== 'failed' ? el('div', { class: 'im-transit im-theirs' }, [el('span', { class: 'im-spin' }), `${c.name}이(가) 답장을 쓰고 있는 듯합니다`]) : null,
      // 바로 받기: 배송·답장 쓰는 시간을 건너뜀
      (c.reply && c.reply.state !== 'failed' && c.reply.state !== 'generating') || c.letters.some((l) => l.state === 'in_transit') ? el('div', { class: 'im-row', style: 'justify-content:flex-end' }, [
        el('button', { class: 'im-btn im-rush', type: 'button', text: '⏩ 바로 받기', title: '배송과 답장 쓰는 시간을 건너뛰고 지금 받아요', onclick: () => act(async () => {
          if (!(await confirmBox(`${c.name}과의 편지를 기다리지 않고 지금 받을까요?\n\n· 가는 중인 편지는 바로 도착해요.\n· 답장을 기다리는 중이면 지금 써서 바로 도착해요(글 생성 1회).`))) return;
          await ask('rush', { id: c.id });
          await refresh();
        }) }),
      ]) : null,
      el('details', { class: 'im-compose', open: !c.letters.length || working.has(`scene:${c.id}`) || (drafts.get(c.id)?.photos?.length > 0) || undefined }, [
        el('summary', { text: '✒ 편지 쓰기' }),
        composeBox(c, { busyRef: () => P.busy, act }),
      ]),
    ];
  }

  // 그림 작업 상태: 대상(편지지·우표·봉인·물건)마다 waiting/drawing/done/failed
  const artTarget = (c, kind, itemId = '') => (c?.artJob?.targets || []).find((t) => t.kind === kind && (t.itemId || '') === (itemId || '')) || null;
  const STATE_TEXT = { waiting: '기다리는 중', drawing: '그리는 중…', failed: '실패' };
  const elapsed = (t) => {
    if (!t?.startedAt) return '';
    const s = Math.max(0, Math.round((Date.now() - t.startedAt) / 1000));
    return s < 60 ? `${s}초째` : `${Math.floor(s / 60)}분 ${s % 60}초째`;
  };
  const stateOverlay = (t) => {
    if (!t || t.state === 'done') return null;
    return el('div', { class: `im-state${t.state === 'failed' ? ' im-bad' : ''}`, title: t.error || '' }, [
      t.state === 'drawing' ? el('span', { class: 'im-spin' }) : null,
      t.state === 'failed' ? `실패 — ${short(t.error || '', 40)}` : t.state === 'drawing' && t.startedAt ? `그리는 중… ${elapsed(t)}` : STATE_TEXT[t.state],
    ]);
  };
  // 그림 세트(편지지·우표·봉인) 상태와 버튼
  function artBar(c, act) {
    if (!artOn()) return null;
    const SK = setKindsUi();
    const have = SK.filter((k) => c.art?.[k]?.imageId);
    const job = c.artJob;
    const left = S.art?.left;
    if (job?.state === 'running') {
      const ts = job.targets || [];
      return el('div', { class: 'im-transit' }, [
        el('div', {}, [el('span', { class: 'im-spin' }), `그림을 그리는 중 ${job.done || 0}/${job.total}`]),
        ...ts.map((t) => el('div', { class: t.state === 'failed' ? 'im-err' : 'im-muted', text: `· ${t.label}: ${t.state === 'done' ? '완성' : t.state === 'drawing' && t.startedAt ? `그리는 중… ${elapsed(t)}` : STATE_TEXT[t.state] || t.state}${t.error && t.state === 'failed' ? ` (${short(t.error, 80)})` : ''}` })),
        el('div', { class: 'im-muted', style: 'font-size:11px', text: '보통 30초~1분, 이미지 서버가 붐비면 몇 분 걸려요. 8분이 넘으면 실패로 표시돼요.' }),
      ]);
    }
    const missing = SK.filter((k) => !have.includes(k));
    return el('div', {}, [
      job?.state === 'failed' ? el('div', { class: 'im-row' }, [
        el('span', { class: 'im-err im-grow', text: `지난 그리기 실패 ${(job.total || 0) - (job.done || 0)}장: ${short(job.error || '', 160)}` }),
        link('닫기', () => act(async () => { await ask('artDismiss', { id: c.id }); await refresh(); })),
      ]) : null,
      el('div', { class: 'im-row' }, [
        el('span', { class: 'im-muted im-grow', text: left !== undefined ? `오늘 남은 그림 ${left}장` : '' }),
        // 종류마다 따로(봉투는 사건마다 바뀌고 상징물은 한 번이면 되므로 묶지 않음)
        ...SK.map((k) => link(`${KIND_LABEL[k]} ${have.includes(k) ? '다시 그리기' : '그리기'}`, () => act(async () => {
          if (!(await confirmBox(`${c.name}의 ${KIND_LABEL[k]}을(를) ${have.includes(k) ? '다시 ' : ''}그립니다.\n이미지 1장 + 글 생성 1회. 계속할까요?`))) return;
          await ask('drawSet', { id: c.id, kinds: [k] });
          await refresh();
        }))),
      ]),
    ]);
  }
  const drawItemBtn = (x, cid) => (!artOn() || x.imageId || (x.from === 'them' && x.state === 'in_transit') || !cid || ['waiting', 'drawing'].includes(artTarget(byId(cid), 'item', x.id)?.state) ? null
    : el('button', { class: 'im-link', type: 'button', text: artTarget(byId(cid), 'item', x.id)?.state === 'failed' ? '다시 그리기' : '그리기', style: 'font-size:11px', onclick: async (ev) => {
      ev.stopPropagation();
      if (!(await confirmBox(`「${x.name}」을 그립니다. 이미지 1장 + 글 생성 1회. 계속할까요?`))) return;
      try { await ask('drawItem', { id: cid, itemId: x.id }); await refresh(); } catch (e) { alert(e.message || String(e)); }
    } }));
  // 그림 크게 보기: 앱 모달(테마 따라감). 모달이 없으면 새 탭
  function openImage(imageId, title, caption) {
    const src = `/api/v1/images/${encodeURIComponent(imageId)}`;
    try {
      if (typeof ctx.ui.showModal !== 'function') throw new Error('no modal');
      const m = ctx.ui.showModal({ title: title || '그림', width: Math.min(920, window.innerWidth - 32), maxHeight: Math.min(900, window.innerHeight - 40) });
      m.root.append(el('div', { class: 'im-zoom' }, [
        el('img', { src, alt: title || '', onclick: () => m.dismiss() }),
        caption ? el('div', { class: 'im-cap', text: caption }) : null,
        el('a', { href: src, target: '_blank', rel: 'noopener', class: 'im-muted', text: '원본 새 탭에서 열기' }),
      ]));
    } catch { window.open(src, '_blank', 'noopener'); }
  }
  const itemCard = (x, who, cid) => el('div', { class: 'im-item', title: x.note || x.name }, [
    el('div', { class: `im-pic${!x.imageId && !artOn() ? ' im-pic-text' : ''}` }, [x.imageId ? el('img', { src: imgUrl(x.imageId, 'lg'), alt: x.name, loading: 'lazy', title: '눌러서 크게 보기', onclick: (ev) => { ev.stopPropagation(); openImage(x.imageId, x.name, [x.note, who].filter(Boolean).join(' · ')); } }) : !artOn() ? el('div', { text: x.note || x.name }) : el('span', { html: PIC }), stateOverlay(artTarget(byId(cid), 'item', x.id))]),
    el('div', { class: 'im-cap' }, [
      el('b', { text: x.name }),
      x.note ? el('div', { class: 'im-muted', text: short(x.note, 60) }) : null,
      el('div', { class: 'im-muted', text: `${who} · ${x.state === 'in_transit' ? '가는 중' : `그쪽 ${x.theirLabel || ''}`}` }),
      drawItemBtn(x, cid),
    ]),
  ]);

  // 물품: 받은 것 / 보낸 것
  function itemsView(c) {
    const got = c.items.filter((x) => x.from === 'them');
    const gave = c.items.filter((x) => x.from === 'me');
    return [
      el('h4', { text: `받은 것 · ${got.length}` }),
      got.length ? el('div', { class: 'im-grid' }, got.slice().reverse().map((x) => itemCard(x, `${c.name}에게서`, c.id))) : el('div', { class: 'im-muted', text: '아직 받은 물건이 없습니다.' }),
      el('h4', { text: `보낸 것 · ${gave.length}` }),
      gave.length ? el('div', { class: 'im-grid' }, gave.slice().reverse().map((x) => itemCard(x, `${c.name}에게`, c.id))) : el('div', { class: 'im-muted', text: '편지를 쓸 때 「동봉할 것」에 적으면 여기에 남습니다.' }),
      el('div', { class: 'im-muted', text: '물건마다 「그리기」로 그림을 만들 수 있습니다(이미지 1장 + 글 1회). 설정에서 도착할 때 자동으로 그리게 할 수도 있습니다.' }),
    ];
  }

  // ── 편지 달력(내 쪽 실제 날짜 기준) ──
  const PALETTE = ['#a8322a', '#2f6b8a', '#6b8a2f', '#8a5a2f', '#6a3f8a', '#2f8a7a', '#8a2f62', '#4a5a6a'];
  const colorOf = (id, list) => PALETTE[Math.max(0, list.findIndex((c) => c.id === id)) % PALETTE.length];
  const dayKeyLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  // 날짜별 일: 보냄(sentAt) / 받음(도착한 상대 편지 arriveAt) / 가는 중·오는 중(도착 예정은 표시만)
  function letterEvents(list) {
    const ev = [];
    const now = Date.now();
    for (const c of list) {
      for (const l of c.letters) {
        if (l.from === 'me') {
          ev.push({ at: l.sentAt, kind: 'sent', c, l, label: `${c.name}에게 보냄`, their: l.theirSentLabel || '', items: (l.enclosures || []).map((x) => x.item) });
        } else if (l.state === 'in_transit') {
          if (l.arriveAt > now) ev.push({ at: l.arriveAt, kind: 'coming', c, l, label: `${c.name}의 편지 도착 예정`, their: '', items: [] });
        } else {
          ev.push({ at: l.arriveAt, kind: 'got', c, l, label: `${c.name}에게서 받음${l.state === 'delivered' ? ' (안 읽음)' : ''}`, their: l.theirWrittenLabel || '', items: (l.enclosures || []).map((x) => x.item) });
        }
      }
    }
    return ev.sort((a, b) => a.at - b.at);
  }
  function lettersCalendar(list) {
    const events = letterEvents(list);
    const byDay = new Map();
    for (const e of events) { const k = dayKeyLocal(e.at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
    const today = new Date();
    if (!P.calMonth) {
      const last = events.filter((e) => e.kind !== 'coming').slice(-1)[0];
      const d = last ? new Date(last.at) : today;
      P.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    const [Y, M] = P.calMonth.split('-').map(Number);
    const first = new Date(Y, M - 1, 1);
    const startDow = first.getDay();
    const gridStart = new Date(Y, M - 1, 1 - startDow);
    const move = (dm) => { const d = new Date(Y, M - 1 + dm, 1); P.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; P.calDay = ''; panelView.render(); };
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      if (i >= 35 && d.getMonth() !== M - 1) break;
      const k = dayKeyLocal(d.getTime());
      const evs = byDay.get(k) || [];
      // 상대별 묶음 표시: 받음(칠한 점)·보냄(테두리 점)·예정(흐린 점)
      const groups = new Map();
      for (const e of evs) { const g = `${e.c.id}|${e.kind}`; groups.set(g, { e, n: (groups.get(g)?.n || 0) + 1 }); }
      cells.push(el('button', {
        type: 'button',
        class: `im-cal-day${d.getMonth() !== M - 1 ? ' im-out' : ''}${k === dayKeyLocal(today.getTime()) ? ' im-today' : ''}${P.calDay === k ? ' im-sel' : ''}`,
        title: evs.map((e) => `${hhmm(e.at)} ${e.label}`).join('\n'),
        onclick: () => { P.calDay = P.calDay === k ? '' : k; panelView.render(); },
      }, [
        el('span', { class: 'im-cal-n', text: String(d.getDate()) }),
        groups.size ? el('div', { class: 'im-cal-marks' }, [...groups.values()].map(({ e, n }) => {
          const col = colorOf(e.c.id, list);
          return el('span', {
            class: `im-cal-mark${e.kind === 'sent' ? ' im-out-mark' : ''}`,
            style: e.kind === 'sent' ? `color:${col}` : `background:${col}${e.kind === 'coming' ? ';opacity:.45' : ''}`,
            text: e.kind === 'sent' ? (n > 1 ? `✒${n}` : '✒') : (n > 1 ? `✉${n}` : '✉'),
          });
        })) : null,
      ]));
    }
    const selEvents = P.calDay ? (byDay.get(P.calDay) || []) : [];
    const monthEvents = events.filter((e) => { const d = new Date(e.at); return d.getFullYear() === Y && d.getMonth() === M - 1; });
    const shown = P.calDay ? selEvents : monthEvents;
    const goLetter = (e) => {
      if (e.kind === 'coming') return;
      P.id = e.c.id; P.tab = 'book'; P.view = 'c'; P.focusLetter = e.l.id;
      lsSet(`${LS_PANEL}.id`, e.c.id); lsSet(`${LS_PANEL}.tab`, 'book');
      panelView.render();
    };
    const dateTitle = (k) => { const [y, m, dd] = k.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }); };
    return [el('div', { class: 'im-cal' }, [
      el('div', { class: 'im-cal-head' }, [
        el('button', { class: 'im-cal-nav', type: 'button', text: '‹', title: '이전 달', onclick: () => move(-1) }),
        el('b', { text: `${Y}년 ${M}월` }),
        el('button', { class: 'im-cal-nav', type: 'button', text: '›', title: '다음 달', onclick: () => move(1) }),
      ]),
      el('div', { class: 'im-cal-grid' }, [...['일', '월', '화', '수', '목', '금', '토'].map((t) => el('div', { class: 'im-cal-dow', text: t })), ...cells]),
      el('div', { class: 'im-cal-legend' }, [
        el('span', {}, [el('span', { class: 'im-cal-mark', style: 'background:#888', text: '✉' }), '받은 편지']),
        el('span', {}, [el('span', { class: 'im-cal-mark im-out-mark', style: 'color:#888', text: '✒' }), '보낸 편지']),
        el('span', {}, [el('span', { class: 'im-cal-mark', style: 'background:#888;opacity:.45', text: '✉' }), '도착 예정']),
        ...list.map((c) => el('span', {}, [el('span', { class: 'im-cal-dot', style: `background:${colorOf(c.id, list)}` }), c.name])),
      ]),
      el('h4', { text: P.calDay ? dateTitle(P.calDay) : `${M}월에 오간 편지 · ${monthEvents.length}` }),
      shown.length ? el('div', { class: 'im-cal-events' }, shown.slice().reverse().map((e) => el('div', { class: 'im-cal-ev', onclick: () => goLetter(e), title: e.kind === 'coming' ? '' : '눌러서 편지첩에서 보기' }, [
        el('span', { class: 'im-cal-dot', style: `background:${colorOf(e.c.id, list)};margin-top:5px` }),
        el('span', { class: 'im-t', text: P.calDay ? hhmm(e.at) : `${new Date(e.at).getDate()}일 ${hhmm(e.at)}` }),
        el('div', { class: 'im-grow', style: 'min-width:0;display:flex;flex-direction:column;gap:2px' }, [
          el('b', { style: 'font-size:13px', text: `${e.kind === 'sent' ? '✒ ' : '✉ '}${e.label}` }),
          e.their ? el('div', { class: 'im-muted', style: 'font-size:11.5px', text: `그쪽 ${e.their}` }) : null,
          e.l.body && e.l.state !== 'delivered' && e.kind !== 'coming' ? el('div', { class: 'im-x', text: e.l.body.replace(/\s+/g, ' ') }) : null,
          e.items.length && e.l.state !== 'delivered' ? el('div', { class: 'im-muted', style: 'font-size:11.5px', text: `동봉 · ${e.items.join(', ')}` }) : null,
          e.items.length && e.l.state === 'delivered' ? el('div', { class: 'im-muted', style: 'font-size:11.5px', text: '봉투 안에 무언가 더 들어 있는 것 같아요' }) : null,
        ]),
      ]))) : el('div', { class: 'im-muted', text: P.calDay ? '이날은 오간 편지가 없어요.' : '이달은 오간 편지가 없어요.' }),
    ])];
  }

  // 모음: 페르소나의 모든 편지 묶음 + 모든 물품
  // ── 기록부: 서정적인 기록·알려진 것·그쪽 사람들의 소문(가려진 것은 눌러서)·편지로 이어진 일들·상징물 ──
  const revealed = new Set();
  const working = new Map(); // 키 → 안내 글(오래 걸리는 요청이 도는 동안)
  const SLOW_NOTE = '원래 연결이 막혀 있으면 다시 시도하고 대체 연결로 넘어가느라 1~2분 걸릴 수 있어요. 창을 닫아도 서버에서 계속돼요.';
  const workingBox = (key) => (working.has(key) ? el('div', { class: 'im-transit' }, [el('div', {}, [el('span', { class: 'im-spin' }), working.get(key)]), el('div', { class: 'im-muted', style: 'font-size:11px', text: SLOW_NOTE })]) : null);
  const runSlow = (key, label, act, fn) => { if (working.has(key)) return; working.set(key, label); rerenderAll(); act(async () => { try { await fn(); } finally { working.delete(key); rerenderAll(); } }); };
  function reportView(c, act) {
    const reps = c.reports || [];
    const cur = reps.at(-1);
    const emb = c.art?.emblem?.imageId || c.art?.seal?.imageId;
    const day = (t) => new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const head = el('div', { class: 'im-rep-head' }, [
      emb ? el('img', { class: 'im-rep-emblem', src: imgUrl(emb, 'lg'), alt: '상징물', title: '눌러서 크게', onclick: () => openImage(emb, `${c.name} · 상징물`, '') }) : el('div', { class: 'im-rep-emblem im-me-empty', text: '상징물 없음' }),
      el('div', { class: 'im-grow' }, [
        el('div', { class: 'im-rep-name', text: c.name }),
        cur ? el('div', { class: 'im-rep-title', text: `「${cur.title}」` }) : null,
        el('div', { class: 'im-muted', text: `그쪽은 지금 ${c.theirNowLabel || ''} · 편지 ${c.letters.length}통${cur ? ` · ${day(cur.at)} 기록` : ''}` }),
        c.art?.portrait?.imageId ? link('초상화 보기', () => openImage(c.art.portrait.imageId, `${c.name} · 초상화`, '')) : null,
      ]),
    ]);
    const askBtn = working.has(`report:${c.id}`) ? workingBox(`report:${c.id}`) : btn(cur ? '기록 갱신하기 (글 1회)' : '기록부 받기 (글 1회)', () => runSlow(`report:${c.id}`, cur ? '기록을 갱신하는 중이에요…' : '기록부를 받는 중이에요…', act, async () => { await ask('makeReport', { id: c.id }, 300000); await refresh(); }), { primary: !cur });
    // 편지로 이어진 일들(글 생성 없음): 편지 오감, 그쪽 사건(드러난 것 / 가려진 것), 물건, 모습 바뀜
    const tl = [];
    for (const l of c.letters) {
      if (l.from === 'them' && l.state === 'in_transit') continue;
      tl.push({ t: l.from === 'me' ? l.sentAt : l.arriveAt, when: l.from === 'me' ? (l.theirSentLabel || '') : (l.theirWrittenLabel || ''), kind: l.from === 'me' ? 'me' : 'them', text: l.from === 'me' ? '내가 편지를 보냄' : `${c.name}의 편지가 닿음${l.enclosures?.length ? ` · 동봉 ${l.enclosures.map((x) => x.item).join(', ')}` : ''}`, sub: (l.body || '').replace(/\s+/g, ' ').slice(0, 70) });
      if (l.artNote) tl.push({ t: (l.arriveAt || l.sentAt) + 1, when: l.theirWrittenLabel || '', kind: 'art', text: l.artNote });
    }
    (c.memory?.timeline || []).forEach((e, i) => tl.push({ t: null, order: i, when: e.when || '', kind: e.open ? 'event' : 'secret', text: e.event }));
    const dated = tl.filter((x) => x.t).sort((a, b) => a.t - b.t);
    const events = tl.filter((x) => !x.t);
    const tlNode = (x, i) => {
      const key = `${c.id}:tl:${i}`;
      const hide = x.kind === 'secret' && !revealed.has(key);
      return el('div', { class: `im-tl im-tl-${x.kind}` }, [
        el('div', { class: 'im-tl-when', text: x.t ? `${new Date(x.t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}${x.when ? ` · 그쪽 ${x.when.replace('만난 지 ', '')}` : ''}` : (x.when || '그쪽에서') }),
        el('div', { class: `im-tl-text${hide ? ' im-hidden' : ''}`, text: hide ? '편지에 쓰지 않은 그쪽의 일 — 눌러서 보기' : x.text, onclick: hide ? () => { revealed.add(key); rerenderAll(); } : undefined }),
        x.sub ? el('div', { class: 'im-muted', style: 'font-size:11px', text: x.sub }) : null,
      ]);
    };
    const body = [head];
    if (!cur) {
      body.push(el('div', { class: 'im-rep-paper' }, [
        el('div', { class: 'im-muted', text: `${c.name}에 대한 기록을 아직 받지 않았어요. 받으면 서정적인 기록과, 그쪽 세계 사람들이 ${c.name}에 대해 하는 말(일부는 가려져 있어요)이 남아요. 원할 때 갱신하면 지난 기록과 함께 쌓여요.` }),
        askBtn,
      ]));
    } else {
      body.push(el('div', { class: 'im-rep-paper' }, [
        el('div', { class: 'im-rep-date', text: `${day(cur.at)}의 기록` }),
        cur.changed ? el('div', { class: 'im-rep-changed', text: `지난 기록 뒤로 — ${cur.changed}` }) : null,
        el('div', { class: 'im-rep-note', text: cur.note }),
      ]));
      if (cur.facts.length) body.push(el('h4', { text: '알려진 것' }), el('div', { class: 'im-rep-facts' }, cur.facts.flatMap((f) => [el('div', { class: 'im-muted', text: f.label }), el('div', { text: f.value })])));
      if (cur.voices.length) {
        body.push(el('h4', { text: `그쪽 사람들이 하는 말 · ${cur.voices.length}` }), el('div', { class: 'im-voices' }, cur.voices.map((v, i) => {
          const key = `${c.id}:${cur.at}:v${i}`;
          const hide = v.hidden && !revealed.has(key);
          return el('div', { class: `im-voice${v.hidden ? ' im-voice-secret' : ''}` }, [
            el('div', { class: `im-voice-says${hide ? ' im-hidden' : ''}`, text: hide ? '가려진 소문 — 눌러서 듣기' : `“${v.says}”`, onclick: hide ? () => { revealed.add(key); rerenderAll(); } : undefined }),
            el('div', { class: 'im-voice-who', text: `— ${v.who}${v.relation ? `, ${v.relation}` : ''}${v.hidden ? ' · 쉿' : ''}` }),
          ]);
        })));
      }
      body.push(el('div', { class: 'im-row', style: 'margin:10px 0' }, [askBtn, el('span', { class: 'im-muted', style: 'font-size:11px', text: '갱신하면 새 기록이 위에 오고, 지난 기록은 아래에 남아요.' })]));
      if (reps.length > 1) {
        body.push(el('h4', { text: `지난 기록 · ${reps.length - 1}` }), ...[...reps].slice(0, -1).reverse().map((r) => el('details', { class: 'im-rep-old' }, [
          el('summary', { text: `${day(r.at)} · 「${r.title}」` }),
          el('div', { class: 'im-rep-note', text: r.note }),
          r.voices.length ? el('div', { class: 'im-muted', style: 'margin-top:6px', text: r.voices.filter((v) => !v.hidden).map((v) => `${v.who}: “${v.says}”`).join('\n') }) : null,
        ])));
      }
    }
    body.push(el('h4', { text: '편지로 이어진 일들' }));
    body.push(dated.length || events.length ? el('div', { class: 'im-timeline' }, [...dated.map(tlNode), ...(events.length ? [el('div', { class: 'im-tl-sep', text: '그쪽 연대기' }), ...events.map((x, i) => tlNode(x, i + 1000))] : [])]) : el('div', { class: 'im-muted', text: '아직 이어진 일이 없어요.' }));
    return body;
  }

  // 모음: 캐릭터마다 추억 상자(보석함). 누르면 그 캐릭터와 나눈 것(초상화·그림·봉투·물건)을 나눠 본다
  function boxesView(list, openBox) {
    return [
      el('div', { class: 'im-muted', style: 'margin:4px 0 8px', text: '상대마다 하나씩. 누르면 그 상대와 나눈 초상화·그림·봉투·물건이 나뉘어 보여요.' }),
      el('div', { class: 'im-lockers' }, list.map((c) => {
        const img = c.art?.locker?.imageId;
        const n = { pics: (c.items || []).filter((x) => x.imageId && x.state === 'arrived').length, portraits: (c.art?.portrait ? 1 : 0) + (c.art?.portraitHistory || []).length };
        return el('div', { class: 'im-locker', onclick: () => openBox(c.id) }, [
          img ? el('img', { src: imgUrl(img, 'lg'), alt: `${c.name}의 추억 상자` }) : el('div', { class: 'im-locker-empty' }, [avatarEl(c)]),
          el('b', { text: c.name }),
          el('div', { class: 'im-muted', style: 'font-size:11px', text: `초상화 ${n.portraits} · 그림·물건 ${n.pics}` }),
        ]);
      })),

    ];
  }
  // 모습 카드: 초상화(NovelAI)·상징물·봉투·추억 상자. 각자 그리기, 그리는 중·실패를 카드 위에
  function lookCards(c, act) {
    if (!artOn()) {
      const t = c.looksText;
      const tcard = (label, text) => el('div', { class: 'im-look-text' }, [el('b', { text: label }), el('div', { text: text || '아직 없어요.' })]);
      return el('div', {}, [
        el('div', { class: 'im-looks-text' }, [tcard('모습', t?.portrait), tcard('상징물', t?.emblem), tcard('봉투', t?.envelope), tcard('추억 상자', t?.box)]),
        el('div', { class: 'im-row', style: 'margin-top:6px' }, [
          working.has(`looks:${c.id}`) ? workingBox(`looks:${c.id}`) : btn(t ? '모습 글 다시 받기 (글 1회)' : '모습을 글로 받기 (글 1회)', () => runSlow(`looks:${c.id}`, '모습을 글로 쓰는 중이에요…', act, async () => { await ask('describeLooks', { id: c.id }, 300000); await refresh(); })),
          t ? el('span', { class: 'im-muted', style: 'font-size:11px', text: `문체: ${PROSE_STYLES[t.style] || t.style || '담백하게'}` }) : null,
        ]),
      ]);
    }
    const card = (label, imgId, state, onDraw, cls = '') => el('div', { class: `im-item im-look ${cls}` }, [
      el('div', { class: 'im-pic' }, [imgId ? el('img', { src: imgUrl(imgId, 'lg'), alt: label, loading: 'lazy', style: 'cursor:zoom-in', onclick: () => openImage(imgId, `${c.name} · ${label}`, '') }) : el('span', { html: PIC }), state]),
      el('div', { class: 'im-cap' }, [el('b', { text: label }), onDraw ? link(imgId ? '다시 그리기' : '그리기', onDraw) : null]),
    ]);
    const pj = c.portraitJob;
    const sec = pj?.startedAt ? Math.max(0, Math.round((Date.now() - pj.startedAt) / 1000)) : 0;
    const pState = pj?.state === 'drawing' ? el('div', { class: 'im-state' }, [el('span', { class: 'im-spin' }), `그리는 중… ${sec < 60 ? `${sec}초째` : `${Math.floor(sec / 60)}분째`}`]) : pj?.state === 'failed' ? el('div', { class: 'im-state im-bad', title: pj.error || '' }, [`실패 — ${short(pj.error || '', 40)}`]) : null;
    const drawKind = (k, label) => () => act(async () => {
      if (!(await confirmBox(`${c.name}의 ${label}을(를) ${c.art?.[k]?.imageId ? '다시 ' : ''}그립니다. 이미지 1장 + 글 생성 1회. 계속할까요?`))) return;
      await ask('drawSet', { id: c.id, kinds: [k] });
      await refresh();
    });
    const kinds = htmlPaper() ? [['emblem', '상징물'], ['envelope', '봉투'], ['locker', '추억 상자']] : [['paper', '편지지'], ['stamp', '우표'], ['seal', '봉인'], ['locker', '추억 상자']];
    return el('div', { class: 'im-grid im-looks' }, [
      card('초상화', c.art?.portrait?.imageId, pState, pj?.state === 'drawing' ? null : () => act(async () => {
        if (!(await confirmBox(`${c.name}의 초상화를 ${c.art?.portrait?.imageId ? '다시 ' : ''}그립니다. 글 생성 1회 + 그림 1장(NovelAI). 계속할까요?`))) return;
        await ask('drawPortrait', { id: c.id });
        await refresh();
      }), 'im-look-tall'),
      ...kinds.map(([k, label]) => card(label, c.art?.[k]?.imageId, stateOverlay(artTarget(c, k)), ['waiting', 'drawing'].includes(artTarget(c, k)?.state) ? null : drawKind(k, label))),
    ]);
  }
  function lockerView(c, act, back) {
    const pics = (c.items || []).filter((x) => x.imageId && x.state === 'arrived');
    const drawn = pics.filter((x) => x.nai || x.photo);
    const things = pics.filter((x) => !x.nai && !x.photo);
    const portraits = [...(c.art?.portrait ? [{ imageId: c.art.portrait.imageId, at: c.art.portrait.at, now: true }] : []), ...[...(c.art?.portraitHistory || [])].reverse()];
    const envs = c.letters.filter((l) => l.from === 'them' && l.state !== 'in_transit' && (l.art?.envelope || c.art?.envelope?.imageId));
    const grid = (arr, f) => el('div', { class: 'im-grid' }, arr.map(f));
    const pic = (id, cap, sub) => el('div', { class: 'im-item' }, [el('div', { class: 'im-pic' }, [el('img', { src: imgUrl(id, 'lg'), alt: cap, loading: 'lazy', style: 'cursor:zoom-in', onclick: () => openImage(id, cap, sub || '') })]), el('div', { class: 'im-cap' }, [el('b', { text: cap }), sub ? el('div', { class: 'im-muted', text: sub }) : null])]);
    return [
      back ? el('div', { class: 'im-row' }, [link('← 추억 상자들', back)]) : null,
      artOn() && c.art?.locker?.imageId ? el('div', { class: 'im-box-big' }, [el('img', { src: imgUrl(c.art.locker.imageId, 'lg'), alt: `${c.name}의 추억 상자`, onclick: () => openImage(c.art.locker.imageId, `${c.name} · 추억 상자`, '') })]) : null,
      el('div', { class: 'im-row', style: 'gap:12px;align-items:center;margin:6px 0' }, [avatarEl(c, 'im-seal', { portraitFirst: true }), el('div', { class: 'im-grow' }, [el('b', { text: c.name }), el('div', { class: 'im-muted', text: `편지 ${c.letters.length}통 · 물건 ${(c.items || []).length}개` })]), link('편지첩 열기', () => { P.id = c.id; P.tab = 'book'; P.view = 'c'; lsSet(`${LS_PANEL}.view`, 'c'); lsSet(`${LS_PANEL}.id`, c.id); lsSet(`${LS_PANEL}.tab`, 'book'); panelView.render(); })]),
      el('h4', { text: '모습' }),
      lookCards(c, act),
      el('h4', { text: `초상화 · ${portraits.length}` }),
      portraits.length ? grid(portraits, (x) => pic(x.imageId, x.now ? '지금 모습' : '예전 모습', x.at ? new Date(x.at).toLocaleDateString('ko-KR') : '')) : el('div', { class: 'im-muted', text: '서류함의 「초상화 그리기」로 그릴 수 있어요.' }),
      el('h4', { text: `그림·사진 · ${drawn.length}` }),
      drawn.length ? el('div', { class: 'im-grid' }, drawn.map((x) => el('div', {}, [pic(x.imageId, x.name, x.from === 'me' ? '내가 보냄' : `${c.name}이(가) 보냄`), x.from === 'me' ? link('내 초상화로 쓰기', () => act(async () => { await ask('setMyPortrait', { key: meKeyOf(c), imageId: x.imageId }); const r = await ask('mePortraits'); S.me = r.me || {}; })) : null]))) : el('div', { class: 'im-muted', text: '서로 보낸 그림·사진이 여기에 모여요.' }),
      el('h4', { text: `봉투 · ${envs.length}` }),
      envs.length ? el('div', { class: 'im-env-grid' }, envs.map((l) => { const f = envelopeFace(c, l, 'im-env-card'); f.addEventListener('click', () => showEnvelope(c, l)); return el('div', {}, [f, el('div', { class: 'im-muted', style: 'font-size:11px;margin-top:4px', text: l.writtenLabel || l.theirWrittenLabel || when(l.arriveAt) })]); })) : el('div', { class: 'im-muted', text: '봉투 그림이 생기면 편지마다 모여요.' }),
      el('h4', { text: `물건 · ${things.length + (c.items || []).filter((x) => !x.imageId).length}` }),
      (c.items || []).filter((x) => !x.nai && !x.photo).length ? el('div', { class: 'im-grid' }, (c.items || []).filter((x) => !x.nai && !x.photo && (x.state === 'arrived' || x.from === 'me')).map((x) => itemCard(x, x.from === 'me' ? `→ ${c.name}` : `${c.name} →`, c.id))) : el('div', { class: 'im-muted', text: '아직 오간 물건이 없습니다.' }),
    ];
  }
  function albumOld(list) {
    const items = list.flatMap((c) => c.items.filter((x) => x.state === 'arrived' || x.from === 'me').map((x) => ({ x, c })));
    items.sort((a, b) => (b.x.arriveAt || 0) - (a.x.arriveAt || 0));
    return [
      el('h4', { text: `편지 묶음 · ${list.length}` }),
      ...list.map((c) => {
        const ls = c.letters.filter((l) => !(l.from === 'them' && l.state === 'in_transit'));
        const first = ls[0];
        const last = ls[ls.length - 1];
        return el('div', { class: 'im-bundle', onclick: () => { P.id = c.id; P.tab = 'book'; lsSet(`${LS_PANEL}.id`, c.id); lsSet(`${LS_PANEL}.tab`, 'book'); panelView.render(); } }, [
          el('div', { class: 'im-stack' }, [el('i'), el('i'), el('i')]),
          el('div', { class: 'im-grow' }, [
            el('b', { text: c.name }),
            el('div', { class: 'im-muted', text: `${ls.length}통 · 물건 ${c.items.length}개${first ? ` · ${when(first.sentAt)} ~ ${when(last.sentAt)}` : ''}` }),
            el('div', { class: 'im-muted', text: c.personaName ? `${c.personaName}의 편지 상대` : '페르소나 없음' }),
          ]),
        ]);
      }),
      (() => {
        const envs = list.flatMap((c) => (c.art?.envelope?.imageId || c.letters.some((q) => q.art?.envelope) ? c.letters.filter((l) => l.from === 'them' && l.state !== 'in_transit').map((l) => ({ c, l })) : []));
        envs.sort((a, b) => (b.l.arriveAt || 0) - (a.l.arriveAt || 0));
        return el('div', {}, [
          el('h4', { text: `받은 봉투 · ${envs.length}` }),
          envs.length ? el('div', { class: 'im-env-grid' }, envs.map(({ c, l }) => {
            const f = envelopeFace(c, l, 'im-env-card');
            f.addEventListener('click', () => showEnvelope(c, l));
            return el('div', {}, [f, el('div', { class: 'im-muted', style: 'font-size:11px;margin-top:4px', text: `${c.name} · ${l.writtenLabel || l.theirWrittenLabel || when(l.arriveAt)}` })]);
          })) : el('div', { class: 'im-muted', text: '봉투 그림이 있는 상대의 편지가 여기에 모입니다(서류함 → 그림 세트에서 봉투를 그려 주세요).' }),
        ]);
      })(),
      el('h4', { text: `모든 물건 · ${items.length}` }),
      items.length ? el('div', { class: 'im-grid' }, items.map(({ x, c }) => itemCard(x, x.from === 'me' ? `→ ${c.name}` : `${c.name} →`, c.id))) : el('div', { class: 'im-muted', text: '아직 오간 물건이 없습니다.' }),
    ];
  }

  // 우체통 위젯
  const box = el('div', { class: 'im-box', title: '이세계 편지' });
  let lastDrag = 0;
  try {
    widget = ctx.ui.createFloatWidget({ width: 76, height: 96, initialPosition: { x: Math.max(12, window.innerWidth - 110), y: Math.max(12, window.innerHeight - 190) }, snapToEdge: false, tooltip: '이세계 편지', chromeless: true });
    widget.root.append(box);
    if (!removeStyle) widget.root.append(el('style', { text: CSS + CSS2 }));
    // 끌기와 누르기 구분: 위치가 실제로 바뀐 끌기 직후의 클릭만 무시한다
    let downPos = null;
    widget.root.addEventListener('pointerdown', () => { downPos = widget.getPosition?.() || null; }, true);
    widget.onDragEnd?.((pos) => {
      if (!downPos || !pos || Math.abs(pos.x - downPos.x) + Math.abs(pos.y - downPos.y) > 4) lastDrag = Date.now();
    });
    widget.root.addEventListener('click', () => {
      if (Date.now() - lastDrag < 350) return;
      // 열 때 새 편지가 있으면 그 상대의 편지첩으로
      const fresh = panel?.isCollapsed() && S.all.find((c) => c.letters.some((l) => l.from === 'them' && l.state === 'delivered'));
      if (fresh) {
        if (!inPersona(fresh)) setPersona(ALL);
        openPanelFor(fresh.id);
      } else togglePanel();
    });
  } catch { widget = null; }

  let widgetKey = '';
  function renderWidget() {
    if (!widget) return;
    const unread = S.list.reduce((n, x) => n + x.unread, 0);
    const flagUp = unread > 0;
    const open = panel && !panel.isCollapsed();
    // 모양이 바뀔 때만 다시 그린다(누르는 도중에 그림이 바뀌어 클릭이 사라지지 않게)
    const running = S.all.filter((c) => c.artJob?.state === 'running').length;
    const failed = S.all.filter((c) => c.artJob?.state === 'failed').length;
    const key = `${unread}|${open}|${running}|${failed}`;
    if (key === widgetKey) return;
    widgetKey = key;
    // 고정 SVG(사용자 글 없음). 숫자만 textContent로 넣는다.
    box.innerHTML = `<svg width="76" height="96" viewBox="0 0 76 96" aria-hidden="true">
      <rect x="33" y="58" width="9" height="36" rx="1" fill="#6b5a48"/>
      <rect x="22" y="90" width="31" height="5" rx="2" fill="#4f4235"/>
      <path d="M8 34a22 22 0 0 1 44 0v26H8z" fill="#c8553a"/>
      <path d="M8 34a22 22 0 0 1 44 0" fill="none" stroke="#9e3d27" stroke-width="2"/>
      <rect x="8" y="50" width="44" height="10" fill="#b44a31"/>
      <rect x="15" y="38" width="30" height="5" rx="2.5" fill="#5a2516"/>
      <rect x="${open ? 50 : 53}" y="${flagUp ? 12 : 36}" width="3.5" height="${flagUp ? 30 : 8}" fill="#57524c"/>
      <path d="${flagUp ? 'M53.5 12h15l-3 5 3 5h-15z' : 'M53.5 36h4v14h-4z'}" fill="#f0a53a"/>
    </svg>`;
    if (unread) box.append(el('span', { text: String(unread), style: 'position:absolute;left:30px;top:4px;min-width:20px;height:20px;border-radius:10px;background:#534ab7;color:#fff;font:600 11px/20px system-ui,sans-serif;text-align:center;padding:0 5px;box-sizing:border-box' }));
    if (running) box.append(el('span', { class: 'im-pill', style: 'background:#7a5a2b', title: '그림을 그리는 중' }, [el('span', { class: 'im-spin', style: 'width:7px;height:7px;margin-right:3px' }), '그림']));
    else if (failed) box.append(el('span', { class: 'im-pill', style: 'background:#a33', title: '그림 그리기 실패 — 편지첩에서 확인' }, ['그림 실패']));
    box.style.position = 'relative';
    widget.root.title = [unread ? `새 편지 ${unread}통` : '이세계 편지', running ? '그림 그리는 중' : '', failed ? '그림 실패 있음' : ''].filter(Boolean).join(' · ');
  }
  views.add({ render: renderWidget });

  const offActivate = tab.onActivate(() => refresh());
  const timer = setInterval(refresh, 60 * 1000);
  const tickArt = setInterval(() => { if (S.all.some((c) => c.artJob?.state === 'running' || c.portraitJob?.state === 'drawing')) refresh(); }, 15 * 1000);
  refresh();
  renderAll();

  return () => {
    clearInterval(timer);
    clearInterval(tickArt);
    clearTimeout(soon);
    offActivate?.();
    offBack?.();
    removeStyle?.();
    widget?.destroy?.();
    panel?.destroy?.();
    tab.destroy();
  };
}
