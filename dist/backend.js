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

  // ── 답장 생성 ──
  // 보내는 사람 이름: 상대에 묶인 페르소나(지금 이름) → 저장해 둔 이름 → 마지막 편지의 이름 → 활성 페르소나
  const personaNameFor = async (user, c) => {
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
    if (!input?.personaId) return { ...input, personaName: '' };
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
      const messages = buildReplyMessages(c, { now: Date.now(), personaName, recent: settings.recentLetters });
      const req = {
        messages,
        parameters: { temperature: settings.temperature, max_tokens: settings.maxTokens },
        userId: user,
      };
      let reply;
      try {
        const res = settings.replyConnectionId
          ? await api.generate.raw({ ...req, connection_id: settings.replyConnectionId })
          : await api.generate.quiet(req);
        reply = cleanReply(parseJsonLoose(res?.content));
      } catch (e) {
        log('warn', `답장 생성 실패(${c.name}): ${e?.message || e}`);
        const after = await mutate(user, id, (cur) => (cur.reply?.state === 'generating' ? markFailed(cur, e) : cur));
        notify(user, { id });
        if (after.reply?.state === 'failed') log('error', `답장 재시도 소진(${c.name})`);
        return;
      }
      await mutate(user, id, (cur) => (cur.reply?.state === 'generating' ? applyReply(cur, reply) : cur));
      log('info', `답장 생성 완료 — 배송 시작(${c.name})`);
      notify(user, { id });
    } finally {
      busy.delete(key);
    }
  };

  // ── 시간 진행 ──
  const tickUser = async (user) => {
    const ids = await listIds(user);
    const firstRun = !recovered.has(user);
    recovered.add(user);
    let delivered = 0;
    const toGenerate = [];
    for (const id of ids) {
      if (busy.has(`${user}:${id}`)) continue;
      try {
        await mutate(user, id, (c) => {
          const base = firstRun ? recover(c) : c;
          const r = advance(base, Date.now());
          delivered += r.delivered.length;
          if (r.generate) toGenerate.push(id);
          return r.c;
        });
      } catch (e) { log('warn', `진행 실패(${id}): ${e?.message || e}`); }
    }
    if (delivered) notify(user, { delivered });
    // 생성은 기다리지 않는다(화면 요청이 생성 시간만큼 막히지 않게). 상대별 잠금은 busy가 맡는다.
    for (const id of toGenerate) generateReply(user, id).catch((e) => log('error', `생성 오류: ${e?.message || e}`));
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
        const input = p.input && 'personaId' in p.input ? await withPersonaName(user, p.input) : p.input;
        const c = await mutate(user, p.id, (c) => updateCorrespondent(c, input, now));
        return { c: publicView(c, now) };
      }
      case 'delete': {
        await serial(user, () => api.userStorage.delete(cPath(p.id), user));
        return {};
      }
      case 'send': {
        const personaName = await personaNameFor(user, await loadC(user, p.id));
        const c = await mutate(user, p.id, (c) => sendLetter(c, { body: p.body, enclosure: p.enclosure, personaName }, now));
        return { c: publicView(c, now) };
      }
      case 'recall': {
        const c = await mutate(user, p.id, (c) => recallLetter(c, p.letterId, now));
        return { c: publicView(c, now) };
      }
      case 'open': {
        const c = await mutate(user, p.id, (c) => markOpened(c, p.letterId, now));
        return { c: publicView(c, now) };
      }
      case 'retry': {
        await mutate(user, p.id, (c) => retryReply(c, now));
        tickUser(user).catch(() => {});
        return {};
      }
      case 'connections': {
        const list = await api.connections.list(user);
        return { connections: (list || []).map((x) => ({ id: x.id, name: x.name, provider: x.provider, model: x.model, is_default: !!x.is_default })) };
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
