import {
  cleanSettings, createCorrespondent, updateCorrespondent, toInput, sendLetter, recallLetter, markOpened,
  advance, recover, markGenerating, markFailed, retryReply, applyReply,
  parseJsonLoose, cleanReply, buildReplyMessages, summarize, publicView, MINUTE,
} from './core.js';
import {
  MATCH_MODES, GENRE_DICE, buildMatchMessages, cleanMatchDraft, cleanEditedDraft, briefFromCard, entryInput, pickLore, firstLetterReply,
} from './match.js';

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
    const draft = cleanMatchDraft(raw, { mode, ranges: p.ranges || null, existingName: existing?.ch?.name || '' });
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
