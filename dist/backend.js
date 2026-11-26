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
    // 매칭으로 만든 상대: 앱의 캐릭터·로어북과 우편 설정
    characterId: str(p?.characterId, 200),
    worldBookId: str(p?.worldBookId, 200),
    origin: ['manual', 'prompt', 'random', 'existing'].includes(p?.origin) ? p.origin : 'manual',
    mail: cleanMail(p?.mail),
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
    characterId: c.characterId || '', worldBookId: c.worldBookId || '', origin: c.origin || 'manual', mail: c.mail || {},
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

export function buildReplyMessages(c, { now = Date.now(), personaName = '', recent = RECENT_LETTERS, lore = '' } = {}) {
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
  const loreFor = async (user, c) => {
    const ids = new Set(c.worldBookId ? [c.worldBookId] : []);
    if (c.characterId) {
      try { for (const id of (await api.characters.get(c.characterId, user))?.world_book_ids || []) ids.add(id); } catch {}
    }
    if (!ids.size) return '';
    const entries = [];
    for (const id of ids) { try { entries.push(...await listEntries(user, id)); } catch {} }
    const recent = c.letters.slice(-4).map((l) => `${l.body || ''}\n${l.ps || ''}\n${l.enclosure || ''}`).join('\n');
    return pickLore(entries, recent).text;
  };

  // ── 상대 만들기(매칭) ──
  const genJson = async (user, messages, settings) => {
    const req = { messages, parameters: { temperature: settings.createTemperature, max_tokens: Math.max(settings.maxTokens, 8000) }, userId: user };
    const conn = settings.createConnectionId || settings.replyConnectionId;
    const res = conn ? await api.generate.raw({ ...req, connection_id: conn }) : await api.generate.quiet(req);
    return parseJsonLoose(res?.content);
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
    try { personaName = p.personaId ? (await api.personas.get(p.personaId, user))?.name || '' : (await api.personas.getActive(user))?.name || ''; } catch {}
    let existing = null;
    if (mode === 'existing') {
      if (!p.characterId) throw new Error('캐릭터를 골라 주세요.');
      existing = await existingInfo(user, p.characterId);
    }
    const dice = mode === 'random' ? (String(p.dice || '').trim() || GENRE_DICE[Math.floor(Math.random() * GENRE_DICE.length)]) : '';
    const firstBy = p.firstBy === 'me' ? 'me' : 'them';
    const messages = buildMatchMessages({
      mode, request: String(p.request || '').slice(0, 4000), dice, exclude: String(p.exclude || '').slice(0, 500),
      existing: existing && { card: existing.card, lore: existing.lore }, personaName, firstBy, ranges: p.ranges || null,
    });
    const raw = await genJson(user, messages, settings);
    const draft = cleanMatchDraft(raw, { mode, ranges: p.ranges || null, existingName: existing?.ch?.name || '', personaName });
    return { draft: { ...draft, dice, firstBy, characterId: existing?.ch?.id || '' } };
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
      const persona = p.personaId ? await api.personas.get(p.personaId, user).catch(() => null) : null;
      let c = createCorrespondent({
        name: d.name, brief, world: '', ratio: d.mail.ratio,
        deliveryMin: d.mail.deliveryMin, deliveryMax: d.mail.deliveryMax, writeMin: d.mail.writeMin, writeMax: d.mail.writeMax,
        maxReplyRealHours: p.maxReplyRealHours ?? 24, timeScale: p.timeScale ?? 1,
        personaId: persona?.id || '', personaName: persona?.name || '',
        characterId: charId, worldBookId: book.id, origin: mode, mail: d.mail,
      }, now);
      if (d.firstLetter) c = applyReply(c, firstLetterReply(d.firstLetter), now);
      await serial(user, () => saveC(user, c));
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
      const lore = await loreFor(user, c).catch((e) => { log('warn', `로어북 읽기 실패(${c.name}): ${e?.message || e}`); return ''; });
      const messages = buildReplyMessages(c, { now: Date.now(), personaName, recent: settings.recentLetters, lore });
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
