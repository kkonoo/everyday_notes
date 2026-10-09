'use strict';
// 냉장고: 재고(보관 위치 카드 + 재료 칩: 양 3단계·유통기한·메모·기본 재료) + 오늘 뭐 해 먹지(지금 재고로 만들 수 있는 메뉴)
// 레시피는 식단의 메뉴·레시피 그대로 (menu.ingredients = 필수 재료, menu.optional = 선택 재료)
// '만들었어요' → 오늘 식단에 넣고 쓴 재료 양을 한 단계 내림. 없는 재료 → 장보기 (meals.js 의 pushMeal, addToShop)
// PC는 왼쪽 재고 + 오른쪽 추천, 폰은 위의 단추로 하나씩. 보관 위치 카드는 연구실 앱(lab-manager) 재고 › 보관 위치와 같은 모양
const AMOUNTS = ['다 떨어짐', '조금', '많음']; // stock.level 0·1·2
const SOON_DAYS = 3; // 유통기한이 이만큼 남았으면 '곧 먹어야 해요'
const stocks = () => recs('stock').sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const daysLeft = s => (s.expiry ? toNum(s.expiry) - toNum(todayStr()) : null);
const hasLeft = s => s.level > 0;
const isSoon = s => hasLeft(s) && daysLeft(s) !== null && daysLeft(s) <= SOON_DAYS; // 지난 것도
const dueText = (d, expiry) => (d < 0 ? `${-d}일 지남` : d === 0 ? '오늘까지' : d <= SOON_DAYS ? `D-${d}` : `${fmtMD(expiry)}까지`);
// 양 바꾸기. 다 떨어진 걸 다시 채우면 새로 산 것 → 지난 유통기한은 지움 (저장은 부르는 쪽에서)
function setLevel(s, level) {
  if (!s.level && level) s.expiry = '';
  s.level = level;
  touch(s);
}

// ---------- 보관 위치: 냉장고 2대처럼 직접 만들기 (설정 › 보관 위치 편집, 카드의 ＋ 위치) ----------
// place rec { name, type, order }. 처음엔 기본 4곳 — id를 정해 둠 (예전 재고의 place 값 그대로, 두 기기에서 따로 만들어져도 같은 위치)
// 위치를 지우면 그 재료들은 '위치 미정'
const PLACE_TYPES = { // 그림(40×40 선 그림)·색
  fridge: { label: '냉장고', color: '#8DB6F2', svg: '<rect x="10" y="4" width="20" height="32" rx="3"/><path d="M10 15h20M14 8.5v3M14 19v5"/>' },
  freezer: { label: '냉동고', color: '#84CDE0', svg: '<rect x="10" y="4" width="20" height="32" rx="3"/><path d="M14 8v3M20 16v14M14 19.5l12 7M26 19.5l-12 7"/>' },
  room: { label: '실온', color: '#F5D27A', svg: '<path d="M6 5v30M34 5v30M6 14h28M6 24h28M6 34h28M10 24v-6h4v6M17 24v-4h5v4M24 14v-6h4v6"/>' },
  sauce: { label: '양념', color: '#F8B88B', svg: '<path d="M17 4h6v6l3 5v19a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V15l3-5z"/><path d="M14 22h12M14 29h12"/>' },
};
const BASE_PLACES = [['cold', '냉장', 'fridge'], ['frozen', '냉동', 'freezer'], ['room', '실온', 'room'], ['sauce', '조미료', 'sauce']];
const places = () => (db.recs.some(r => r.kind === 'place') ? recs('place').sort(byOrder)
  : BASE_PLACES.map(([id, name, type], order) => ({ id, name, type, order })));
