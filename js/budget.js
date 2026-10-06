'use strict';
// 가계부: 달마다 예산표(수입·지출·저축의 계획 vs 실제) + 목표 + 재산 + 통장별
// 하루하루 내역이 아니라 항목마다 한 달 합계. 항목은 다음 달에도 이어지고, 계획 금액을 고치면 그달부터 (지난달은 그대로)
// 금액 칸에는 '480000+32000'처럼 더하고 빼서 적어도 됨. 재산은 달마다 금액을 적고, 안 적은 달은 그 전 금액

// ---------- 달: 'YYYY-MM' ----------
const thisMonth = () => todayStr().slice(0, 7);
function addMonths(m, d) {
  const n = +m.slice(0, 4) * 12 + +m.slice(5, 7) - 1 + d;
  return `${Math.floor(n / 12)}-${pad(n % 12 + 1)}`;
}
const monthDiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + +b.slice(5, 7) - +a.slice(5, 7);
const fmtYM = m => `${+m.slice(0, 4)}년 ${+m.slice(5, 7)}월`;
const live = (r, m) => r.from <= m && (!r.to || m < r.to); // from ≤ 달 < to (to 없으면 계속)
// 달마다 적는 값 { 'YYYY-MM': 금액 } 에서 그 달까지 중 마지막 (없으면 null)
function upTo(vals, m) {
  let k = null;
  for (const x in vals || {}) if (x <= m && (!k || x > k)) k = x;
  return k ? vals[k] : null;
}

// ---------- 금액 ----------
const won = n => Math.round(n).toLocaleString('ko-KR');
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + won(Math.abs(n));
// 빈칸 = null, 못 읽으면 undefined. 쉼표·띄어쓰기·'원'은 무시
function parseWon(s) {
  s = s.replace(/[,\s원]/g, '').replace(/−/g, '-');
  if (!s) return null;
  if (!/^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)*$/.test(s)) return undefined;
  return Math.round(s.match(/[+-]?[\d.]+/g).reduce((a, x) => a + +x, 0));
}
function fillSelect(sel, pairs, value) {
  sel.replaceChildren(...pairs.map(([v, t]) => { const o = h('option', '', t); o.value = v; return o; }));
  sel.value = pairs.some(([v]) => v === value) ? value : pairs[0][0];
}

// ---------- 지출 분류·통장 (bconf, id 'budget') ----------
// 기본 분류는 id를 정해 둠 → 두 기기에서 따로 만들어져도 같은 분류
const BASE_GROUPS = [{ id: 'fixed', name: '고정비' }, { id: 'living', name: '생활비' }, { id: 'allow', name: '용돈' }];
const bconf = () => db.recs.find(r => r.id === 'budget') || { groups: BASE_GROUPS, accounts: [] };
function confRec() { // 고칠 때: 없으면 만듦 (저장은 부르는 쪽에서)
  let c = db.recs.find(r => r.id === 'budget');
  if (!c) db.recs.push(c = { ...newRec('bconf', { groups: BASE_GROUPS.map(g => ({ ...g })), accounts: [] }), id: 'budget' });
  return c;
}
const accounts = () => bconf().accounts;
function addAccount() {
  const name = (prompt('새 통장 이름 (예: 월급통장, 생활비통장)') || '').trim();
  if (!name) return null;
  const c = confRec(), a = { id: uid(), name };
  c.accounts = [...c.accounts, a];
  touch(c);
  return a;
}

// ---------- 예산 항목 (bline) ----------
const SIDES = { in: '수입', out: '지출', save: '저축' };
const bLines = (side, m) => recs('bline').filter(l => l.side === side && live(l, m)).sort(byOrder);
const groupOf = l => (l.side === 'out' && bconf().groups.some(g => g.id === l.group) ? l.group : null);
const planOf = (l, m) => upTo(l.plans, m) ?? 0;
// 실제 = 그 달에 적은 금액. '매달 같은 금액'은 안 적어도 계획 금액 (이번 달까지만)
const autoOf = (l, m) => (l.fixed && m <= thisMonth() ? planOf(l, m) : null);
const actualOf = (l, m) => l.actual?.[m] ?? autoOf(l, m);
// 합계. diff = 실제를 적은 항목만 (실제 − 계획)
function sums(list, m) {
  const s = { plan: 0, actual: 0, diff: 0, blank: 0, n: list.length };
  for (const l of list) {
    const p = planOf(l, m), a = actualOf(l, m);
    s.plan += p;
    if (a == null) s.blank++; else { s.actual += a; s.diff += a - p; }
  }
  return s;
}
// 수입·저축은 계획보다 많으면, 지출은 적으면 좋음
const goodDiff = (side, d) => (side === 'out' ? d < 0 : d > 0);

