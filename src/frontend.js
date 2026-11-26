import { etaLabel, formatSpan } from './core.js';

// 이세계 우체통 프런트 — 서랍 탭 하나.
// 화면: 우편함(상대 목록) / 상대(편지 묶음 + 쓰기) / 편지 열기(봉투 → 본문) / 새 상대·수정 / 설정
// 모든 글은 textContent로만 넣는다(생성된 글에 HTML이 섞여도 실행되지 않게).

const CSS = `
.im-tab{display:flex;flex-direction:column;gap:12px;padding:12px;color:var(--lumiverse-text);font-size:13px;line-height:1.6}
.im-tab h3{margin:0;font-size:15px}
.im-tab h4{margin:4px 0 0;font-size:13px}
.im-muted{color:var(--lumiverse-text-muted);font-size:12px}
.im-err{color:var(--lumiverse-danger);font-size:12px}
.im-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.im-grow{flex:1}
.im-tab textarea,.im-tab input,.im-tab select{width:100%;box-sizing:border-box;background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,6px);padding:6px 8px;font:inherit}
.im-tab textarea{min-height:90px;resize:vertical}
.im-tab label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--lumiverse-text-muted)}
.im-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.im-btn{background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,6px);padding:5px 12px;cursor:pointer;font:inherit}
.im-btn.im-primary{background:var(--lumiverse-primary);color:#fff;border-color:transparent}
.im-btn:disabled{opacity:.5;cursor:default}
.im-link{background:none;border:none;color:var(--lumiverse-primary);cursor:pointer;padding:0;font:inherit}
.im-card{border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,8px);padding:10px 12px;background:var(--lumiverse-fill-subtle,transparent);cursor:pointer;display:flex;flex-direction:column;gap:2px}
.im-card:hover{border-color:var(--lumiverse-primary)}
.im-badge{display:inline-block;min-width:18px;padding:0 6px;border-radius:9px;background:var(--lumiverse-primary);color:#fff;font-size:11px;text-align:center}
.im-letter{border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,8px);padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.im-letter.im-mine{margin-left:18px;opacity:.92}
.im-letter.im-theirs{margin-right:18px}
.im-paper{font-family:"Nanum Myeongjo","Noto Serif KR",Georgia,serif;white-space:pre-wrap;font-size:14px;line-height:1.85;padding:16px 18px;border-radius:var(--lumiverse-radius,8px);background:color-mix(in srgb,var(--lumiverse-fill) 70%,#c8a46a 12%);border:1px solid color-mix(in srgb,var(--lumiverse-border) 60%,#c8a46a 40%)}
.im-envelope{display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:var(--lumiverse-radius,8px);border:1px dashed color-mix(in srgb,var(--lumiverse-border) 50%,#c8a46a 50%);background:color-mix(in srgb,var(--lumiverse-fill) 80%,#c8a46a 8%)}
.im-envelope dt{font-size:11px;color:var(--lumiverse-text-muted)}
.im-envelope dd{margin:0 0 4px}
.im-sep{border:none;border-top:1px solid var(--lumiverse-border);margin:4px 0}
`;
const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/><path d="M15 3.5l2 1.2"/></svg>';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
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