// 고치기 전에: 기본 위치를 계정에 저장해 두고 rec 목록을 돌려줌 (저장은 부르는 쪽에서)
function ownPlaces() {
  if (!db.recs.some(r => r.kind === 'place')) {
    for (const [i, [id, name, type]] of BASE_PLACES.entries()) db.recs.push({ ...newRec('place', { name, type, order: i }), id });
  }
  return recs('place').sort(byOrder);
}
const placeOf = s => places().find(p => p.id === s.place) || null;
const typeOf = p => PLACE_TYPES[p && p.type] || PLACE_TYPES.fridge;
function placeIcon(p) {
  const s = h('span', 'place-icon');
  if (p) s.innerHTML = `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${typeOf(p).svg}</svg>`;
  else s.textContent = '?';
  return s;
}
async function addPlaceRec() { // 저장까지
  const name = await ask('새 보관 위치 이름 (예: 김치냉장고)');
  if (!name) return null;
  const list = ownPlaces(), p = newRec('place', { name, type: 'fridge', order: nextOrder(list) });
  db.recs.push(p);
  save();
  return p;
}

// ---------- 설정: 늘 있는 재료(재고에 없어도 있는 걸로), 같은 재료(이름이 달라도 같은 재료로 칠 묶음) ----------
// 냉장고 화면에서 고침 (늘 있는 것 카드, 뭐 해 먹지의 같은 재료). 계정에 저장 (id 고정 rec 하나). 고친 적 없으면 기본값
const FRIDGE_ID = 'fridge';
const FRIDGE_DEFAULT = { always: ['물', '소금', '식용유'], aliases: [['달걀', '계란'], ['대파', '파']] };
const fridgeConf = () => ({ ...FRIDGE_DEFAULT, ...recs('fridge').find(r => r.id === FRIDGE_ID) });
function setFridgeConf(patch) { // 저장은 부르는 쪽에서
  let r = db.recs.find(x => x.id === FRIDGE_ID);
  if (!r) { r = { ...newRec('fridge', {}), id: FRIDGE_ID }; db.recs.push(r); }
  Object.assign(r, patch);
  touch(r);
}

// ---------- 재료 맞추기 ----------
// 이름 → 같은 재료로 치는 이름들: 띄어쓰기·대소문자 무시, 같은 재료 묶음, '두부/순두부'는 둘 중 아무거나 (장보기와 같음)
// 부분 일치는 안 함 ('파' ≠ '양파'). '다진 마늘'처럼 다르게 적은 건 같은 재료로 묶어서
function nameMatcher() {
  const alias = new Map();
  for (const g of fridgeConf().aliases) {
    const ns = g.map(norm);
    for (const n of ns) alias.set(n, [...new Set([...(alias.get(n) || [n]), ...ns])]);
  }
  return s => [...new Set(s.split('/').map(norm).filter(Boolean).flatMap(n => alias.get(n) || [n]))];
}
// 레시피 재료 하나 → 'always'(늘 있는 재료) / 양이 남은 재고 (기한이 이른 것 먼저) / null(없음)
function pantry() {
  const names = nameMatcher(), always = new Set(fridgeConf().always.flatMap(names));
  const items = stocks().filter(hasLeft).map(s => ({ s, ns: names(s.name) }))
    .sort((a, b) => (a.s.expiry || '9999').localeCompare(b.s.expiry || '9999'));
  return g => {
    const ns = names(g);
    if (ns.some(n => always.has(n))) return 'always';
    const hit = items.find(x => x.ns.some(n => ns.includes(n)));
    return hit ? hit.s : null;
  };
}
// 재료를 적은 메뉴마다 { m, missing: 없는 필수 재료, used: [{ s: 쓰는 재고, need: 필수인지 }], soon: 곧 먹어야 하는 재고 }
// 필수 재료가 다 있으면 '지금 만들 수 있어요', 1~2개 없으면 '1–2개만 있으면 돼요' (재고에 있는 필수 재료가 하나는 있을 때만)
// 곧 먹어야 하는 재료를 많이 쓰는 것, 그 기한이 이른 것 먼저
function cookPlans() {
  const find = pantry(), out = [];
  for (const m of menus()) {
    const need = m.ingredients || [];
    if (!need.length) continue;
    const missing = [], used = new Map();
    const use = (g, isNeed) => {
      const hit = find(g);
      if (hit && hit !== 'always') used.set(hit, used.get(hit) || isNeed);
      return hit;
    };
    for (const g of need) if (!use(g, true)) missing.push(g);
    for (const g of m.optional || []) use(g, false);
    if (missing.length > 2 || (missing.length && ![...used.values()].some(Boolean))) continue;
    const soon = [...used.keys()].filter(isSoon);
    out.push({ m, missing, used: [...used].map(([s, isNeed]) => ({ s, need: isNeed })), soon, first: Math.min(...soon.map(daysLeft)) });
  }
  return out.sort((a, b) => b.soon.length - a.soon.length || a.first - b.first
    || a.missing.length - b.missing.length || a.m.name.localeCompare(b.m.name, 'ko'));
}