let bm = thisMonth(); // 보고 있는 달
$('prevBtn').addEventListener('click', () => { if (prefs.view === 'budget') { bm = addMonths(bm, -1); render(); } });
$('nextBtn').addEventListener('click', () => { if (prefs.view === 'budget') { bm = addMonths(bm, 1); render(); } });
$('todayBtn').addEventListener('click', () => { if (prefs.view === 'budget') { bm = thisMonth(); render(); } });

function renderBudget() {
  $('monthTitle').textContent = fmtYM(bm);
  $('budgetSheet').replaceChildren(summary(), ...Object.keys(SIDES).map(sideBox));
  renderGoals();
  renderAssets();
  renderAccounts();
}

// ---------- 요약: 수입·지출·저축·남는 돈 + 분류별 지출 ----------
function summary() {
  const box = h('section', 'panel bsum'), t = {}, tiles = h('div', 'tiles');
  for (const s of Object.keys(SIDES)) t[s] = sums(bLines(s, bm), bm);
  const left = k => t.in[k] - t.out[k] - t.save[k];
  for (const [label, actual, plan] of [['수입', t.in.actual, t.in.plan], ['지출', t.out.actual, t.out.plan],
    ['저축', t.save.actual, t.save.plan], ['남는 돈', left('actual'), left('plan')]]) {
    const tile = h('div', 'tile');
    tile.append(h('span', 'label', label), h('span', 'value', won(actual)), h('span', 'plan', `계획 ${won(plan)}`));
    tiles.append(tile);
  }
  box.append(tiles);
  const rows = [];
  for (const g of [...bconf().groups, null]) {
    const s = sums(bLines('out', bm).filter(l => groupOf(l) === (g ? g.id : null)), bm);
    if (s.plan || s.actual) rows.push(meterRow(g ? g.name : '미분류', s.actual, s.plan));
  }
  if (rows.length) {
    const m = h('div', 'meters');
    m.append(...rows);
    box.append(m);
  }
  if (!Object.values(t).some(s => s.n)) {
    box.append(h('p', 'hint', '아래에 수입·지출·저축 항목을 적고 계획 금액을 넣어요. 항목은 다음 달에도 이어지고, 실제 금액은 달마다 적어요. ' +
      '월세처럼 매달 같은 건 항목 이름을 눌러 ‘매달 같은 금액’으로.'));
  }
  return box;
}
// 계획 대비 실제 막대 (넘으면 빨강 + '초과')
function meterRow(name, actual, plan) {
  const row = h('div', 'meter-row'), over = actual > plan, m = h('div', 'meter' + (over ? ' over' : '')), fill = h('i');
  fill.style.width = `${plan ? Math.min(1, actual / plan) * 100 : 100}%`;
  m.append(fill);
  const nums = h('span', 'nums', `${won(actual)} / ${won(plan)}`);
  if (over) nums.append(h('b', 'bad', ` 초과 ${won(actual - plan)}`));
  row.append(h('span', 'name', name), m, nums);
  return row;
}

