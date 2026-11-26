import { formatTheirTime, formatSpan, parseJsonLoose, normalize } from './core.js';

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

const ORG_SHAPE = '{"summaries":[{"letter_id":"","text":""}],"ledger":{"called_me":"","called_them":"","stage":"","mood":"","promises_add":[{"who":"me|them","what":"","when":""}],"promises_done":[""],"questions_add":[{"who":"me|them","q":""}],"questions_answered":[""],"dates_add":[""],"knows_about_me_add":[""],"i_know_add":[""]},"timeline_add":[{"when":"","event":"","open":true}],"timeline_close":[""],"lore_add":[{"title":"","keys":[""],"content":""}],"lore_edit":[{"title":"","after":"","reason":""}],"card":[{"field":"","value":"","reason":""}],"conflicts":[{"target":"","why":""}],"chapter":""}';

export function buildOrganizeMessages(c, { letterIds, personaName = '', loreTitles = [], cardText = '', chapterDue = false }) {
  c = ensureMemory(c);
  const userName = personaName || c.personaName || '편지의 주인';
  const set = new Set(letterIds);
  const letters = c.letters.filter((l) => set.has(l.id));
  const fmt = (l) => {
    const who = l.from === 'me' ? '{{user}}' : c.name;
    const when = l.from === 'me' ? formatTheirTime(l.theirArriveAt) : formatTheirTime(l.theirWrittenAt);
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
    const row = { letterId: l.id, from: l.from, when: formatTheirTime(l.from === 'me' ? l.theirArriveAt : l.theirWrittenAt), text: s.text };
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