// ---------- 그리기 ----------
const fridgePane = () => (prefs.fridgePane === 'cook' ? 'cook' : 'stock'); // 폰에서 보는 쪽
// 빠른 추가로 넣을 곳 (위치가 하나도 없으면 '' = 위치 미정)
const addPlace = () => (places().some(p => p.id === prefs.stockPlace) ? prefs.stockPlace : (places()[0] || {}).id || '');
function renderFridge() {
  $('fridgeView').dataset.pane = fridgePane();
  document.querySelectorAll('#fridgeSeg [data-pane]').forEach(b => b.classList.toggle('on', b.dataset.pane === fridgePane()));
  $('placePills').replaceChildren(...places().map(p => button(p.name, () => {
    prefs.stockPlace = p.id;
    savePrefs();
    render();
    if (!phone()) $('stockInput').focus();
  }, p.id === addPlace() ? 'on' : '')));
  renderStock();
  renderCook();
  renderAliases();
}
$('fridgeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-pane]');
  if (!b) return;
  prefs.fridgePane = b.dataset.pane;
  savePrefs();
  render();
});

// 재고: 맨 위 '곧 먹어야 해요'(3일 이내)·'기한 지났어요' 칩, 그 아래 보관 위치 카드 (재료 = 칩)
// 위치를 누르면 그곳만 진하게 · 재료를 누르면 그 아래에 자세히(양 바꾸기) · 재료를 끌어(폰은 길게 눌러) 다른 위치에 놓으면 옮김
let mapSel = null; // 고른 것 (앱을 켜 둔 동안): { place: id | '' (위치 미정) } 또는 { item: id, top: 맨 위 칩에서 골랐는지 }
function renderStock() {
  const all = stocks(), item = mapSel && mapSel.item ? all.find(s => s.id === mapSel.item) : null;
  const ps = places(), ids = new Set(ps.map(p => p.id)), where = s => (ids.has(s.place) ? s.place : '');
  const selPlace = item ? where(item) : mapSel && 'place' in mapSel ? mapSel.place : undefined; // undefined = 고른 것 없음
  const out = [];
  // 맨 위: 곧 먹어야 해요 · 기한 지났어요
  const soon = all.filter(isSoon).sort((a, b) => daysLeft(a) - daysLeft(b));
  if (soon.length) {
    const box = h('div', 'stock-alert');
    for (const [title, list] of [['곧 먹어야 해요', soon.filter(s => daysLeft(s) >= 0)], ['기한 지났어요', soon.filter(s => daysLeft(s) < 0)]]) {
      if (!list.length) continue;
      const row = h('div', 'alert-row');
      row.append(h('span', 'alert-title', title), ...list.map(s => stockChip(s, item === s && mapSel.top, true)));
      box.append(row);
    }
    out.push(box);
    if (item && mapSel.top) out.push(itemInfo(item));
  }
  // 보관 위치 카드 (+ 위치 미정: 재료가 있을 때만)
  const map = h('div', 'stock-map');
  const zones = [...ps.map(p => [p, all.filter(s => s.place === p.id)]), [null, all.filter(s => !where(s))]];
  for (const [p, list] of zones) {
    if (!p && !list.length) continue;
    const id = p ? p.id : '', on = selPlace !== undefined && selPlace === id;
    map.append(placeCard(p, list, item, on ? 'on' : selPlace !== undefined ? 'dim' : ''));
    if (on && !item) map.append(placeInfo(p, list));
    else if (on && !mapSel.top) map.append(itemInfo(item)); // 고른 것 바로 아래 (폰에서 멀리 내려가지 않게)
  }
  map.append(alwaysCard(selPlace !== undefined ? 'dim' : ''));
  const add = button('＋ 위치', () => { addPlaceRec(); }, 'place-card add');
  add.title = '보관 위치 더하기 (냉장고 2대 등)';
  map.append(add);
  out.push(map);
  if (!all.length) out.push(h('p', 'hint center', '위 칸에 재료를 적고 Enter. 쉼표나 줄바꿈으로 나눠 여러 개를 한 번에 넣어요.'));
  $('stockList').replaceChildren(...out);
}
// 위치 카드: 그림 · 이름 · 개수, 재료 칩 (기본 재료는 '기본 재료 n' 칩을 눌러야 보임, 펼친 곳은 기기별로 기억 prefs.baseOpen)
function placeCard(p, list, item, state) {
  const id = p ? p.id : '', key = id || 'none', open = !!(prefs.baseOpen || {})[key];
  const out = list.filter(s => !hasLeft(s)).length, soon = list.filter(isSoon).length;
  const head = h('div', 'place-head'), name = h('div', 'place-name');
  name.append(h('b', '', p ? p.name : '위치 미정'),
    h('small', '', [`${list.length}개`, soon && `곧 ${soon}`, out && `다 떨어짐 ${out}`].filter(Boolean).join(' · ')));
  head.append(placeIcon(p), name);
  const card = h('div', `place-card ${p ? '' : 'none'} ${state}`), chips = h('div', 'place-items');
  // 다 떨어진 것은 뒤로
  const order = xs => [...xs.filter(hasLeft), ...xs.filter(s => !hasLeft(s))];
  const base = list.filter(s => s.base);
  chips.append(...order(list.filter(s => !s.base)).map(s => stockChip(s, item === s && !mapSel.top)));
  if (base.length) {
    const fold = h('span', 'item-chip base-fold' + (open ? ' open' : ''), `기본 재료 ${base.length}`);
    fold.title = open ? '기본 재료 접기' : '기본 재료 펼치기 (간장처럼 오래 두는 것)';
    fold.addEventListener('click', e => {
      e.stopPropagation();
      const o = { ...prefs.baseOpen };
      if (open) delete o[key]; else o[key] = true;
      prefs.baseOpen = o;
      savePrefs();
      render();
    });
    chips.append(fold);
    if (open) chips.append(...order(base).map(s => stockChip(s, item === s && !mapSel.top)));
  }
  if (!list.length) chips.append(h('span', 'hint', '비어 있어요'));
  card.append(head, chips);
  card.style.setProperty('--pc', p ? typeOf(p).color : 'var(--faint)');
  if (p) card.dataset.place = id; // 재료를 끌어 놓을 곳
  card.title = '누르면 이곳만';
  card.addEventListener('click', e => {
    if (e.target.closest('.item-chip')) return;
    const again = mapSel && !mapSel.item && mapSel.place === id;
    mapSel = again ? null : { place: id };
    if (p && !again) { prefs.stockPlace = id; savePrefs(); } // 빠른 추가도 이곳으로
    render();
  });
  return card;
}
// 재료 칩: 점 색 = 양 (많음·조금·다 떨어짐), 테두리 = 유통기한 (곧·지남). 누르면 아래에 자세히, 다시 누르면 닫기
// 끌어서(폰은 길게 누른 채) 다른 위치 카드에 놓으면 옮김. top = 맨 위 '곧 먹어야 해요' 줄의 칩
function stockChip(s, on, top = false) {
  const d = daysLeft(s), due = hasLeft(s) && d !== null && d <= SOON_DAYS ? (d < 0 ? 'over' : 'soon') : '';
  const c = h('span', `item-chip l${s.level} ${due} ${on ? 'on' : ''}`);
  c.append(h('span', 'dot'), h('span', '', s.name));
  if (due) c.append(h('span', 'chip-due', dueText(d, s.expiry)));
  c.title = `${AMOUNTS[s.level]}${s.expiry ? ` · ${dueText(d, s.expiry)}` : ''}${s.memo ? ` · ${s.memo}` : ''} — 끌어서 다른 위치로`;
  c.addEventListener('click', () => { mapSel = on ? null : { item: s.id, top }; render(); });
  const drop = t => {
    const p = places().find(x => x.id === t.dataset.place);
    if (!p || s.place === p.id) return;
    s.place = p.id;
    touch(s);
    mapSel = { item: s.id, top: false };
    save();
    toast(`‘${s.name}’ → ${p.name}`);
  };
  dragByMouse(c, '.place-card[data-place]', drop);
  longPress(c, start => dragRow(c, '.place-card[data-place]', drop, start));
  return c;
}
// 고른 재료: 양 단추(바로 바뀜) · 위치 · 유통기한 · 메모 · 고치기
function itemInfo(s) {
  const box = h('div', 'map-info'), seg = h('div', 'seg level-seg'), d = daysLeft(s), p = placeOf(s);
  for (const l of [2, 1, 0]) seg.append(button(AMOUNTS[l], () => { setLevel(s, l); save(); }, s.level === l ? 'on' : ''));
  const tags = [p ? p.name : '위치 미정', s.expiry ? dueText(d, s.expiry) : '유통기한 없음', s.base && '기본 재료', s.memo].filter(Boolean);
  box.append(h('b', '', s.name), seg, ...tags.map(t => h('span', 'tag', t)), h('span', 'spacer'), button('고치기', () => openStock(s), 'btn small'));
  return box;
}
// 고른 위치: 종류 · 개수 · 위치 편집
function placeInfo(p, list) {
  const box = h('div', 'map-info');
  box.append(h('b', '', p ? p.name : '위치 미정'), ...(p ? [h('span', 'tag', typeOf(p).label)] : []),
    h('span', 'hint', `재료 ${list.length}개` + (p ? ' · 위 칸에 적으면 이곳에 들어가요' : '')), h('span', 'spacer'),
    button('위치 편집', openPlaces, 'btn small'));
  return box;
}
// 늘 있는 것: 재고로 세지 않고 늘 있는 걸로 치는 재료 (물·소금 등). 칩을 누르면 빼기, 끝 칸에 적고 Enter면 더하기
function alwaysCard(state) {
  const card = h('div', `place-card always ${state}`), chips = h('div', 'place-items'), name = h('div', 'place-name'), input = h('input', 'chip-add');
  name.append(h('b', '', '늘 있는 것'), h('small', '', '재고로 안 세고 늘 있는 걸로 쳐요'));
  const head = h('div', 'place-head');
  head.append(name);
  const list = fridgeConf().always;
  chips.append(...list.map(n => {
    const c = h('span', 'item-chip always', `${n} ✕`);
    c.title = '늘 있는 것에서 빼기';
    c.addEventListener('click', () => {
      if (!confirm(`‘${n}’을(를) 늘 있는 것에서 뺄까요?`)) return;
      setFridgeConf({ always: list.filter(x => x !== n) });
      save();
    });
    return c;
  }));
  input.placeholder = '+ 더하기';
  input.autocomplete = 'off';
  input.dataset.key = 'always-add';
  onEnter(input, text => {
    const add = parseIngredients(text).filter(n => !list.some(x => norm(x) === norm(n)));
    if (!add.length) return;
    setFridgeConf({ always: [...list, ...add] });
    save();
  });
  chips.append(input);
  card.append(head, chips);
  return card;
}

