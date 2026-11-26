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
    personaId: str(p?.personaId, 200),
    personaName: str(p?.personaName, 80),
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

// 저장된 상대 → 입력 양식(수정 화면용)
export function toInput(c) {
  return {
    name: c.name, brief: c.brief, world: c.world, ratio: c.ratio,
    deliveryMin: c.delivery.min, deliveryMax: c.delivery.max,
    writeMin: c.writeDelay.min, writeMax: c.writeDelay.max,
    maxReplyRealHours: c.maxReplyRealHours, timeScale: scaleOf(c), personaId: c.personaId, personaName: c.personaName || '',
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

// 내가 보내는 편지
export function sendLetter(c, { body, enclosure, personaName }, now = Date.now(), rand = Math.random) {
  c = normalize(c);
  const travel = realHours(c, pickBetween(c.delivery.min, c.delivery.max, rand));
  const names = splitEnclosures(enclosure);
  const letter = {
    id: newId('l', now, rand),
    from: 'me',
    personaName: str(personaName, 80),
    body: cleanLetterBody(body),
    enclosure: names.join(', '),
    enclosures: names.map((item) => ({ item, note: '' })),
    sentAt: now,
    arriveAt: now + travel,
    theirSentAt: theirNow(c, now),
    theirArriveAt: theirNow(c, now + travel),
    state: 'in_transit',
  };
  return { ...c, letters: [...c.letters, letter], items: [...c.items, ...names.map((n, i) => makeItem(letter, n, '', i))], initiativeAt: 0 };
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
export function applyReply(c, reply, now = Date.now(), rand = Math.random) {
  c = normalize(c);
  const travel = realHours(c, pickBetween(c.delivery.min, c.delivery.max, rand));
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
  if (a < 0 || b <= a) throw new Error('응답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(t.slice(a, b + 1));
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
    return `${head}\n${l.body}${enc ? `\n(동봉: ${enc})` : ''}`;
  }
  const head = `[${c.name} → {{user}}] 쓴 날 ${theirLabel(c, l.theirWrittenAt)}`;
  return `${head}\n${l.body}${l.ps ? `\n추신: ${l.ps}` : ''}${l.enclosures?.length ? `\n(동봉: ${l.enclosures.map((x) => x.item).join(', ')})` : ''}`;
};

export function buildReplyMessages(c, { now = Date.now(), personaName = '', recent = RECENT_LETTERS, lore = '', memory = null } = {}) {
  c = normalize(c);
  const userName = personaName || c.personaName || '편지의 주인';
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
    `knows_about_user=only what their letters said; their name is ${userName}`,
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
    '4. The letter must feel like a physical object from your world: describe `envelope` and any `enclosures` in concrete sensory terms.',
    '5. Stay consistent with the character and world above. New facts are allowed when they follow from events.',
    `6. Time is fixed by <correspondence>. \`read_at\`, \`written_at\`, and every \`their_date\` must fall between the first arrival and their_now, written in the same form as their_now ("${theirLabel(c, tNow)}"). When mentioning how long you waited or how many days passed, use only those numbers.`,
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
    personaId: c.personaId || '', personaName: c.personaName || '',
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


// 이세계 우체통 프런트
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
.im-tab,.im-panel,.im-page{--im-ink:color-mix(in srgb,var(--lumiverse-text) 72%,#6b4a2b 28%);--im-wax:#a8322a;--im-wax2:#c7493b;--im-cream:color-mix(in srgb,var(--lumiverse-bg-elevated,#fff) 84%,#d9b98a 16%);--im-cream2:color-mix(in srgb,var(--lumiverse-bg,#f4f4f6) 88%,#c8a46a 12%);--im-line:color-mix(in srgb,var(--lumiverse-border) 55%,#b08a5a 45%);--im-serif:"Nanum Myeongjo","Noto Serif KR","Batang",Georgia,serif}
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
  const setPersona = (id) => { S.persona = id; lsSet(LS_PERSONA, id); renderAll(); };

  async function refresh() {
    try {
      const [r, p] = await Promise.all([ask('all'), S.personas.length ? null : ask('personas').catch(() => null)]);
      S.all = r.all;
      S.settings = r.settings;
      if (p) { S.personas = p.personas; S.activePersonaId = p.activeId; }
      const l = await ask('load');
      S.list = l.list;
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
        p.imageId ? el('img', { class: 'im-ava', src: imgUrl(p.imageId), alt: '' }) : el('span', { class: 'im-ava', text: p.name.slice(0, 1) }),
        `${p.name} · ${count}`,
      ]));
    }
    if (used.has(NO_PERSONA)) chips.push(el('button', { class: `im-chip im-plain${S.persona === NO_PERSONA ? ' im-on' : ''}`, type: 'button', text: '페르소나 없음', onclick: () => setPersona(NO_PERSONA) }));
    return el('div', { class: 'im-chips' }, chips);
  }

  // 편지 쓰기 칸(서랍·보조창 공용)
  const drafts = new Map(); // 상대 id → { body, enclosure }
  function composeBox(c, { busyRef, act, onSent }) {
    const d = drafts.get(c.id) || { body: '', enclosure: '' };
    drafts.set(c.id, d);
    const sender = c.personaId ? (personaOf(c.personaId)?.name || c.personaName || '(지워진 페르소나)') : '활성 페르소나';
    return el('div', { class: 'im-letter' }, [
      el('div', { class: 'im-row' }, [el('h4', { class: 'im-grow', text: `${c.name}에게` }), el('span', { class: 'im-muted', text: `보내는 사람: ${sender}` })]),
      el('textarea', { value: d.body, placeholder: '편지 본문', rows: 7, oninput: (e) => { d.body = e.target.value; } }),
      el('textarea', { value: d.enclosure, placeholder: '동봉할 것(선택, 한 줄에 하나) — 예: 말린 네잎클로버 한 장', rows: 2, style: 'min-height:48px', oninput: (e) => { d.enclosure = e.target.value; } }),
      el('div', { class: 'im-row' }, [
        el('span', { class: 'im-muted im-grow', text: `${deliveryLabel(c)}. 도착 전에는 회수할 수 있습니다.` }),
        btn(busyRef() ? '보내는 중…' : '보내기', () => act(async () => {
          if (!d.body.trim()) throw new Error('본문을 적어 주세요.');
          await ask('send', { id: c.id, body: d.body, enclosure: d.enclosure });
          drafts.set(c.id, { body: '', enclosure: '' });
          await refresh();
          onSent?.();
        }), { primary: true, disabled: busyRef() }),
      ]),
    ]);
  }

  // ══════════════ 서랍 탭 ══════════════
  const tab = ctx.ui.registerDrawerTab({
    id: 'isekai-mailbox', title: '이세계 우체통', shortName: '우체통',
    description: '다른 세계의 누군가와 주고받는 편지',
    keywords: ['letter', 'mail', 'post', '편지', '우체통', '이세계'],
    headerTitle: '이세계 우체통', iconSvg: ICON,
  });
  const removeStyle = typeof ctx.dom?.addStyle === 'function' ? ctx.dom.addStyle(CSS + CSS2) : null;
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
      const body = { home: homeView, c: cView, letter: letterView, form: formView, settings: settingsView, match: matchView, preview: previewView, dossier: dossierView }[view.name]?.() || [];
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
                if (!confirm('이 편지를 회수할까요? 상대에게 가지 않습니다.')) return;
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
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' })), el('span', { class: 'im-grow' }), panel ? link('편지첩으로 보기', () => openPanelFor(c.id)) : null, link('서류함', () => openDossier(c.id)), link('상대 정보 수정', async () => { await reloadPersonas(); go({ name: 'form', id: c.id }); })]),
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
    function formView() {
      const editing = !!view.id;
      const cur = editing ? byId(view.id) : null;
      const v = cur ? {
        name: cur.name, brief: cur.brief, world: cur.world, ratio: cur.ratio, deliveryMin: cur.delivery.min, deliveryMax: cur.delivery.max,
        writeMin: cur.writeDelay.min, writeMax: cur.writeDelay.max, maxReplyRealHours: cur.maxReplyRealHours, timeScale: cur.timeScale || 1, personaId: cur.personaId || '', waitHours: cur.waitHours ?? Math.max(72, cur.writeDelay.max * 3),
      } : {
        name: '', brief: '', world: '', ratio: 1, deliveryMin: 1, deliveryMax: 24, writeMin: 2, writeMax: 48, maxReplyRealHours: 24, timeScale: 1,
        personaId: S.persona !== ALL && S.persona !== NO_PERSONA ? S.persona : S.activePersonaId,
      };
      const inputs = {};
      const text = (k, ph, rows) => (inputs[k] = rows ? el('textarea', { value: v[k] || '', placeholder: ph, rows }) : el('input', { value: v[k] ?? '', placeholder: ph }));
      const numIn = (k, step = 'any') => (inputs[k] = el('input', { type: 'number', step, min: '0', value: String(v[k] ?? '') }));
      inputs.personaId = el('select', {}, [
        el('option', { value: '', text: '페르소나 없음(보낼 때 활성 페르소나)' }),
        ...S.personas.map((p) => el('option', { value: p.id, text: p.title ? `${p.name} — ${p.title}` : p.name, selected: p.id === v.personaId })),
      ]);
      const read = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
      return [
        el('div', { class: 'im-row' }, [link('← 돌아가기', () => (editing ? go({ name: 'c', id: view.id }) : go({ name: 'home' })))]),
        el('h3', { text: editing ? '상대 정보 수정' : '새 상대' }),
        field('편지를 쓰는 나 (페르소나)', inputs.personaId),
        el('div', { class: 'im-muted', text: '상대를 직접 적습니다. 캐릭터 카드·로어북 자동 생성과 무작위 매칭은 다음 단계에서 붙습니다.' }),
        field('이름', text('name', '예: 하르텐')),
        field('상대 설명 (성격·말투·처지 — 캐릭터 카드처럼 적어도 됩니다)', text('brief', '눈 덮인 곶의 등대지기. 무뚝뚝하지만 편지는 꼬박꼬박 길게 쓴다…', 6)),
        field('그쪽 세계 (선택)', text('world', '바다가 얼어붙는 북쪽 해안. 우편은 철새 다리에 묶어 보낸다…', 4)),
        el('h4', { text: '시간' }),
        el('div', { class: 'im-pair' }, [
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
              if (pid && S.persona !== ALL) setPersona(pid);
              await refresh();
              go({ name: 'c', id: r.id });
            }
          }), { primary: true, disabled: busy }),
          editing ? btn('상대 지우기', () => act(async () => {
            if (!confirm('이 상대와 주고받은 편지·물품 기록을 모두 지울까요? 되돌릴 수 없습니다.')) return;
            await ask('delete', { id: view.id });
            await refresh();
            go({ name: 'home' });
          })) : null,
        ]),
      ];
    }

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
      const imodel = el('input', { value: A.model, placeholder: '목록에서 고르거나 직접 적기 (비우면 연결의 모델)', list: 'im-image-models' });
      const ilist = el('datalist', { id: 'im-image-models' });
      const imodelNote = el('div', { class: 'im-muted', text: '' });
      const showModels = (r) => {
        ilist.replaceChildren(...r.models.map((m) => el('option', { value: m.id, text: m.label !== m.id ? m.label : '' })));
        imodelNote.textContent = `모델 ${r.models.length}개${r.current ? ` · 이 연결의 기본 모델: ${r.current}` : ''}. 칸을 비우면 기본 모델을 씁니다.`;
      };
      const loadModels = (connId) => {
        if (modelCache[connId || '']) { showModels(modelCache[connId || '']); return; }
        imodelNote.textContent = '모델 목록을 불러오는 중…';
        ask('imageModels', { connectionId: connId }, 30000).then((r) => {
          modelCache[connId || ''] = r;
          ilist.replaceChildren(...r.models.map((m) => el('option', { value: m.id, text: m.label !== m.id ? m.label : '' })));
          imodelNote.textContent = `모델 ${r.models.length}개${r.current ? ` · 이 연결의 기본 모델: ${r.current}` : ''}. 칸을 비우면 기본 모델을 씁니다.`;
        }).catch((e) => { imodelNote.textContent = `모델 목록을 못 불러왔습니다: ${e.message}`; });
      };
      isel.addEventListener('change', () => loadModels(isel.value));
      loadModels(isel.value);
      const istyle = el('textarea', { value: A.style, rows: 3, placeholder: 'hand-painted storybook illustration, delicate ink linework, soft watercolor washes, …' });
      const KINDS = [['paper', '편지지'], ['stamp', '우표'], ['seal', '봉인'], ['item', '물건']];
      const DEF_T = {
        paper: 'flat 2D stationery design … ornamental border and small corner vignettes showing {subject}, large blank center …, {style}',
        stamp: 'flat 2D postage stamp design … vintage engraved illustration of {subject} …, {style}',
        seal: 'flat 2D illustration of a seal impression seen from directly above, {subject} …, {style}',
        item: 'highly detailed illustration of {subject}, intricate textures … single object on plain paper background, {style}',
      };
      const kIn = Object.fromEntries(KINDS.map(([k]) => [k, {
        model: el('input', { value: A.kinds?.[k]?.model || '', placeholder: '비우면 위 모델', list: 'im-image-models' }),
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
      const iauto = el('select', {}, [el('option', { value: 'off', text: '끔', selected: A.autoItems !== 'all' }), el('option', { value: 'all', text: '켬', selected: A.autoItems === 'all' })]);
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
      return [
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' }))]),
        el('h3', { text: '설정' }),
        field('답장 쓰기 연결', sel),
        field('상대 만들기 연결 (비우면 답장 연결)', csel),
        field('상대 만들기 온도', ctemp),
        el('h4', { text: '정리 단계 (답장마다 1회 더 생성)' }),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [orgOn, '답장이 오면 요약·관계 장부·로어북·카드를 정리하기']),
        field('정리 연결 (비우면 답장 연결)', osel),
        field('정리 온도', otemp),
        el('h4', { text: '기억 예산 (프롬프트에 넣는 양)' }),
        el('div', { class: 'im-pair' }, BL.map(([k, t]) => field(t, bIn[k]))),
        el('div', { class: 'im-muted', text: '최근 원문 통수는 위 「최근 편지 수」입니다. 예산을 넘어 빠진 양은 상대 서류함의 모의 조립에서 보입니다.' }),
        el('div', { class: 'im-pair' }, [field('온도', temp), field('최대 출력 토큰', maxT)]),
        field('프롬프트에 넣는 최근 편지 수(양쪽 합)', recent),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [exact, '배송 중 남은 시간을 분 단위로 보기']),
        el('div', { class: 'im-muted', text: '연결에 붙은 프리셋은 쓰지 않고, 우체통이 자기 지시문과 위 값을 보냅니다.' }),
        el('h4', { text: '그림 (NanoGPT 등 이미지 연결)' }),
        field('이미지 연결', isel),
        field('기본 모델', imodel),
        ilist,
        imodelNote,
        field('전체 룩 (영어, 양식의 {style} 자리에 들어감)', istyle),
        el('details', {}, [
          el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '종류별 양식·모델 (편지지·우표·봉인·물건)' }),
          el('div', { class: 'im-muted', text: '{subject}는 글 생성이 써 주는 주제, {style}은 위 전체 룩입니다. 비우면 기본 양식(평면 도안·세밀한 물건 그림)을 씁니다.' }),
          ...KINDS.flatMap(([k, t]) => [el('h4', { text: t }), field('모델', kIn[k].model), field('양식', kIn[k].template)]),
        ]),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [ineg, '금지어를 negative prompt로 보내기 (받지 않는 모델이 많아요. 거절되면 빼고 다시 시도합니다)']),
        field('금지어', inegText),
        el('div', { class: 'im-pair' }, [
          field('편지지 테두리 두께(px) — 글씨는 이 안쪽에만', iborder),
          field('그림에서 테두리로 쓸 비율(%)', islice),
          field('글씨 칸 선명도 (100=그림 그대로, 낮을수록 크림색으로 덮음)', istrength),
        ]),
        el('div', { class: 'im-muted', text: '편지지 그림은 액자처럼 씁니다: 모서리·테두리는 늘리지 않고 편지 길이에 맞춰 가장자리만 이어 붙입니다. 장식이 글씨에 닿으면 두께나 비율을 올려 주세요.' }),
        el('div', { class: 'im-pair' }, [field('크기', isize), field('편지지 크기', ipsize), field('하루 최대 장수', iday), field('받은 물건 자동 그리기', iauto)]),
        el('div', { class: 'im-muted', text: '사람·얼굴·손·글자는 그리지 않습니다. 만든 그림은 이 브라우저에서 WebP로 바꿔 다시 저장합니다(원본 png는 지움).' }),
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
        el('h4', { text: '편지첩 여는 방식 (이 기기, 새로 고침 뒤 적용)' }),
        el('select', { onchange: (e) => { lsSet(LS_PANEL_MODE, e.target.value); error = '여는 방식을 바꿨습니다. 페이지를 새로 고치면 적용됩니다.'; render(); } }, [
          el('option', { value: 'page', text: '채팅창처럼 화면 가득 (왼쪽 상대 목록 + 편지첩) — 권한 app_manipulation 필요', selected: lsGet(LS_PANEL_MODE, 'page') === 'page' }),
          el('option', { value: 'dock', text: '오른쪽에 붙이기 (메인 화면이 옆으로 밀림)', selected: lsGet(LS_PANEL_MODE, 'page') === 'dock' }),
          el('option', { value: 'float', text: '떠 있는 창 (메인 화면 위에 겹침, 끌어서 옮김)', selected: lsGet(LS_PANEL_MODE, 'page') === 'float' }),
        ]),
        el('div', { class: 'im-muted', text: pageMode ? '지금: 채팅창처럼 화면 가득' : panelMode === 'float' ? '지금: 떠 있는 창' : (lsGet(LS_PANEL_MODE, 'page') === 'page' ? '지금: 오른쪽에 붙이기 (화면 가득 방식은 확장 패널에서 app_manipulation 권한을 승인해야 합니다)' : '지금: 오른쪽에 붙이기') }),
        btn('저장', () => act(async () => {
          S.settings = (await ask('saveSettings', { settings: { replyConnectionId: sel.value, createConnectionId: csel.value, createTemperature: ctemp.value, art: { connectionId: isel.value, model: imodel.value, style: istyle.value, size: isize.value, paperSize: ipsize.value, perDay: Number(iday.value), autoItems: iauto.value, sendNegative: ineg.checked, negative: inegText.value, paperStrength: Number(istrength.value), paperBorder: Number(iborder.value), paperSlice: Number(islice.value), kinds: Object.fromEntries(Object.entries(kIn).map(([k, v]) => [k, { model: v.model.value, template: v.template.value }])) }, initiativeEnabled: initOn.checked, initiativePerDay: Number(initDay.value), initiativeStreak: Number(initStreak.value), pushEnabled: pushOn.checked, organizeEnabled: orgOn.checked, organizeConnectionId: osel.value, organizeTemperature: otemp.value, budgets: Object.fromEntries(Object.entries(bIn).map(([k, i]) => [k, Number(i.value)])), temperature: temp.value, maxTokens: maxT.value, recentLetters: recent.value, showExactEta: exact.checked } })).settings;
          go({ name: 'home' });
        }), { primary: true }),
      ];
    }

    // ── 새 상대(매칭) ──
    const M = { mode: 'prompt', request: '', dice: '', exclude: '', characterId: '', personaId: '', firstBy: 'them', ratioMin: '', ratioMax: '', deliveryMin: '', deliveryMax: '', timeScale: '1', characters: null, draft: null };
    const MODES = [['prompt', '원하는 상대 적기'], ['random', '무작위로 만나기'], ['existing', '기존 캐릭터'], ['manual', '직접 다 적기']];
    function matchView() {
      if (!M.personaId) M.personaId = S.persona !== ALL && S.persona !== NO_PERSONA ? S.persona : S.activePersonaId;
      if (M.mode === 'existing' && !M.characters) {
        M.characters = [];
        ask('characters').then((r) => { M.characters = r.characters; render(); }).catch((e) => { error = e.message; render(); });
      }
      const bind = (k, tag = 'input', props = {}) => el(tag, { ...props, value: M[k], oninput: (e) => { M[k] = e.target.value; } });
      const personaSel = el('select', { onchange: (e) => { M.personaId = e.target.value; } }, [
        el('option', { value: '', text: '페르소나 없음(보낼 때 활성 페르소나)' }),
        ...S.personas.map((p) => el('option', { value: p.id, text: p.title ? `${p.name} — ${p.title}` : p.name, selected: p.id === M.personaId })),
      ]);
      const body = [];
      if (M.mode === 'prompt') {
        body.push(field('어떤 상대와 편지하고 싶나요?', bind('request', 'textarea', { rows: 5, placeholder: '예: 눈 덮인 곶의 늙은 등대지기. 무뚝뚝하지만 편지는 꼬박꼬박 길게 쓴다. 바다가 얼면 새가 편지를 나른다.' })));
      } else if (M.mode === 'random') {
        body.push(field('세계의 씨앗 (비우면 주사위)', bind('dice', 'input', { placeholder: '예: 사막의 대상로 / 하늘에 뜬 섬' })));
        body.push(field('빼고 싶은 소재 (선택)', bind('exclude', 'input', { placeholder: '예: 전쟁, 용' })));
      } else if (M.mode === 'existing') {
        body.push(field('편지할 캐릭터', el('select', { onchange: (e) => { M.characterId = e.target.value; } }, [
          el('option', { value: '', text: M.characters?.length ? '고르기' : '불러오는 중…' }),
          ...(M.characters || []).map((c) => el('option', { value: c.id, text: c.books ? `${c.name} (로어북 ${c.books})` : c.name, selected: c.id === M.characterId })),
        ])));
        body.push(el('div', { class: 'im-muted', text: '원본 카드와 로어북은 바꾸지 않고, 우편 설정과 「〈이름〉 · 우체통」 로어북만 새로 만듭니다.' }));
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
            mode: M.mode, request: M.request, dice: M.dice, exclude: M.exclude, characterId: M.characterId, personaId: M.personaId, firstBy: M.firstBy,
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
            mode: M.mode, request: M.request, dice: d.dice || M.dice, exclude: M.exclude, characterId: M.characterId, personaId: M.personaId, firstBy: M.firstBy,
            ranges: { ratioMin: M.ratioMin, ratioMax: M.ratioMax, deliveryMin: M.deliveryMin, deliveryMax: M.deliveryMax },
          }, 240000);
          M.draft = r.draft;
        }), { disabled: busy })]),
        el('h3', { text: '미리보기' }),
        d.dice ? el('div', { class: 'im-muted', text: `세계의 씨앗: ${d.dice}` }) : null,
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
          const r = await ask('matchConfirm', { draft: d, personaId: M.personaId, timeScale: M.timeScale }, 60000);
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
      return [
        back,
        el('h3', { text: `${c?.name || ''} 서류함` }),
        // 정리 상태
        o ? el('div', { class: o.state === 'failed' ? 'im-err' : 'im-muted', text: o.state === 'failed' ? `정리 실패: ${o.error || ''}` : `정리 대기 중 · 편지 ${o.forLetterIds.length}통${o.error ? ` (재시도: ${o.error})` : ''}` }) : null,
        el('div', { class: 'im-row' }, [btn('아직 정리 안 된 편지 정리하기(생성 1회)', () => doAct(() => ask('organizeNow', { id: view.id })))]),
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
            if (!confirm('로어북의 달력·시간 항목과 편지에 쓴 날짜를 읽어 그쪽 달력을 만듭니다. 글 생성 1회. 계속할까요?')) return;
            await ask('makeCalendar', { id: view.id }, 120000);
          })),
          c?.calendar ? link('달력 지우기', () => doAct(async () => { if (confirm('달력을 지우고 「만난 지 N일째」로 표시할까요?')) await ask('setCalendar', { id: view.id, calendar: null }); })) : null,
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
        // 그림
        el('h4', { text: `그림${S.art?.left !== undefined ? ` · 오늘 남은 ${S.art.left}장` : ''}` }),
        c ? artBar(c, doAct) : null,
        el('div', { class: 'im-grid' }, ['paper', 'stamp', 'seal'].map((k) => {
          const img = c?.art?.[k]?.imageId;
          const label = { paper: '편지지', stamp: '우표', seal: '봉인' }[k];
          return el('div', { class: 'im-item' }, [
            el('div', { class: 'im-pic' }, [img ? el('img', { src: imgUrl(img, 'lg'), alt: label, loading: 'lazy', style: 'cursor:zoom-in', title: '눌러서 크게 보기', onclick: () => openImage(img, `${c?.name || ''} · ${label}`) }) : el('span', { html: PIC }), stateOverlay(artTarget(c, k))]),
            el('div', { class: 'im-cap' }, [el('b', { text: label }), link(img ? '다시 그리기' : '그리기', () => doAct(async () => {
              if (!confirm(`${label}을(를) ${img ? '다시 ' : ''}그립니다. 이미지 1장 + 글 생성 1회. 계속할까요?`)) return;
              await ask('drawSet', { id: view.id, kinds: [k] });
            }))]),
          ]);
        })),
        // 관계 장부
        el('h4', { text: '관계 장부' }),
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
      return el('div', { class: 'im-envelope' }, [
        el('div', { class: 'im-env-face' }, [sealImg ? el('img', { class: 'im-env-seal', src: imgUrl(sealImg, 'sm'), alt: '봉인' }) : el('span', { class: 'im-env-seal', text: c.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 1) })]),
        el('div', { class: 'im-env-body' }, [
        el('div', { style: 'font-size:12px;color:#7a6a52;text-align:center', text: `${c.name}에게서 · ${when(l.arriveAt)} 도착` }),
        el('dl', { style: 'margin:0' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
        l.enclosures?.length ? el('div', { style: 'font-size:12px;color:#7a6a52', text: `안에 무언가 더 들어 있는 것 같습니다 (${l.enclosures.length})` }) : null,
        btn('봉투 열기', () => act(async () => { await ask('open', { id: c.id, letterId: l.id }); await refresh(); })),
        ]),
      ]);
    }
    const meta = [l.writtenLabel || l.theirWrittenLabel, e.medium, e.scent].filter(Boolean).join(' · ');
    const paperImg = c.art?.paper?.imageId;
    const stampImg = c.art?.stamp?.imageId;
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
    return el('div', { class: `im-paper im-theirs${paperImg ? ' im-has-paper' : ''}`, style: paperStyle }, [
      el('div', { class: 'im-stamp', title: [e.stamp && `우표: ${e.stamp}`, e.seal && `봉인: ${e.seal}`].filter(Boolean).join('\n') }, [
        stampImg ? el('img', { src: imgUrl(stampImg, 'sm'), alt: '우표', style: 'cursor:zoom-in', onclick: () => openImage(stampImg, `${c.name} · 우표`, e.stamp || '') }) : el('span', { style: 'font-size:18px;line-height:1', text: '✉' }),
      ]),
      el('div', { class: 'im-meta', text: `${c.name}의 편지 · ${meta}` }),
      el('div', { text: l.body + (l.ps ? `\n\n추신. ${l.ps}` : '') }),
      l.enclosures?.length ? el('div', { class: 'im-encl' }, l.enclosures.map((x) => el('div', { text: `동봉 · ${x.item}${x.note ? ` — ${x.note}` : ''}` }))) : null,
      el('div', { class: 'im-meta', style: 'margin:8px 0 0', text: `받은 시각 ${when(l.arriveAt)}` }),
    ]);
  }

  // ══════════════ 보조창(도크) + 우체통 위젯 ══════════════
  let panel = null;
  let widget = null;
  const P = { tab: lsGet(`${LS_PANEL}.tab`, 'book'), id: lsGet(`${LS_PANEL}.id`, ''), busy: false, error: '' };
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
        el('div', { class: 'im-page-head' }, [el('span', { class: 'im-mini', html: MINI_BOX }), el('div', { class: 'im-grow' }, [el('div', { class: 'im-title', text: '이세계 우체통' }), pageSub]), closeBtn]),
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
      const fw = ctx.ui.createFloatWidget({ width: w, height: h, initialPosition: { x: Math.max(8, window.innerWidth - w - 24), y: 40 }, snapToEdge: false, tooltip: '이세계 우체통 · 편지첩', chromeless: false, touchScrollMode: 'native' });
      fw.setVisible(false);
      const head = el('div', { class: 'im-row', style: 'padding:6px 10px;border-bottom:1px solid var(--lumiverse-border);cursor:move;font-size:12px' }, [
        el('b', { class: 'im-grow', text: '이세계 우체통 · 편지첩' }),
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
      panel = ctx.ui.requestDockPanel({ edge: 'right', title: '이세계 우체통 · 편지첩', size: 440, minSize: 320, maxSize: 760, resizable: true, startCollapsed: true });
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
    P.id = id; P.tab = 'book'; lsSet(`${LS_PANEL}.id`, id); lsSet(`${LS_PANEL}.tab`, 'book');
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
      const c = byId(P.id);
      const setTab = (t) => { P.tab = t; lsSet(`${LS_PANEL}.tab`, t); panelView.render(); };
      const people = el('div', { class: 'im-chips' }, mine.map((x) => {
        const unread = x.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length;
        return el('button', { class: `im-chip im-plain${x.id === P.id ? ' im-on' : ''}`, type: 'button', onclick: () => { P.id = x.id; lsSet(`${LS_PANEL}.id`, x.id); panelView.render(); } }, [x.name, unread ? el('span', { class: 'im-badge', text: String(unread) }) : null]);
      }));
      const tabs = el('div', { class: 'im-tabs' }, [['book', '편지첩'], ['items', '물품'], ['album', '모음']].map(([k, t]) => el('button', { type: 'button', class: P.tab === k ? 'im-on' : '', text: t, onclick: () => setTab(k) })));
      let body = [];
      if (P.tab === 'album') body = albumView(mine);
      else if (!c) body = [el('div', { class: 'im-muted', text: S.all.length ? '이 페르소나와 편지를 주고받는 상대가 없습니다.' : '아직 상대가 없습니다. 서랍의 「우체통」 탭에서 새 상대를 만들어 주세요.' })];
      else if (P.tab === 'items') body = itemsView(c);
      else body = bookView(c, pact);
      if (pageMode && panel.pageSub) {
        const pn = S.persona === ALL ? '모든 페르소나' : S.persona === NO_PERSONA ? '페르소나 없음' : (personaOf(S.persona)?.name || '');
        panel.pageSub.textContent = `${pn ? `${pn}의 편지함 · ` : ''}상대 ${mine.length}명${S.list.reduce((n, x) => n + x.unread, 0) ? ` · 새 편지 ${S.list.reduce((n, x) => n + x.unread, 0)}통` : ''}`;
      }
      if (pageMode && panel.listCol) {
        panel.listCol.replaceChildren(
          personaChips(),
          ...(mine.length ? mine.map((x) => {
            const unread = x.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length;
            const s = S.list.find((y) => y.id === x.id);
            const last = [...x.letters].reverse().find((l) => l.body);
            return el('div', { class: `im-row-card${x.id === P.id ? ' im-on' : ''}`, onclick: () => { P.id = x.id; lsSet(`${LS_PANEL}.id`, x.id); panelView.render(); } }, [
              x.art?.seal?.imageId ? el('img', { class: 'im-seal', src: imgUrl(x.art.seal.imageId, 'sm'), alt: '' }) : el('span', { class: 'im-seal', text: x.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 1) }),
              el('div', { class: 'im-grow', style: 'display:flex;flex-direction:column;gap:2px;min-width:0' }, [
                el('div', { class: 'im-row', style: 'flex-wrap:nowrap' }, [el('span', { class: 'im-name im-grow', text: x.name }), x.artJob?.state === 'running' ? el('span', { class: 'im-spin', title: '그림 그리는 중' }) : null, unread ? el('span', { class: 'im-badge', text: String(unread) }) : null]),
                el('div', { class: 'im-muted', style: 'font-size:11.5px', text: s?.status || '' }),
                last ? el('div', { class: 'im-excerpt', text: last.body.replace(/\s+/g, ' ') }) : null,
              ]),
            ]);
          }) : [el('div', { class: 'im-muted', text: '편지 상대가 없습니다.' })]),
          el('div', { class: 'im-muted', style: 'margin-top:8px', text: '새 상대·설정·서류함은 서랍의 「우체통」 탭에 있어요.' }),
        );
      }
      panelRoot.replaceChildren(...[
        // 화면 가득 방식: 넓으면 왼쪽 목록이 페르소나·상대를 맡고, 좁으면(휴대폰) 위쪽 칩으로
        pageMode ? el('div', { class: 'im-page-chips' }, [personaChips(), mine.length ? people : null]) : personaChips(),
        !pageMode && mine.length ? people : null,
        tabs,
        ...body,
        P.error || S.error ? el('div', { class: 'im-err', text: P.error || S.error }) : null,
      ].filter(Boolean));
    },
  };
  views.add(panelView);

  // 편지첩: 오래된 편지부터 아래로, 맨 아래에 쓰기
  function bookView(c, act) {
    const now = Date.now();
    const exact = !!S.settings?.showExactEta;
    const nodes = c.letters.flatMap((l) => [
      el('div', { class: 'im-divider', text: l.from === 'me' ? (l.theirSentLabel ? `그쪽 ${l.theirSentLabel.replace('만난 지 ', '')} 무렵 · 내가 보냄` : '내가 보냄') : (l.theirWrittenLabel ? `그쪽 ${l.theirWrittenLabel.replace('만난 지 ', '')} · ${c.name}` : `${c.name}`) }),
      letterNode(l),
    ]);
    function letterNode(l) {
      if (l.from === 'me') {
        if (l.state === 'in_transit') {
          return el('div', { class: 'im-transit im-mine' }, [
            el('div', { text: `내 편지가 가는 중 · ${etaLabel(l.arriveAt - now, exact)}` }),
            el('div', { text: short(l.body, 60) }),
            link('회수하기', () => act(async () => {
              if (!confirm('이 편지를 회수할까요? 상대에게 가지 않습니다.')) return;
              await ask('recall', { id: c.id, letterId: l.id });
              await refresh();
            })),
          ]);
        }
        const enc = l.enclosures?.length ? l.enclosures.map((x) => x.item) : (l.enclosure ? [l.enclosure] : []);
        return el('div', { class: 'im-paper im-mine' }, [
          el('div', { class: 'im-meta', text: `${l.personaName || '나'}의 편지 · ${when(l.sentAt)} 보냄 · 그쪽 ${l.theirArriveLabel} 도착` }),
          el('div', { text: l.body }),
          enc.length ? el('div', { class: 'im-encl' }, enc.map((x) => el('div', { text: `동봉 · ${x}` }))) : null,
        ]);
      }
      if (l.state === 'in_transit') return el('div', { class: 'im-transit im-theirs', text: `${c.name}의 편지가 ${exact ? etaLabel(l.arriveAt - now, true).replace('도착까지', '도착까지') : '어딘가를 건너는 중…'}` });
      return theirLetterNode(c, l, { act });
    }
    const sealImg = c.art?.seal?.imageId;
    return [
      el('div', { class: 'im-info' }, [
        sealImg ? el('img', { class: 'im-seal', src: imgUrl(sealImg, 'sm'), alt: '' }) : el('span', { class: 'im-seal', text: c.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 1) }),
        el('div', { class: 'im-grow' }, [
          el('div', { class: 'im-name', text: c.name }),
          el('div', { class: 'im-muted', text: `${c.personaName ? `${c.personaName}의 편지 상대 · ` : ''}그쪽은 지금 ${c.theirNowLabel} · 시간 1:${c.ratio}` }),
        ]),
      ]),
      artBar(c, act),
      c.reply?.state === 'failed' ? el('div', { class: 'im-row' }, [el('span', { class: 'im-err im-grow', text: `우편 사고: ${c.reply.error || ''}` }), btn('다시 시도', () => act(async () => { await ask('retry', { id: c.id }); await refresh(); }))]) : null,
      ...(nodes.length ? nodes : [el('div', { class: 'im-muted', text: '아직 주고받은 편지가 없습니다. 첫 편지를 써 보세요.' })]),
      c.reply && c.reply.state !== 'failed' ? el('div', { class: 'im-transit im-theirs' }, [el('span', { class: 'im-spin' }), `${c.name}이(가) 답장을 쓰고 있는 듯합니다`]) : null,
      el('details', { class: 'im-compose', open: !c.letters.length }, [
        el('summary', { text: '✒ 편지 쓰기' }),
        composeBox(c, { busyRef: () => P.busy, act }),
      ]),
    ];
  }

  // 그림 작업 상태: 대상(편지지·우표·봉인·물건)마다 waiting/drawing/done/failed
  const artTarget = (c, kind, itemId = '') => (c?.artJob?.targets || []).find((t) => t.kind === kind && (t.itemId || '') === (itemId || '')) || null;
  const STATE_TEXT = { waiting: '기다리는 중', drawing: '그리는 중…', failed: '실패' };
  const stateOverlay = (t) => {
    if (!t || t.state === 'done') return null;
    return el('div', { class: `im-state${t.state === 'failed' ? ' im-bad' : ''}`, title: t.error || '' }, [
      t.state === 'drawing' ? el('span', { class: 'im-spin' }) : null,
      t.state === 'failed' ? `실패 — ${short(t.error || '', 40)}` : STATE_TEXT[t.state],
    ]);
  };
  // 그림 세트(편지지·우표·봉인) 상태와 버튼
  function artBar(c, act) {
    const have = ['paper', 'stamp', 'seal'].filter((k) => c.art?.[k]?.imageId);
    const job = c.artJob;
    const left = S.art?.left;
    if (job?.state === 'running') {
      const ts = job.targets || [];
      return el('div', { class: 'im-transit' }, [
        el('div', {}, [el('span', { class: 'im-spin' }), `그림을 그리는 중 ${job.done || 0}/${job.total}`]),
        ...ts.map((t) => el('div', { class: t.state === 'failed' ? 'im-err' : 'im-muted', text: `· ${t.label}: ${t.state === 'done' ? '완성' : STATE_TEXT[t.state] || t.state}${t.error && t.state === 'failed' ? ` (${short(t.error, 80)})` : ''}` })),
      ]);
    }
    const missing = ['paper', 'stamp', 'seal'].filter((k) => !have.includes(k));
    return el('div', {}, [
      job?.state === 'failed' ? el('div', { class: 'im-row' }, [
        el('span', { class: 'im-err im-grow', text: `지난 그리기 실패 ${(job.total || 0) - (job.done || 0)}장: ${short(job.error || '', 160)}` }),
        link('닫기', () => act(async () => { await ask('artDismiss', { id: c.id }); await refresh(); })),
      ]) : null,
      el('div', { class: 'im-row' }, [
        el('span', { class: 'im-muted im-grow', text: `그림 세트 ${have.length}/3${left !== undefined ? ` · 오늘 남은 그림 ${left}장` : ''}` }),
        link(missing.length ? `그림 세트 만들기(${missing.length}장)` : '세트 다시 그리기(3장)', () => act(async () => {
          const kinds = missing.length ? missing : ['paper', 'stamp', 'seal'];
          if (!confirm(`${c.name}의 ${kinds.map((k) => ({ paper: '편지지', stamp: '우표', seal: '봉인' })[k]).join('·')}을 그립니다.\n이미지 ${kinds.length}장 + 글 생성 1회. 계속할까요?`)) return;
          await ask('drawSet', { id: c.id, kinds });
          await refresh();
        })),
      ]),
    ]);
  }
  const drawItemBtn = (x, cid) => (x.imageId || (x.from === 'them' && x.state === 'in_transit') || !cid || ['waiting', 'drawing'].includes(artTarget(byId(cid), 'item', x.id)?.state) ? null
    : el('button', { class: 'im-link', type: 'button', text: artTarget(byId(cid), 'item', x.id)?.state === 'failed' ? '다시 그리기' : '그리기', style: 'font-size:11px', onclick: async (ev) => {
      ev.stopPropagation();
      if (!confirm(`「${x.name}」을 그립니다. 이미지 1장 + 글 생성 1회. 계속할까요?`)) return;
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
    el('div', { class: 'im-pic' }, [x.imageId ? el('img', { src: imgUrl(x.imageId, 'lg'), alt: x.name, loading: 'lazy', title: '눌러서 크게 보기', onclick: (ev) => { ev.stopPropagation(); openImage(x.imageId, x.name, [x.note, who].filter(Boolean).join(' · ')); } }) : el('span', { html: PIC }), stateOverlay(artTarget(byId(cid), 'item', x.id))]),
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

  // 모음: 페르소나의 모든 편지 묶음 + 모든 물품
  function albumView(list) {
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
      el('h4', { text: `모든 물건 · ${items.length}` }),
      items.length ? el('div', { class: 'im-grid' }, items.map(({ x, c }) => itemCard(x, x.from === 'me' ? `→ ${c.name}` : `${c.name} →`, c.id))) : el('div', { class: 'im-muted', text: '아직 오간 물건이 없습니다.' }),
    ];
  }

  // 우체통 위젯
  const box = el('div', { class: 'im-box', title: '이세계 우체통' });
  let lastDrag = 0;
  try {
    widget = ctx.ui.createFloatWidget({ width: 76, height: 96, initialPosition: { x: Math.max(12, window.innerWidth - 110), y: Math.max(12, window.innerHeight - 190) }, snapToEdge: false, tooltip: '이세계 우체통', chromeless: true });
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
    widget.root.title = [unread ? `새 편지 ${unread}통` : '이세계 우체통', running ? '그림 그리는 중' : '', failed ? '그림 실패 있음' : ''].filter(Boolean).join(' · ');
  }
  views.add({ render: renderWidget });

  const offActivate = tab.onActivate(() => refresh());
  const timer = setInterval(refresh, 60 * 1000);
  refresh();
  renderAll();

  return () => {
    clearInterval(timer);
    clearTimeout(soon);
    offActivate?.();
    offBack?.();
    removeStyle?.();
    widget?.destroy?.();
    panel?.destroy?.();
    tab.destroy();
  };
}