export function setup(ctx) {
  const waits = new Map();
  let seq = 0;
  const offBack = ctx.onBackendMessage((msg) => {
    if (msg?.type === 'changed' && !msg.requestId) { onChanged(msg); return; }
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

  // 상태
  let view = { name: 'home' };
  let list = [];
  let settings = null;
  let current = null; // 열려 있는 상대(publicView)
  let currentInput = null;
  let error = '';
  let busy = false;
  let draft = { body: '', enclosure: '' };

  const setError = (e) => { error = e ? (e.message || String(e)) : ''; };
  const go = (v) => { view = v; error = ''; render(); };

  async function loadHome() {
    try {
      const r = await ask('load');
      list = r.list;
      settings = r.settings;
      const unread = list.reduce((n, x) => n + x.unread, 0);
      tab.setBadge(unread ? String(unread) : null);
    } catch (e) { setError(e); }
  }
  async function loadC(id) {
    try {
      const r = await ask('get', { id });
      current = r.c;
      currentInput = r.input;
    } catch (e) { setError(e); }
  }
  async function refresh() {
    await loadHome();
    if ((view.name === 'c' || view.name === 'letter') && view.id) await loadC(view.id);
    render();
  }
  function onChanged() { refresh(); }
  const offActivate = tab.onActivate(() => refresh());
  const timer = setInterval(() => { if (view.name === 'c' || view.name === 'home') refresh(); }, 60 * 1000);

  const act = async (fn) => {
    if (busy) return;
    busy = true; setError(null); render();
    try { await fn(); } catch (e) { setError(e); }
    busy = false; render();
  };

  // ── 화면 ──
  function render() {
    const body = { home: homeView, c: cView, letter: letterView, form: formView, settings: settingsView }[view.name]?.() || [];
    root.replaceChildren(...[].concat(body, error ? el('div', { class: 'im-err', text: error }) : null).filter(Boolean));
  }

  function homeView() {
    return [
      el('div', { class: 'im-row' }, [
        el('h3', { class: 'im-grow', text: '우편함' }),
        btn('새 상대', () => { currentInput = null; go({ name: 'form' }); }, { primary: true }),
        btn('설정', () => go({ name: 'settings' })),
      ]),
      list.length ? null : el('div', { class: 'im-muted', text: '아직 편지를 주고받는 상대가 없습니다. 「새 상대」에서 누구에게 편지를 보낼지 적어 주세요.' }),
      ...list.map((x) => el('div', { class: 'im-card', onclick: () => openC(x.id) }, [
        el('div', { class: 'im-row' }, [
          el('b', { class: 'im-grow', text: x.name }),
          x.unread ? el('span', { class: 'im-badge', text: String(x.unread) }) : null,
        ]),
        el('div', { class: 'im-muted', text: `그쪽은 지금 ${x.theirNow} · 시간 1:${x.ratio}` }),
        el('div', { class: x.failed ? 'im-err' : 'im-muted', text: x.status }),
      ])),
    ];
  }

  async function openC(id) {
    view = { name: 'c', id };
    draft = { body: '', enclosure: '' };
    await loadC(id);
    render();
  }

  function cView() {
    const c = current;
    if (!c || c.id !== view.id) return [el('div', { class: 'im-muted', text: '불러오는 중…' })];
    const now = Date.now();
    const exact = !!settings?.showExactEta;
    const items = c.letters.slice().reverse().map((l) => {
      if (l.from === 'me') {
        return el('div', { class: 'im-letter im-mine' }, [
          el('div', { class: 'im-muted', text: `보낸 편지 · ${when(l.sentAt)} · 그쪽 ${l.theirSentLabel}` }),
          el('div', { text: l.body.length > 140 ? `${l.body.slice(0, 140)}…` : l.body }),
          l.state === 'in_transit'
            ? el('div', { class: 'im-row' }, [el('span', { class: 'im-muted im-grow', text: etaLabel(l.arriveAt - now, exact) }), link('회수하기', () => act(async () => {
              if (!confirm('이 편지를 회수할까요? 상대에게 가지 않습니다.')) return;
              current = (await ask('recall', { id: c.id, letterId: l.id })).c;
              await loadHome();
            }))])
            : el('div', { class: 'im-muted', text: `도착함 · 그쪽 ${l.theirArriveLabel}` }),
        ]);
      }
      if (l.state === 'in_transit') {
        return el('div', { class: 'im-letter im-theirs' }, [
          el('div', { class: 'im-muted', text: `${c.name}의 편지가 오는 중` }),
          el('div', { text: exact ? etaLabel(l.arriveAt - now, true) : '어딘가를 건너는 중…' }),
        ]);
      }
      return el('div', { class: 'im-letter im-theirs', onclick: () => openLetter(l.id) }, [
        el('div', { class: 'im-row' }, [
          el('b', { class: 'im-grow', text: l.state === 'delivered' ? '새 편지' : `${c.name}의 편지` }),
          l.state === 'delivered' ? el('span', { class: 'im-badge', text: '!' }) : null,
        ]),
        el('div', { class: 'im-muted', text: `도착 ${when(l.arriveAt)} · 그쪽 ${l.theirWrittenLabel}에 씀` }),
        l.state === 'opened' ? el('div', { text: l.body.length > 100 ? `${l.body.slice(0, 100)}…` : l.body }) : el('div', { class: 'im-muted', text: l.envelope?.medium ? `봉투: ${l.envelope.medium}` : '봉투가 닫혀 있습니다' }),
      ]);
    });
    const s = list.find((x) => x.id === c.id);
    return [
      el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' })), el('span', { class: 'im-grow' }), link('상대 정보 수정', () => go({ name: 'form', id: c.id }))]),
      el('h3', { text: c.name }),
      el('div', { class: 'im-muted', text: `그쪽은 지금 ${c.theirNowLabel} · 시간 1:${c.ratio} (나의 하루 = 그쪽 ${formatSpan(24 * c.ratio)})` }),
      s ? el('div', { class: s.failed ? 'im-err' : 'im-muted', text: s.status }) : null,
      c.reply?.state === 'failed' ? el('div', { class: 'im-row' }, [
        el('span', { class: 'im-err im-grow', text: `사유: ${c.reply.error || '알 수 없음'}` }),
        btn('다시 시도', () => act(async () => { await ask('retry', { id: c.id }); await refresh(); })),
      ]) : null,
      composeView(c),
      el('hr', { class: 'im-sep' }),
      ...(items.length ? items : [el('div', { class: 'im-muted', text: '아직 주고받은 편지가 없습니다.' })]),
    ];
  }

  function composeView(c) {
    const ta = el('textarea', { value: draft.body, placeholder: `${c.name}에게 쓰는 편지`, rows: 7, oninput: (e) => { draft.body = e.target.value; } });
    const enc = el('input', { value: draft.enclosure, placeholder: '동봉할 것(선택) — 예: 말린 네잎클로버 한 장', oninput: (e) => { draft.enclosure = e.target.value; } });
    return el('div', { class: 'im-letter' }, [
      el('h4', { text: '편지 쓰기' }),
      ta, enc,
      el('div', { class: 'im-row' }, [
        el('span', { class: 'im-muted im-grow', text: `배송 ${c.delivery.min}~${c.delivery.max}시간. 도착 전에는 회수할 수 있습니다.` }),
        btn(busy ? '보내는 중…' : '보내기', () => act(async () => {
          if (!draft.body.trim()) throw new Error('본문을 적어 주세요.');
          current = (await ask('send', { id: c.id, body: draft.body, enclosure: draft.enclosure })).c;
          draft = { body: '', enclosure: '' };
          await loadHome();
        }), { primary: true, disabled: busy }),
      ]),
    ]);
  }

  async function openLetter(letterId) {
    view = { name: 'letter', id: current.id, letterId, step: 'envelope' };
    render();
  }

  function letterView() {
    const c = current;
    const l = c?.letters.find((x) => x.id === view.letterId);
    if (!l) return [link('← 돌아가기', () => openC(view.id))];
    const back = el('div', { class: 'im-row' }, [link(`← ${c.name}`, () => openC(c.id))]);
    const e = l.envelope || {};
    if (view.step === 'envelope' && l.state === 'delivered') {
      const rows = [['매체', e.medium], ['손끝에 닿는 것', e.texture], ['냄새', e.scent], ['흔적', e.marks], ['봉인', e.seal], ['우표', e.stamp]].filter(([, v]) => v);
      return [
        back,
        el('div', { class: 'im-envelope' }, [
          el('div', { class: 'im-muted', text: `${when(l.arriveAt)}에 도착한 편지` }),
          el('dl', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
          l.enclosures?.length ? el('div', { class: 'im-muted', text: `안에 무언가 더 들어 있는 것 같습니다 (${l.enclosures.length})` }) : null,
        ]),
        btn('봉투 열기', () => act(async () => {
          current = (await ask('open', { id: c.id, letterId: l.id })).c;
          view = { ...view, step: 'body' };
          await loadHome();
        }), { primary: true }),
      ];
    }
    const meta = [e.medium, e.scent].filter(Boolean).join(' · ');
    return [
      back,
      el('div', { class: 'im-muted', text: `${l.writtenLabel || l.theirWrittenLabel}${meta ? ` · ${meta}` : ''}` }),
      el('div', { class: 'im-paper', text: l.body + (l.ps ? `\n\n추신. ${l.ps}` : '') }),
      ...(l.enclosures || []).map((x) => el('div', { class: 'im-envelope' }, [el('b', { text: `동봉: ${x.item}` }), x.note ? el('div', { text: x.note }) : null])),
      el('div', { class: 'im-muted', text: `받은 시각 ${when(l.arriveAt)}` }),
    ];
  }

  // 새 상대 / 수정
  function formView() {
    const editing = !!view.id;
    const v = editing && currentInput ? { ...currentInput } : {
      name: '', brief: '', world: '', ratio: 1, deliveryMin: 1, deliveryMax: 24, writeMin: 2, writeMax: 48, maxReplyRealHours: 24, timeScale: 1, personaId: '',
    };
    const inputs = {};
    const text = (k, ph, rows) => (inputs[k] = rows ? el('textarea', { value: v[k] || '', placeholder: ph, rows }) : el('input', { value: v[k] ?? '', placeholder: ph }));
    const numIn = (k, step = 'any') => (inputs[k] = el('input', { type: 'number', step, min: '0', value: String(v[k] ?? '') }));
    const read = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    return [
      el('div', { class: 'im-row' }, [link('← 돌아가기', () => (editing ? openC(view.id) : go({ name: 'home' })))]),
      el('h3', { text: editing ? '상대 정보 수정' : '새 상대' }),
      el('div', { class: 'im-muted', text: '1단계 버전: 상대를 직접 적습니다. 캐릭터 카드·로어북 자동 생성과 무작위 매칭은 다음 단계에서 붙습니다.' }),
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
            current = (await ask('update', { id: view.id, input: read() })).c;
            await loadHome();
            await openC(view.id);
          } else {
            const r = await ask('create', { input: read() });
            await loadHome();
            await openC(r.id);
          }
        }), { primary: true, disabled: busy }),
        editing ? btn('상대 지우기', () => act(async () => {
          if (!confirm('이 상대와 주고받은 편지를 모두 지울까요? 되돌릴 수 없습니다.')) return;
          await ask('delete', { id: view.id });
          await loadHome();
          go({ name: 'home' });
        })) : null,
      ]),
    ];
  }

  let connections = null;
  function settingsView() {
    const s = { ...(settings || {}) };
    if (!connections) {
      connections = [];
      ask('connections').then((r) => { connections = r.connections; render(); }).catch((e) => { setError(e); render(); });
    }
    const sel = el('select', {}, [
      el('option', { value: '', text: '기본 연결 사용' }),
      ...connections.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}${x.is_default ? ' (기본)' : ''}`, selected: x.id === s.replyConnectionId })),
    ]);
    const temp = el('input', { type: 'number', step: '0.05', min: '0', max: '2', value: String(s.temperature ?? 0.9) });
    const maxT = el('input', { type: 'number', step: '100', min: '500', value: String(s.maxTokens ?? 6000) });
    const recent = el('input', { type: 'number', step: '1', min: '1', max: '20', value: String(s.recentLetters ?? 6) });
    const exact = el('input', { type: 'checkbox', checked: !!s.showExactEta });
    return [
      el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' }))]),
      el('h3', { text: '설정' }),
      field('답장 쓰기 연결', sel),
      el('div', { class: 'im-pair' }, [field('온도', temp), field('최대 출력 토큰', maxT)]),
      field('프롬프트에 넣는 최근 편지 수(양쪽 합)', recent),
      el('label', { class: 'im-row' }, [exact, '배송 중 남은 시간을 분 단위로 보기']),
      el('div', { class: 'im-muted', text: '연결에 붙은 프리셋은 쓰지 않고, 우체통이 자기 지시문과 위 값을 보냅니다.' }),
      btn('저장', () => act(async () => {
        settings = (await ask('saveSettings', { settings: { replyConnectionId: sel.value, temperature: temp.value, maxTokens: maxT.value, recentLetters: recent.value, showExactEta: exact.checked } })).settings;
        go({ name: 'home' });
      }), { primary: true }),
    ];
  }

  loadHome().then(render);
  render();

  return () => {
    clearInterval(timer);
    offActivate?.();
    offBack?.();
    removeStyle?.();
    tab.destroy();
  };
}