// ---------- 빠른 추가: 쉼표·줄바꿈으로 여러 개. 이미 있는 재료(같은 재료 포함)는 새로 안 만들고 '많음'으로 ----------
function addStocks(text) {
  const names = nameMatcher(), list = parseIngredients(text);
  if (!list.length) return; // 쉼표만 적은 경우
  let added = 0, back = 0;
  for (const name of list) {
    const ns = names(name), s = stocks().find(x => names(x.name).some(n => ns.includes(n)));
    if (!s) {
      db.recs.push(newRec('stock', { name, place: addPlace(), level: 2, expiry: '', memo: '', base: false }));
      added++;
    } else if (s.level < 2) { setLevel(s, 2); back++; }
  }
  save();
  toast(added && back ? `${added}개 넣고, ${back}개는 ‘많음’으로 바꿨어요`
    : added ? `재료 ${added}개를 넣었어요` : back ? `${back}개를 ‘많음’으로 바꿨어요` : '이미 다 있어요');
}
onEnter($('stockInput'), addStocks);

// ---------- 재료 편집 창 ----------
const stockForm = $('stockForm');
let editingStock = null, stockLevel = 2;
const syncStockLevel = () => document.querySelectorAll('#stockLevelSeg [data-level]').forEach(b => b.classList.toggle('on', +b.dataset.level === stockLevel));
function openStock(s) {
  editingStock = s;
  stockForm.name.value = s.name;
  fillSelect(stockForm.place, [...places().map(p => [p.id, p.name]), ['', '위치 미정']], placeOf(s) ? s.place : '');
  stockForm.expiry.value = s.expiry || '';
  stockForm.memo.value = s.memo || '';
  stockForm.base.checked = !!s.base;
  stockLevel = s.level;
  syncStockLevel();
  $('stockEditor').showModal();
}
$('stockLevelSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-level]');
  if (b) { stockLevel = +b.dataset.level; syncStockLevel(); }
});
stockForm.addEventListener('submit', e => {
  e.preventDefault();
  const s = editingStock;
  s.name = stockForm.name.value.trim() || s.name;
  s.place = stockForm.place.value;
  s.level = stockLevel;
  s.expiry = stockForm.expiry.value;
  s.memo = stockForm.memo.value.trim();
  s.base = stockForm.base.checked;
  touch(s);
  $('stockEditor').close();
  save();
});
$('stockCancel').addEventListener('click', () => $('stockEditor').close());
$('stockDelBtn').addEventListener('click', () => {
  if (!confirm(`‘${editingStock.name}’ 재료를 지울까요?`)) return;
  remove(editingStock);
  mapSel = null;
  $('stockEditor').close();
  save();
});

