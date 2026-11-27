// 내 세계: 페르소나가 사는 세계(로어북·달력)와 내 쪽 연대기, 시간 감기. 페르소나 없음(진짜 나)에는 없다.
import { cleanCalendar } from './core.js';
import { calendarFromRaw } from './match.js';

// 상대는 내 세계를 모른다 — 내가 편지에 쓴 만큼만. 이 기록은 내 쪽 사건·마무리·내 쪽 연대기에만 쓰인다.

const ws = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const warr = (v, max, fn) => (Array.isArray(v) ? v : []).map(fn).filter(Boolean).slice(0, max);

export function cleanWorld(w) {
  if (!w || typeof w !== 'object' || !w.startAt) return null;
  return {
    bookId: ws(w.bookId, 80),
    bookName: ws(w.bookName, 120),
    linked: w.linked === 'persona' ? 'persona' : 'created',
    calendar: cleanCalendar(w.calendar),
    startAt: Number(w.startAt) || 0,
    skipHours: Math.max(0, Number(w.skipHours) || 0),
    lifeMode: w.lifeMode === 'manual' ? 'manual' : 'auto',
    lifeAt: Math.max(0, Number(w.lifeAt) || 0), // 내 쪽 시각(시간) — 여기까지 연대기를 썼다
    life: warr(w.life, 120, (e) => (ws(e?.event, 600) ? { when: ws(e.when, 80), event: ws(e.event, 600), open: !!e.open, myAt: Number(e.myAt) || 0, by: ws(e.by, 20), at: Number(e.at) || 0 } : null)),
  };
}