// ---------- 예산표 ----------
function sideBox(side) {
  const list = bLines(side, bm), box = h('section', 'bsec');
  box.dataset.side = side;
  const s = sums(list, bm), head = sumRow('bsec-head', side, SIDES[side], s);
  if (s.blank && s.n && bm <= thisMonth()) head.firstChild.append(h('span', 'hint', `${s.blank}개 안 적음`));
  box.append(head);
  if (side === 'out') {
    for (const g of [...bconf().groups, null]) {
      const ls = list.filter(l => groupOf(l) === (g ? g.id : null));
      if (!g && !ls.length) continue;
      box.append(groupHead(g, ls), ...ls.map(lineRow), addLine(side, g ? g.id : null));
    }
    box.append(button('+ 분류', addOutGroup, 'btn small add-group'));
  } else box.append(...list.map(lineRow), addLine(side, null));
  return box;
}
// 합계 줄: 이름 | 계획 | 실제 | 차이
function sumRow(cls, side, name, s) {
  const row = h('div', `brow ${cls}`), caps = cls === 'bsec-head';
  const num = (cap, text, c = '') => {
    const e = h('span', `bnum ${c}`);
    if (caps) e.append(h('span', 'cap', cap));
    e.append(h('b', '', text));
    return e;
  };
  const has = s.n > s.blank && s.diff;
  row.append(h('span', 'bname', name), num('계획', won(s.plan)), num('실제', won(s.actual)),
    num('차이', has ? signed(s.diff) : '', 'bdiff' + (has ? goodDiff(side, s.diff) ? ' good' : ' bad' : '')));
  return row;
}

function groupHead(g, ls) {
  const row = sumRow('bgroup', 'out', g ? g.name : '미분류', sums(ls, bm));
  row.dataset.group = g ? g.id : '';
  if (!g) return row;
  const handle = dragHandle(), tools = h('span', 'btools');
  tools.append(iconBtn('✎', '분류 이름 바꾸기', () => renameOutGroup(g)), iconBtn('✕', '분류 지우기', () => deleteOutGroup(g)));
  tools.querySelectorAll('button').forEach(b => { b.tabIndex = -1; });
  row.firstChild.prepend(handle);
  row.firstChild.append(tools);
  sortable(handle, row, '.bsec[data-side="out"] .bgroup:not([data-group=""])', (t, before) => moveConf('groups', g.id, t.dataset.group, before));
  return row;
}
// 분류(groups)·통장(accounts) 순서: id를 targetId 앞/뒤로
function moveConf(key, id, targetId, before) {
  const c = confRec(), me = c[key].find(x => x.id === id), arr = c[key].filter(x => x !== me);
  arr.splice(arr.findIndex(x => x.id === targetId) + (before ? 0 : 1), 0, me);
  c[key] = arr;
  touch(c);
  save();
}
function addOutGroup() {
  const name = (prompt('새 분류 이름 (예: 보험, 경조사)') || '').trim();
  if (!name) return;
  const c = confRec(), g = { id: uid(), name };
  c.groups = [...c.groups, g];
  touch(c);
  focusNext = `badd:out:${g.id}`;
  save();
}
function renameOutGroup(g) {
  const name = (prompt('분류 이름', g.name) || '').trim();
  if (!name || name === g.name) return;
  const c = confRec();
  c.groups = c.groups.map(x => (x.id === g.id ? { ...x, name } : x));
  touch(c);
  save();
}
function deleteOutGroup(g) {
  const ls = recs('bline').filter(l => l.group === g.id);
  if (!confirm(`‘${g.name}’ 분류를 지울까요?` + (ls.length ? `\n항목 ${ls.length}개는 미분류로 옮겨요.` : ''))) return;
  ls.forEach(l => { l.group = null; touch(l); });
  const c = confRec();
  c.groups = c.groups.filter(x => x.id !== g.id);
  touch(c);
  save();
}

