'use strict';
// 냉장고: 재고(재료마다 보관 위치·양 3단계·유통기한·메모·기본 재료) + 오늘 뭐 해 먹지(지금 재고로 만들 수 있는 메뉴)
// 레시피는 식단의 메뉴·레시피 그대로 (menu.ingredients = 필수 재료, menu.optional = 선택 재료)
// '만들었어요' → 오늘 식단에 넣고 쓴 재료 양을 한 단계 내림. 없는 재료 → 장보기 (meals.js 의 pushMeal, addToShop)
// PC는 왼쪽 재고 + 오른쪽 추천, 폰은 위의 단추로 하나씩
const PLACES = { cold: '냉장', frozen: '냉동', room: '실온', sauce: '조미료' };
const AMOUNTS = ['다 떨어짐', '조금', '많음']; // stock.level 0·1·2
const SOON_DAYS = 3; // 유통기한이 이만큼 남았으면 '곧 먹어야 해요'
const stocks = () => recs('stock').sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const placeOf = s => (PLACES[s.place] ? s.place : 'cold');
const daysLeft = s => (s.expiry ? toNum(s.expiry) - toNum(todayStr()) : null);
const hasLeft = s => s.level > 0;
const isSoon = s => hasLeft(s) && daysLeft(s) !== null && daysLeft(s) <= SOON_DAYS; // 지난 것도
const dueText = (d, expiry) => (d < 0 ? `${-d}일 지남` : d === 0 ? '오늘까지' : d <= SOON_DAYS ? `D-${d}` : `${fmtMD(expiry)}까지`);
// 다 떨어진 걸 다시 채우면 새로 산 것 → 지난 유통기한은 지움 (저장은 부르는 쪽에서)
function restock(s) {
  if (!s.level) s.expiry = '';
  s.level = 2;
  touch(s);
}

// ---------- 설정: 항상 있는 재료(재고에 없어도 있는 걸로), 별칭(같은 재료로 칠 이름 묶음) ----------
// 계정에 저장 (id 고정 rec 하나라 기기끼리 겹치지 않음). 고친 적 없으면 기본값
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
// 이름 → 같은 재료로 치는 이름들: 띄어쓰기·대소문자 무시, 별칭 묶음, '두부/순두부'는 둘 중 아무거나 (장보기와 같음)
// 부분 일치는 안 함 ('파' ≠ '양파'). '다진 마늘'처럼 다르게 적은 건 별칭으로
function nameMatcher() {
  const alias = new Map();
  for (const g of fridgeConf().aliases) {
    const ns = g.map(norm);
    for (const n of ns) alias.set(n, [...new Set([...(alias.get(n) || [n]), ...ns])]);
  }
  return s => [...new Set(s.split('/').map(norm).filter(Boolean).flatMap(n => alias.get(n) || [n]))];
}
// 레시피 재료 하나 → 'always'(항상 있는 재료) / 양이 남은 재고 (기한이 이른 것 먼저) / null(없음)
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
const addPlace = () => (PLACES[prefs.stockPlace] ? prefs.stockPlace : 'cold'); // 빠른 추가로 넣을 곳
function renderFridge() {
  $('fridgeView').dataset.pane = fridgePane();
  document.querySelectorAll('#fridgeSeg [data-pane]').forEach(b => b.classList.toggle('on', b.dataset.pane === fridgePane()));
  document.querySelectorAll('#placeSeg [data-place]').forEach(b => b.classList.toggle('on', b.dataset.place === addPlace()));
  renderStock();
  renderCook();
}
$('fridgeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-pane]');
  if (!b) return;
  prefs.fridgePane = b.dataset.pane;
  savePrefs();
  render();
});