// ---------- 보관 위치 편집 (설정 › 냉장고, 위치를 누른 뒤 '위치 편집'): 노트 카테고리 편집과 같은 모양 ----------
// ⋮⋮ 끌어서 순서 · 그림을 눌러 종류(그림·색) · ✎ 이름 · ✕ 지우기 (그 재료들은 위치 미정)
let pickingType = null; // 종류 고르는 중인 위치 id
function openPlaces() {
  $('settings').close();
  pickingType = null;
  renderPlaces();
  $('placesDlg').showModal();
}
function changePlace(id, fn) { // 기본 위치도 계정에 저장한 뒤 고침
  const p = ownPlaces().find(x => x.id === id);
  if (!p) return;
  fn(p);
  touch(p);
  save();
  renderPlaces();
}
function renderPlaces() {
  const out = [];
  for (const p of places()) {
    const n = stocks().filter(s => s.place === p.id).length, row = h('div', 'row place-row'), handle = dragHandle();
    row.dataset.id = p.id;
    sortable(handle, row, '#placeManage .place-row', (t, before) => {
      const list = ownPlaces();
      reorder(list, list.find(x => x.id === p.id), list.find(x => x.id === t.dataset.id), before);
      save();
      renderPlaces();
    });
    const icon = placeIcon(p), pick = button('', () => { pickingType = pickingType === p.id ? null : p.id; renderPlaces(); }, 'type-btn' + (pickingType === p.id ? ' on' : ''));
    pick.append(icon);
    pick.title = '종류(그림·색) 바꾸기';
    pick.style.setProperty('--pc', typeOf(p).color);
    row.append(handle, pick, h('span', 'cat-name', p.name), h('span', 'hint', `재료 ${n}`), iconBtn('✎', '이름 바꾸기', async () => {
      const name = await ask('보관 위치 이름', p.name);
      if (name && name !== p.name) changePlace(p.id, x => { x.name = name; });
    }), iconBtn('✕', '위치 지우기', () => {
      if (!confirm(`‘${p.name}’ 위치를 지울까요?` + (n ? `\n재료 ${n}개는 ‘위치 미정’으로 남아요.` : ''))) return;
      ownPlaces();
      for (const s of stocks()) if (s.place === p.id) { s.place = ''; touch(s); }
      remove(recs('place').find(x => x.id === p.id));
      save();
      renderPlaces();
    }));
    out.push(row);
    if (pickingType === p.id) {
      const types = h('div', 'type-pick-row');
      types.append(...Object.entries(PLACE_TYPES).map(([k, t]) => {
        const b = button('', () => { pickingType = null; changePlace(p.id, x => { x.type = k; }); }, 'type-btn' + (p.type === k ? ' on' : ''));
        b.append(placeIcon({ type: k }), h('span', '', t.label));
        b.style.setProperty('--pc', t.color);
        return b;
      }));
      out.push(types);
    }
  }
  if (!out.length) out.push(h('p', 'hint', '보관 위치가 없어요. 재료는 모두 ‘위치 미정’에 있어요.'));
  out.push(button('+ 위치', async () => { if (await addPlaceRec()) renderPlaces(); }));
  $('placeManage').replaceChildren(...out);
}
$('placesBtn').addEventListener('click', openPlaces);
$('placesClose').addEventListener('click', () => $('placesDlg').close());

