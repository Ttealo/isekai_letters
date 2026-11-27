import {
  cleanSettings, createCorrespondent, updateCorrespondent, toInput, sendLetter, recallLetter, markOpened,
  advance, recover, markGenerating, markFailed, retryReply, applyReply, initiativeCheck, startInitiative, cleanCalendar, shiftCalendarStart, calendarDate,
  parseJsonLoose, imageIdsOf, editLetter, cleanReply, buildReplyMessages, summarize, publicView, MINUTE,
} from './core.js';
import {
  MATCH_MODES, rollMatch, rollText, buildMatchMessages, buildCalendarMessages, calendarFromRaw, cleanMatchDraft, cleanEditedDraft, briefFromCard, entryInput, pickLore, firstLetterReply,
} from './match.js';
import { cleanPortrait, buildPortraitMessages, cleanPortraitPrompt, composePortrait, buildSceneMessages, cleanScenePrompt, composeScene, isPictureItem } from './portrait.js';
import { cleanTheme, defaultTheme, buildThemeMessages } from './paper.js';
import {
  ensureMemory, memoryLayers, cleanBudgets, buildOrganizeMessages, cleanOrganize, applyMemory, planChanges, addChanges, setChange,
  queueOrganize, chapterDue, readCardField, setCardField, approxTokens, MODES, CARD_FIELDS,
} from './memory.js';
import {
  ART_KINDS, setKinds, isPostcard, artParamAttempts, isParamRejection, modelFor, cleanArt, dayKey, artChangeJobs, quotaLeft, useQuota, buildArtPromptMessages, cleanArtPrompts, composePrompt, ensureArt,
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
    // 자동: 원래 연결과 공급자가 다르고 모델 이름이 같은 연결(어느 공급자든). 고른 연결이 있으면 그것
    if (!primary || !primary.model) return null;
    return list.find((x) => x.id !== primary.id && x.provider !== primary.provider && baseModel(x.model) === baseModel(primary.model)) || null;
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
