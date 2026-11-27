// 이세계 우체통 공용 로직(백엔드·프런트·테스트가 같이 씀). 의존성 없음, 부수 효과 없음.
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
export function applyReply(c, reply, now = Date.now(), rand = Math.random, { lateChance = 0 } = {}) {
  c = normalize(c);
  const base0 = realHours(c, pickBetween(c.delivery.min, c.delivery.max, rand));
  const late = postLate(base0, lateChance, rand);
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




// 상대 자동 생성(매칭): 프롬프트, 결과 검사, 카드·로어북·우편 설정으로 나누기. 부수 효과 없음.
// 카드 양식은 D:\AI\Marinara-Engine_설정\CHARACTER_CARD_COMPACT.md(압축판) 요약. 원본이 바뀌면 여기도 맞춘다.

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



// 장기 기억과 정리 단계(부수 효과 없음).
// 기억 층: L1 관계 장부 / L2 최근 원문(core) / L3 편지 요약 / L4 시기 요약 / L5 그쪽 사건 / L6 로어북(match.pickLore) / L7 옛 편지 회상
// 정리 단계: 답장이 생길 때마다 한 번 — 요약·장부·사건·로어북/카드 변경 제안을 받아 규칙대로 적용하거나 승인 대기로 둔다.

export const DEFAULT_BUDGETS = {
  summaries: 20, // L3 최근 요약 통수
  summaryChars: 2400,
  chapterChars: 1600, // L4
  chapterEvery: 10, // 요약이 이만큼 쌓이면 시기 요약 1장
  timelineItems: 12, // L5
  ledgerChars: 1600, // L1
  loreChars: 6000, // L6
  recallChars: 1800, // L7 (0이면 끔)
};

export const CARD_FIELDS = ['look', 'outfit', 'job', 'impression', 'desire', 'goal', 'skill', 'surface_inner', 'core', 'fixed', 'leak', 'voice', 'speech', 'never'];
export const DEFAULT_LOCKS = ['first_line', 'core', 'fixed', 'never', '세계 개요'];
export const MODES = ['auto', 'approve', 'off'];

export function defaultApplyMode(origin) {
  return origin === 'existing'
    ? { loreAdd: 'auto', loreEdit: 'auto', cardAdd: 'approve', cardEdit: 'approve', origLore: 'off' }
    : { loreAdd: 'auto', loreEdit: 'auto', cardAdd: 'auto', cardEdit: 'auto', origLore: 'off' };
}

const mstr = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const marr = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).map(fn).filter(Boolean) : []);
export const approxTokens = (s) => Math.ceil((s || '').length / 1.7);

export function cleanBudgets(b) {
  const out = {};
  for (const [k, d] of Object.entries(DEFAULT_BUDGETS)) {
    const x = Number(b?.[k]);
    out[k] = Number.isFinite(x) && x >= 0 ? Math.min(k.endsWith('Chars') ? 40000 : 200, Math.round(x)) : d;
  }
  out.chapterEvery = Math.max(3, out.chapterEvery);
  return out;
}

export function emptyLedger() {
  return { calledMe: '', calledThem: '', stage: '', mood: '', promises: [], openQuestions: [], anniversaries: [], knowsAboutMe: [], iKnow: [] };
}

// 상대에 기억·잠금·적용 모드 기본값을 채운다(이미 있으면 그대로)
export function ensureMemory(c) {
  c = normalize(c);
  if (c.memory && c.locks && c.applyMode) return c;
  return {
    ...c,
    memory: c.memory || { summaries: [], chapters: [], ledger: emptyLedger(), timeline: [], changes: [], organizedUpTo: '' },
    locks: c.locks || [...DEFAULT_LOCKS],
    applyMode: c.applyMode || defaultApplyMode(c.origin),
    localLore: c.localLore || [],
    organize: c.organize ?? null,
  };
}

// ── 기억 층 조립 ──

function ledgerText(L) {
  const lines = [];
  if (L.calledMe || L.calledThem) lines.push(`called=you call {{user}} "${L.calledMe || '?'}" / {{user}} calls you "${L.calledThem || '?'}"`);
  if (L.stage) lines.push(`stage=${L.stage}`);
  if (L.mood) lines.push(`your_mood_toward_user=${L.mood}`);
  const open = (L.promises || []).filter((p) => p.state !== 'done' && p.state !== 'broken');
  if (open.length) lines.push(`promises=\n${open.map((p) => `- ${p.who === 'me' ? '{{user}}' : 'you'}: ${p.what}${p.when ? ` (${p.when})` : ''}`).join('\n')}`);
  if (L.openQuestions?.length) lines.push(`unanswered_questions=\n${L.openQuestions.map((q) => `- ${q.who === 'me' ? '{{user}} asked' : 'you asked'}: ${q.q}`).join('\n')}`);
  if (L.anniversaries?.length) lines.push(`dates_to_remember=${L.anniversaries.join(' / ')}`);
  if (L.knowsAboutMe?.length) lines.push(`what_you_know_about_user=\n${L.knowsAboutMe.map((x) => `- ${x}`).join('\n')}`);
  return lines.join('\n');
}

const fit = (parts, budget) => {
  const out = [];
  let used = 0;
  let dropped = 0;
  for (const p of parts) {
    if (used + p.length > budget) { dropped++; continue; }
    out.push(p);
    used += p.length;
  }
  return { out, dropped };
};

