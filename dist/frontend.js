// 이세계 우체통 공용 로직(백엔드·프런트·테스트가 같이 씀). 의존성 없음, 부수 효과 없음.
// 시각: 현실 시각은 ms(Date.now()), 상대 쪽 시각은 "만난 뒤 흐른 시간(시간 단위, 실수)".

export const HOUR = 3600 * 1000;
export const MINUTE = 60 * 1000;
export const RETRY_MINUTES = [1, 5, 30]; // 생성 실패 시 재시도 간격, 다 쓰면 failed
export const RECENT_LETTERS = 6; // 1단계: 프롬프트에 넣는 최근 원문 통수

export const DEFAULT_SETTINGS = {
  replyConnectionId: '', // 비면 사용자의 기본 연결(quiet)
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
    temperature: num(s?.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    maxTokens: Math.round(num(s?.maxTokens, 500, 32000, DEFAULT_SETTINGS.maxTokens)),
    recentLetters: Math.round(num(s?.recentLetters, 1, 20, RECENT_LETTERS)),
    showExactEta: !!s?.showExactEta,
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
export function formatTheirTime(theirHours) {
  const h = Math.max(0, theirHours);
  const day = Math.floor(h / 24) + 1;
  const hour = Math.floor(h % 24);
  const part = hour < 5 ? '깊은 밤' : hour < 9 ? '새벽' : hour < 12 ? '아침' : hour < 14 ? '한낮' : hour < 18 ? '오후' : hour < 21 ? '저녁' : '밤';
  return `만난 지 ${day}일째 ${part}`;
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
  return { ...c, letters: [...c.letters, letter], items: [...c.items, ...names.map((n, i) => makeItem(letter, n, '', i))] };
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
    const head = `[{{user}} → ${c.name}] 보낸 날(그쪽 기준) ${formatTheirTime(l.theirSentAt)} / 도착 ${formatTheirTime(l.theirArriveAt)}`;
    const enc = l.enclosures?.length ? l.enclosures.map((x) => x.item).join(', ') : l.enclosure;
    return `${head}\n${l.body}${enc ? `\n(동봉: ${enc})` : ''}`;
  }
  const head = `[${c.name} → {{user}}] 쓴 날 ${formatTheirTime(l.theirWrittenAt)}`;
  return `${head}\n${l.body}${l.ps ? `\n추신: ${l.ps}` : ''}${l.enclosures?.length ? `\n(동봉: ${l.enclosures.map((x) => x.item).join(', ')})` : ''}`;
};

export function buildReplyMessages(c, { now = Date.now(), personaName = '', recent = RECENT_LETTERS } = {}) {
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
    c.world ? `\n<world>\n${c.world}\n</world>` : '',
    '',
    '<correspondence>',
    `their_now=${formatTheirTime(tNow)}`,
    `days_since_first_contact=${Math.floor(tNow / 24) + 1}`,
    `ratio=1:${c.ratio} (your time / {{user}}'s time; ${c.ratio > 1 ? `one day for {{user}} is ${formatSpan(24 * c.ratio)} for you` : c.ratio < 1 ? `one day for {{user}} is only ${formatSpan(24 * c.ratio)} for you` : 'same speed'})`,
    `letters_arrived=${unanswered.length}통, first arrived ${formatTheirTime(firstArrival)}`,
    `time_since_arrival=${formatSpan(tNow - firstArrival)} (everything in \`between\` happened within this span)`,
    lastTheirs ? `since_your_last_letter=${formatSpan(tNow - lastTheirs.theirWrittenAt)} (exactly; do not exaggerate)` : 'first_reply=yes (this is your first letter to {{user}})',
    gifts.length ? `gifts_exchanged=\n${gifts.map((g) => `- ${g}`).join('\n')}` : '',
    `knows_about_user=only what their letters said; their name is ${userName}`,
    omitted > 0 ? `older_letters_omitted=${omitted}통 (not shown here)` : '',
    '</correspondence>',
    '',
    '<task>',
    '1. First write `between`: what happened to you from receiving the letter until finishing this reply, in your own time. Scale detail to the elapsed time; summarize long spans coarsely. Include at least one sensory detail per event.',
    '2. Then write the letter. Let only some of `between` show through, the way people actually write letters: hints, omissions, a shaky hand.',
    '3. Respond to what {{user}} actually wrote. Answer or deliberately avoid their questions.',
    '4. The letter must feel like a physical object from your world: describe `envelope` and any `enclosures` in concrete sensory terms.',
    '5. Stay consistent with the character and world above. New facts are allowed when they follow from events.',
    '6. Time is fixed by <correspondence>. `read_at`, `written_at`, and every `their_date` must fall between the first arrival and their_now, written like their_now ("만난 지 N일째 …"). When mentioning how long you waited or how many days passed, use only those numbers.',
    'Output JSON only, in Korean, with this shape:',
    '{"between":[{"their_date":"","event":"","senses":"","open":false}],"read_at":"","written_at":"","envelope":{"medium":"","texture":"","scent":"","marks":"","seal":"","stamp":""},"enclosures":[{"item":"","note":""}],"body":"","ps":""}',
    '</task>',
  ].filter((x) => x !== '').join('\n').replaceAll('{{user}}', userName);

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
    id: c.id, name: c.name, ratio: c.ratio, theirNow: formatTheirTime(tNow),
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
      return { ...x, theirLabel: l ? formatTheirTime(l.from === 'me' ? l.theirSentAt : l.theirWrittenAt) : '' };
    }),
    theirNowLabel: formatTheirTime(theirNow(c, now)),
    letters: c.letters.map((l) => {
      if (l.from === 'them' && l.state === 'in_transit') return { id: l.id, from: 'them', state: 'in_transit', sentAt: l.sentAt, arriveAt: l.arriveAt };
      if (l.from === 'them') {
        const { between, ...rest } = l; // 사이 일지는 상대의 사정 — 화면에는 내지 않는다(3단계 연대기에서 일부 공개)
        return { ...rest, theirWrittenLabel: formatTheirTime(l.theirWrittenAt) };
      }
      return { ...l, theirSentLabel: formatTheirTime(l.theirSentAt), theirArriveLabel: formatTheirTime(l.theirArriveAt) };
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
.im-item .im-cap{padding:6px 8px;font-size:12px;line-height:1.4}
.im-item .im-cap b{display:block;font-size:12.5px}
.im-bundle{display:flex;gap:10px;align-items:center;border:1px solid var(--lumiverse-border);border-radius:8px;padding:10px;cursor:pointer;background:var(--lumiverse-fill-subtle,transparent)}
.im-bundle:hover{border-color:var(--lumiverse-primary)}
.im-bundle .im-stack{width:44px;height:36px;position:relative;flex:none}
.im-bundle .im-stack i{position:absolute;inset:0;border:1px solid #cdb68e;background:#f4ead6;border-radius:2px}
.im-bundle .im-stack i:nth-child(1){transform:rotate(-8deg)}
.im-bundle .im-stack i:nth-child(2){transform:rotate(5deg)}
.im-sep{border:none;border-top:1px solid var(--lumiverse-border);margin:4px 0}
.im-box{cursor:pointer;user-select:none;width:76px;height:96px;display:block}
.im-box svg{display:block;filter:drop-shadow(0 3px 4px #0005)}
.im-note{position:absolute;right:0;bottom:100%;margin-bottom:6px;white-space:nowrap;background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:6px;padding:4px 8px;font-size:11px;pointer-events:none}
`;
const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/><path d="M15 3.5l2 1.2"/></svg>';
const PIC = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z"/></svg>';
const NO_PERSONA = '__none__';
const ALL = '__all__';
const LS_PERSONA = 'isekai_mailbox.persona';
const LS_PANEL = 'isekai_mailbox.panel';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // 우리 코드의 고정 SVG에만 쓴다
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.setAttribute('style', v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}
const btn = (text, onclick, opts = {}) => el('button', { class: `im-btn${opts.primary ? ' im-primary' : ''}`, type: 'button', text, disabled: !!opts.disabled, onclick });
const link = (text, onclick) => el('button', { class: 'im-link', type: 'button', text, onclick });
const field = (label, input) => el('label', {}, [label, input]);
const when = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    } catch (e) { S.error = e.message || String(e); }
    const unread = S.list.reduce((n, x) => n + x.unread, 0);
    tab.setBadge(unread ? String(unread) : null);
    renderAll();
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
  const removeStyle = typeof ctx.dom?.addStyle === 'function' ? ctx.dom.addStyle(CSS) : null;
  if (!removeStyle) tab.root.append(el('style', { text: CSS }));
  const root = el('div', { class: 'im-tab' });
  tab.root.append(root);

  const drawer = (() => {
    let view = { name: 'home' };
    let busy = false;
    let error = '';
    let connections = null;
    const go = (v) => { view = v; error = ''; render(); if (v.name === 'home' || v.name === 'c') refresh(); };
    const act = async (fn) => {
      if (busy) return;
      busy = true; error = ''; render();
      try { await fn(); } catch (e) { error = e.message || String(e); }
      busy = false; render();
    };

    function render() {
      const body = { home: homeView, c: cView, letter: letterView, form: formView, settings: settingsView }[view.name]?.() || [];
      const err = error || S.error;
      root.replaceChildren(...[].concat(body, err ? el('div', { class: 'im-err', text: err }) : null).filter(Boolean));
    }

    function homeView() {
      const shown = S.list.filter(inPersona);
      return [
        el('div', { class: 'im-row' }, [
          el('h3', { class: 'im-grow', text: '우편함' }),
          btn('새 상대', async () => { await reloadPersonas(); go({ name: 'form' }); }, { primary: true }),
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
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' })), el('span', { class: 'im-grow' }), panel ? link('편지첩으로 보기', () => openPanelFor(c.id)) : null, link('상대 정보 수정', async () => { await reloadPersonas(); go({ name: 'form', id: c.id }); })]),
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
        writeMin: cur.writeDelay.min, writeMax: cur.writeDelay.max, maxReplyRealHours: cur.maxReplyRealHours, timeScale: cur.timeScale || 1, personaId: cur.personaId || '',
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
      const maxT = el('input', { type: 'number', step: '100', min: '500', value: String(s.maxTokens ?? 6000) });
      const recent = el('input', { type: 'number', step: '1', min: '1', max: '20', value: String(s.recentLetters ?? 6) });
      const exact = el('input', { type: 'checkbox', checked: !!s.showExactEta, style: 'width:auto' });
      return [
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' }))]),
        el('h3', { text: '설정' }),
        field('답장 쓰기 연결', sel),
        el('div', { class: 'im-pair' }, [field('온도', temp), field('최대 출력 토큰', maxT)]),
        field('프롬프트에 넣는 최근 편지 수(양쪽 합)', recent),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [exact, '배송 중 남은 시간을 분 단위로 보기']),
        el('div', { class: 'im-muted', text: '연결에 붙은 프리셋은 쓰지 않고, 우체통이 자기 지시문과 위 값을 보냅니다.' }),
        btn('저장', () => act(async () => {
          S.settings = (await ask('saveSettings', { settings: { replyConnectionId: sel.value, temperature: temp.value, maxTokens: maxT.value, recentLetters: recent.value, showExactEta: exact.checked } })).settings;
          go({ name: 'home' });
        }), { primary: true }),
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
      return el('div', { class: 'im-envelope' }, [
        el('div', { style: 'font-size:12px;color:#7a6a52', text: `${c.name}에게서 · ${when(l.arriveAt)} 도착` }),
        el('dl', { style: 'margin:0' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
        l.enclosures?.length ? el('div', { style: 'font-size:12px;color:#7a6a52', text: `안에 무언가 더 들어 있는 것 같습니다 (${l.enclosures.length})` }) : null,
        btn('봉투 열기', () => act(async () => { await ask('open', { id: c.id, letterId: l.id }); await refresh(); })),
      ]);
    }
    const meta = [l.writtenLabel || l.theirWrittenLabel, e.medium, e.scent].filter(Boolean).join(' · ');
    return el('div', { class: 'im-paper im-theirs' }, [
      el('div', { class: 'im-stamp', title: [e.stamp && `우표: ${e.stamp}`, e.seal && `봉인: ${e.seal}`].filter(Boolean).join('\n') }, [
        l.stampImageId ? el('img', { src: imgUrl(l.stampImageId), alt: '' }) : el('span', { style: 'font-size:18px;line-height:1', text: '✉' }),
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
  try {
    panel = ctx.ui.requestDockPanel({ edge: 'right', title: '이세계 우체통 · 편지첩', size: 440, minSize: 320, maxSize: 760, resizable: true, startCollapsed: true });
    panel.root.append(panelRoot);
    if (!removeStyle) panel.root.append(el('style', { text: CSS }));
    panel.onVisibilityChange?.((visible) => { if (visible) refresh(); renderWidget(); drawer.render(); });
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
      panelRoot.replaceChildren(...[
        personaChips(),
        mine.length ? people : null,
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
    const nodes = c.letters.map((l) => {
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
    });
    return [
      el('div', { class: 'im-muted', text: `${c.personaName ? `${c.personaName} ↔ ` : ''}${c.name} · 그쪽은 지금 ${c.theirNowLabel} · 1:${c.ratio}` }),
      c.reply?.state === 'failed' ? el('div', { class: 'im-row' }, [el('span', { class: 'im-err im-grow', text: `우편 사고: ${c.reply.error || ''}` }), btn('다시 시도', () => act(async () => { await ask('retry', { id: c.id }); await refresh(); }))]) : null,
      c.reply && c.reply.state !== 'failed' ? el('div', { class: 'im-transit im-theirs', text: `${c.name}이(가) 답장을 쓰고 있는 듯합니다` }) : null,
      ...(nodes.length ? nodes : [el('div', { class: 'im-muted', text: '아직 주고받은 편지가 없습니다. 첫 편지를 써 보세요.' })]),
      el('details', { open: !c.letters.length }, [
        el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '편지 쓰기' }),
        composeBox(c, { busyRef: () => P.busy, act }),
      ]),
    ];
  }

  const itemCard = (x, who) => el('div', { class: 'im-item', title: x.note || x.name }, [
    el('div', { class: 'im-pic' }, [x.imageId ? el('img', { src: imgUrl(x.imageId, 'lg'), alt: x.name }) : el('span', { html: PIC })]),
    el('div', { class: 'im-cap' }, [
      el('b', { text: x.name }),
      x.note ? el('div', { class: 'im-muted', text: short(x.note, 60) }) : null,
      el('div', { class: 'im-muted', text: `${who} · ${x.state === 'in_transit' ? '가는 중' : `그쪽 ${x.theirLabel || ''}`}` }),
    ]),
  ]);

  // 물품: 받은 것 / 보낸 것
  function itemsView(c) {
    const got = c.items.filter((x) => x.from === 'them');
    const gave = c.items.filter((x) => x.from === 'me');
    return [
      el('h4', { text: `받은 것 · ${got.length}` }),
      got.length ? el('div', { class: 'im-grid' }, got.slice().reverse().map((x) => itemCard(x, `${c.name}에게서`))) : el('div', { class: 'im-muted', text: '아직 받은 물건이 없습니다.' }),
      el('h4', { text: `보낸 것 · ${gave.length}` }),
      gave.length ? el('div', { class: 'im-grid' }, gave.slice().reverse().map((x) => itemCard(x, `${c.name}에게`))) : el('div', { class: 'im-muted', text: '편지를 쓸 때 「동봉할 것」에 적으면 여기에 남습니다.' }),
      el('div', { class: 'im-muted', text: '물건 그림은 이미지 단계(NanoGPT)가 붙으면 채워집니다.' }),
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
      items.length ? el('div', { class: 'im-grid' }, items.map(({ x, c }) => itemCard(x, x.from === 'me' ? `→ ${c.name}` : `${c.name} →`))) : el('div', { class: 'im-muted', text: '아직 오간 물건이 없습니다.' }),
    ];
  }

  // 우체통 위젯
  const box = el('div', { class: 'im-box', title: '이세계 우체통' });
  let lastDrag = 0;
  try {
    widget = ctx.ui.createFloatWidget({ width: 76, height: 96, initialPosition: { x: Math.max(12, window.innerWidth - 110), y: Math.max(12, window.innerHeight - 190) }, snapToEdge: false, tooltip: '이세계 우체통', chromeless: true });
    widget.root.append(box);
    if (!removeStyle) widget.root.append(el('style', { text: CSS }));
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
    const key = `${unread}|${open}`;
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
    box.style.position = 'relative';
    widget.root.title = unread ? `새 편지 ${unread}통` : '이세계 우체통';
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