// 재고: 맨 위 '곧 먹어야 해요'(3일 이내) · '기한 지났어요', 그 아래 보관 위치별 (기본 재료는 접힌 줄 안에)
function renderStock() {
  const all = stocks(), soon = all.filter(isSoon).sort((a, b) => daysLeft(a) - daysLeft(b)), out = [];
  const near = soon.filter(s => daysLeft(s) >= 0), over = soon.filter(s => daysLeft(s) < 0);
  if (near.length) out.push(stockBox('곧 먹어야 해요', near, 'soon'));
  if (over.length) out.push(stockBox('기한 지났어요', over, 'over'));
  for (const p of Object.keys(PLACES)) {
    const list = all.filter(s => placeOf(s) === p && !isSoon(s));
    if (list.length) out.push(placeBox(p, list));
  }
  if (!all.length) out.push(h('p', 'hint center', '위 칸에 재료를 적고 Enter. 쉼표나 줄바꿈으로 나눠 여러 개를 한 번에 넣어요.'));
  $('stockList').replaceChildren(...out);
}
function stockBox(title, list, cls) {
  const box = h('div', `sec stock-sec ${cls}`), head = h('div', 'sec-head'), ul = h('ul', 'entries');
  head.append(h('span', 'sec-name', title), h('span', 'count', list.length));
  ul.append(...list.map(s => stockRow(s, true)));
  box.append(head, ul);
  return box;
}
// 보관 위치 하나: 기본 재료는 맨 아래 '기본 재료 n' 줄을 눌러야 보임 (펼친 곳은 기기별로 기억, prefs.baseOpen)
function placeBox(p, list) {
  const box = h('div', 'sec stock-sec'), head = h('div', 'sec-head'), ul = h('ul', 'entries');
  const base = list.filter(s => s.base), open = !!(prefs.baseOpen || {})[p];
  head.append(h('span', 'sec-name', PLACES[p]), h('span', 'count', list.length));
  ul.append(...list.filter(s => !s.base).map(s => stockRow(s)));
  box.append(head, ul);
  if (base.length) {
    const fold = h('div', 'base-head' + (open ? '' : ' folded'));
    fold.append(h('span', 'fold', '▾'), h('span', 'name', '기본 재료'), h('span', 'count', base.length));
    fold.title = open ? '접기' : '펼치기';
    fold.addEventListener('click', () => {
      const o = { ...prefs.baseOpen };
      if (open) delete o[p]; else o[p] = true;
      prefs.baseOpen = o;
      savePrefs();
      render();
    });
    box.append(fold);
    if (open) {
      const bl = h('ul', 'entries');
      bl.append(...base.map(s => stockRow(s)));
      box.append(bl);
    }
  }
  return box;
}
// 한 줄: 이름 · 메모 · (위치) · 유통기한 · 양. 양을 누르면 많음 → 조금 → 다 떨어짐 → 많음, 줄을 누르면 편집 창
function stockRow(s, showPlace) {
  const li = h('li', 'entry stock-row' + (hasLeft(s) ? '' : ' out')), d = daysLeft(s);
  li.append(h('span', 'text', s.name));
  if (s.memo) li.append(h('span', 'stock-memo', s.memo));
  if (showPlace) li.append(h('span', 'stock-place', PLACES[placeOf(s)]));
  if (d !== null && hasLeft(s)) li.append(h('span', 'due' + (d < 0 ? ' over' : d <= SOON_DAYS ? ' soon' : ''), dueText(d, s.expiry)));
  const lv = button(AMOUNTS[s.level], e => {
    e.stopPropagation();
    if (s.level) { s.level--; touch(s); } else restock(s);
    save();
  }, `level l${s.level}`);
  lv.title = '눌러서 양 바꾸기 (많음 → 조금 → 다 떨어짐)';
  li.append(lv);
  li.title = '눌러서 위치·유통기한·메모 고치기';
  li.addEventListener('click', () => openStock(s));
  return li;
}

// ---------- 빠른 추가: 쉼표·줄바꿈으로 여러 개. 이미 있는 재료(별칭 포함)는 새로 안 만들고 '많음'으로 ----------
$('placeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-place]');
  if (!b) return;
  prefs.stockPlace = b.dataset.place;
  savePrefs();
  render();
  if (!phone()) $('stockInput').focus();
});
function addStocks(text) {
  const names = nameMatcher(), list = parseIngredients(text);
  if (!list.length) return; // 쉼표만 적은 경우
  let added = 0, back = 0;
  for (const name of list) {
    const ns = names(name), s = stocks().find(x => names(x.name).some(n => ns.includes(n)));
    if (!s) {
      db.recs.push(newRec('stock', { name, place: addPlace(), level: 2, expiry: '', memo: '', base: false }));
      added++;
    } else if (s.level < 2) { restock(s); back++; }
  }
  save();
  toast(added && back ? `${added}개 넣고, ${back}개는 ‘많음’으로 바꿨어요`
    : added ? `재료 ${added}개를 넣었어요` : back ? `${back}개를 ‘많음’으로 바꿨어요` : '이미 다 있어요');
}
onEnter($('stockInput'), addStocks);

// ---------- 재료 편집 창 ----------
const stockForm = $('stockForm');
let editingStock = null, stockPlace = 'cold', stockLevel = 2;
function syncStockSegs() {
  document.querySelectorAll('#stockPlaceSeg [data-place]').forEach(b => b.classList.toggle('on', b.dataset.place === stockPlace));
  document.querySelectorAll('#stockLevelSeg [data-level]').forEach(b => b.classList.toggle('on', +b.dataset.level === stockLevel));
}
function openStock(s) {
  editingStock = s;
  stockForm.name.value = s.name;
  stockForm.expiry.value = s.expiry || '';
  stockForm.memo.value = s.memo || '';
  stockForm.base.checked = !!s.base;
  stockPlace = placeOf(s);
  stockLevel = s.level;
  syncStockSegs();
  $('stockEditor').showModal();
}
$('stockPlaceSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-place]');
  if (b) { stockPlace = b.dataset.place; syncStockSegs(); }
});
$('stockLevelSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-level]');
  if (b) { stockLevel = +b.dataset.level; syncStockSegs(); }
});
stockForm.addEventListener('submit', e => {
  e.preventDefault();
  const s = editingStock;
  s.name = stockForm.name.value.trim() || s.name;
  s.place = stockPlace;
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
  $('stockEditor').close();
  save();
});

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

// ---------- 설정 › 냉장고 ----------
$('settingsBtn').addEventListener('click', () => {
  const c = fridgeConf();
  $('alwaysInput').value = c.always.join(', ');
  $('aliasText').value = c.aliases.map(g => g.join(' = ')).join('\n');
});
enterBlurs($('alwaysInput'));
$('alwaysInput').addEventListener('change', e => { setFridgeConf({ always: parseIngredients(e.target.value) }); save(); });
// 한 줄에 한 묶음: '달걀 = 계란' (쉼표로 나눠도 됨). 이름이 하나뿐인 줄은 버림
$('aliasText').addEventListener('change', e => {
  const aliases = e.target.value.split('\n').map(l => [...new Set(l.split(/[=,]/).map(s => s.trim()).filter(Boolean))]).filter(g => g.length > 1);
  setFridgeConf({ aliases });
  save();
});