// ---------- 오늘 뭐 해 먹지 ----------
function renderCook() {
  const withIng = menus().filter(m => (m.ingredients || []).length), plans = cookPlans(), out = [];
  const now = plans.filter(p => !p.missing.length), near = plans.filter(p => p.missing.length);
  const list = ps => {
    const ul = h('ul', 'cook-list');
    ul.append(...ps.map(cookRow));
    return ul;
  };
  if (now.length) out.push(h('div', 'slot-head', `지금 만들 수 있어요 ${now.length}`), list(now));
  if (near.length) out.push(h('div', 'slot-head', `1–2개만 있으면 돼요 ${near.length}`), list(near));
  if (!out.length) {
    out.push(h('p', 'empty', !withIng.length ? '메뉴에 재료를 적어 두면 여기서 골라 줘요. (식단 › 메뉴·레시피에서 메뉴를 눌러 재료 적기)'
      : !stocks().some(hasLeft) ? '재고에 재료를 넣으면 만들 수 있는 메뉴를 보여 줘요.'
      : '지금 재료로 만들 수 있는 메뉴가 없어요.'));
  }
  $('cookList').replaceChildren(...out);
  $('cookCount').textContent = withIng.length ? `재료를 적은 메뉴 ${withIng.length}개 중` : '';
}
// 메뉴 하나: 이름(누르면 레시피) · 곧 먹어야 하는 재료 · 없는 재료 + 단추
function cookRow(p) {
  const li = h('li', 'cook-row'), main = h('div', 'cook-main'), meta = h('div', 'cook-meta'), btns = h('div', 'cook-btns');
  main.append(h('span', 'title', p.m.name));
  for (const s of p.soon) meta.append(h('span', `due ${daysLeft(s) < 0 ? 'over' : 'soon'}`, `${s.name} ${dueText(daysLeft(s), s.expiry)}`));
  if (p.missing.length) meta.append(h('span', 'cook-miss', `없어요: ${p.missing.join(', ')}`));
  if (meta.childNodes.length) main.append(meta);
  main.title = '눌러서 레시피 보기';
  main.addEventListener('click', () => openMenu(p.m));
  if (p.missing.length) btns.append(button('없는 재료 → 장보기', () => addToShop(p.missing, `‘${p.m.name}’에 없는 재료`), 'btn small'));
  btns.append(button('만들었어요', () => openCooked(p), 'btn small primary'));
  li.append(main, btns);
  return li;
}
// 같은 재료: 이름이 달라도 같은 재료로 치는 묶음 (달걀 = 계란). 칩을 누르면 빼기, 아래 칸에 적고 Enter면 더하기
function renderAliases() {
  const list = fridgeConf().aliases;
  $('aliasList').replaceChildren(...list.map(g => {
    const b = button(`${g.join(' = ')} ✕`, () => {
      if (!confirm(`‘${g.join(' = ')}’ 묶음을 뺄까요?`)) return;
      setFridgeConf({ aliases: list.filter(x => x !== g) });
      save();
    });
    b.title = '이 묶음 빼기';
    return b;
  }));
}
onEnter($('aliasInput'), text => {
  const g = [...new Set(text.split(/[=,]/).map(s => s.trim()).filter(Boolean))];
  if (g.length < 2) { toast('‘달걀 = 계란’처럼 두 이름 이상 적어 주세요'); return; }
  setFridgeConf({ aliases: [...fridgeConf().aliases, g] });
  save();
});