// 옛 편지 회상(L7): 최근 내 편지의 낱말과 많이 겹치는 옛 편지 문단을 고른다(무료, 키워드 방식)
export function recallOld(letters, recentCount, budget) {
  if (!budget) return { text: '', count: 0, dropped: 0 };
  const past = letters.filter((l) => l.body && !(l.from === 'me' && l.state === 'in_transit'));
  const recent = past.slice(-recentCount);
  const old = past.slice(0, Math.max(0, past.length - recentCount));
  if (!old.length) return { text: '', count: 0, dropped: 0 };
  const lastMine = [...recent].reverse().find((l) => l.from === 'me');
  const words = new Set(((lastMine?.body || '') + ' ' + (lastMine?.enclosure || '')).split(/[\s.,!?…·"'「」()~\-—]+/).map((w) => w.replace(/(은|는|이|가|을|를|에|에서|의|도|로|으로|와|과|요|야)$/, '')).filter((w) => w.length >= 2));
  if (!words.size) return { text: '', count: 0, dropped: 0 };
  const scored = [];
  for (const l of old) {
    for (const para of l.body.split(/\n\s*\n/)) {
      let score = 0;
      for (const w of words) if (para.includes(w)) score++;
      if (score >= 2) scored.push({ score, text: `(${l.from === 'me' ? '{{user}}' : 'you'}, 예전 편지) ${para.trim()}` });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const { out, dropped } = fit(scored.map((x) => x.text), budget);
  return { text: out.join('\n'), count: out.length, dropped };
}

// 기억 층 → 프롬프트에 넣을 글 + 보고(모의 조립용)
export function memoryLayers(c, { budgets = DEFAULT_BUDGETS, recentLetters = 6 } = {}) {
  c = ensureMemory(c);
  const b = cleanBudgets(budgets);
  const m = c.memory;
  const report = [];
  const ledgerRaw = ledgerText(m.ledger || emptyLedger());
  const ledger = ledgerRaw.slice(0, b.ledgerChars);
  report.push({ layer: '관계 장부', chars: ledger.length, note: ledgerRaw.length > ledger.length ? `${ledgerRaw.length - ledger.length}자 잘림` : '' });

  // 요약: 원문으로 이미 들어가는 최근 편지는 빼고, 그 앞의 요약만
  const past = c.letters.filter((l) => !(l.from === 'me' && l.state === 'in_transit'));
  const shownIds = new Set(past.slice(-recentLetters).map((l) => l.id));
  const sums = (m.summaries || []).filter((s) => !shownIds.has(s.letterId));
  const lastN = sums.slice(-b.summaries);
  const sumFit = fit([...lastN].reverse().map((s) => `- [${s.when || ''}] ${s.from === 'me' ? '{{user}}' : 'you'}: ${s.text}`), b.summaryChars);
  const summaries = sumFit.out.reverse().join('\n');
  report.push({ layer: '편지 요약', chars: summaries.length, note: `${sumFit.out.length}/${sums.length}통${sums.length - sumFit.out.length ? ` (${sums.length - sumFit.out.length}통 빠짐)` : ''}` });

  const chFit = fit([...(m.chapters || [])].reverse().map((ch, i, all) => `[${all.length - i}장] ${ch.text}`), b.chapterChars);
  const chapters = chFit.out.reverse().join('\n');
  report.push({ layer: '시기 요약', chars: chapters.length, note: `${chFit.out.length}/${(m.chapters || []).length}장` });

  const tl = (m.timeline || []);
  const openEv = tl.filter((e) => e.open);
  const closed = tl.filter((e) => !e.open).slice(-Math.max(0, b.timelineItems - openEv.length));
  const timeline = [...openEv.map((e) => `- (진행 중) ${e.when ? `[${e.when}] ` : ''}${e.event}`), ...closed.map((e) => `- ${e.when ? `[${e.when}] ` : ''}${e.event}`)].join('\n');
  report.push({ layer: '그쪽 사건', chars: timeline.length, note: `진행 중 ${openEv.length} · 최근 ${closed.length}` });

  const rc = recallOld(c.letters, recentLetters, b.recallChars);
  report.push({ layer: '옛 편지 회상', chars: rc.text.length, note: b.recallChars ? `${rc.count}문단${rc.dropped ? ` (${rc.dropped} 빠짐)` : ''}` : '끔' });
  return { ledger, summaries, chapters, timeline, recall: rc.text, report };
}

// ── 정리 단계 ──

const ORG_SHAPE = '{"summaries":[{"letter_id":"","text":""}],"ledger":{"called_me":"","called_them":"","stage":"","mood":"","promises_add":[{"who":"me|them","what":"","when":""}],"promises_done":[""],"questions_add":[{"who":"me|them","q":""}],"questions_answered":[""],"dates_add":[""],"knows_about_me_add":[""],"i_know_add":[""]},"timeline_add":[{"when":"","event":"","open":true}],"timeline_close":[""],"lore_add":[{"title":"","keys":[""],"content":""}],"lore_edit":[{"title":"","after":"","reason":""}],"card":[{"field":"","value":"","reason":""}],"conflicts":[{"target":"","why":""}],"art_change":{"paper":false,"stamp":false,"reason":"","medium":"","motif":""},"chapter":""}';

export function buildOrganizeMessages(c, { letterIds, personaName = '', loreTitles = [], cardText = '', chapterDue = false }) {
  c = ensureMemory(c);
  const userName = personaName || c.personaName || '편지의 주인';
  const set = new Set(letterIds);
  const letters = c.letters.filter((l) => set.has(l.id));
  const fmt = (l) => {
    const who = l.from === 'me' ? '{{user}}' : c.name;
    const when = l.from === 'me' ? theirLabel(c, l.theirArriveAt) : theirLabel(c, l.theirWrittenAt);
    const between = l.from === 'them' && l.between?.length ? `\n(그사이 ${c.name}에게 일어난 일, 편지에는 일부만 드러남)\n${l.between.map((e) => `- [${e.when}] ${e.event}${e.open ? ' (진행 중)' : ''}`).join('\n')}` : '';
    const enc = (l.enclosures || []).map((x) => x.item).join(', ');
    return `<letter id="${l.id}" from="${who}" their_date="${when}">\n${l.body}${l.ps ? `\n추신: ${l.ps}` : ''}${enc ? `\n(동봉: ${enc})` : ''}${between}\n</letter>`;
  };
  const L = c.memory.ledger;
  const openTl = (c.memory.timeline || []).filter((e) => e.open).map((e) => `- ${e.event}`).join('\n');
  const recentSums = (c.memory.summaries || []).slice(-(chapterDue ? 12 : 4)).map((s) => `- ${s.text}`).join('\n');
  const system = [
    '<system>',
    `You keep the records of a letter correspondence between {{user}} and ${c.name} (another world). You are a careful archivist, not a writer.`,
    'Record only what the letters (and the hidden between-events) establish. Do not invent. Korean output.',
    'Changes to the lorebook and the character card must follow from new facts in these letters. Never rewrite style; never change fixed traits.',
    `Locked (never propose changes): ${c.locks.join(', ')}.`,
    'If a new fact contradicts the card or lorebook, do not edit; put it in `conflicts` instead.',
    '</system>',
    '',
    `<card>\n${cardText || c.brief}\n</card>`,
    `<lorebook_titles>\n${loreTitles.join(' / ') || '(없음)'}\n</lorebook_titles>`,
    `<current_records>\nledger=${JSON.stringify({ calledMe: L.calledMe, calledThem: L.calledThem, stage: L.stage, mood: L.mood, promises: L.promises.filter((p) => p.state === 'open').map((p) => p.what), questions: L.openQuestions.map((q) => q.q), knowsAboutMe: L.knowsAboutMe })}\nopen_events=\n${openTl || '(없음)'}\nrecent_summaries=\n${recentSums || '(없음)'}\n</current_records>`,
  ].join('\n');
  const user = [
    '<new_letters>',
    letters.map(fmt).join('\n\n'),
    '</new_letters>',
    '',
    '<task>',
    '- summaries: one per new letter (2~3 Korean sentences: facts, feelings, promises). Use the letter id.',
    '- ledger: update only what changed. called_me = how ' + c.name + ' addresses {{user}}; called_them = how {{user}} addresses ' + c.name + '. stage = closeness in a few words. mood = ' + c.name + '\'s feeling toward {{user}} now. knows_about_me_add = new facts ' + c.name + ' learned about {{user}} from {{user}}\'s letters only. i_know_add = new facts {{user}} learned about ' + c.name + '. promises_done / questions_answered: copy the exact text from current records.',
    '- timeline_add: events in ' + c.name + '\'s world from the between-events and the letter (when = their date). timeline_close: exact text of open events that ended.',
    '- lore_add: only lasting world facts (place, person, object, custom) that will matter again; title + 2~4 keys + content (facts only). lore_edit: when an existing lorebook entry (by exact title) must change because of events; write the full new content in `after`.',
    '- card: field-level changes (field ∈ look, outfit, job, impression, desire, goal, skill, surface_inner, leak, voice, speech) only when events changed them (an injury, a move, a new goal). value = the full new line value.',
    '- art_change: set paper and/or stamp true ONLY when the new letter itself shows that the physical letter changed for a reason in the story — moving to a new place, a season turning, scarcity or war, a festival or special occasion, a new job or status. Give the reason in one Korean sentence, and the new medium (paper) or stamp motif if known. Usually both are false.',
    chapterDue ? '- chapter: 4~6 Korean sentences summarizing this whole stretch of the correspondence (how the relationship changed). Required now.' : '- chapter: "" (not needed now).',
    'Empty arrays when nothing applies. Output JSON only:',
    ORG_SHAPE,
    '</task>',
  ].join('\n');
  const rep = (t) => t.replaceAll('{{user}}', userName).replaceAll('{{char}}', c.name);
  return [{ role: 'system', content: rep(system) }, { role: 'user', content: rep(user) }];
}

export function cleanOrganize(raw) {
  if (typeof raw === 'string') raw = parseJsonLoose(raw);
  const L = raw?.ledger || {};
  const who = (v) => (v === 'me' ? 'me' : 'them');
  return {
    summaries: marr(raw?.summaries, 10, (x) => (mstr(x?.text, 600) ? { letterId: mstr(x?.letter_id, 60), text: mstr(x.text, 600) } : null)),
    ledger: {
      calledMe: mstr(L.called_me, 60), calledThem: mstr(L.called_them, 60), stage: mstr(L.stage, 120), mood: mstr(L.mood, 200),
      promisesAdd: marr(L.promises_add, 6, (p) => (mstr(p?.what, 200) ? { who: who(p?.who), what: mstr(p.what, 200), when: mstr(p?.when, 80) } : null)),
      promisesDone: marr(L.promises_done, 10, (x) => mstr(x, 200) || null),
      questionsAdd: marr(L.questions_add, 6, (q) => (mstr(q?.q, 200) ? { who: who(q?.who), q: mstr(q.q, 200) } : null)),
      questionsAnswered: marr(L.questions_answered, 10, (x) => mstr(x, 200) || null),
      datesAdd: marr(L.dates_add, 4, (x) => mstr(x, 120) || null),
      knowsAdd: marr(L.knows_about_me_add, 8, (x) => mstr(x, 200) || null),
      iKnowAdd: marr(L.i_know_add, 8, (x) => mstr(x, 200) || null),
    },
    timelineAdd: marr(raw?.timeline_add, 10, (e) => (mstr(e?.event, 400) ? { when: mstr(e?.when, 80), event: mstr(e.event, 400), open: !!e?.open } : null)),
    timelineClose: marr(raw?.timeline_close, 10, (x) => mstr(x, 400) || null),
    loreAdd: marr(raw?.lore_add, 4, (e) => (mstr(e?.title, 80) && mstr(e?.content, 3000) ? { title: mstr(e.title, 80), keys: marr(e?.keys, 6, (k) => mstr(k, 40) || null), content: mstr(e.content, 3000) } : null)),
    loreEdit: marr(raw?.lore_edit, 4, (e) => (mstr(e?.title, 80) && mstr(e?.after, 3000) ? { title: mstr(e.title, 80), after: mstr(e.after, 3000), reason: mstr(e?.reason, 300) } : null)),
    card: marr(raw?.card, 6, (x) => (CARD_FIELDS.includes(mstr(x?.field, 40)) && mstr(x?.value, 1000) ? { field: mstr(x.field, 40), value: mstr(x.value, 1000), reason: mstr(x?.reason, 300) } : null)),
    conflicts: marr(raw?.conflicts, 6, (x) => (mstr(x?.why, 400) ? { target: mstr(x?.target, 120), why: mstr(x.why, 400) } : null)),
    chapter: mstr(raw?.chapter, 1500),
    artChange: raw?.art_change && (raw.art_change.paper || raw.art_change.stamp)
      ? { paper: !!raw.art_change.paper, stamp: !!raw.art_change.stamp, reason: mstr(raw.art_change.reason, 200), medium: mstr(raw.art_change.medium, 200), motif: mstr(raw.art_change.motif, 200) }
      : null,
  };
}

const dedupePush = (list, items, keyOf, max) => {
  const seen = new Set(list.map(keyOf));
  const out = [...list];
  for (const it of items) { const k = keyOf(it); if (!seen.has(k)) { seen.add(k); out.push(it); } }
  return out.slice(-max);
};

// 요약·장부·사건·시기 요약을 기억에 반영(앱 데이터는 안 건드림)
export function applyMemory(c, org, { letterIds, now = Date.now() }) {
  c = ensureMemory(c);
  const m = c.memory;
  const byId = new Map(c.letters.map((l) => [l.id, l]));
  const ids = new Set(letterIds);
  const sums = [...m.summaries];
  for (const s of org.summaries) {
    const l = byId.get(s.letterId) || null;
    if (!l || !ids.has(l.id)) continue;
    const i = sums.findIndex((x) => x.letterId === l.id);
    const row = { letterId: l.id, from: l.from, when: theirLabel(c, l.from === 'me' ? l.theirArriveAt : l.theirWrittenAt), text: s.text };
    if (i >= 0) sums[i] = row; else sums.push(row);
  }
  const L0 = m.ledger || emptyLedger();
  const O = org.ledger;
  const ledger = {
    calledMe: O.calledMe || L0.calledMe, calledThem: O.calledThem || L0.calledThem, stage: O.stage || L0.stage, mood: O.mood || L0.mood,
    promises: dedupePush(L0.promises.map((p) => (O.promisesDone.includes(p.what) ? { ...p, state: 'done' } : p)), O.promisesAdd.map((p) => ({ ...p, state: 'open', at: now })), (p) => p.what, 30),
    openQuestions: dedupePush(L0.openQuestions.filter((q) => !O.questionsAnswered.includes(q.q)), O.questionsAdd.filter((q) => !O.questionsAnswered.includes(q.q)), (q) => q.q, 20),
    anniversaries: dedupePush(L0.anniversaries, O.datesAdd, (x) => x, 12),
    knowsAboutMe: dedupePush(L0.knowsAboutMe, O.knowsAdd, (x) => x, 40),
    iKnow: dedupePush(L0.iKnow, O.iKnowAdd, (x) => x, 40),
  };
  let timeline = (m.timeline || []).map((e) => (e.open && org.timelineClose.includes(e.event) ? { ...e, open: false } : e));
  timeline = dedupePush(timeline, org.timelineAdd.map((e) => ({ ...e, at: now })), (e) => e.event, 80);
  const chapters = [...(m.chapters || [])];
  if (org.chapter) chapters.push({ text: org.chapter, at: now, upto: sums.length });
  const last = c.letters.filter((l) => ids.has(l.id)).slice(-1)[0];
  return { ...c, memory: { ...m, summaries: sums.slice(-400), ledger, timeline, chapters: chapters.slice(-40), organizedUpTo: last?.id || m.organizedUpTo } };
}

export function chapterDue(c, budgets) {
  c = ensureMemory(c);
  const every = cleanBudgets(budgets).chapterEvery;
  const lastUpto = (c.memory.chapters || []).slice(-1)[0]?.upto || 0;
  return (c.memory.summaries || []).length - lastUpto >= every - 2; // 이번 정리로 every에 닿으면
}

// ── 카드 글 다루기 ──

const fieldRe = (f) => new RegExp(`^([ \\t]*)(${f})=(.*)$`, 'm');
export function readCardField(text, field) {
  const m = (text || '').match(fieldRe(field));
  return m ? m[3] : null;
}
export function setCardField(text, field, value) {
  const t = text || '';
  const re = fieldRe(field);
  if (re.test(t)) return t.replace(re, (_, ind, f) => `${ind}${f}=${value}`);
  const indent = ['look', 'outfit', 'job', 'impression'].includes(field) ? '  ' : '';
  if (indent && /^real:\s*$/m.test(t)) {
    const lines = t.split('\n');
    const i = lines.findIndex((x) => /^real:\s*$/.test(x));
    let j = i + 1;
    while (j < lines.length && /^\s{2,}\S/.test(lines[j])) j++;
    lines.splice(j, 0, `${indent}${field}=${value}`);
    return lines.join('\n');
  }
  return `${t.replace(/\s*$/, '')}\n${field}=${value}`;
}

// ── 변경 제안 → 변경 기록(아직 앱에 쓰지 않음) ──
// 상태: auto 모드면 'apply'(백엔드가 실행 후 applied/failed), approve 모드면 'pending', off면 기록하지 않음, 충돌이면 'conflict'
export function planChanges(c, org, { letterId, now = Date.now(), loreIndex = [], cardText = '' }) {
  c = ensureMemory(c);
  const mode = c.applyMode;
  const locks = new Set(c.locks);
  const changes = [];
  const mk = (x) => ({ id: `ch${now.toString(36)}${changes.length}`, at: now, letterId, ...x });
  const stateFor = (m) => (m === 'auto' ? 'apply' : m === 'approve' ? 'pending' : null);
  const titles = new Map(loreIndex.map((e) => [e.title.replace(/\s/g, ''), e]));
  for (const e of org.loreAdd) {
    if (titles.has(e.title.replace(/\s/g, ''))) continue; // 이미 있는 제목이면 추가하지 않음
    const st = stateFor(mode.loreAdd);
    if (st) changes.push(mk({ target: 'lore', op: 'add', key: e.title, before: '', after: e.content, keys: e.keys, reason: '새 사실', state: st }));
  }
  for (const e of org.loreEdit) {
    const hit = titles.get(e.title.replace(/\s/g, ''));
    if (!hit) continue;
    if (locks.has(hit.title)) { changes.push(mk({ target: 'lore', op: 'edit', key: hit.title, before: hit.content, after: e.after, reason: e.reason, state: 'locked', ref: hit.ref })); continue; }
    const m = hit.original ? mode.origLore : mode.loreEdit;
    const st = stateFor(m);
    if (st) changes.push(mk({ target: 'lore', op: 'edit', key: hit.title, before: hit.content, after: e.after, reason: e.reason, state: st, ref: hit.ref }));
  }
  for (const x of org.card) {
    if (locks.has(x.field)) { changes.push(mk({ target: 'card', op: 'edit', key: x.field, before: readCardField(cardText, x.field) || '', after: x.value, reason: x.reason, state: 'locked' })); continue; }
    const before = readCardField(cardText, x.field);
    if (before === x.value) continue;
    const st = stateFor(before === null ? mode.cardAdd : mode.cardEdit);
    if (st) changes.push(mk({ target: 'card', op: before === null ? 'add' : 'edit', key: x.field, before: before || '', after: x.value, reason: x.reason, state: st }));
  }
  for (const k of org.conflicts) changes.push(mk({ target: 'conflict', op: 'note', key: k.target, before: '', after: '', reason: k.why, state: 'conflict' }));
  return changes;
}

export function addChanges(c, changes) {
  c = ensureMemory(c);
  return { ...c, memory: { ...c.memory, changes: [...c.memory.changes, ...changes].slice(-300) } };
}

export function setChange(c, id, patch) {
  c = ensureMemory(c);
  return { ...c, memory: { ...c.memory, changes: c.memory.changes.map((x) => (x.id === id ? { ...x, ...patch } : x)) } };
}

// 정리 작업 상태(답장 작업과 같은 재시도 규칙)
export function queueOrganize(c, letterIds) {
  c = ensureMemory(c);
  const prev = c.organize && c.organize.state !== 'failed' ? c.organize.forLetterIds : [];
  return { ...c, organize: { state: 'waiting', attempts: 0, nextTryAt: 0, error: '', forLetterIds: [...new Set([...prev, ...letterIds])] } };
}

export function describeTime(hours) { return formatSpan(hours); }

// 이미지(소품 일러스트): 설정 정리, 그림 프롬프트 만들기, 하루 상한. 부수 효과 없음.
// 편지지·우표·봉인은 "그래픽 도안"(정면 평면, 배경·탁자·그림자 없음), 물건은 세밀한 일러스트.
// 사람·얼굴·손·글자는 그리지 않는다. 종류마다 양식(템플릿)과 모델을 설정에서 바꿀 수 있다.

export const ART_KINDS = ['envelope', 'emblem', 'locker', 'paper', 'stamp', 'seal'];
export const ALL_KINDS = ['envelope', 'emblem', 'locker', 'paper', 'stamp', 'seal', 'item'];
export const ART_LABEL = { envelope: '봉투', emblem: '상징물', locker: '추억 상자', paper: '편지지', stamp: '우표', seal: '봉인', item: '물건' };
// 세트: 편지지를 HTML로 꾸미면(기본) 봉투·우표·봉인, 그림이면 편지지·우표·봉인
// 꾸미기 모드: 우표는 쓰지 않는다(봉투·봉인만)
export const setKinds = (art) => (art?.paperMode === 'image' ? ['paper', 'stamp', 'seal'] : ['envelope', 'emblem']);

export const DEFAULT_STYLE = 'hand-painted storybook illustration, delicate ink linework, soft watercolor washes, muted vintage palette, not a photograph';
export const NEGATIVE = 'photo, photograph, photorealistic, realistic, 3d render, table, desk, wooden surface, background scene, perspective, shadow, people, person, face, hands, fingers, human figure, text, letters, writing, words, numbers, digits, watermark, signature, logo';

// {subject} = 글 생성이 써 준 영어 주제, {style} = 전체 룩
export const DEFAULT_TEMPLATES = {
  envelope: 'beautiful illustration of a closed letter as one object, seen straight-on and filling the whole frame: {subject}, its closure (wax seal, cord, clasp or whatever that world uses) and its own postal marks are part of the picture, rich small details, {style}, no readable lettering, no text, no table, no background scene',
  postcard: 'picture postcard illustration of {subject}, a wide landscape view of that world, atmospheric depth, rich environmental detail, thin white postcard border, {style}, no people in focus, no lettering, no text',
  locker: 'storybook illustration of a shallow open tray box with no lid at all (like a bento box), seen from the front and slightly above, the box fills most of the square frame, packed full of {subject}, the contents heaped and peeking above the rim, clean soft outlines, moderate detail (simpler than a painting), soft warm colors, isolated on a plain white background, {style}, no lid, no hinged lid, no people, no faces, no smiley faces, no hearts, no writing, no lettering',
  emblem: 'single small iconic object that represents a person, beautifully crafted and ornate, centered in a soft round vignette, {subject}, jewel-like detail, gentle rim light, plain soft background, {style}, no people, no face, no lettering',
  paper: 'flat 2D stationery design printed on cream paper, straight-on front view filling the entire frame edge to edge, ornamental border and small corner vignettes showing {subject}, large completely blank center area for handwriting, {style}, no table, no background, no shadows, no perspective, no lettering',
  stamp: 'flat 2D postage stamp design, straight-on front view filling the whole frame, white perforated edge, vintage engraved illustration of {subject}, two or three ink colors, printed paper texture, {style}, no denomination, no lettering, no numbers',
  seal: 'flat 2D illustration of a seal impression seen from directly above, {subject}, engraved relief detail, centered on plain cream background, {style}, no lettering',
  item: 'highly detailed illustration of {subject}, intricate textures and small details, fine ink linework with layered watercolor, soft natural light, single object centered on plain warm paper background, {style}, no lettering',
};

export const DEFAULT_ART = {
  connectionId: '', // 비면 앱 기본 이미지 연결
  model: '', // 기본 모델(비면 연결의 모델)
  style: DEFAULT_STYLE,
  size: '1024x1024',
  paperSize: '1024x1024',
  envelopeSize: '1536x1024',
  paperMode: 'html', // 'html'(편지지는 테마로 꾸미고 봉투를 그림) | 'image'(예전처럼 편지지를 그림)
  perDay: 6, // 하루 전체 장수(세트 포함)
  autoItems: 'all', // 'off' | 'all' — 상대가 보낸 물건을 답장이 만들어질 때 그림
  paperChange: 'event', // 편지지 바뀜: 'event'(사건이 있을 때 — 계절 변화 포함) | 'season'(그쪽 계절이 바뀔 때만) | 'off'
  stampChange: 'event', // 우표 바뀜: 같은 값
  sendNegative: false, // 금지어를 negative_prompt로 보낼지(받지 않는 모델이 많음 — 거절되면 빼고 다시 시도)
  negative: NEGATIVE,
  paperStrength: 70, // 편지지 가운데 글씨 칸을 덮는 크림색의 옅기(100=안 덮음)
  paperBorder: 64, // 편지지 테두리 장식 두께(px) — 글씨는 이 안쪽에만
  paperSlice: 20, // 그림 가장자리에서 테두리로 잘라 쓸 비율(%)
  kinds: {}, // { paper: { model, template }, … } 비면 기본
};

const astr = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const asize = (v, d) => (typeof v === 'string' && /^\d{3,4}x\d{3,4}$/.test(v.trim()) ? v.trim() : d);
const anum = (v, lo, hi, d) => { const n = Number(v); return v !== '' && v !== null && v !== undefined && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

export function cleanArt(a) {
  const kinds = {};
  for (const k of ALL_KINDS) {
    const x = a?.kinds?.[k] || {};
    kinds[k] = { model: astr(x.model, 200), template: astr(x.template, 1500) };
  }
  return {
    connectionId: astr(a?.connectionId, 200),
    model: astr(a?.model, 200),
    style: astr(a?.style, 1500) || DEFAULT_STYLE,
    size: asize(a?.size, DEFAULT_ART.size),
    paperSize: asize(a?.paperSize, DEFAULT_ART.paperSize),
    envelopeSize: asize(a?.envelopeSize, DEFAULT_ART.envelopeSize),
    paperMode: a?.paperMode === 'image' ? 'image' : 'html',
    perDay: anum(a?.perDay, 0, 100, DEFAULT_ART.perDay),
    perCorrespondentDay: anum(a?.perCorrespondentDay, 0, 100, 0),
    autoItems: a?.autoItems === 'off' ? 'off' : 'all',
    paperChange: ['event', 'season', 'off'].includes(a?.paperChange) ? a.paperChange : 'event',
    stampChange: ['event', 'season', 'off'].includes(a?.stampChange) ? a.stampChange : 'event',
    sendNegative: !!a?.sendNegative,
    negative: astr(a?.negative, 1500) || NEGATIVE,
    paperStrength: anum(a?.paperStrength, 0, 100, DEFAULT_ART.paperStrength),
    paperBorder: anum(a?.paperBorder, 0, 200, DEFAULT_ART.paperBorder),
    paperSlice: anum(a?.paperSlice, 1, 45, DEFAULT_ART.paperSlice),
    kinds,
    portrait: a?.portrait && typeof a.portrait === 'object' ? a.portrait : {}, // 초상화 설정(portrait.js의 cleanPortrait로 정리)
  };
}

export const templateFor = (art, kind) => art.kinds?.[kind]?.template || DEFAULT_TEMPLATES[kind] || DEFAULT_TEMPLATES.item;
// 종류별 기본 모델(NanoGPT 기준, 싸면서 지금 그림체에 맞는 것). 사용자가 종류·전체 모델을 정하면 그것이 우선
export const DEFAULT_KIND_MODEL = { envelope: 'chroma', locker: 'chroma', emblem: 'seedream-v5.0-lite', item: 'seedream-v5.0-lite', paper: 'recraft/v4.1/flash/v2/text-to-image', stamp: 'recraft/v4.1/flash/v2/text-to-image', seal: 'recraft/v4.1/flash/v2/text-to-image' };
export const modelFor = (art, kind) => art.kinds?.[kind]?.model || art.model || DEFAULT_KIND_MODEL[kind] || '';

// 하루 사용량(서버 날짜 기준 YYYY-MM-DD)
export function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}
export function quotaLeft(usage, art, now = Date.now(), cid = '') {
  const today = usage?.day === dayKey(now);
  const used = today ? usage.count || 0 : 0;
  const all = Math.max(0, art.perDay - used);
  // 상대 한 명이 하루에 쓸 수 있는 장수(0=제한 없음)
  if (!cid || !art.perCorrespondentDay) return all;
  const mine = today ? usage.by?.[cid] || 0 : 0;
  return Math.min(all, Math.max(0, art.perCorrespondentDay - mine));
}
export function useQuota(usage, n, now = Date.now(), cid = '') {
  const day = dayKey(now);
  const today = usage?.day === day;
  const count = (today ? usage.count || 0 : 0) + n;
  const by = { ...(today ? usage.by || {} : {}) };
  if (cid) by[cid] = (by[cid] || 0) + n;
  return { day, count, by };
}

// 글 생성 1회로 그림 "주제"(영어 짧은 구)를 받는다. 구도·화풍은 템플릿이 맡는다.
export function buildArtPromptMessages(c, jobs) {
  const m = c.mail || {};
  const lines = jobs.map((j) => {
    const why = j.reason ? `; this letter's paper/stamp changed because: ${j.reason}` : '';
    if (j.kind === 'envelope') return `- key=${j.key}: ${c.name}'s closed letter as it arrives — material, color, texture, how it is closed and sealed, postal marks and wear (letter medium: ${m.medium || '-'}; texture: ${m.texture || '-'}; seal: ${m.seal || '-'}; stamp: ${m.stampMotif || '-'}${why})`;
    if (j.kind === 'locker') return `- key=${j.key}: the box itself (material, color, small ornaments that fit ${c.name}'s world and taste) and what fills it: folded letters plus a few of these keepsakes they exchanged — ${(c.items || []).filter((x) => x.state !== 'in_transit').slice(-8).map((x) => x.name).join(', ') || 'small charms and pressed flowers'}`;
    if (j.kind === 'emblem') return `- key=${j.key}: one charming object that symbolizes ${c.name} (from their job, world and personality — e.g. a tool, charm or keepsake they always carry); describe its material, shape and ornaments`;
    if (j.kind === 'paper') return `- key=${j.key}: decorative motifs for the border of ${c.name}'s letter paper (their world's flora, tools, symbols; letter medium: ${j.medium || m.medium || '-'}; texture: ${m.texture || '-'}${why})`;
    if (j.kind === 'stamp') return `- key=${j.key}: the emblem shown on a postage stamp of that world (motif: ${j.motif || m.stampMotif || '-'}${why})`;
    if (j.kind === 'seal') return `- key=${j.key}: the design pressed into ${c.name}'s letter seal (seal: ${m.seal || '-'})`;
    return `- key=${j.key}: the object "${j.name}"${j.note ? ` (${j.note})` : ''} — its material, shape, wear and small details`;
  });
  const system = [
    'You write short English subject phrases for illustrations of objects and motifs from a fictional world.',
    'Describe only WHAT is shown: motifs, materials, colors, small details. 10-25 words each.',
    'Do not describe composition, camera, background, style or lighting (added later). Never include people, faces, hands, text, letters or numbers.',
  ].join('\n');
  const user = [
    `Correspondent: ${c.name}. Letter medium: ${m.medium || '-'}; scent: ${m.scent || '-'}.`,
    m.imageKeywords?.length ? `World keywords: ${m.imageKeywords.join(', ')}` : '',
    'Write one subject for each:',
    ...lines,
    'Output JSON only: {"prompts":[{"key":"","prompt":""}]}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function cleanArtPrompts(raw, keys) {
  const list = Array.isArray(raw?.prompts) ? raw.prompts : [];
  const out = {};
  for (const p of list) {
    const k = astr(p?.key, 80);
    const t = astr(p?.prompt, 800);
    if (keys.includes(k) && t) out[k] = t;
  }
  return out;
}

// 템플릿에 주제·화풍을 넣어 최종 프롬프트
export function composePrompt(kind, subject, art) {
  const t = templateFor(art, kind);
  const withSubject = t.includes('{subject}') ? t.replaceAll('{subject}', subject) : `${subject}, ${t}`;
  return withSubject.includes('{style}') ? withSubject.replaceAll('{style}', art.style || DEFAULT_STYLE) : `${withSubject}, ${art.style || DEFAULT_STYLE}`;
}

// 요청 매개변수 시도 순서: 모델이 값을 거절하면(400) 하나씩 빼고 다시.
// 앱의 NanoGPT 연결은 negativePrompt를 보내지 않고, 연결에 저장된 rawRequestOverride가 크기를 덮어쓰므로 요청 덮어쓰기로 보낸다.
export function artParamAttempts(size, art) {
  const out = [];
  if (art.sendNegative) out.push({ size, rawRequestOverride: JSON.stringify({ size, negative_prompt: art.negative }) });
  out.push({ size, rawRequestOverride: JSON.stringify({ size }) });
  out.push({ size: '1024x1024', rawRequestOverride: '{}' });
  return out;
}
export const isParamRejection = (e) => /\(400\)|not support|unsupported|negative|resolution|size/i.test(String(e?.message || e));

// 받은 물건 중 풍경 엽서·그림엽서는 엽서 양식(가로 풍경)으로
export const isPostcard = (name = '', note = '') => /엽서|풍경화|postcard/i.test(`${name} ${note}`);

// 바뀔 그림 고르기. change: 정리 단계가 찾은 모양 변화 {paper, stamp, reason, medium, motif} | null
// seasonChanged: 이번 편지와 직전 상대 편지의 그쪽 달(계절)이 다른지
export function artChangeJobs(art, { change = null, seasonChanged = false, hasSet = {} } = {}) {
  const jobs = [];
  for (const kind of ['paper', 'stamp']) {
    if (!hasSet[kind]) continue; // 기본 세트가 없으면 바꿀 것도 없음(세트는 사람이 시작)
    const mode = kind === 'paper' ? art.paperChange : art.stampChange;
    if (mode === 'off') continue;
    const byEvent = mode === 'event' && change?.[kind];
    const bySeason = (mode === 'season' || mode === 'event') && seasonChanged;
    if (byEvent || bySeason) {
      jobs.push({ kind, reason: byEvent ? (change.reason || '사건') : '그쪽 계절이 바뀜', medium: kind === 'paper' ? change?.medium || '' : '', motif: kind === 'stamp' ? change?.motif || '' : '' });
    }
  }
  return jobs;
}

// 상대 안의 그림 기록(없으면 빈 칸)
export function ensureArt(c) {
  if (c.art && typeof c.art === 'object') return c;
  return { ...c, art: {} };
}

// 캐릭터 초상화(NovelAI V4.5 Full): 카드 → 글 생성이 NAI 태그 프롬프트를 쓰고, 사용자 화풍 프롬프트와 합친다. 부수 효과 없음.
// 작성 규칙은 사용자 지침 D:\소스\캐릭터챗\11_더스트블러드\NovelAI_Prompt_Guide_v3.md 의 V4.5F 부분을 줄인 것.

// 사용자가 준 기본 화풍·품질 프롬프트(인원 태그 1man, solo는 캐릭터 쪽이 정하므로 뺐다)
export const NAI_BASE = [
  '2.0:: thick_lineart, sharp_focus ::,',
  '1.5::detailed eyes, beautiful eyes, perfect eyes::, 1.2::perfect anatomy, perfect hands::, masterpiece, best quality, very aesthetic, highres, year 2025, year 2024, ultra-detailed,',
  '1.5::artist:ramsrar::,',
  '1.0::artist:muksal::,',
  '0.7::artist:mery (yangmalgage)::,',
  '0.4::artist:soybean_(hisoybean)::, 0.5::artist:qianben shan::, 0.8::artist:nidexintu::, 0.9::artist:mgmg_1012 ::, 0.5::artist:yoggi (stretchmen)::,',
  '0.7::artist:96yottea, artist:nano_(c175311) ::,',
  '1.4::artist:lack, artist:bikkusama::,',
  '1.2::perfect anatomy::,-3::simple illustration::, -1::censored::, -3::flat color ::, -3::monochrome ::, -2::artist collaboration ::, -3::Unfinished Eyes::, scenely, -2::lips::, depth of field, bokeh,',
].join('\n');

export const NAI_NEGATIVE = [
  'text, logo, signature, watermark, too many watermarks,',
  '0.4::artist:nameo (judgemasterkou), artist:matsunaga kouyou::, artist collaboration,',
  'chibi, 1990s (style), anatomical structure error,',
  'bad anatomy, distorted anatomy, disfigured, bad hands, missing finger, extra digits, mutation, extra arms, extra legs, long neck, bad feet, very displeasing, undetailed eyes, asymmetrical face, fused eyes, bad eyes, disfigured eyes, mutated eyes,',
  'multiple views, negative space, blank page,',
  'variant set, large variant set, 4koma, 2koma, oekaki,',
  'halftone, screentone, artistic error, film grain, scan artifacts, jpeg artifacts, chromatic aberration, dithering, disorganized colors,',
  'lowres, worst quality, bad quality, cheesy, sloppiness, unfinished, Incomplete, Realistic Art Style, 3::multiple views::, 5::Unfinished Eyes::, 6::artist name::,',
].join('\n');

export const DEFAULT_PORTRAIT = {
  connectionId: '', // NovelAI 이미지 연결(필수)
  model: 'nai-diffusion-4-5-full',
  base: NAI_BASE,
  negative: NAI_NEGATIVE,
  size: '832x1216',
  avatar: true, // 매칭으로 만든 캐릭터의 아바타로 쓰기
  avatarExisting: false, // 원래 있던 캐릭터(기존 캐릭터로 시작)도 아바타를 바꿀지
  refreshEvery: 8, // 상대 편지 이만큼마다 초상화를 지금 모습으로 새로 그림(0=안 함)
  pictureItems: true, // 상대가 보낸 사진·그림류 동봉은 NovelAI로
};

const pstr = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
export function cleanPortrait(p) {
  return {
    connectionId: pstr(p?.connectionId, 200),
    model: pstr(p?.model, 200) || DEFAULT_PORTRAIT.model,
    base: pstr(p?.base, 4000) || NAI_BASE,
    negative: pstr(p?.negative, 4000) || NAI_NEGATIVE,
    size: typeof p?.size === 'string' && /^\d{3,4}x\d{3,4}$/.test(p.size.trim()) ? p.size.trim() : DEFAULT_PORTRAIT.size,
    avatar: p?.avatar !== false,
    avatarExisting: !!p?.avatarExisting,
    refreshEvery: Number.isFinite(Number(p?.refreshEvery)) && p?.refreshEvery !== '' && p?.refreshEvery !== null && p?.refreshEvery !== undefined ? Math.min(100, Math.max(0, Math.round(Number(p.refreshEvery)))) : 8,
    pictureItems: p?.pictureItems !== false,
  };
}

const NAI_GUIDE = `
<nai_v45f_rules>
Target: NovelAI Diffusion V4.5 Full. English only (the tokenizer ignores Korean/Japanese/emoji). Lowercase known Danbooru-style tags, comma separated; short English phrases only where no tag exists. Never invent fake compound tags.
Prompts are blueprints, not impressions: state what, where, which direction, length, shape, material, pattern, motif. Convert moods into visible attributes. Never write "looks like", "mysterious", "elegant aura" etc.
Allowed fixed evaluative phrases (closed list): elegant jawline, refined nose, refined nose bridge, graceful eyebrows, large delicate eyes, gentle droopy eyes.
No synonyms repeated (not "black hair, jet black hair"). Precision = number of independent attributes, not repetition.
Weights sparingly (at most 3 in total), format 1.2::tag:: and always close with ::. Negative weights only for targeted removal.

character (fixed appearance only — no emotion, action, background, time, lighting, scene props), in this order:
1. subject: 1boy / 1girl / 1other, solo. Non-human: add known species tags (e.g. animal ears, tail, horns, pointy ears, scales, monster girl, monster boy, robot joints, ghost, slime girl, plant girl, furry male/female); if barely humanoid, describe the body structure with short phrases.
2. age impression: adults only. Male 25+: 2::mature male::, 1::aged up::. Female: mature female when needed. Never add childlike traits. bishounen only if the card says beautiful male.
3. build: tags first (skinny / slim / toned / muscular / curvy / plump / tall / petite / broad shoulders / narrow waist); never both sides of a conflict.
4. skin: color, brightness, surface, marks (e.g. pale skin, smooth skin, freckles, scar on cheek).
5. face line: one base phrase with 1.2:: (balanced facial proportions / sophisticated facial features / aristocratic facial features / delicate facial features / strong masculine facial structure / sculpted facial features / soft facial features) + 3~5 part phrases that distinguish this person (elongated face / soft oval face / soft rounded face / defined jawline / sharp jawline / broad chin / small chin / prominent cheekbones / straight nose / small nose / tsurime / tareme / jitome / half-closed eyes / narrow sharp eyes / almond eyes / deep-set eyes / downturned outer corners / thick eyebrows / straight eyebrows / thin lips / mole under eye). tsurime and tareme never together. No smile here.
6. hair — fill all slots: color (exactly one tag), length, texture (straight/wavy/curly/messy/spiked hair), bangs (e.g. blunt bangs, swept bangs, center-parted bangs, no bangs = hair pulled back / forehead), sidelocks, back/tie (ponytail, braid, bun…), top/ornament (ahoge, hair ornament…). Use the plainest value if the card is silent.
7. eyes: color tag + irises/pupils (e.g. clear glossy irises, slit pupils), heterochromia only if stated.
8. clothing: type → material → color → structure → length → trim → pattern → decoration, plus fit (tailored fitted silhouette / loose draped silhouette / structured stiff silhouette …). Base it on their job and world. Not one vague word like "fantasy outfit".
9. accessories that identify them: type, position, material, color, motif.
Keep character under ~180 tokens.

scene (one portrait, base prompt part): framing (upper body or cowboy shot), a simple pose that fits them (e.g. holding a letter, sitting at a desk with a pen), a calm expression tag that suits their temperament, 3~6 background tags of their world, 1~2 lighting tags. Under ~70 tokens.
character_uc: only opposite drifts to block (e.g. mature adult → youthful facial features, baby face; man drawn feminine → feminine face; slim → muscular, abs). Often empty. Never a generic quality list.
</nai_v45f_rules>`;

export function buildPortraitMessages(c, { cardText = '', world = '', recent = '' } = {}) {
  const system = [
    'You write NovelAI image prompts from character sheets. Follow the rules exactly and keep every fact the sheet gives (hair, eyes, build, clothing, species, scars). Do not add designs the sheet contradicts; fill silent slots with plain values.',
    NAI_GUIDE,
  ].join('\n');
  const user = [
    `<character_sheet name="${c.name}">`,
    cardText || c.brief || '',
    '</character_sheet>',
    world ? `<world>\n${world.slice(0, 1500)}\n</world>` : '',
    c.mail?.imageKeywords?.length ? `world_visual_keywords=${c.mail.imageKeywords.join(', ')}` : '',
    recent ? `<lately>\n${recent.slice(0, 800)}\n</lately>\nShow them as they are lately (scene, season, visible changes such as injuries or new clothes), still one calm portrait.` : '',
    'The sheet is in Korean; translate attributes into English tags.',
    'Output JSON only: {"character":"","scene":"","character_uc":""}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// 한글·이모지는 빼고(인식 못 함), 줄바꿈은 쉼표 띄어쓰기로
const naiClean = (v, max) => pstr(typeof v === 'string' ? v : '', max)
  .replace(/[\u3131-\uD79D\u3040-\u30FF\u4E00-\u9FFF]+/g, '')
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/\s*\n+\s*/g, ' ')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\s+,/g, ',')
  .replace(/,\s*,+/g, ',')
  .trim();

export function cleanPortraitPrompt(raw) {
  const character = naiClean(raw?.character, 1500);
  if (!character) throw new Error('초상화 캐릭터 프롬프트가 비어 있습니다.');
  return { character, scene: naiClean(raw?.scene, 800), characterUc: naiClean(raw?.character_uc, 400) };
}

// 최종 요청: 기본(화풍·품질) + 장면 = base prompt, 캐릭터는 character prompt 칸, 금지어 + 캐릭터 UC
export function composePortrait(P, pp) {
  const flat = (t) => String(t || '').replace(/\s*\n+\s*/g, ' ').trim();
  const base = flat(P.base).replace(/,\s*$/, '');
  return {
    prompt: [base, pp.scene].filter(Boolean).join(', '),
    negative: [flat(P.negative).replace(/,\s*$/, ''), pp.characterUc].filter(Boolean).join(', '),
    characterTags: [{ tags: pp.character }],
  };
}

// ── 장면 그림(사진·그림 동봉): 자연어 → NAI 프롬프트. 등장인물은 상대·나(페르소나) 중 고른 쪽 ──
export function buildSceneMessages({ request = '', them = null, me = null, world = '' } = {}) {
  const system = [
    'You turn a natural-language picture request into a NovelAI image prompt. Keep every visible fact of the people from their sheets; the request decides scene, pose, action, framing, place and mood (as visible attributes).',
    NAI_GUIDE,
    'For a scene: "scene" holds framing, the action and relations, place and lighting tags (under ~90 tokens; for 2 people add one short English sentence about who does what to whom). One entry in "characters" per person shown, each with fixed appearance only (same rules as character). Nobody shown → "characters": [] and the scene describes objects/landscape.',
  ].join('\n');
  const user = [
    them ? `<person id="them" name="${them.name}">\n${String(them.card || '').slice(0, 2500)}\n</person>` : '',
    me ? `<person id="me" name="${me.name || 'the letter writer'}">\n${String(me.card || '').slice(0, 1500) || '(no description: an ordinary adult from present-day Earth; keep appearance plain)'}\n</person>` : '',
    world ? `<world>\n${world.slice(0, 1200)}\n</world>` : '',
    `<request>\n${request}\n</request>`,
    'The request and sheets may be in Korean; output English tags only.',
    'Output JSON only: {"scene":"","characters":[{"who":"them|me","tags":""}],"character_uc":""}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
export function cleanScenePrompt(raw) {
  const chars = (Array.isArray(raw?.characters) ? raw.characters : []).map((x) => ({ who: x?.who === 'me' ? 'me' : 'them', tags: naiClean(x?.tags, 1500) })).filter((x) => x.tags).slice(0, 3);
  const scene = naiClean(raw?.scene, 1000);
  if (!scene && !chars.length) throw new Error('그림 프롬프트가 비어 있습니다.');
  return { scene, characters: chars, characterUc: naiClean(raw?.character_uc, 400) };
}
export function composeScene(P, sp) {
  const flat = (t) => String(t || '').replace(/\s*\n+\s*/g, ' ').trim().replace(/,\s*$/, '');
  return {
    prompt: [flat(P.base), sp.scene].filter(Boolean).join(', '),
    negative: [flat(P.negative), sp.characterUc].filter(Boolean).join(', '),
    characterTags: sp.characters.map((x) => ({ tags: x.tags })),
  };
}
// 상대가 보낸 물건 중 NovelAI로 그릴 것(사람이 담긴 사진·그림)
export const isPictureItem = (name = '', note = '') => /사진|초상|자화상|스케치|그림|화첩|portrait|photo|sketch/i.test(`${name} ${note}`);


// 백엔드: 사용자별 저장소에 상대 파일을 두고, 1분마다 시간을 진행시킨다.
// 저장: userStorage  settings.json / c/<상대 id>.json   공용 storage  users.json(예약 실행이 돌 사용자 목록)
// 설치 범위가 operator여도 사용자마다 따로 동작하도록 모든 호출에 userId를 넘긴다.
const TICK_MS = MINUTE;
const SETTINGS = 'settings.json';
const USERS = 'users.json';
const cPath = (id) => `c/${id}.json`;
const ID_RE = /^c[0-9a-z]{4,40}$/;

export function start(api) {
  const log = (lvl, msg) => api.log?.[lvl]?.(`[우체통] ${msg}`);
  const queues = new Map(); // userId → 쓰기 순서 보장용 Promise
  const busy = new Set(); // `${userId}:${cid}` 생성 중
  const recovered = new Set(); // 이번 실행에서 복구를 마친 사용자
  let users = new Set();
  let stopped = false;

  const serial = (user, fn) => {
    const next = (queues.get(user) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(user, next);
    return next;
  };

  // ── 저장소 ──
  const readJson = async (path, user, fallback) => {
    if (!(await api.userStorage.exists(path, user))) return fallback;
    return api.userStorage.getJson(path, { userId: user, fallback });
  };
  const loadSettings = async (user) => cleanSettings(await readJson(SETTINGS, user, {}));
  const listIds = async (user) => {
    if (!(await api.userStorage.exists('c', user))) return [];
    const files = await api.userStorage.list('c', user);
    return files.map((f) => f.split('/').pop().replace(/\.json$/, '')).filter((id) => ID_RE.test(id));
  };
  const loadC = async (user, id) => {
    if (!ID_RE.test(id)) throw new Error('잘못된 상대 id');
    const c = await readJson(cPath(id), user, null);
    if (!c) throw new Error('상대를 찾지 못했습니다.');
    return c;
  };
  const saveC = (user, c) => api.userStorage.setJson(cPath(c.id), c, { userId: user });
  // 읽고-고치고-쓰기를 사용자 단위로 차례로
  const mutate = (user, id, fn) => serial(user, async () => {
    const c = await loadC(user, id);
    const next = await fn(c);
    await saveC(user, next);
    return next;
  });

  const rememberUser = async (user) => {
    if (users.has(user)) return;
    users.add(user);
    try { await api.storage.setJson(USERS, { users: [...users] }); } catch (e) { log('warn', `사용자 목록 저장 실패: ${e?.message || e}`); }
  };
  const loadUsers = async () => {
    try {
      const raw = (await api.storage.exists(USERS)) ? await api.storage.getJson(USERS, { fallback: { users: [] } }) : { users: [] };
      users = new Set((raw.users || []).filter((x) => typeof x === 'string' && x));
    } catch (e) { log('warn', `사용자 목록 읽기 실패: ${e?.message || e}`); }
  };

  const notify = (user, extra = {}) => {
    try { api.sendToFrontend({ type: 'changed', ...extra }, user); } catch {}
  };

  // ── 로어북 ──
  // 상대의 로어북(우체통이 만든 것 + 캐릭터에 붙은 것) 항목을 읽어, 상시 항목과 최근 편지에 키워드가 나온 항목만 고른다
  const listEntries = async (user, bookId) => {
    const out = [];
    for (let offset = 0; offset < 1000; offset += 200) {
      const r = await api.world_books.entries.list(bookId, { limit: 200, offset, userId: user });
      out.push(...(r?.data || []));
      if (!r?.data?.length || out.length >= (r.total || 0)) break;
    }
    return out;
  };
  // 상대가 쓰는 로어북 항목 전체: 우체통 로어북(+원본 캐릭터 로어북) + 로컬 항목(로어북 없는 상대)
  const allLore = async (user, c) => {
    const ids = new Set(c.worldBookId ? [c.worldBookId] : []);
    if (c.characterId) {
      try { for (const id of (await api.characters.get(c.characterId, user))?.world_book_ids || []) ids.add(id); } catch {}
    }
    const entries = [];
    for (const id of ids) {
      try { for (const e of await listEntries(user, id)) entries.push({ ...e, _book: id, _original: id !== c.worldBookId }); } catch {}
    }
    for (const e of c.localLore || []) entries.push({ id: e.id, comment: e.title, key: e.keys || [], content: e.content, constant: !!e.constant, _local: true });
    return entries;
  };
  const loreFor = async (user, c, budgetChars = 6000) => {
    const entries = await allLore(user, c);
    if (!entries.length) return { text: '', count: 0, dropped: 0, total: 0 };
    const recent = c.letters.slice(-4).map((l) => `${l.body || ''}\n${l.ps || ''}\n${l.enclosure || ''}`).join('\n');
    return { ...pickLore(entries, recent, budgetChars), total: entries.length };
  };
  const loreIndex = (entries) => entries.filter((e) => !e.disabled).map((e) => ({
    title: e.comment || (e.key || []).join(', '), content: e.content, original: !!e._original,
    ref: e._local ? { local: e.id } : { entryId: e.id, bookId: e._book },
  }));

  // 카드 글: 캐릭터가 있으면 앱 카드, 없으면 c.brief
  const cardOf = async (user, c) => {
    if (c.characterId) {
      const ch = await api.characters.get(c.characterId, user);
      if (ch) return { ch, description: ch.description || '', personality: ch.personality || '', never: ch.post_history_instructions || '' };
    }
    return { ch: null, description: c.brief || '', personality: '', never: '' };
  };
  const cardTextOf = (card) => [card.description, card.personality, card.never ? `never=${card.never}` : ''].filter(Boolean).join('\n');
  const PERSONALITY_FIELDS = ['leak', 'voice', 'speech'];
  // 카드 한 칸 바꾸기(앱 카드와 c.brief를 같이). value가 null이면 그 줄을 지운다(되돌리기용)
  const writeCardField = async (user, c, field, value) => {
    const card = await cardOf(user, c);
    const put = (text) => (value === null ? text.replace(new RegExp(`^[ \\t]*${field}=.*\\n?`, 'm'), '') : setCardField(text, field, value));
    let { description, personality, never } = card;
    if (field === 'never') never = value || '';
    else if (readCardField(description, field) !== null) description = put(description);
    else if (readCardField(personality, field) !== null) personality = put(personality);
    else if (PERSONALITY_FIELDS.includes(field) && card.ch) personality = put(personality);
    else description = put(description);
    if (card.ch) {
      await api.characters.update(card.ch.id, { description, personality, post_history_instructions: never }, user);
      return { ...c, brief: briefFromCard({ description, personality, never }) };
    }
    return { ...c, brief: description };
  };

  // 변경 하나 실행(apply) 또는 되돌리기(revert). 바뀐 상대를 돌려준다.
  const execChange = async (user, c, ch, how = 'apply') => {
    if (ch.target === 'lore' && ch.op === 'add') {
      if (how === 'revert') {
        if (ch.ref?.entryId) await api.world_books.entries.delete(ch.ref.entryId, user);
        if (ch.ref?.local) c = { ...c, localLore: (c.localLore || []).filter((e) => e.id !== ch.ref.local) };
        return { c, patch: { state: 'reverted' } };
      }
      if (c.worldBookId) {
        const e = await api.world_books.entries.create(c.worldBookId, entryInput({ title: ch.key, keys: ch.keys?.length ? ch.keys : [ch.key], content: ch.after, constant: false }, 500), user);
        return { c, patch: { state: 'applied', ref: { entryId: e.id, bookId: c.worldBookId } } };
      }
      const id = `ll${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      return { c: { ...c, localLore: [...(c.localLore || []), { id, title: ch.key, keys: ch.keys?.length ? ch.keys : [ch.key], content: ch.after, constant: false }] }, patch: { state: 'applied', ref: { local: id } } };
    }
    if (ch.target === 'lore' && ch.op === 'edit') {
      const content = how === 'revert' ? ch.before : ch.after;
      if (ch.ref?.entryId) await api.world_books.entries.update(ch.ref.entryId, { content }, user);
      else if (ch.ref?.local) c = { ...c, localLore: (c.localLore || []).map((e) => (e.id === ch.ref.local ? { ...e, content } : e)) };
      else throw new Error('바꿀 로어북 항목을 찾지 못했습니다.');
      return { c, patch: { state: how === 'revert' ? 'reverted' : 'applied' } };
    }
    if (ch.target === 'card') {
      const value = how === 'revert' ? (ch.op === 'add' ? null : ch.before) : ch.after;
      c = await writeCardField(user, c, ch.key, value);
      return { c, patch: { state: how === 'revert' ? 'reverted' : 'applied' } };
    }
    throw new Error('실행할 수 없는 변경입니다.');
  };
  const runChanges = async (user, id, ids) => {
    for (const chId of ids) {
      await mutate(user, id, async (c) => {
        c = ensureMemory(c);
        const ch = c.memory.changes.find((x) => x.id === chId);
        if (!ch || ch.state !== 'apply') return c;
        try {
          const r = await execChange(user, c, ch, 'apply');
          return setChange(r.c, chId, { ...r.patch, doneAt: Date.now() });
        } catch (e) {
          return setChange(c, chId, { state: 'failed', error: String(e?.message || e).slice(0, 300) });
        }
      });
    }
  };

  // ── 그림(소품 일러스트) ──
  const USAGE = 'art-usage.json';
  const WEBP = 'webp-queue.json';
  const drawing = new Set();
  const ART_TIMEOUT_MIN = 8;
  const readUsage = async (user) => readJson(USAGE, user, { day: '', count: 0 });
  const pushWebp = (user, rows) => serial(user, async () => {
    const q = await readJson(WEBP, user, []);
    await api.userStorage.setJson(WEBP, [...q, ...rows].slice(-200), { userId: user });
  });
  // jobs: [{kind:'paper'|'stamp'|'seal'|'item', itemId?}] — 글 1회로 주제를 받고 그림을 차례로. 백그라운드로 돈다.
  const drawArt = async (user, id, jobs, { quiet = false } = {}) => {
    const key = `${user}:${id}:art`;
    if (drawing.has(key)) throw new Error('이 상대의 그림을 이미 그리는 중입니다.');
    const settings = await loadSettings(user);
    const art = cleanArt(settings.art);
    const left = quotaLeft(await readUsage(user), art, Date.now(), id);
    if (left < jobs.length) throw new Error(`오늘 그릴 수 있는 그림이 ${left}장 남았습니다(필요 ${jobs.length}장${art.perCorrespondentDay ? ` · 상대 한 명 하루 ${art.perCorrespondentDay}장` : ''}). 설정에서 상한을 바꿀 수 있습니다.`);
    drawing.add(key);
    const c00 = await loadC(user, id);
    const label = (j) => (j.kind === 'item' ? (c00.items || []).find((x) => x.id === j.itemId)?.name || '물건' : { envelope: '봉투', emblem: '상징물', locker: '추억 상자', paper: '편지지', stamp: '우표', seal: '봉인' }[j.kind]);
    // 대상마다 상태: waiting → drawing → done | failed
    const targets = jobs.map((j) => ({ kind: j.kind, itemId: j.itemId || '', label: label(j), state: 'waiting', error: '' }));
    const setTarget = (i, patch) => mutate(user, id, (c) => {
      const t = (c.artJob?.targets || targets).map((x, k) => (k === i ? { ...x, ...patch } : x));
      return { ...c, artJob: { ...(c.artJob || {}), targets: t, done: t.filter((x) => x.state === 'done').length } };
    });
    await mutate(user, id, (c) => ({ ...ensureArt(c), artJob: { state: 'running', total: jobs.length, done: 0, error: '', at: Date.now(), targets } }));
    notify(user, { id });
    const run = async () => {
      const errors = [];
      let doneCount = 0;
      try {
        const named = jobs.map((j, i) => {
          const it = j.kind === 'item' ? (c00.items || []).find((x) => x.id === j.itemId) : null;
          return { ...j, key: `k${i}`, name: it?.name, note: it?.note }; // j.letterId·reason·medium·motif: 편지 한 통의 새 편지지·우표
        });
        // 1) 그림 주제(글 1회). 한도 초과(429)·서버 오류면 잠시 뒤 한 번 더, 그래도 안 되면 이름·설명으로 대신
        let prompts = {};
        let subjectNote = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const raw = await genJson(user, buildArtPromptMessages(c00, named), { ...settings, createConnectionId: settings.organizeConnectionId || settings.createConnectionId, createTemperature: 0.7 });
            prompts = cleanArtPrompts(raw, named.map((j) => j.key));
            subjectNote = '';
            break;
          } catch (e) {
            subjectNote = String(e?.message || e);
            if (attempt === 0 && /\b(429|5\d\d)\b|exhausted|rate|timeout|응답 없음/i.test(subjectNote)) await new Promise((r) => setTimeout(r, 8000));
            else break;
          }
        }
        const m = c00.mail || {};
        const fallback = (j) => (j.kind === 'item' ? [j.name, j.note].filter(Boolean).join(', ')
          : j.kind === 'paper' || j.kind === 'envelope' ? [m.medium, m.texture, m.seal, ...(m.imageKeywords || [])].filter(Boolean).join(', ')
            : j.kind === 'locker' ? ['folded letters', 'small keepsakes', ...(m.imageKeywords || []).slice(0, 4)].join(', ')
            : j.kind === 'emblem' ? [m.stampMotif, m.seal, ...(m.imageKeywords || []).slice(0, 3)].filter(Boolean).join(', ') || `${c00.name} keepsake`
            : j.kind === 'stamp' ? (m.stampMotif || m.seal || m.medium || `${c00.name} emblem`) : (m.seal || m.stampMotif || `${c00.name} seal`));
        // 2) 그림을 차례로
        for (let i = 0; i < named.length; i++) {
          const j = named[i];
          const subject = prompts[j.key] || fallback(j) || '';
          if (!subject) {
            const msg = `주제를 못 받음${subjectNote ? ` (${subjectNote.slice(0, 120)})` : ''}`;
            errors.push(`${targets[i].label}: ${msg}`);
            await setTarget(i, { state: 'failed', error: msg });
            continue;
          }
          const postcard = j.kind === 'item' && isPostcard(j.name, j.note);
          const prompt = composePrompt(postcard ? 'postcard' : j.kind, subject, art);
          const t0 = Date.now();
          await setTarget(i, { state: 'drawing', startedAt: t0 });
          notify(user, { id });
          log('info', `그림 시작(${c00.name} · ${targets[i].label}) 모델=${modelFor(art, j.kind) || '연결 기본'}`);
          try {
            // 모델이 값을 거절하면(금지어·크기) 하나씩 빼고 다시
            let res;
            let lastErr;
            for (const parameters of artParamAttempts(j.kind === 'paper' ? art.paperSize : j.kind === 'envelope' || postcard ? art.envelopeSize : j.kind === 'locker' ? '1024x1024' : art.size, art)) {
              try {
                // 오래 응답이 없으면 실패로(공급자 쪽에서 늦게라도 만들어질 수 있음 — 그 그림은 쓰지 않음)
                let timer;
                const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${ART_TIMEOUT_MIN}분 동안 응답이 없어 그만뒀어요(이미지 서버가 느림)`)), ART_TIMEOUT_MIN * 60000); });
                try {
                  res = await Promise.race([api.imageGen.generate({
                    prompt, connection_id: art.connectionId || undefined, model: modelFor(art, j.kind) || undefined,
                    parameters, includeDataUrl: false, owner_character_id: c00.characterId || undefined, userId: user,
                  }), timeout]);
                } finally { clearTimeout(timer); }
                break;
              } catch (e) {
                lastErr = e;
                if (!isParamRejection(e)) break;
              }
            }
            if (!res) throw lastErr || new Error('그림을 만들지 못했습니다.');
            if (!res?.imageId) throw new Error('이미지 id가 없습니다.');
            await serial(user, async () => {
              await api.userStorage.setJson(USAGE, useQuota(await readUsage(user), 1, Date.now(), id), { userId: user });
            });
            await mutate(user, id, (c) => {
              c = ensureArt(c);
              const rec = { imageId: res.imageId, prompt, at: Date.now(), subjectFallback: !prompts[j.key] };
              if (j.kind === 'item') return { ...c, items: c.items.map((x) => (x.id === j.itemId ? { ...x, imageId: res.imageId, imagePrompt: prompt } : x)) };
              if (j.letterId) {
                // 바뀌기 전 편지들은 그때 그림을 그대로 갖게 고정
                const prev = c.art?.[j.kind]?.imageId;
                const letters = c.letters.map((l) => {
                  if (l.id === j.letterId) return { ...l, art: { ...(l.art || {}), [j.kind]: res.imageId }, artNote: [l.artNote, `새 ${{ paper: '편지지', envelope: '봉투' }[j.kind] || '우표'} — ${j.reason || ''}`].filter(Boolean).join(' · ') };
                  if (l.from === 'them' && prev && !l.art?.[j.kind]) return { ...l, art: { ...(l.art || {}), [j.kind]: prev } };
                  return l;
                });
                return { ...c, letters, art: { ...c.art, [j.kind]: { ...rec, reason: j.reason || '' } } };
              }
              return { ...c, art: { ...c.art, [j.kind]: rec } };
            });
            await setTarget(i, { state: 'done', error: prompts[j.key] ? '' : '주제 대신 이름·설명으로 그림', doneAt: Date.now() });
            log('info', `그림 완성(${c00.name} · ${targets[i].label}) ${Math.round((Date.now() - t0) / 1000)}초`);
            doneCount++;
            await pushWebp(user, [{ cid: id, imageId: res.imageId, tries: 0 }]);
            notify(user, { id });
          } catch (e) {
            const msg = String(e?.message || e).slice(0, 300);
            errors.push(`${targets[i].label}: ${msg}`);
            await setTarget(i, { state: 'failed', error: msg });
            notify(user, { id });
          }
        }
      } catch (e) {
        errors.push(String(e?.message || e));
      } finally {
        drawing.delete(key);
        await mutate(user, id, (c) => {
          const t = c.artJob?.targets || targets;
          return { ...c, artJob: errors.length ? { state: 'failed', total: jobs.length, done: doneCount, error: errors.join(' / ').slice(0, 500), at: Date.now(), targets: t } : null };
        }).catch(() => {});
        if (errors.length) log('warn', `그림 일부 실패: ${errors.join(' / ')}`);
        try {
          if (errors.length) api.toast?.error?.(`${c00.name}: 그림 ${jobs.length - doneCount}장 실패 — ${errors[0].slice(0, 120)}`, { title: '이세계 우체통', userId: user });
          else api.toast?.success?.(`${c00.name}: 그림 ${doneCount}장 완성`, { title: '이세계 우체통', userId: user });
        } catch {}
        notify(user, { id });
      }
    };
    run();
    return { started: jobs.length, left: left - jobs.length, quiet };
  };
  // 자동 그리기(물건·편지지 바뀜)는 앞의 그리기가 끝날 때까지 기다렸다가(최대 3분) 이어서 그린다
  const drawArtWhenFree = async (user, id, jobs) => {
    const key = `${user}:${id}:art`;
    for (let i = 0; i < 90 && drawing.has(key); i++) await new Promise((r) => setTimeout(r, 2000));
    return drawArt(user, id, jobs);
  };
  // 사람이 누른 그리기: 다른 그리기가 도는 중이면 거절하지 않고 끝난 뒤 이어서(대기열)
  const drawOrQueue = async (user, id, jobs) => {
    if (!drawing.has(`${user}:${id}:art`)) return drawArt(user, id, jobs);
    const settings = await loadSettings(user);
    const left = quotaLeft(await readUsage(user), cleanArt(settings.art), Date.now(), id);
    if (left < jobs.length) throw new Error(`오늘 그릴 수 있는 그림이 ${left}장 남았습니다(필요 ${jobs.length}장).`);
    drawArtWhenFree(user, id, jobs).catch((e) => log('warn', `대기 중이던 그리기 실패: ${e?.message || e}`));
    return { started: jobs.length, queued: true, left: left - jobs.length };
  };
  // 초상화(NovelAI): 글 1회로 태그 프롬프트, 그림 1장. 백그라운드로 돈다.
  // NovelAI 그림 1장(시간 제한·상한 사용). 반환: imageId
  const naiImage = async (user, c, req, P) => {
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${ART_TIMEOUT_MIN}분 동안 응답이 없어 그만뒀어요`)), ART_TIMEOUT_MIN * 60000); });
    let res;
    try {
      res = await Promise.race([api.imageGen.generate({
        prompt: req.prompt, connection_id: P.connectionId, model: P.model || undefined,
        parameters: { negativePrompt: req.negative, resolution: P.size, characterTags: req.characterTags },
        includeDataUrl: false, owner_character_id: c.characterId || undefined, userId: user,
      }), timeout]);
    } finally { clearTimeout(timer); }
    if (!res?.imageId) throw new Error('이미지 id가 없습니다.');
    await api.userStorage.setJson(USAGE, useQuota(await readUsage(user), 1, Date.now(), c.id), { userId: user });
    return res.imageId;
  };
  const personaCard = async (user, c) => {
    if (c.noPersona) return { name: '', card: '' };
    try {
      const p = c.personaId ? await api.personas.get(c.personaId, user) : await api.personas.getActive(user);
      return { name: p?.name || '', card: [p?.description, p?.personality, p?.appearance].filter((x) => typeof x === 'string' && x).join('\n') };
    } catch { return { name: '', card: '' }; }
  };
  const worldOf = async (user, c) => (await allLore(user, c).catch(() => [])).filter((e) => /세계 개요|overview/i.test(e.comment || '')).map((e) => e.content).join('\n') || c.world || '';
  // 장면 그림: 자연어 → 지침 → NovelAI. 사람이 기다리는 요청(10~60초)
  const drawScene = async (user, id, { request = '', includeThem = true, includeMe = false } = {}) => {
    const settings = await loadSettings(user);
    const art = cleanArt(settings.art);
    const P = cleanPortrait(art.portrait);
    if (!P.connectionId) throw new Error('설정 → 초상화에서 NovelAI 이미지 연결을 먼저 골라 주세요.');
    if (!String(request).trim()) throw new Error('어떤 그림인지 적어 주세요.');
    const c = await loadC(user, id);
    if (quotaLeft(await readUsage(user), art, Date.now(), c.id) < 1) throw new Error('오늘 그릴 수 있는 그림을 다 썼습니다.');
    const them = includeThem ? { name: c.name, card: cardTextOf(await cardOf(user, c)) } : null;
    const me = includeMe ? await personaCard(user, c) : null;
    const raw = await genJson(user, buildSceneMessages({ request: String(request).slice(0, 1500), them, me, world: await worldOf(user, c) }), { ...settings, createTemperature: 0.6 });
    const sp = cleanScenePrompt(raw);
    const imageId = await naiImage(user, c, composeScene(P, sp), P);
    log('info', `장면 그림(${c.name}): ${String(request).slice(0, 40)}`);
    return { imageId, prompt: sp };
  };
  // 상대가 보낸 사진·그림 동봉: NovelAI로(상대가 담긴 그림)
  const drawPictureItem = async (user, id, itemId) => {
    const c = await loadC(user, id);
    const it = (c.items || []).find((x) => x.id === itemId);
    if (!it || it.imageId) return;
    const l = c.letters.find((x) => x.id === it.letterId);
    const r = await drawScene(user, id, { request: `${it.name}${it.note ? ` — ${it.note}` : ''}${l?.body ? `\n(편지 내용 일부: ${l.body.slice(0, 400)})` : ''}`, includeThem: true });
    await mutate(user, id, (x) => ({ ...x, items: x.items.map((y) => (y.id === itemId ? { ...y, imageId: r.imageId, imagePrompt: r.prompt.scene, nai: true } : y)) }));
    notify(user, { id });
  };
  const drawPortrait = async (user, id, { recent = '' } = {}) => {
    const key = `${user}:${id}:portrait`;
    if (drawing.has(key)) throw new Error('초상화를 이미 그리는 중입니다.');
    const settings = await loadSettings(user);
    const art = cleanArt(settings.art);
    const P = cleanPortrait(art.portrait);
    if (!P.connectionId) throw new Error('설정 → 초상화에서 NovelAI 이미지 연결을 먼저 골라 주세요.');
    if (quotaLeft(await readUsage(user), art, Date.now(), id) < 1) throw new Error('오늘 그릴 수 있는 그림을 다 썼습니다(상대별 상한 포함). 설정에서 하루 상한을 바꿀 수 있습니다.');
    drawing.add(key);
    const t0 = Date.now();
    await mutate(user, id, (c) => ({ ...c, portraitJob: { state: 'drawing', startedAt: t0, error: '' } }));
    notify(user, { id });
    (async () => {
      const c = await loadC(user, id);
      try {
        const card = await cardOf(user, c);
        const world = (await allLore(user, c).catch(() => [])).filter((e) => /세계 개요|overview/i.test(e.comment || '')).map((e) => e.content).join('\n');
        const raw = await genJson(user, buildPortraitMessages(c, { cardText: cardTextOf(card), world: world || c.world, recent }), { ...settings, createTemperature: 0.6, createConnectionId: settings.createConnectionId });
        const pp = cleanPortraitPrompt(raw);
        const req = composePortrait(P, pp);
        log('info', `초상화 시작(${c.name}) 모델=${P.model}`);
        let timer;
        const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${ART_TIMEOUT_MIN}분 동안 응답이 없어 그만뒀어요`)), ART_TIMEOUT_MIN * 60000); });
        let res;
        try {
          res = await Promise.race([api.imageGen.generate({
            prompt: req.prompt, connection_id: P.connectionId, model: P.model || undefined,
            parameters: { negativePrompt: req.negative, resolution: P.size, characterTags: req.characterTags },
            includeDataUrl: false, owner_character_id: c.characterId || undefined, userId: user,
          }), timeout]);
        } finally { clearTimeout(timer); }
        if (!res?.imageId) throw new Error('이미지 id가 없습니다.');
        await api.userStorage.setJson(USAGE, useQuota(await readUsage(user), 1, Date.now(), id), { userId: user });
        let old = '';
        await mutate(user, id, (x) => {
          x = ensureArt(x);
          old = x.art?.portrait?.imageId || '';
          const history = [...(x.art?.portraitHistory || []), ...(old ? [{ imageId: old, at: x.art.portrait.at || 0 }] : [])].slice(-30);
          old = '';
          return { ...x, portraitJob: null, art: { ...x.art, portraitHistory: history, portrait: { imageId: res.imageId, prompt: req.prompt, character: pp.character, negative: req.negative, at: Date.now(), atLetters: x.letters.filter((q) => q.from === 'them').length } } };
        });
        if (old) { try { await api.images.delete(old, user); } catch {} }
        await pushWebp(user, [{ cid: id, imageId: res.imageId, tries: 0, kind: 'portrait' }]);
        log('info', `초상화 완성(${c.name}) ${Math.round((Date.now() - t0) / 1000)}초`);
        api.toast?.success?.(`${c.name}: 초상화 완성`, { title: '이세계 우체통', userId: user });
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 300);
        log('warn', `초상화 실패(${c.name}): ${msg}`);
        await mutate(user, id, (x) => ({ ...x, portraitJob: { state: 'failed', startedAt: t0, error: msg } })).catch(() => {});
        api.toast?.error?.(`${c.name}: 초상화 실패 — ${msg.slice(0, 120)}`, { title: '이세계 우체통', userId: user });
      } finally {
        drawing.delete(key);
        notify(user, { id });
      }
    })();
    return { started: true };
  };
  // 프런트가 WebP로 바꿔 보낸 바이트로 바꿔 끼우고 원본(png)을 지운다
  const webpDone = async (user, p) => {
    const q = await readJson(WEBP, user, []);
    const row = q.find((x) => x.imageId === p.imageId);
    if (!row) return { skipped: true };
    const bytes = Uint8Array.from(Buffer.from(String(p.data || ''), 'base64'));
    if (bytes.length < 100 || bytes.length > 8 * 1024 * 1024) throw new Error('WebP 크기가 이상합니다.');
    const c0 = await loadC(user, row.cid).catch(() => null);
    const up = await api.images.upload({ data: bytes, filename: `isekai-${p.imageId}.webp`, mime_type: 'image/webp', owner_character_id: c0?.characterId || undefined }, user);
    if (c0) {
      await mutate(user, row.cid, (c) => {
        c = ensureArt(c);
        const art = Object.fromEntries(Object.entries(c.art).map(([k, v]) => [k, Array.isArray(v) ? v.map((h) => (h?.imageId === p.imageId ? { ...h, imageId: up.id } : h)) : v?.imageId === p.imageId ? { ...v, imageId: up.id, webp: true } : v]));
        const items = (c.items || []).map((x) => (x.imageId === p.imageId ? { ...x, imageId: up.id } : x));
        const letters = (c.letters || []).map((l) => (l.art && Object.values(l.art).includes(p.imageId)
          ? { ...l, art: Object.fromEntries(Object.entries(l.art).map(([k, v]) => [k, v === p.imageId ? up.id : v])) } : l));
        return { ...c, art, items, letters };
      });
    }
    if (c0 && row.kind === 'portrait' && c0.characterId && api.characters?.setAvatar) {
      const P = cleanPortrait(cleanArt((await loadSettings(user)).art).portrait);
      if (P.avatar && (c0.origin !== 'existing' || P.avatarExisting)) {
        try { await api.characters.setAvatar(c0.characterId, { data: bytes, mime_type: 'image/webp', filename: `${c0.name}.webp` }, user); log('info', `아바타 바꿈(${c0.name})`); } catch (e) { log('warn', `아바타 바꾸기 실패: ${e?.message || e}`); }
      }
    }
    try { await api.images.delete(p.imageId, user); } catch {}
    await serial(user, async () => {
      const cur = await readJson(WEBP, user, []);
      await api.userStorage.setJson(WEBP, cur.filter((x) => x.imageId !== p.imageId), { userId: user });
    });
    if (c0) notify(user, { id: row.cid });
    return { id: up.id, before: Number(p.originalBytes) || 0, after: bytes.length };
  };

  // 편지지·우표 바뀜: 정리 단계가 찾은 사건(event) 또는 그쪽 계절 바뀜(season)
  // 편지지 테마(글 1회). letterId가 있으면 그 편지부터 새 테마, 그 전 편지들은 예전 테마로 고정
  const makeTheme = async (user, id, { reason = '', letterId = '' } = {}) => {
    const settings = await loadSettings(user);
    const c0 = await loadC(user, id);
    const prev = c0.paperTheme ? cleanTheme(c0.paperTheme) : null;
    const raw = await genJson(user, buildThemeMessages(c0, { reason, prev }), { ...settings, createConnectionId: settings.organizeConnectionId || settings.createConnectionId, createTemperature: reason ? 0.6 : 0.9 });
    const t = cleanTheme(raw, prev || defaultTheme(c0));
    const before = prev || defaultTheme(c0);
    const c = await mutate(user, id, (c) => {
      const letters = c.letters.map((l) => {
        if (letterId && l.id === letterId) return { ...l, theme: t, artNote: [l.artNote, `새 편지지 — ${reason}`].filter(Boolean).join(' · ') };
        if (letterId && l.from === 'them' && !l.theme) return { ...l, theme: before };
        return l;
      });
      return { ...c, letters, paperTheme: t };
    });
    log('info', `편지지 테마(${c.name})${reason ? ` 바뀜: ${reason}` : ''} → ${t.font}/${t.motif}/${t.texture}`);
    notify(user, { id });
    return t;
  };
  const maybeChangeArt = async (user, id, letterId, change) => {
    const settings = await loadSettings(user);
    const art = cleanArt(settings.art);
    if (art.paperChange === 'off' && art.stampChange === 'off') return;
    const c = await loadC(user, id);
    const l = c.letters.find((x) => x.id === letterId);
    if (!l || l.from !== 'them' || l.art?.paper || l.art?.stamp || l.theme) return; // 상대 편지에만, 한 번만
    let seasonChanged = false;
    if (c.calendar?.months?.length) {
      const prevTheirs = [...c.letters].filter((x) => x.from === 'them' && x.id !== l.id && x.theirWrittenAt <= l.theirWrittenAt).pop();
      if (prevTheirs) seasonChanged = calendarDate(c.calendar, prevTheirs.theirWrittenAt).month !== calendarDate(c.calendar, l.theirWrittenAt).month;
    }
    const html = art.paperMode !== 'image';
    let jobs = artChangeJobs(art, { change, seasonChanged, hasSet: { paper: html || !!c.art?.paper?.imageId, stamp: html ? !!c.art?.envelope?.imageId : !!c.art?.stamp?.imageId } });
    if (!jobs.length) return;
    log('info', `편지지·우표 바뀜(${c.name}): ${jobs.map((j) => `${j.kind}=${j.reason}`).join(', ')}`);
    if (html) {
      const pj = jobs.find((j) => j.kind === 'paper');
      if (pj) await makeTheme(user, id, { reason: [pj.reason, pj.medium].filter(Boolean).join(' — '), letterId }).catch((e) => log('warn', `편지지 테마 바꾸기 실패: ${e?.message || e}`));
      jobs = jobs.filter((j) => j.kind !== 'paper').map((j) => (j.kind === 'stamp' ? { ...j, kind: 'envelope' } : j));
    }
    if (jobs.length && api.imageGen?.generate) await drawArtWhenFree(user, id, jobs.map((j) => ({ ...j, letterId })));
  };

  // ── 정리 단계 ──
  const organizing = new Set();
  const runOrganize = async (user, id) => {
    const key = `${user}:${id}:org`;
    if (organizing.has(key)) return;
    organizing.add(key);
    try {
      let c = await mutate(user, id, (c) => {
        c = ensureMemory(c);
        return c.organize?.state === 'waiting' ? { ...c, organize: { ...c.organize, state: 'generating' } } : c;
      });
      if (c.organize?.state !== 'generating') return;
      const settings = await loadSettings(user);
      const letterIds = c.organize.forLetterIds.filter((lid) => c.letters.some((l) => l.id === lid && !(l.from === 'them' && l.state === 'in_transit' && !l.body)));
      let org;
      let idx;
      let card;
      try {
        const personaName = await personaNameFor(user, c);
        idx = loreIndex(await allLore(user, c));
        card = await cardOf(user, c);
        const due = chapterDue(c, settings.budgets);
        const messages = buildOrganizeMessages(c, { letterIds, personaName, loreTitles: idx.map((e) => e.title), cardText: cardTextOf(card), chapterDue: due });
        const req = { messages, parameters: { temperature: settings.organizeTemperature, max_tokens: 6000 }, userId: user };
        const conn = settings.organizeConnectionId || settings.replyConnectionId;
        const res = await callLLM(user, req, conn, settings, `정리(${c.name})`);
        org = cleanOrganize(parseJsonLoose(res?.content));
      } catch (e) {
        log('warn', `정리 실패(${c.name}): ${e?.message || e}`);
        await mutate(user, id, (cur) => {
          if (cur.organize?.state !== 'generating') return cur;
          const attempts = (cur.organize.attempts || 0) + 1;
          const wait = [1, 5, 30][attempts - 1];
          return { ...cur, organize: wait === undefined
            ? { ...cur.organize, state: 'failed', attempts, error: String(e?.message || e).slice(0, 300) }
            : { ...cur.organize, state: 'waiting', attempts, nextTryAt: Date.now() + wait * MINUTE, error: String(e?.message || e).slice(0, 300) } };
        });
        notify(user, { id });
        return;
      }
      const lastLetter = letterIds[letterIds.length - 1] || '';
      let applyIds = [];
      await mutate(user, id, (cur) => {
        cur = ensureMemory(cur);
        if (cur.organize?.state !== 'generating') return cur;
        let next = applyMemory(cur, org, { letterIds, now: Date.now() });
        const changes = planChanges(next, org, { letterId: lastLetter, now: Date.now(), loreIndex: idx, cardText: cardTextOf(card) });
        applyIds = changes.filter((x) => x.state === 'apply').map((x) => x.id);
        next = addChanges(next, changes);
        const rest = (cur.organize.forLetterIds || []).filter((x) => !letterIds.includes(x));
        return { ...next, organize: rest.length ? { ...cur.organize, state: 'waiting', forLetterIds: rest, attempts: 0 } : null };
      });
      await runChanges(user, id, applyIds);
      await maybeChangeArt(user, id, lastLetter, org.artChange).catch((e) => log('info', `편지지·우표 바뀜 건너뜀: ${e?.message || e}`));
      log('info', `정리 완료(${c.name}): 변경 ${applyIds.length}건 자동 적용`);
      notify(user, { id });
    } finally {
      organizing.delete(key);
    }
  };

  // ── 글 생성 공용 호출 ──
  // Vertex 등이 한도(429)·서버 오류면 8초·20초 뒤 다시, 그래도 안 되면 같은 모델 이름의 NanoGPT 연결로 넘긴다(설정에서 끌 수 있음)
  const isLimitError = (e) => /\b(429|5\d\d)\b|exhausted|rate.?limit|overloaded|unavailable|quota/i.test(String(e?.message || e));
  const connCache = new Map(); // user → { at, list }
  const connList = async (user) => {
    const hit = connCache.get(user);
    if (hit && Date.now() - hit.at < 10 * 60000) return hit.list;
    let list = [];
    try { list = (await api.connections.list(user)) || []; } catch {}
    connCache.set(user, { at: Date.now(), list });
    return list;
  };
  const baseModel = (m) => String(m || '').toLowerCase().replace(/^.*\//, '').trim();
  const fallbackFor = async (user, connId, settings) => {
    if (settings?.fallbackMode === 'off') return null;
    const list = await connList(user);
    if (settings?.fallbackConnectionId) return list.find((x) => x.id === settings.fallbackConnectionId) || null;
    const primary = connId ? list.find((x) => x.id === connId) : list.find((x) => x.is_default);
    if (!primary || primary.provider === 'nanogpt' || !primary.model) return null;
    return list.find((x) => x.id !== primary.id && x.provider === 'nanogpt' && baseModel(x.model) === baseModel(primary.model)) || null;
  };
  const callLLM = async (user, req, connId, settings, what = '글 생성') => {
    // raw 생성은 연결의 모델을 스스로 채우지 않으므로(공급자에 따라 「model 없음」으로 거절) 연결 목록의 모델을 함께 보낸다
    const send = async (id, r) => {
      if (!id) return api.generate.quiet(r);
      const cn = (await connList(user)).find((x) => x.id === id);
      return api.generate.raw({ ...r, connection_id: id, ...(cn?.model && !r.model ? { model: cn.model } : {}) });
    };
    let lastErr;
    for (const wait of (globalThis.__IM_FAST_RETRY ? [0, 1, 1] : [0, 8000, 20000])) {
      if (wait) {
        log('info', `${what}: 한도·서버 오류, ${wait / 1000}초 뒤 다시 (${String(lastErr?.message || lastErr).slice(0, 60)})`);
        await new Promise((r) => setTimeout(r, wait));
      }
      try { return await send(connId, req); } catch (e) {
        lastErr = e;
        if (!isLimitError(e)) throw e;
      }
    }
    const fb = await fallbackFor(user, connId, settings);
    if (!fb) throw lastErr;
    log('info', `${what}: 원래 연결이 계속 막혀 「${fb.name}」(${fb.model})로 보냄`);
    const { responseMimeType, responseSchema, responseJsonSchema, ...params } = req.parameters || {};
    return send(fb.id, { ...req, parameters: params });
  };

  // ── 상대 만들기(매칭) ──
  // JSON 응답: 구글 계열은 JSON 전용 출력을 켠다(다른 공급자는 무시). 깨지면 한 번 더(온도 낮춰) 시도.
  let jsonModeOk = true;
  const genJson = async (user, messages, settings) => {
    const conn = settings.createConnectionId || settings.replyConnectionId;
    const once = async (temperature) => {
      const parameters = { temperature, max_tokens: Math.max(settings.maxTokens, 20000), ...(jsonModeOk ? { responseMimeType: 'application/json' } : {}) };
      const req = { messages, parameters, userId: user };
      try {
        return await callLLM(user, req, conn, settings, '글 생성');
      } catch (e) {
        if (!jsonModeOk || !/responseMimeType|unknown|unrecognized|invalid/i.test(String(e?.message || e))) throw e;
        jsonModeOk = false;
        log('info', 'JSON 전용 출력을 받지 않는 연결이라 끄고 다시 보냄');
        return once(temperature);
      }
    };
    const onceRetry = (temperature) => once(temperature); // 재시도·대체 연결은 callLLM이 맡음
    let res = await onceRetry(settings.createTemperature);
    try { return parseJsonLoose(res?.content); } catch (e) {
      const c0 = String(res?.content || '');
      log('warn', `JSON 깨짐(${e.message}) 길이=${c0.length} 끝=${res?.finish_reason || '?'} 꼬리=${c0.slice(-160).replace(/\s+/g, ' ')}`);
      const cut = res?.finish_reason === 'length' || res?.finish_reason === 'max_tokens' || res?.finish_reason === 'MAX_TOKENS';
      res = await onceRetry(Math.min(0.7, Number(settings.createTemperature) || 0.7));
      try { return parseJsonLoose(res?.content); } catch (e2) {
        const c1 = String(res?.content || '');
        log('warn', `JSON 다시 깨짐(${e2.message}) 길이=${c1.length} 끝=${res?.finish_reason || '?'}`);
        throw new Error(`모델이 형식에 맞지 않는 답을 두 번 보냈습니다${cut || res?.finish_reason === 'length' ? '(응답이 길이 제한에서 잘림 — 설정의 최대 토큰을 늘려 주세요)' : ''}. 다시 눌러 주세요. (${e2.message})`);
      }
    }
  };
  const existingInfo = async (user, characterId) => {
    const ch = await api.characters.get(characterId, user);
    if (!ch) throw new Error('고른 캐릭터를 찾지 못했습니다.');
    const card = [ch.description, ch.personality, ch.scenario].filter(Boolean).join('\n\n').slice(0, 8000);
    const lines = [];
    for (const id of ch.world_book_ids || []) {
      try {
        for (const e of await listEntries(user, id)) if (!e.disabled && e.content) lines.push(`[${e.comment || (e.key || []).join(', ')}]\n${e.content}`);
      } catch {}
    }
    return { ch, card, lore: lines.join('\n\n').slice(0, 8000) };
  };
  const matchDraft = async (user, p) => {
    const mode = MATCH_MODES.includes(p.mode) ? p.mode : 'prompt';
    if (mode === 'prompt' && !String(p.request || '').trim()) throw new Error('어떤 상대를 원하는지 적어 주세요.');
    const settings = await loadSettings(user);
    let personaName = '';
    if (!p.noPersona) try { personaName = p.personaId ? (await api.personas.get(p.personaId, user))?.name || '' : (await api.personas.getActive(user))?.name || ''; } catch {}
    let existing = null;
    if (mode === 'existing') {
      if (!p.characterId) throw new Error('캐릭터를 골라 주세요.');
      existing = await existingInfo(user, p.characterId);
    }
    const roll = mode === 'random' ? rollMatch(Math.random, { setting: p.dice }) : null;
    const dice = roll ? roll.setting : '';
    // 이미 편지하는 상대(이름·직업·세계)는 겹치지 않게
    const used = [];
    if (mode !== 'existing') {
      for (const id of await listIds(user)) {
        try {
          const c = await loadC(user, id);
          const job = (String(c.brief || '').match(/job=([^\n/]+)/) || [])[1]?.trim() || '';
          used.push(`${c.name}${job ? `(${job})` : ''}${c.mail?.medium ? ` · 편지=${c.mail.medium}` : ''}`);
        } catch {}
      }
    }
    const firstBy = p.firstBy === 'me' ? 'me' : 'them';
    const messages = buildMatchMessages({
      mode, request: String(p.request || '').slice(0, 4000), dice, roll, used, exclude: String(p.exclude || '').slice(0, 500),
      existing: existing && { card: existing.card, lore: existing.lore }, personaName, noPersona: !!p.noPersona, firstBy, ranges: p.ranges || null,
    });
    const raw = await genJson(user, messages, settings);
    const draft = cleanMatchDraft(raw, { mode, ranges: p.ranges || null, existingName: existing?.ch?.name || '', personaName });
    return { draft: { ...draft, dice, roll: roll ? rollText(roll) : '', firstBy, characterId: existing?.ch?.id || '' } };
  };
  const matchConfirm = async (user, p, now) => {
    const d = cleanEditedDraft(p.draft);
    const mode = d.mode;
    const characterId = mode === 'existing' ? String(p.draft?.characterId || '') : '';
    if (mode === 'existing' && !characterId) throw new Error('기존 캐릭터 id가 없습니다.');
    // 1) 로어북
    const book = await api.world_books.create({
      name: mode === 'existing' ? `${d.name} · 우체통` : `${d.worldTitle} · 우체통`,
      description: '이세계 우체통이 만든 로어북. 편지가 오가며 항목이 늘어날 수 있다.',
      metadata: { isekai_mailbox: true },
    }, user);
    const made = { bookId: book.id, characterId: '' };
    try {
      let order = 100;
      for (const e of d.entries) { await api.world_books.entries.create(book.id, entryInput(e, order), user); order += 10; }
      // 2) 캐릭터(기존 상대면 원본을 건드리지 않음)
      let charId = characterId;
      let brief;
      if (mode === 'existing') {
        brief = (await existingInfo(user, characterId)).card;
      } else {
        const ch = await api.characters.create({
          name: d.name,
          description: d.card.description,
          personality: d.card.personality,
          post_history_instructions: d.card.never,
          creator_notes: '이세계 우체통에서 만든 편지 상대입니다.',
          tags: ['이세계 우체통'],
          world_book_ids: [book.id],
          extensions: { isekai_mailbox: { mail: d.mail, worldBookId: book.id } },
        }, user);
        charId = ch.id;
        made.characterId = ch.id;
        brief = briefFromCard(d.card);
      }
      // 3) 우체통 상대
      const persona = p.personaId && !p.noPersona ? await api.personas.get(p.personaId, user).catch(() => null) : null;
      let c = createCorrespondent({
        name: d.name, brief, world: '', ratio: d.mail.ratio,
        deliveryMin: d.mail.deliveryMin, deliveryMax: d.mail.deliveryMax, writeMin: d.mail.writeMin, writeMax: d.mail.writeMax,
        maxReplyRealHours: p.maxReplyRealHours ?? 24, timeScale: p.timeScale ?? 1,
        personaId: persona?.id || '', personaName: persona?.name || '', noPersona: !!p.noPersona, userTz: p.userTz || '',
        characterId: charId, worldBookId: book.id, origin: mode, mail: d.mail,
        calendar: d.calendar, waitHours: d.mail.waitHours,
      }, now);
      // 달력의 「첫 편지 날짜」가 첫 편지를 쓴 그쪽 시각이 되도록: 만난 뒤 흐른 시간(anchor)만큼 시작을 앞당긴다
      if (c.calendar) c = { ...c, calendar: shiftCalendarStart(c.calendar, -c.anchor.theirAt) };
      if (d.firstLetter) c = applyReply(c, firstLetterReply(d.firstLetter), now);
      await serial(user, () => saveC(user, c));
      // 첫 편지의 동봉물도 자동 그리기(설정이 켜져 있으면)
      const settingsA = await loadSettings(user);
      const firstItems = (c.items || []).filter((x) => x.from === 'them' && !x.imageId).map((x) => ({ kind: 'item', itemId: x.id }));
      if (api.imageGen?.generate && firstItems.length && cleanArt(settingsA.art).autoItems === 'all') drawArtWhenFree(user, c.id, firstItems).catch((e) => log('info', `첫 편지 물건 자동 그림 건너뜀: ${e?.message || e}`));
      if (cleanArt(settingsA.art).paperMode !== 'image') makeTheme(user, c.id).catch((e) => log('info', `편지지 테마 건너뜀: ${e?.message || e}`));
      return { id: c.id, characterId: charId, worldBookId: book.id };
    } catch (e) {
      // 중간에 실패하면 이번에 만든 것만 지운다
      try { if (made.characterId) await api.characters.delete(made.characterId, user); } catch {}
      try { await api.world_books.delete(made.bookId, user); } catch {}
      throw e;
    }
  };

  // ── 답장 생성 ──
  // 보내는 사람 이름: 상대에 묶인 페르소나(지금 이름) → 저장해 둔 이름 → 마지막 편지의 이름 → 활성 페르소나
  const personaNameFor = async (user, c) => {
    if (c.noPersona) return '';
    try {
      if (c.personaId) {
        const p = await api.personas.get(c.personaId, user);
        if (p?.name) return p.name;
      }
    } catch {}
    if (c.personaName) return c.personaName;
    const lastMine = [...c.letters].reverse().find((l) => l.from === 'me' && l.personaName);
    if (lastMine) return lastMine.personaName;
    try { return (await api.personas.getActive(user))?.name || ''; } catch { return ''; }
  };
  const withPersonaName = async (user, input) => {
    if (input?.noPersona || !input?.personaId) return { ...input, personaName: '' };
    try {
      const p = await api.personas.get(input.personaId, user);
      if (!p) throw new Error('고른 페르소나를 찾지 못했습니다.');
      return { ...input, personaName: p.name };
    } catch (e) { throw new Error(e?.message || '페르소나를 읽지 못했습니다.'); }
  };

  const generateReply = async (user, id) => {
    const key = `${user}:${id}`;
    if (busy.has(key)) return;
    busy.add(key);
    try {
      const c = await mutate(user, id, (c) => (c.reply?.state === 'waiting' ? markGenerating(c) : c));
      if (c.reply?.state !== 'generating') return;
      const settings = await loadSettings(user);
      const personaName = await personaNameFor(user, c);
      const budgets = cleanBudgets(settings.budgets);
      const lore = await loreFor(user, c, budgets.loreChars).catch((e) => { log('warn', `로어북 읽기 실패(${c.name}): ${e?.message || e}`); return { text: '' }; });
      const memory = memoryLayers(c, { budgets, recentLetters: settings.recentLetters });
      const messages = buildReplyMessages(c, { now: Date.now(), personaName, recent: settings.recentLetters, lore: lore.text, memory, letterMin: settings.letterMin, letterMax: settings.letterMax });
      const req = {
        messages,
        parameters: { temperature: settings.temperature, max_tokens: settings.maxTokens },
        userId: user,
      };
      let reply;
      try {
        const res = await callLLM(user, req, settings.replyConnectionId, settings, `답장(${c.name})`);
        reply = cleanReply(parseJsonLoose(res?.content));
      } catch (e) {
        log('warn', `답장 생성 실패(${c.name}): ${e?.message || e}`);
        const after = await mutate(user, id, (cur) => (cur.reply?.state === 'generating' ? markFailed(cur, e) : cur));
        notify(user, { id });
        if (after.reply?.state === 'failed') log('error', `답장 재시도 소진(${c.name})`);
        return;
      }
      await mutate(user, id, async (cur) => {
        if (cur.reply?.state !== 'generating') return cur;
        const answered = cur.reply.forLetterIds || [];
        if (cur.reply.initiative) {
          serial(user, async () => {
            const u = await readJson(INIT_USAGE, user, { day: '', count: 0 });
            await api.userStorage.setJson(INIT_USAGE, { day: dayKey(), count: (u.day === dayKey() ? u.count : 0) + 1 }, { userId: user });
          }).catch(() => {});
        }
        const next = applyReply(cur, reply, Date.now(), Math.random, { lateChance: settings.lateChance });
        const newId = next.letters[next.letters.length - 1].id;
        return settings.organizeEnabled ? queueOrganize(next, [...answered, newId]) : next;
      });
      log('info', `답장 생성 완료 — 배송 시작(${c.name})`);
      if (!settings.organizeEnabled) {
        const cur0 = await loadC(user, id);
        maybeChangeArt(user, id, cur0.letters[cur0.letters.length - 1].id, null).catch(() => {});
      }
      if (api.imageGen?.generate && cleanArt(settings.art).autoItems === 'all' && reply.enclosures?.length) {
        const cur = await loadC(user, id);
        const last = cur.letters[cur.letters.length - 1];
        const P0 = cleanPortrait(cleanArt(settings.art).portrait);
        const mine = (cur.items || []).filter((x) => x.letterId === last.id && !x.imageId);
        const pics = P0.connectionId && P0.pictureItems ? mine.filter((x) => isPictureItem(x.name, x.note)) : [];
        const its = mine.filter((x) => !pics.includes(x)).map((x) => ({ kind: 'item', itemId: x.id }));
        if (its.length) drawArtWhenFree(user, id, its).catch((e) => log('info', `물건 자동 그림 건너뜀: ${e?.message || e}`));
        for (const x of pics) drawPictureItem(user, id, x.id).catch((e) => log('warn', `사진 동봉 그림 실패: ${e?.message || e}`));
      }
      {
        const P1 = cleanPortrait(cleanArt(settings.art).portrait);
        const cur = await loadC(user, id);
        const theirs = cur.letters.filter((x) => x.from === 'them').length;
        const pt = cur.art?.portrait;
        if (P1.connectionId && P1.refreshEvery > 0 && pt?.imageId && theirs - (pt.atLetters || 0) >= P1.refreshEvery && cur.portraitJob?.state !== 'drawing') {
          const lastL = cur.letters[cur.letters.length - 1];
          const recent = [...(lastL?.between || []).map((b) => `${b.when || ''} ${b.event}`), (lastL?.body || '').slice(0, 300)].join('\n');
          drawPortrait(user, id, { recent }).catch((e) => log('info', `초상화 갱신 건너뜀: ${e?.message || e}`));
        }
      }
      notify(user, { id });
    } finally {
      busy.delete(key);
    }
  };

  // ── 푸시 알림(편지 도착) ──
  const INIT_USAGE = 'initiative-usage.json';
  const sendPush = async (user, arrivals) => {
    if (!api.push?.send) return;
    const total = arrivals.reduce((n, a) => n + a.count, 0);
    const body = arrivals.length === 1
      ? `${arrivals[0].name}의 편지${total > 1 ? ` ${total}통이` : '가'} 도착했어요`
      : `편지 ${total}통이 도착했어요 — ${arrivals.map((a) => a.name).join(', ')}`;
    try {
      await api.push.send({ title: '이세계 우체통', body, tag: 'isekai-mailbox', url: '/', rawTitle: true, icon: arrivals[0].stampId ? `/api/v1/images/${arrivals[0].stampId}?size=sm` : undefined }, user);
    } catch (e) { log('info', `푸시 알림 못 보냄: ${e?.message || e}`); }
  };

  // ── 시간 진행 ──
  const tickUser = async (user) => {
    const ids = await listIds(user);
    const firstRun = !recovered.has(user);
    recovered.add(user);
    let delivered = 0;
    const arrivals = []; // { name, stampId } — 푸시 알림용
    const toGenerate = [];
    const toOrganize = [];
    const settings = await loadSettings(user);
    let initLeft = 0;
    if (settings.initiativeEnabled && settings.initiativePerDay > 0) {
      const u = await readJson(INIT_USAGE, user, { day: '', count: 0 });
      initLeft = Math.max(0, settings.initiativePerDay - (u.day === dayKey() ? u.count : 0));
    }
    for (const id of ids) {
      if (busy.has(`${user}:${id}`)) continue;
      try {
        await mutate(user, id, (c) => {
          let base = firstRun ? recover(c) : c;
          if (firstRun && base.organize?.state === 'generating') base = { ...base, organize: { ...base.organize, state: 'waiting', nextTryAt: 0 } };
          if (firstRun && base.portraitJob?.state === 'drawing' && !drawing.has(`${user}:${id}:portrait`)) base = { ...base, portraitJob: { ...base.portraitJob, state: 'failed', error: '확장이 다시 시작돼 그리기가 끊겼어요. 다시 그려 주세요.' } };
          if (firstRun && base.artJob?.state === 'running' && !drawing.has(`${user}:${id}:art`)) {
            const t = (base.artJob.targets || []).map((x) => (x.state === 'done' ? x : { ...x, state: 'failed', error: '확장이 다시 시작돼 그리기가 끊겼어요. 다시 그려 주세요.' }));
            base = { ...base, artJob: { ...base.artJob, state: 'failed', targets: t, error: '확장이 다시 시작돼 그리기가 끊겼어요.' } };
          }
          let r = advance(base, Date.now());
          delivered += r.delivered.length;
          if (r.delivered.length) arrivals.push({ name: r.c.name, count: r.delivered.length, stampId: r.c.art?.stamp?.imageId || r.c.art?.seal?.imageId || '' });
          // 먼저 오는 편지: 기다림이 찼고 오늘 남은 횟수가 있으면
          if (!r.generate && settings.initiativeEnabled) {
            const ic = initiativeCheck(r.c, Date.now(), { maxStreak: settings.initiativeStreak });
            if (ic.start && initLeft > 0) {
              initLeft--;
              r = { ...r, c: startInitiative(ic.c, Date.now()), generate: true };
              log('info', `먼저 오는 편지 시작(${r.c.name})`);
            } else r = { ...r, c: ic.c };
          }
          if (r.generate) toGenerate.push(id);
          const o = r.c.organize;
          if (o?.state === 'waiting' && Date.now() >= (o.nextTryAt || 0) && !r.generate) toOrganize.push(id);
          return r.c;
        });
      } catch (e) { log('warn', `진행 실패(${id}): ${e?.message || e}`); }
    }
    if (delivered) notify(user, { delivered });
    if (arrivals.length && settings.pushEnabled) sendPush(user, arrivals).catch(() => {});
    // 생성은 기다리지 않는다(화면 요청이 생성 시간만큼 막히지 않게). 상대별 잠금은 busy가 맡는다.
    for (const id of toGenerate) generateReply(user, id).catch((e) => log('error', `생성 오류: ${e?.message || e}`));
    for (const id of toOrganize) runOrganize(user, id).catch((e) => log('error', `정리 오류: ${e?.message || e}`));
  };

  let ticking = false;
  const tick = async () => {
    if (ticking || stopped) return;
    ticking = true;
    try {
      for (const user of users) await tickUser(user);
    } finally { ticking = false; }
  };

  // ── 프런트 요청 ──
  const run = async (p, user) => {
    await rememberUser(user);
    const now = Date.now();
    switch (p.type) {
      case 'load': {
        await tickUser(user).catch(() => {});
        const ids = await listIds(user);
        const list = [];
        for (const id of ids) { try { list.push(summarize(await loadC(user, id), now)); } catch {} }
        list.sort((a, b) => b.lastAt - a.lastAt);
        return { settings: await loadSettings(user), list };
      }
      case 'get': {
        await tickUser(user).catch(() => {});
        const c = await loadC(user, p.id);
        return { c: publicView(c, Date.now()), input: toInput(c) };
      }
      case 'all': {
        // 보조창(편지첩·물품·모음)용: 모든 상대의 화면 사본
        await tickUser(user).catch(() => {});
        const out = [];
        for (const id of await listIds(user)) { try { out.push(publicView(await loadC(user, id), Date.now())); } catch {} }
        return { all: out, settings: await loadSettings(user) };
      }
      case 'personas': {
        const r = await api.personas.list({ limit: 200, userId: user });
        let activeId = '';
        try { activeId = (await api.personas.getActive(user))?.id || ''; } catch {}
        return { activeId, personas: (r?.data || []).map((x) => ({ id: x.id, name: x.name, title: x.title || '', imageId: x.image_id || '' })) };
      }
      case 'create': {
        const c = createCorrespondent(await withPersonaName(user, p.input), now);
        await serial(user, () => saveC(user, c));
        return { id: c.id };
      }
      case 'update': {
        const input = p.input && ('personaId' in p.input || 'noPersona' in p.input) ? await withPersonaName(user, p.input) : p.input;
        const c = await mutate(user, p.id, (c) => updateCorrespondent(c, input, now));
        return { c: publicView(c, now) };
      }
      case 'deleteInfo': {
        // 지우기 전에 무엇이 함께 지워질 수 있는지
        const c = await loadC(user, p.id);
        let ch = null; let book = null; let otherUsers = 0;
        try { ch = c.characterId ? await api.characters.get(c.characterId, user) : null; } catch {}
        try { book = c.worldBookId ? await api.world_books.get(c.worldBookId, user) : null; } catch {}
        // 같은 캐릭터를 다른 상대가 쓰고 있으면 알려 준다
        for (const id of await listIds(user)) {
          if (id === c.id) continue;
          try { const o = await loadC(user, id); if (ch && o.characterId === ch.id) otherUsers++; } catch {}
        }
        return {
          name: c.name, letters: c.letters.length, items: (c.items || []).length, images: imageIdsOf(c).length,
          character: ch ? { id: ch.id, name: ch.name, made: c.origin !== 'existing' } : null,
          book: book ? { id: book.id, name: book.name } : null, sharedCharacter: otherUsers,
        };
      }
      case 'delete': {
        const c = await loadC(user, p.id).catch(() => null);
        const done = { character: false, book: false, images: 0 };
        if (c) {
          if (p.removeImages) {
            for (const img of imageIdsOf(c)) { try { await api.images.delete(img, user); done.images++; } catch {} }
            await serial(user, async () => {
              const ids = new Set(imageIdsOf(c));
              const cur = await readJson(WEBP, user, []);
              await api.userStorage.setJson(WEBP, cur.filter((x) => x.cid !== c.id && !ids.has(x.imageId)), { userId: user });
            });
          }
          if (p.removeBook && c.worldBookId) { try { await api.world_books.delete(c.worldBookId, user); done.book = true; } catch (e) { log('warn', `로어북 지우기 실패: ${e?.message || e}`); } }
          if (p.removeCharacter && c.characterId) { try { await api.characters.delete(c.characterId, user); done.character = true; } catch (e) { log('warn', `캐릭터 지우기 실패: ${e?.message || e}`); } }
        }
        await serial(user, () => api.userStorage.delete(cPath(p.id), user));
        log('info', `상대 지움(${c?.name || p.id}) 캐릭터=${done.character} 로어북=${done.book} 그림=${done.images}`);
        return done;
      }
      case 'uploadPhoto': {
        // 내 사진 동봉: 프런트가 WebP로 줄여 보낸다
        const bytes = Uint8Array.from(Buffer.from(String(p.data || ''), 'base64'));
        if (bytes.length < 100 || bytes.length > 8 * 1024 * 1024) throw new Error('사진 크기가 이상합니다(8MB 이하).');
        const c = await loadC(user, p.id);
        const up = await api.images.upload({ data: bytes, filename: `isekai-photo-${Date.now()}.webp`, mime_type: p.mime === 'image/jpeg' ? 'image/jpeg' : 'image/webp', owner_character_id: c.characterId || undefined }, user);
        return { imageId: up.id };
      }
      case 'dropPhoto': {
        // 보내기 전에 뺀 사진: 어느 편지에도 안 쓰였으면 지운다
        const c = await loadC(user, p.id);
        if (!imageIdsOf(c).includes(p.imageId)) { try { await api.images.delete(p.imageId, user); } catch {} }
        return {};
      }
      case 'send': {
        const personaName = await personaNameFor(user, await loadC(user, p.id));
        const lateChance = (await loadSettings(user)).lateChance;
        const c = await mutate(user, p.id, (c) => ({ ...sendLetter(c, { body: p.body, enclosure: p.enclosure, personaName, photos: p.photos, lateChance }, now), ...(p.userTz ? { userTz: String(p.userTz).slice(0, 60) } : {}) }));
        return { c: publicView(c, now) };
      }
      case 'recall': {
        const c = await mutate(user, p.id, (c) => recallLetter(c, p.letterId, now));
        return { c: publicView(c, now) };
      }
      case 'editLetter': {
        const c = await mutate(user, p.id, (c) => editLetter(c, p.letterId, { body: p.body, ps: p.ps }, now));
        return { c: publicView(c, now) };
      }
      case 'open': {
        const c = await mutate(user, p.id, (c) => markOpened(c, p.letterId, now));
        return { c: publicView(c, now) };
      }
      case 'dossier': {
        // 상대 서류함: 기억·규칙·변경 기록 + 다음 답장 모의 조립(모델 호출 없음)
        const c = ensureMemory(await loadC(user, p.id));
        const settings = await loadSettings(user);
        const budgets = cleanBudgets(settings.budgets);
        const personaName = await personaNameFor(user, c);
        let lore = { text: '', count: 0, dropped: 0, total: 0 };
        try { lore = await loreFor(user, c, budgets.loreChars); } catch {}
        const memory = memoryLayers(c, { budgets, recentLetters: settings.recentLetters });
        const sim = { ...c, reply: c.reply || { forLetterIds: c.letters.filter((l) => l.from === 'me' && l.state !== 'in_transit').slice(-1).map((l) => l.id) } };
        const messages = buildReplyMessages(sim, { now: Date.now(), personaName, recent: settings.recentLetters, lore: lore.text, memory, letterMin: settings.letterMin, letterMax: settings.letterMax });
        const past = c.letters.filter((l) => !(l.from === 'me' && l.state === 'in_transit'));
        const recentText = past.slice(-settings.recentLetters).map((l) => l.body || '').join('');
        const report = [
          { layer: '상대 카드', chars: (c.brief || '').length, note: '' },
          { layer: '로어북', chars: lore.text.length, note: `${lore.count}/${lore.total}항목${lore.dropped ? ` (${lore.dropped} 예산 초과로 빠짐)` : ''}` },
          { layer: '최근 원문', chars: recentText.length, note: `${Math.min(past.length, settings.recentLetters)}/${past.length}통` },
          ...memory.report,
        ].map((r) => ({ ...r, tokens: approxTokens('x'.repeat(r.chars)) }));
        const total = messages.reduce((n, m) => n + m.content.length, 0);
        return {
          memory: c.memory, locks: c.locks, applyMode: c.applyMode, organize: c.organize, budgets, localLore: c.localLore || [],
          report, totalChars: total, totalTokens: approxTokens(messages.map((m) => m.content).join('')), prompt: messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n'),
          cardFields: CARD_FIELDS,
        };
      }
      case 'setRules': {
        const c = await mutate(user, p.id, (c) => {
          c = ensureMemory(c);
          const locks = Array.isArray(p.locks) ? p.locks.map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 40) : c.locks;
          const am = { ...c.applyMode };
          for (const k of Object.keys(am)) if (MODES.includes(p.applyMode?.[k])) am[k] = p.applyMode[k];
          return { ...c, locks, applyMode: am };
        });
        return { locks: c.locks, applyMode: c.applyMode };
      }
      case 'change': {
        // 승인 대기 승인/거절, 적용된 변경 되돌리기
        const cur = ensureMemory(await loadC(user, p.id));
        const ch = cur.memory.changes.find((x) => x.id === p.changeId);
        if (!ch) throw new Error('변경 기록을 찾지 못했습니다.');
        if (p.action === 'reject') {
          if (!['pending', 'conflict', 'locked', 'failed'].includes(ch.state)) throw new Error('이 변경은 거절할 수 없습니다.');
          await mutate(user, p.id, (c) => setChange(ensureMemory(c), ch.id, { state: 'rejected' }));
        } else if (p.action === 'approve') {
          if (!['pending', 'failed', 'locked'].includes(ch.state) || ch.target === 'conflict') throw new Error('이 변경은 승인할 수 없습니다.');
          await mutate(user, p.id, (c) => setChange(ensureMemory(c), ch.id, { state: 'apply' }));
          await runChanges(user, p.id, [ch.id]);
        } else if (p.action === 'revert') {
          if (ch.state !== 'applied') throw new Error('적용된 변경만 되돌릴 수 있습니다.');
          await mutate(user, p.id, async (c) => {
            c = ensureMemory(c);
            const r = await execChange(user, c, ch, 'revert');
            return setChange(r.c, ch.id, { ...r.patch, revertedAt: Date.now() });
          });
        } else throw new Error('모르는 동작');
        const after = ensureMemory(await loadC(user, p.id));
        return { change: after.memory.changes.find((x) => x.id === ch.id) };
      }
      case 'organizeNow': {
        // 아직 정리하지 않은 편지(도착한 것)를 정리 대기열에 넣는다 — 0.3 이전 기록이나 실패 뒤 재시도용
        const c = await mutate(user, p.id, (c) => {
          c = ensureMemory(c);
          const done = new Set((c.memory.summaries || []).map((s) => s.letterId));
          const todo = c.letters.filter((l) => !done.has(l.id) && l.state !== 'in_transit').map((l) => l.id);
          if (!todo.length) throw new Error('정리할 편지가 없습니다.');
          return queueOrganize(c, todo);
        });
        tickUser(user).catch(() => {});
        return { queued: c.organize.forLetterIds.length };
      }
      case 'imageConnections': {
        const list = await api.imageGen.listConnections(user);
        return { connections: (list || []).map((x) => ({ id: x.id, name: x.name, provider: x.provider, model: x.model, is_default: !!x.is_default })) };
      }
      case 'imageModels': {
        // 고른 이미지 연결(없으면 기본 연결)의 모델 목록
        let connId = String(p.connectionId || '');
        const conns = await api.imageGen.listConnections(user);
        if (!connId) connId = (conns || []).find((x) => x.is_default)?.id || conns?.[0]?.id || '';
        if (!connId) return { connectionId: '', models: [] };
        const conn = (conns || []).find((x) => x.id === connId);
        const models = await api.imageGen.getModels(connId, user);
        return { connectionId: connId, current: conn?.model || '', models: (models || []).slice(0, 500).map((m) => ({ id: String(m.id), label: String(m.label || m.id) })) };
      }
      case 'artStatus': {
        const art = cleanArt((await loadSettings(user)).art);
        return { left: quotaLeft(await readUsage(user), art), perDay: art.perDay };
      }
      case 'drawPortrait': return drawPortrait(user, p.id);
      case 'syncOurLetters': {
        // 상대의 로어북에 「우리의 편지」 항목: 관계·약속·시기 요약·최근 편지 요약. 일반 채팅에서도 편지 일을 알게
        const c = ensureMemory(await loadC(user, p.id));
        if (!c.worldBookId) throw new Error('이 상대에는 연결된 로어북이 없습니다.');
        const m = memoryLayers(c, { budgets: { ...cleanBudgets((await loadSettings(user)).budgets), ledgerChars: 900, summaries: 6, summaryChars: 900, chapterChars: 900 }, recentLetters: 0 });
        const n = c.letters.filter((l) => l.state !== 'in_transit').length;
        const content = [
          `{{char}}와 {{user}}는 서로 다른 세계에서 편지만 주고받는다(지금까지 ${n}통, 얼굴을 본 적 없음).`,
          m.ledger, m.chapters && `지난 이야기:\n${m.chapters}`, m.summaries && `최근 편지:\n${m.summaries}`,
        ].filter(Boolean).join('\n').replaceAll(c.name, '{{char}}').slice(0, 3000);
        const entries = await listEntries(user, c.worldBookId);
        const old = entries.find((e) => e.comment === '우리의 편지');
        const input = entryInput({ title: '우리의 편지', keys: ['편지', '우체통', '답장'], content, constant: !!p.constant }, 90);
        if (old) await api.world_books.entries.update(old.id, input, user);
        else await api.world_books.entries.create(c.worldBookId, input, user);
        return { updated: !!old, chars: content.length };
      }
      case 'drawScene': {
        // 내 편지에 넣을 그림: 자연어 → NovelAI. 사진 동봉처럼 쓴다
        const r = await drawScene(user, p.id, { request: p.request, includeThem: !!p.includeThem, includeMe: !!p.includeMe });
        return { imageId: r.imageId };
      }
      case 'makeTheme': return { theme: await makeTheme(user, p.id, { reason: String(p.reason || '').slice(0, 300) }) };
      case 'setTheme': {
        const c = await mutate(user, p.id, (c) => ({ ...c, paperTheme: cleanTheme(p.theme, c.paperTheme ? cleanTheme(c.paperTheme) : defaultTheme(c)) }));
        return { theme: c.paperTheme };
      }
      case 'drawSet': {
        const c = ensureArt(await loadC(user, p.id));
        const kinds = (Array.isArray(p.kinds) ? p.kinds : setKinds(cleanArt((await loadSettings(user)).art))).filter((k) => ART_KINDS.includes(k));
        if (!kinds.length) throw new Error('그릴 것이 없습니다.');
        return drawOrQueue(user, c.id, kinds.map((kind) => ({ kind })));
      }
      case 'makeCalendar': {
        // 기존 상대에 달력 붙이기: 로어북의 달력·시간 항목과 편지에 쓴 날짜를 읽어 글 1회
        const c = await loadC(user, p.id);
        const lore = (await allLore(user, c).catch(() => [])).filter((e) => /달력|시간|계절|calendar/i.test(`${e.comment || ''} ${(e.key || []).join(' ')}`)).map((e) => `[${e.comment}]\n${e.content}`).join('\n\n').slice(0, 4000);
        const dates = c.letters.filter((l) => l.from === 'them' && l.body).slice(0, 5).map((l) => l.writtenLabel || l.body.split('\n')[0].slice(0, 60));
        const settings = await loadSettings(user);
        const raw = await genJson(user, buildCalendarMessages(c, { loreText: lore, letterDates: dates }), { ...settings, createTemperature: 0.3 });
        const cal = calendarFromRaw(raw?.calendar || raw);
        if (!cal) throw new Error('달력을 만들지 못했습니다.');
        // 첫 편지 날짜를 만난 날로: 첫 상대 편지가 쓰인 그쪽 시각만큼 시작을 앞당긴다
        const firstTheirs = c.letters.find((l) => l.from === 'them');
        const offset = firstTheirs?.theirWrittenAt || 0;
        const shifted = shiftCalendarStart(cal, -offset);
        const next = await mutate(user, p.id, (cur) => ({ ...cur, calendar: { ...shifted, style: cur.calendar?.style || 'both' } }));
        return { calendar: next.calendar };
      }
      case 'setCalendar': {
        const next = await mutate(user, p.id, (cur) => {
          const cal = p.calendar === null ? null : cleanCalendar({ ...(cur.calendar || {}), ...(p.calendar || {}) });
          return { ...cur, calendar: cal };
        });
        return { calendar: next.calendar };
      }
      case 'pushTest': {
        // 알림 시험: 앱 화면이 열려 있으면 앱이 알림을 생략하므로, 몇 초 뒤에 보낸다(그사이 앱을 닫거나 다른 화면으로)
        if (!api.push?.send) throw new Error('이 앱에서는 확장 푸시 알림을 쓸 수 없습니다.');
        let status = null;
        try { status = await api.push.getStatus?.(user); } catch {}
        if (status && status.available === false) throw new Error('알림을 받을 기기가 등록돼 있지 않습니다. 루미버스 설정에서 알림을 먼저 등록해 주세요.');
        const delay = Math.min(120, Math.max(5, Number(p.delaySec) || 30));
        setTimeout(() => {
          api.push.send({ title: '이세계 우체통', body: '알림 시험이에요. 편지가 도착하면 이렇게 알려 드려요.', tag: 'isekai-mailbox-test', url: '/', rawTitle: true }, user)
            .then((r) => log('info', `알림 시험 보냄: ${r?.sent ?? '?'}대`))
            .catch((e) => log('warn', `알림 시험 실패: ${e?.message || e}`));
        }, delay * 1000);
        return { delaySec: delay, status };
      }
      case 'artDismiss': {
        await mutate(user, p.id, (c) => (c.artJob?.state === 'failed' ? { ...c, artJob: null } : c));
        return {};
      }
      case 'drawItem': {
        const c = await loadC(user, p.id);
        const it = (c.items || []).find((x) => x.id === p.itemId);
        if (!it) throw new Error('물건을 찾지 못했습니다.');
        if (it.from === 'them' && it.state === 'in_transit') throw new Error('아직 도착하지 않은 물건입니다.');
        return drawOrQueue(user, c.id, [{ kind: 'item', itemId: it.id }]);
      }
      case 'webpQueue':
        return { queue: (await readJson(WEBP, user, [])).slice(0, 10) };
      case 'webpDone':
        return webpDone(user, p);
      case 'webpFail': {
        await serial(user, async () => {
          const q = await readJson(WEBP, user, []);
          const next = q.map((x) => (x.imageId === p.imageId ? { ...x, tries: (x.tries || 0) + 1 } : x)).filter((x) => (x.tries || 0) < 3);
          await api.userStorage.setJson(WEBP, next, { userId: user });
        });
        return {};
      }
      case 'retry': {
        await mutate(user, p.id, (c) => retryReply(c, now));
        tickUser(user).catch(() => {});
        return {};
      }
      case 'characters': {
        const r = await api.characters.list({ limit: 200, userId: user });
        return { characters: (r?.data || []).map((x) => ({ id: x.id, name: x.name, imageId: x.image_id || '', books: (x.world_book_ids || []).length })) };
      }
      case 'matchDraft':
        return matchDraft(user, p);
      case 'matchConfirm':
        return matchConfirm(user, p, now);
      case 'connections': {
        const list = await api.connections.list(user);
        return { connections: (list || []).map((x) => ({ id: x.id, name: x.name, provider: x.provider, model: x.model, is_default: !!x.is_default })) };
      }
      case 'exportAll': {
        // 백업: 설정 + 상대 전부(+ 캐릭터 카드·로어북 항목 사본). 그림은 루미버스 이미지라 id만 남는다.
        const out = { kind: 'isekai_mailbox_backup', version: 1, exportedAt: now, settings: await loadSettings(user), correspondents: [] };
        const only = Array.isArray(p.ids) && p.ids.length ? new Set(p.ids) : null;
        for (const id of await listIds(user)) {
          if (only && !only.has(id)) continue;
          try {
            const c = await loadC(user, id);
            const row = { c, character: null, book: null };
            if (c.characterId) {
              try {
                const ch = await api.characters.get(c.characterId, user);
                if (ch) row.character = { name: ch.name, description: ch.description || '', personality: ch.personality || '', scenario: ch.scenario || '', post_history_instructions: ch.post_history_instructions || '', creator_notes: ch.creator_notes || '', tags: ch.tags || [] };
              } catch {}
            }
            if (c.worldBookId) {
              try {
                const b = await api.world_books.get(c.worldBookId, user);
                if (b) row.book = { name: b.name, description: b.description || '', entries: (await listEntries(user, b.id)).map((e) => ({ key: e.key || [], comment: e.comment || '', content: e.content || '', constant: !!e.constant, order_value: e.order_value, disabled: !!e.disabled })) };
              } catch {}
            }
            out.correspondents.push(row);
          } catch {}
        }
        return out;
      }
      case 'importAll': {
        // 되살리기: 같은 id가 있으면 건너뜀(replace면 덮어씀). 캐릭터·로어북이 이 서버에 없으면 사본으로 새로 만든다.
        const b = p.backup;
        if (!b || b.kind !== 'isekai_mailbox_backup' || !Array.isArray(b.correspondents)) throw new Error('이세계 우체통 백업 파일이 아닙니다.');
        const have = new Set(await listIds(user));
        const res = { added: 0, replaced: 0, skipped: 0, characters: 0, books: 0 };
        for (const row of b.correspondents) {
          let c = row?.c;
          if (!c?.id || !c?.name || !Array.isArray(c.letters)) { res.skipped++; continue; }
          if (have.has(c.id) && !p.replace) { res.skipped++; continue; }
          let bookOk = false; let charOk = false;
          try { bookOk = !!(c.worldBookId && await api.world_books.get(c.worldBookId, user)); } catch {}
          try { charOk = !!(c.characterId && await api.characters.get(c.characterId, user)); } catch {}
          if (!bookOk && row.book) {
            const nb = await api.world_books.create({ name: row.book.name, description: row.book.description, metadata: { isekai_mailbox: true } }, user);
            for (const e of row.book.entries || []) { try { await api.world_books.entries.create(nb.id, e, user); } catch {} }
            c = { ...c, worldBookId: nb.id };
            res.books++;
          }
          if (!charOk && row.character) {
            const ch = await api.characters.create({ ...row.character, world_book_ids: c.worldBookId ? [c.worldBookId] : [], extensions: { isekai_mailbox: { mail: c.mail || {}, worldBookId: c.worldBookId || '' } } }, user);
            c = { ...c, characterId: ch.id };
            res.characters++;
          }
          if (!charOk && !row.character) c = { ...c, characterId: '' };
          if (!bookOk && !row.book) c = { ...c, worldBookId: '' };
          // 진행 중이던 일은 비우고 다시 계산하게(배송·답장 시각은 그대로)
          c = { ...c, artJob: null, organize: c.organize?.state === 'generating' ? { ...c.organize, state: 'waiting', nextTryAt: 0 } : c.organize };
          if (c.reply?.state === 'generating') c = { ...c, reply: { ...c.reply, state: 'waiting' } };
          await serial(user, () => saveC(user, c));
          if (have.has(c.id)) res.replaced++; else res.added++;
        }
        if (p.withSettings && b.settings) await serial(user, () => api.userStorage.setJson(SETTINGS, cleanSettings(b.settings), { userId: user }));
        log('info', `백업 되살리기: 추가 ${res.added} · 덮어씀 ${res.replaced} · 건너뜀 ${res.skipped} · 캐릭터 ${res.characters} · 로어북 ${res.books}`);
        return res;
      }
      case 'saveSettings': {
        const s = cleanSettings(p.settings);
        await serial(user, () => api.userStorage.setJson(SETTINGS, s, { userId: user }));
        return { settings: s };
      }
      default:
        throw new Error(`모르는 요청: ${p.type}`);
    }
  };

  const off = api.onFrontendMessage(async (payload, userId, frontendSessionId) => {
    if (typeof userId !== 'string' || !userId || !payload || typeof payload.requestId !== 'string') return;
    let reply;
    try {
      reply = { ok: true, ...(await run(payload, userId)) };
    } catch (error) {
      reply = { ok: false, error: error?.message || String(error) };
    }
    api.sendToFrontend({ ...reply, requestId: payload.requestId }, userId, frontendSessionId ? { frontendSessionId } : undefined);
  });

  loadUsers().then(tick);
  const timer = setInterval(tick, TICK_MS);
  log('info', '준비됨');
  return () => {
    stopped = true;
    clearInterval(timer);
    off?.();
  };
}
if (typeof spindle !== 'undefined') start(spindle);