// 초안: 페르소나 설명(+붙어 있는 로어북)으로 빠진 로어북 항목과 달력
export function buildWorldDraftMessages(persona, { existing = '', existingTitles = [] } = {}) {
  const system = [
    'You build the home world of a letter writer (a roleplay persona) as lorebook entries, so their own side of life can go on while they exchange letters with someone from another world.',
    'Base everything on the persona sheet (and the existing lorebook if given). Do not change who the persona is. Do not decide their feelings or choices.',
    'Write in Korean.',
  ].join('\n');
  const user = [
    `<persona name="${persona.name || ''}">\n${String(persona.card || '').slice(0, 3000)}\n</persona>`,
    existing ? `<existing_lorebook>\n${existing.slice(0, 4000)}\n</existing_lorebook>\nAdd only what is missing; never repeat these titles: ${existingTitles.join(' / ')}` : '',
    'Make 4~8 entries: "세계 개요" (the world and era, if not existing), "사는 곳" (home and neighborhood), 2~4 people around them (family, neighbors, coworkers, friends — name, relation, one habit), and 0~2 places or customs that daily life touches.',
    'calendar: if the persona lives in present-day Earth or a world using the real calendar, "real": true. Otherwise design that world\'s calendar (day_hours, 4~16 months or seasons with days, year_label, start_year, start_month name, start_day = today there).',
    'Output JSON only: {"entries":[{"title":"","keys":[""],"content":""}],"calendar":{"real":true,"day_hours":24,"months":[{"name":"","days":30}],"year_label":"","start_year":1,"start_month":"","start_day":1}}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function cleanWorldDraft(raw) {
  const entries = warr(raw?.entries, 12, (e) => (ws(e?.title, 80) && ws(e?.content, 3000) ? { title: ws(e.title, 80), keys: warr(e?.keys, 6, (k) => ws(k, 40) || null), content: ws(e.content, 3000), constant: /세계 개요/.test(e.title) } : null));
  const cr = raw?.calendar || {};
  const calendar = cr.real ? null : calendarFromRaw(cr);
  if (!entries.length && !calendar) throw new Error('내 세계 초안이 비어 있습니다.');
  return { entries, calendar };
}

// 내 쪽 연대기: 흐른 시간 동안 내 주변에 일어난 일(페르소나의 말·감정·선택은 정하지 않음)
export function buildLifeMessages(persona, { worldText = '', life = [], spanHours = 24, fromLabel = '', toLabel = '', letters = '', events = '' } = {}) {
  const pName = persona.name || 'the letter writer';
  const system = [
    `You keep the chronicle of ${pName}'s own world — the side of life that goes on around them while they exchange letters with someone from another world.`,
    `Write what happened AROUND ${pName} during the given span: people around them, places, weather, work, small and occasionally larger happenings. Scale to the span (a few hours = 0~1 small thing; days = 1~3; weeks or more = 2~5, coarser).`,
    `Never decide ${pName}'s own words, feelings or choices; stay consistent with their world and with what they wrote in their letters. Some events may stay open (ongoing).`,
    'Write in Korean.',
  ].join('\n');
  const user = [
    `<persona name="${pName}">\n${String(persona.card || '').slice(0, 2000)}\n</persona>`,
    worldText ? `<world>\n${worldText.slice(0, 3000)}\n</world>` : '',
    life.length ? `<chronicle_so_far>\n${life.slice(-14).map((e) => `- ${e.open ? '(진행 중) ' : ''}${e.when ? `[${e.when}] ` : ''}${e.event}`).join('\n')}\n</chronicle_so_far>` : '',
    events ? `<recent_events>\n${events.slice(0, 1200)}\n</recent_events>` : '',
    letters ? `<what_${pName}_wrote_lately>\n${letters.slice(0, 2000)}\n</what_${pName}_wrote_lately>` : '',
    `span=${fromLabel || '?'} → ${toLabel || '?'} (${Math.round(spanHours)} hours on ${pName}'s side)`,
    'Output JSON only: {"events":[{"when":"date in the same form as the span","event":"1~3 sentences","open":false}],"close":["exact text of chronicle events that ended"]}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function cleanLife(raw) {
  return {
    add: warr(raw?.events, 6, (e) => (ws(e?.event, 600) ? { when: ws(e?.when, 80), event: ws(e.event, 600), open: !!e?.open } : null)),
    close: warr(raw?.close, 8, (x) => ws(x, 600) || null),
  };
}

// 연대기에 더하고 닫기. myAt = 내 쪽 시각(시간)
export function applyLife(world, { add = [], close = [] }, myAt, by = '') {
  const closed = new Set(close);
  const seen = new Set();
  const life = [...(world.life || []).map((e) => (e.open && closed.has(e.event) ? { ...e, open: false } : e)), ...add.map((e) => ({ ...e, myAt, by, at: Date.now() }))]
    .filter((e) => { if (seen.has(e.event)) return false; seen.add(e.event); return true; })
    .slice(-120);
  return { ...world, life, lifeAt: Math.max(world.lifeAt || 0, myAt) };
}

export function worldLifeText(world, n = 12) {
  return (world?.life || []).slice(-n).map((e) => `- ${e.open ? '(진행 중) ' : ''}${e.when ? `[${e.when}] ` : ''}${e.event}`).join('\n');
}

// 시간 감기: 내 쪽 시간이 ms만큼 앞서 가면, 그 페르소나의 상대마다 그만큼 시간이 흐른 것으로 친다.
// 가는 편지는 그만큼 도착에 가까워지고, 답장·먼저 쓰기 시각도 당겨지고, 그쪽 시계도 비율만큼 흐른다.
// skipAt: 이 시각 전에 쓰였어야 할 답장은 「그때 쓴 편지」로 쳐서 배송을 그만큼 덜 걸리게(생성 때 처리)
export function skipCorrespondent(c, ms, now = Date.now()) {
  if (!ms || c.ended) return c;
  return {
    ...c,
    anchor: c.anchor ? { ...c.anchor, realAt: c.anchor.realAt - ms } : c.anchor,
    letters: (c.letters || []).map((l) => (l.state === 'in_transit' ? { ...l, arriveAt: l.arriveAt - ms } : l)),
    reply: c.reply && c.reply.state !== 'failed' ? { ...c.reply, dueAt: (c.reply.dueAt || now) - ms, nextTryAt: c.reply.nextTryAt ? c.reply.nextTryAt - ms : 0 } : c.reply,
    initiativeAt: c.initiativeAt ? c.initiativeAt - ms : 0,
    skipAt: now,
  };
}

// 감은 시간 안에 쓰였어야 할 답장: 쓰인 시각을 dueAt으로 보고 배송 시간을 그만큼 줄인다
export function settleSkippedLetter(c, letter, dueAt, now = Date.now()) {
  if (!c.skipAt || !dueAt || dueAt >= c.skipAt || dueAt >= now) return letter;
  const early = now - dueAt;
  return { ...letter, arriveAt: Math.max(now, letter.arriveAt - early) };
}