// ---------- 만들었어요: 오늘 식단에 넣고, 쓴 재료(체크한 것) 양을 한 단계 내림 ----------
// 끼니는 지금 시각으로 미리 골라 둠. 그 끼니에 같은 메뉴가 이미 있으면 식단은 그대로 (한 주 식단과 같음)
// 체크는 필수 재료만 미리 (선택 재료·오래 두는 기본 재료는 직접)
let cooking = null, cookedSlot = 'd';
function slotNow() {
  const hr = new Date().getHours();
  return hr < 5 ? 'n' : hr < 10 ? 'b' : hr < 15 ? 'l' : hr < 17 ? 's' : hr < 21 ? 'd' : 'n';
}
const alreadyEaten = (m, s) => mealsOn(todayStr()).some(x => x.slot === s && norm(mealName(x)) === norm(m.name));
function syncCooked() {
  document.querySelectorAll('#cookedSlot [data-slot]').forEach(b => b.classList.toggle('on', b.dataset.slot === cookedSlot));
  $('cookedNote').textContent = alreadyEaten(cooking.m, cookedSlot) ? `오늘 ${SLOTS[cookedSlot]}에 이미 있어요. 식단은 그대로 두고 재료만 내려요.` : '';
}
function openCooked(p) {
  cooking = p;
  cookedSlot = slotNow();
  $('cookedTitle').textContent = `‘${p.m.name}’ 만들었어요`;
  $('cookedItems').replaceChildren(...(p.used.length ? p.used.map(({ s, need }) => {
    const row = h('label', 'check-row'), box = h('input');
    box.type = 'checkbox';
    box.checked = need && !s.base;
    row.append(box, h('span', '', s.name),
      h('span', 'hint', `${AMOUNTS[s.level]} → ${AMOUNTS[s.level - 1]}` + (need ? '' : ' · 선택 재료') + (s.base ? ' · 기본 재료' : '')));
    return row;
  }) : [h('p', 'hint', '재고에서 쓴 재료가 없어요.')]));
  syncCooked();
  $('cooked').showModal();
}
$('cookedSlot').addEventListener('click', e => {
  const b = e.target.closest('[data-slot]');
  if (b) { cookedSlot = b.dataset.slot; syncCooked(); }
});
$('cookedCancel').addEventListener('click', () => $('cooked').close());
$('cookedOk').addEventListener('click', () => {
  const { m, used } = cooking, eaten = alreadyEaten(m, cookedSlot);
  if (!eaten) pushMeal(todayStr(), cookedSlot, m.name);
  let n = 0;
  $('cookedItems').querySelectorAll('input').forEach((box, i) => {
    const s = used[i].s;
    if (box.checked && s.level > 0) { s.level--; touch(s); n++; }
  });
  $('cooked').close();
  save();
  toast((eaten ? `오늘 ${SLOTS[cookedSlot]}에 이미 있어요` : `오늘 ${SLOTS[cookedSlot]} 식단에 넣었어요`) + (n ? ` · 재료 ${n}개 양을 내렸어요` : ''));
});