// 항목 한 줄: 이름(누르면 고치기) · 고정 · 통장 | 계획 | 실제 | 차이
function lineRow(l) {
  const row = h('div', 'brow bline'), name = h('span', 'bname'), handle = dragHandle(), text = h('span', 'btext', l.name);
  row.dataset.id = l.id;
  text.title = '눌러서 고치기 (이름·구분·통장·매달 같은 금액·삭제)';
  text.addEventListener('click', () => openLine(l));
  name.append(handle, text);
  if (l.fixed) name.append(h('span', 'badge', '고정'));
  if (l.to === addMonths(bm, 1)) name.append(h('span', 'badge', '이 달까지'));
  if (accounts().length) name.append(accountSelect(l));
  const p = planOf(l, bm), a = actualOf(l, bm), d = a == null ? 0 : a - p;
  const plan = amtInput(`plan:${l.id}`, 'plan', upTo(l.plans, bm), null, v => setLinePlan(l, v));
  plan.title = `${+bm.slice(5)}월부터 이 금액 (지난달은 그대로)`;
  const act = amtInput(`act:${l.id}`, 'act', l.actual?.[bm] ?? null, autoOf(l, bm), v => setLineActual(l, v));
  if (autoOf(l, bm) != null) act.title = '매달 같은 금액: 안 적으면 계획 금액으로 쳐요 (흐린 글씨)';
  const diff = h('span', 'bdiff', d ? signed(d) : '');
  if (d) diff.classList.add(goodDiff(l.side, d) ? 'good' : 'bad');
  if (d) row.dataset.diff = goodDiff(l.side, d) ? 'good' : 'bad';
  row.append(name, plan, act, diff);
  sortable(handle, row, `.bsec[data-side="${l.side}"] .bline, .bsec[data-side="${l.side}"] .bgroup`, (t, before) => dropLine(l, t, before));
  return row;
}
// 계획: 이 달부터 이 금액 (지난달은 그대로). 비우면 지난달 계획을 이어 씀
function setLinePlan(l, v) {
  const plans = { ...l.plans };
  delete plans[bm];
  if (v != null && (upTo(plans, bm) ?? 0) !== v) plans[bm] = v;
  l.plans = plans;
  touch(l);
}
function setLineActual(l, v) {
  const actual = { ...l.actual };
  if (v == null || v === autoOf(l, bm)) delete actual[bm]; else actual[bm] = v;
  l.actual = actual;
  touch(l);
}
const sameGroup = l => bLines(l.side, bm).filter(x => groupOf(x) === groupOf(l));
function dropLine(l, t, before) {
  if (t.classList.contains('bgroup')) {
    l.group = t.dataset.group || null;
    reorder(sameGroup(l), l, null, true);
  } else {
    const target = recs('bline').find(x => x.id === t.dataset.id);
    if (!target) return;
    l.group = groupOf(target);
    reorder(sameGroup(l), l, target, before);
  }
  touch(l);
  save();
}
function accountSelect(l) {
  const s = h('select', 'acct');
  fillSelect(s, [['', '통장 –'], ...accounts().map(a => [a.id, a.name]), ['+', '+ 새 통장…']], l.account);
  s.title = '통장';
  s.tabIndex = -1; // Tab은 금액 칸끼리만 옮겨 다니게
  s.classList.toggle('none', !s.value);
  s.addEventListener('change', () => {
    const a = s.value === '+' ? addAccount() : null;
    if (s.value === '+' && !a) { render(); return; }
    l.account = a ? a.id : s.value || null;
    touch(l);
    save();
  });
  return s;
}

// 금액 칸. Enter = 같은 열 아래 칸으로, 저장은 칸을 떠난 뒤 (다시 그려도 커서가 옮겨 간 칸에 남게)
// auto = 안 적었을 때 쓰는 금액 (흐린 글씨)
let addedBack = null; // 방금 추가한 항목의 계획 칸에서 Enter → 다시 그 추가 칸으로 { key, back }
function amtInput(key, col, value, auto, onSet) {
  const input = h('input', 'amt');
  input.inputMode = 'tel'; // 폰: 숫자판 (+ 도 있음)
  input.autocomplete = 'off';
  input.dataset.key = key;
  input.dataset.col = col;
  input.value = value == null ? '' : won(value);
  if (auto != null) input.placeholder = won(auto);
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const list = [...document.querySelectorAll(`.amt[data-col="${col}"]`)];
    const next = addedBack && addedBack.key === key ? document.querySelector(`[data-key="${addedBack.back}"]`) : list[list.indexOf(input) + 1];
    addedBack = null;
    if (!next) { input.blur(); return; }
    next.focus();
    next.select();
  });
  input.addEventListener('change', () => {
    const v = parseWon(input.value);
    if (v === undefined) {
      toast('금액은 숫자로 (예: 480000+32000)');
      input.value = value == null ? '' : won(value);
      return;
    }
    onSet(v);
    setTimeout(save);
  });
  return input;
}
function addLine(side, group) {
  const input = h('input', 'add-input badd'), key = `badd:${side}:${group || ''}`;
  input.placeholder = side === 'in' ? '+ 수입 (월급·부수입 등)' : side === 'save' ? '+ 저축 (적금·투자 등)' : '+ 항목';
  input.autocomplete = 'off';
  input.dataset.key = key;
  onEnter(input, name => {
    const l = newRec('bline', { side, group, account: null, name, plans: {}, actual: {}, fixed: false, from: bm, to: null,
      order: nextOrder(bLines(side, bm)) });
    db.recs.push(l);
    focusNext = `plan:${l.id}`;
    addedBack = { key: focusNext, back: key };
    save();
  });
  return input;
}

