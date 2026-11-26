import {
  cleanSettings, createCorrespondent, updateCorrespondent, toInput, sendLetter, recallLetter, markOpened,
  advance, recover, markGenerating, markFailed, retryReply, applyReply,
  parseJsonLoose, cleanReply, buildReplyMessages, summarize, publicView, MINUTE,
} from './core.js';
import {
  MATCH_MODES, GENRE_DICE, buildMatchMessages, cleanMatchDraft, cleanEditedDraft, briefFromCard, entryInput, pickLore, firstLetterReply,
} from './match.js';
import {
  ensureMemory, memoryLayers, cleanBudgets, buildOrganizeMessages, cleanOrganize, applyMemory, planChanges, addChanges, setChange,
  queueOrganize, chapterDue, readCardField, setCardField, approxTokens, MODES, CARD_FIELDS,
} from './memory.js';
import {
  ART_KINDS, artParamAttempts, isParamRejection, modelFor, cleanArt, quotaLeft, useQuota, buildArtPromptMessages, cleanArtPrompts, composePrompt, ensureArt,
} from './art.js';

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
    const left = quotaLeft(await readUsage(user), art);
    if (left < jobs.length) throw new Error(`오늘 그릴 수 있는 그림이 ${left}장 남았습니다(필요 ${jobs.length}장). 설정에서 하루 상한을 바꿀 수 있습니다.`);
    drawing.add(key);
    await mutate(user, id, (c) => ({ ...ensureArt(c), artJob: { state: 'running', total: jobs.length, done: 0, error: '', at: Date.now() } }));
    notify(user, { id });
    const run = async () => {
      let done = 0;
      const errors = [];
      try {
        const c0 = await loadC(user, id);
        const named = jobs.map((j, i) => {
          const it = j.kind === 'item' ? (c0.items || []).find((x) => x.id === j.itemId) : null;
          return { ...j, key: `k${i}`, name: it?.name, note: it?.note };
        });
        const raw = await genJson(user, buildArtPromptMessages(c0, named), { ...settings, createConnectionId: settings.organizeConnectionId || settings.createConnectionId, createTemperature: 0.7 });
        const prompts = cleanArtPrompts(raw, named.map((j) => j.key));
        for (const j of named) {
          const subject = prompts[j.key] || (j.kind === 'item' ? j.name : '');
          if (!subject) { errors.push(`${j.kind}: 주제를 못 받음`); continue; }
          const prompt = composePrompt(j.kind, subject, art);
          try {
            // 모델이 값을 거절하면(금지어·크기) 하나씩 빼고 다시
            let res;
            let lastErr;
            for (const parameters of artParamAttempts(j.kind === 'paper' ? art.paperSize : art.size, art)) {
              try {
                res = await api.imageGen.generate({
                  prompt, connection_id: art.connectionId || undefined, model: modelFor(art, j.kind) || undefined,
                  parameters, includeDataUrl: false, owner_character_id: c0.characterId || undefined, userId: user,
                });
                break;
              } catch (e) {
                lastErr = e;
                if (!isParamRejection(e)) break;
              }
            }
            if (!res) throw lastErr || new Error('그림을 만들지 못했습니다.');
            if (!res?.imageId) throw new Error('이미지 id가 없습니다.');
            await serial(user, async () => {
              await api.userStorage.setJson(USAGE, useQuota(await readUsage(user), 1), { userId: user });
            });
            await mutate(user, id, (c) => {
              c = ensureArt(c);
              const rec = { imageId: res.imageId, prompt, at: Date.now() };
              const next = j.kind === 'item'
                ? { ...c, items: c.items.map((x) => (x.id === j.itemId ? { ...x, imageId: res.imageId, imagePrompt: prompt } : x)) }
                : { ...c, art: { ...c.art, [j.kind]: rec } };
              return { ...next, artJob: { ...(c.artJob || {}), done: ++done } };
            });
            await pushWebp(user, [{ cid: id, imageId: res.imageId, tries: 0 }]);
            notify(user, { id });
          } catch (e) {
            errors.push(`${j.kind}: ${e?.message || e}`);
          }
        }
      } catch (e) {
        errors.push(String(e?.message || e));
      } finally {
        drawing.delete(key);
        await mutate(user, id, (c) => ({ ...c, artJob: errors.length ? { state: 'failed', total: jobs.length, done, error: errors.join(' / ').slice(0, 500), at: Date.now() } : null })).catch(() => {});
        if (errors.length) log('warn', `그림 일부 실패: ${errors.join(' / ')}`);
        notify(user, { id });
      }
    };
    run();
    return { started: jobs.length, left: left - jobs.length, quiet };
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
        const art = Object.fromEntries(Object.entries(c.art).map(([k, v]) => [k, v?.imageId === p.imageId ? { ...v, imageId: up.id, webp: true } : v]));
        const items = (c.items || []).map((x) => (x.imageId === p.imageId ? { ...x, imageId: up.id } : x));
        return { ...c, art, items };
      });
    }
    try { await api.images.delete(p.imageId, user); } catch {}
    await serial(user, async () => {
      const cur = await readJson(WEBP, user, []);
      await api.userStorage.setJson(WEBP, cur.filter((x) => x.imageId !== p.imageId), { userId: user });
    });
    if (c0) notify(user, { id: row.cid });
    return { id: up.id, before: Number(p.originalBytes) || 0, after: bytes.length };
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
        const res = conn ? await api.generate.raw({ ...req, connection_id: conn }) : await api.generate.quiet(req);
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
      log('info', `정리 완료(${c.name}): 변경 ${applyIds.length}건 자동 적용`);
      notify(user, { id });
    } finally {
      organizing.delete(key);
    }
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
      const budgets = cleanBudgets(settings.budgets);
      const lore = await loreFor(user, c, budgets.loreChars).catch((e) => { log('warn', `로어북 읽기 실패(${c.name}): ${e?.message || e}`); return { text: '' }; });
      const memory = memoryLayers(c, { budgets, recentLetters: settings.recentLetters });
      const messages = buildReplyMessages(c, { now: Date.now(), personaName, recent: settings.recentLetters, lore: lore.text, memory });
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
      await mutate(user, id, async (cur) => {
        if (cur.reply?.state !== 'generating') return cur;
        const answered = cur.reply.forLetterIds || [];
        const next = applyReply(cur, reply);
        const newId = next.letters[next.letters.length - 1].id;
        return settings.organizeEnabled ? queueOrganize(next, [...answered, newId]) : next;
      });
      log('info', `답장 생성 완료 — 배송 시작(${c.name})`);
      if (cleanArt(settings.art).autoItems === 'all' && reply.enclosures?.length) {
        const cur = await loadC(user, id);
        const last = cur.letters[cur.letters.length - 1];
        const its = (cur.items || []).filter((x) => x.letterId === last.id && !x.imageId).map((x) => ({ kind: 'item', itemId: x.id }));
        if (its.length) drawArt(user, id, its).catch((e) => log('info', `물건 자동 그림 건너뜀: ${e?.message || e}`));
      }
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
    const toOrganize = [];
    for (const id of ids) {
      if (busy.has(`${user}:${id}`)) continue;
      try {
        await mutate(user, id, (c) => {
          let base = firstRun ? recover(c) : c;
          if (firstRun && base.organize?.state === 'generating') base = { ...base, organize: { ...base.organize, state: 'waiting', nextTryAt: 0 } };
          const r = advance(base, Date.now());
          delivered += r.delivered.length;
          if (r.generate) toGenerate.push(id);
          const o = r.c.organize;
          if (o?.state === 'waiting' && Date.now() >= (o.nextTryAt || 0) && !r.generate) toOrganize.push(id);
          return r.c;
        });
      } catch (e) { log('warn', `진행 실패(${id}): ${e?.message || e}`); }
    }
    if (delivered) notify(user, { delivered });
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
        const messages = buildReplyMessages(sim, { now: Date.now(), personaName, recent: settings.recentLetters, lore: lore.text, memory });
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
      case 'drawSet': {
        const c = ensureArt(await loadC(user, p.id));
        const kinds = (Array.isArray(p.kinds) ? p.kinds : ART_KINDS).filter((k) => ART_KINDS.includes(k));
        if (!kinds.length) throw new Error('그릴 것이 없습니다.');
        return drawArt(user, c.id, kinds.map((kind) => ({ kind })));
      }
      case 'drawItem': {
        const c = await loadC(user, p.id);
        const it = (c.items || []).find((x) => x.id === p.itemId);
        if (!it) throw new Error('물건을 찾지 못했습니다.');
        if (it.from === 'them' && it.state === 'in_transit') throw new Error('아직 도착하지 않은 물건입니다.');
        return drawArt(user, c.id, [{ kind: 'item', itemId: it.id }]);
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
