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
  for (const v of Object.values(c?.art || {})) if (v?.imageId) ids.add(v.imageId);
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