// ---------- 항목 고치기 ----------
let lineEditing = null;
function openLine(l) {
  lineEditing = l;
  const f = $('lineForm');
  f.name.value = l.name;
  fillSelect(f.kind, [['in', '수입'], ...bconf().groups.map(g => [`out:${g.id}`, `지출 › ${g.name}`]), ['out:', '지출 › 미분류'], ['save', '저축']],
    l.side === 'out' ? `out:${groupOf(l) || ''}` : l.side);
  fillAccounts(l.account);
  f.fixed.checked = !!l.fixed;
  f.last.checked = l.to === addMonths(bm, 1);
  $('lineLastLabel').textContent = `${+bm.slice(5)}월까지만`;
  $('lineEndBtn').hidden = !(l.from < bm);
  $('lineDelBtn').textContent = l.from < bm ? '모든 달에서 삭제' : '삭제';
  $('lineEditor').showModal();
}
const fillAccounts = id => fillSelect($('lineAccount'), [['', '통장 미정'], ...accounts().map(a => [a.id, a.name]), ['+', '+ 새 통장…']], id);
$('lineAccount').addEventListener('change', e => {
  if (e.target.value !== '+') return;
  const a = addAccount();
  if (a) save();
  fillAccounts(a ? a.id : lineEditing.account);
});
$('lineForm').addEventListener('submit', e => {
  e.preventDefault();
  const l = lineEditing, f = e.target, [side, group] = f.kind.value.split(':'), last = addMonths(bm, 1);
  if (l.side !== side) l.order = nextOrder(bLines(side, bm));
  l.name = f.name.value.trim() || l.name;
  l.side = side;
  l.group = side === 'out' ? group || null : null;
  l.account = f.account.value || null;
  l.fixed = f.fixed.checked;
  if (f.last.checked) l.to = last; else if (l.to === last) l.to = null;
  touch(l);
  $('lineEditor').close();
  save();
});
$('lineDelBtn').addEventListener('click', () => {
  const l = lineEditing;
  if (!confirm(`‘${l.name}’ 항목을 ${l.from < bm ? '모든 달에서 ' : ''}지울까요?`)) return;
  remove(l);
  $('lineEditor').close();
  save();
});
$('lineEndBtn').addEventListener('click', () => { // 지난달까지 기록은 남김
  const l = lineEditing;
  l.to = bm;
  touch(l);
  $('lineEditor').close();
  save();
  toast(`‘${l.name}’ 는 ${+addMonths(bm, -1).slice(5)}월까지만 남겼어요`);
});
$('lineCancel').addEventListener('click', () => $('lineEditor').close());

// ---------- 통장별: 들어오는 돈 − 나가는 돈 (계획) ----------
function renderAccounts() {
  const all = Object.keys(SIDES).flatMap(s => bLines(s, bm)), ids = accounts().map(a => a.id), out = [];
  for (const a of [...accounts(), null]) {
    const ls = all.filter(l => (ids.includes(l.account) ? l.account : null) === (a ? a.id : null));
    const sum = list => list.reduce((s, l) => s + planOf(l, bm), 0);
    const got = sum(ls.filter(l => l.side === 'in')), spent = sum(ls.filter(l => l.side !== 'in')), net = got - spent;
    if (!a && !got && !spent) continue;
    const row = h('div', 'acct-row');
    if (a) { // ⋮⋮ 끌어서 순서 바꾸기 (항목의 통장 고르기 목록도 이 순서)
      const handle = dragHandle();
      row.dataset.id = a.id;
      row.append(handle);
      sortable(handle, row, '#accountList .acct-row[data-id]', (t, before) => moveConf('accounts', a.id, t.dataset.id, before));
    }
    row.append(h('span', 'btext', a ? a.name : '통장 미정'));
    if (a) row.append(iconBtn('✎', '통장 이름 바꾸기', () => renameAccount(a)), iconBtn('✕', '통장 지우기', () => deleteAccount(a)));
    row.append(h('span', 'net', net < 0 ? `${won(-net)} 채우기` : `${signed(net)} 남음`),
      h('span', 'meta', `들어옴 ${won(got)} · 나감 ${won(spent)}`));
    out.push(row);
  }
  out.push(h('p', 'empty', accounts().length ? '‘채우기’는 다른 통장에서 옮겨 넣을 돈이에요.'
    : '＋로 통장을 만들고 항목마다 통장을 고르면, 통장마다 들어오고 나가는 돈(계획)을 보여줘요.'));
  $('accountList').replaceChildren(...out);
}
$('newAccountBtn').addEventListener('click', () => { if (addAccount()) save(); });
function renameAccount(a) {
  const name = (prompt('통장 이름', a.name) || '').trim();
  if (!name || name === a.name) return;
  const c = confRec();
  c.accounts = c.accounts.map(x => (x.id === a.id ? { ...x, name } : x));
  touch(c);
  save();
}
function deleteAccount(a) {
  const ls = recs('bline').filter(l => l.account === a.id);
  if (!confirm(`‘${a.name}’ 통장을 지울까요?` + (ls.length ? `\n항목 ${ls.length}개는 통장 미정이 돼요.` : ''))) return;
  ls.forEach(l => { l.account = null; touch(l); });
  const c = confRec();
  c.accounts = c.accounts.filter(x => x.id !== a.id);
  touch(c);
  save();
}

// ---------- 재산 (asset) ----------
const ASSET_TYPES = { cash: '예금·현금', saving: '적금', stock: '주식·투자', estate: '부동산', car: '자동차', etc: '기타', debt: '대출' };
const typeRank = a => Object.keys(ASSET_TYPES).indexOf(a.type);
const assetsOn = m => recs('asset').filter(a => live(a, m)).sort((a, b) => typeRank(a) - typeRank(b) || byOrder(a, b));
const worth = (a, m) => (upTo(a.values, m) ?? 0) * (a.type === 'debt' ? -1 : 1); // 대출은 빼기
const netWorth = (m, list = assetsOn(m)) => list.reduce((s, a) => s + worth(a, m), 0);

function renderAssets() {
  const list = assetsOn(bm), prev = assetsOn(addMonths(bm, -1)), out = [];
  $('netWorth').textContent = list.length ? `순자산 ${won(netWorth(bm, list))}` : '';
  if (list.length) {
    if (prev.length) out.push(h('p', 'hint', `지난달보다 ${signed(netWorth(bm, list) - netWorth(addMonths(bm, -1), prev))}`));
    out.push(trend());
  }
  for (const t of Object.keys(ASSET_TYPES)) {
    const ls = list.filter(a => a.type === t);
    if (!ls.length) continue;
    const head = h('div', 'agroup'), sum = ls.reduce((s, a) => s + worth(a, bm), 0);
    head.append(h('span', '', ASSET_TYPES[t]), h('span', '', (sum < 0 ? '−' : '') + won(Math.abs(sum))));
    out.push(head, ...ls.map(assetRow));
  }
  if (!list.length) out.push(h('p', 'empty', '＋로 예금·적금·주식·부동산·차·대출을 넣고 달마다 금액을 적어요. 안 적은 달은 그 전 금액 그대로예요.'));
  $('assetList').replaceChildren(...out);
}
function assetRow(a) {
  const row = h('div', 'arow'), name = h('span', 'btext', a.name), v = a.values?.[bm] ?? null;
  name.title = '눌러서 고치기 (이름·종류·삭제)';
  name.addEventListener('click', () => openAsset(a));
  const input = amtInput(`asset:${a.id}`, 'asset', v, v == null ? upTo(a.values, bm) : null, x => {
    const vals = { ...a.values };
    if (x == null) delete vals[bm]; else vals[bm] = x;
    a.values = vals;
    touch(a);
  });
  if (v == null) input.title = '그 전 금액 그대로 (흐린 글씨). 이번 달 금액을 적으면 바뀌어요';
  row.append(name, input);
  return row;
}
// 순자산 추이: 보는 달까지 12달 (재산이 있는 달만 이음). 점에 마우스를 올리면 그 달 금액
const svg = (tag, attrs) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
function trend() {
  const ms = Array.from({ length: 12 }, (_, i) => addMonths(bm, i - 11));
  const pts = ms.map((m, i) => { const list = assetsOn(m); return list.length ? { m, i, v: netWorth(m, list) } : null; }).filter(Boolean);
  if (pts.length < 2) return h('p', 'hint', '두 달 이상 적으면 순자산 변화가 그래프로 보여요.');
  const W = $('assetList').clientWidth || 320, H = 84, top = 8, base = H - 18, step = (W - 16) / 11;
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), room = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  const X = i => 8 + step * i, Y = v => top + (base - top) * (hi + room - v) / (hi - lo + room * 2);
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const first = pts[0], last = pts[pts.length - 1];
  const s = svg('svg', { class: 'trend', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  for (const p of pts) { // 마우스 올릴 칸 (그 달 전체 높이)
    const r = svg('rect', { class: 'hit', x: X(p.i) - step / 2, y: 0, width: step, height: base });
    r.append(svg('title', {}));
    r.firstChild.textContent = `${fmtYM(p.m)} 순자산 ${won(p.v)}`;
    s.append(r);
  }
  s.append(svg('path', { class: 'area', d: `${path}L${X(last.i)},${base}L${X(first.i)},${base}Z` }),
    svg('line', { class: 'base', x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5 }), svg('path', { class: 'line', d: path }));
  if (last.m === bm) s.append(svg('circle', { class: 'dot', cx: X(last.i), cy: Y(last.v), r: 4 }));
  ms.forEach((m, i) => {
    const t = svg('text', { x: X(i), y: H - 4, class: m === bm ? 'now' : '' });
    t.textContent = +m.slice(5);
    s.append(t);
  });
  return s;
}

let assetEditing = null;
function openAsset(a) {
  assetEditing = a; // null = 새 재산
  const f = $('assetForm'), carried = a ? upTo(a.values, bm) : null;
  f.reset();
  fillSelect(f.type, Object.entries(ASSET_TYPES), a ? a.type : 'cash');
  f.name.value = a ? a.name : '';
  f.amount.value = a && a.values?.[bm] != null ? won(a.values[bm]) : '';
  f.amount.placeholder = carried != null ? won(carried) : '';
  $('assetAmountLabel').textContent = `${+bm.slice(5)}월 금액`;
  $('assetEndBtn').hidden = !a || !(a.from < bm);
  $('assetDelBtn').hidden = !a;
  $('assetEditor').showModal();
}
$('newAssetBtn').addEventListener('click', () => openAsset(null));
$('assetForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, v = parseWon(f.amount.value);
  if (v === undefined) { toast('금액은 숫자로 적어요'); return; }
  let a = assetEditing;
  if (!a) db.recs.push(a = newRec('asset', { type: f.type.value, name: '', values: {}, from: bm, to: null, order: nextOrder(recs('asset')) }));
  a.type = f.type.value;
  a.name = f.name.value.trim() || a.name;
  const vals = { ...a.values };
  if (v == null) delete vals[bm]; else vals[bm] = v;
  a.values = vals;
  touch(a);
  $('assetEditor').close();
  save();
});
$('assetDelBtn').addEventListener('click', () => {
  const a = assetEditing;
  if (!confirm(`‘${a.name}’ 를 지울까요? 지난 달 기록도 함께 지워져요.`)) return;
  remove(a);
  $('assetEditor').close();
  save();
});
$('assetEndBtn').addEventListener('click', () => { // 팔았거나 끝난 재산: 지난달까지 기록은 남김
  const a = assetEditing;
  a.to = bm;
  touch(a);
  $('assetEditor').close();
  save();
  toast(`‘${a.name}’ 는 ${+addMonths(bm, -1).slice(5)}월까지만 남겼어요`);
});
$('assetCancel').addEventListener('click', () => $('assetEditor').close());

// ---------- 목표 (goal) ----------
const goals = () => recs('goal').sort(byOrder);
const goalNow = (g, m) => (g.assets?.length ? netWorth(m, assetsOn(m).filter(a => g.assets.includes(a.id))) : netWorth(m));
function renderGoals() {
  const saving = sums(bLines('save', bm), bm).plan;
  const out = goals().map(g => {
    const now = goalNow(g, bm), left = g.target - now, months = monthDiff(bm, g.by) + 1;
    const row = h('div', 'goal'), head = h('div', 'goal-head'), m = h('div', 'meter'), fill = h('i');
    head.append(h('span', 'btext', g.name), h('span', 'pct', `${Math.max(0, Math.floor(now / g.target * 100))}%`));
    fill.style.width = `${Math.max(0, Math.min(1, now / g.target)) * 100}%`;
    m.append(fill);
    row.append(head, m, h('span', 'hint', `${won(now)} / ${won(g.target)}${g.assets?.length ? '' : ' (순자산)'}`));
    if (left <= 0) row.append(h('span', 'hint', '달성했어요!'));
    else if (months < 1) row.append(h('span', 'hint', `${fmtYM(g.by)}까지였어요 · ${won(left)} 남음`));
    else {
      const per = Math.ceil(left / months);
      row.append(h('span', 'hint', `${fmtYM(g.by)}까지 ${months}달 · 한 달에 ${won(per)}씩`),
        h('span', 'hint', `이 달 저축 계획 ${won(saving)}` + (saving < per ? ` · ${won(per - saving)} 모자라요` : ' · 충분해요')));
    }
    row.title = '눌러서 고치기';
    row.addEventListener('click', () => openGoal(g));
    return row;
  });
  $('goalList').replaceChildren(...(out.length ? out : [h('p', 'empty', '＋로 모을 돈과 기한을 정하면 한 달에 얼마씩 모아야 하는지 알려줘요.')]));
}

let goalEditing = null, goalPick = new Set();
function openGoal(g) {
  goalEditing = g; // null = 새 목표
  const f = $('goalForm');
  f.reset();
  f.name.value = g ? g.name : '';
  f.amount.value = g ? won(g.target) : '';
  f.by.value = g ? g.by : addMonths(thisMonth(), 12);
  f.basis.value = g && g.assets?.length ? 'pick' : '';
  goalPick = new Set(g ? g.assets || [] : []);
  renderGoalAssets();
  $('goalDelBtn').hidden = !g;
  $('goalEditor').showModal();
}
function renderGoalAssets() {
  const box = $('goalAssets'), list = recs('asset').sort((a, b) => typeRank(a) - typeRank(b) || byOrder(a, b));
  box.hidden = $('goalForm').basis.value !== 'pick';
  box.replaceChildren(...(list.length ? list.map(a => button(a.name, () => {
    if (goalPick.has(a.id)) goalPick.delete(a.id); else goalPick.add(a.id);
    renderGoalAssets();
  }, goalPick.has(a.id) ? 'on' : '')) : [h('span', 'hint', '재산을 먼저 넣어요 (재산 ＋)')]));
}
$('goalForm').basis.addEventListener('change', renderGoalAssets);
$('newGoalBtn').addEventListener('click', () => openGoal(null));
$('goalForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, target = parseWon(f.amount.value);
  if (!target || target <= 0) { toast('목표 금액을 숫자로 적어요'); return; }
  if (!/^\d{4}-\d{2}$/.test(f.by.value)) { toast('언제까지를 골라요 (예: 2028-12)'); return; }
  const fields = { name: f.name.value.trim(), target, by: f.by.value, assets: f.basis.value === 'pick' ? [...goalPick] : [] };
  if (goalEditing) { Object.assign(goalEditing, fields); touch(goalEditing); } else db.recs.push(newRec('goal', { ...fields, order: nextOrder(goals()) }));
  $('goalEditor').close();
  save();
});
$('goalDelBtn').addEventListener('click', () => {
  if (!confirm(`‘${goalEditing.name}’ 목표를 지울까요?`)) return;
  remove(goalEditing);
  $('goalEditor').close();
  save();
});
$('goalCancel').addEventListener('click', () => $('goalEditor').close());
