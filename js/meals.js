'use strict';
// 식단: 달력(하루 칸 = 그날 메뉴) + 그날 식단 + 메뉴·레시피 목록
// 아침·점심·저녁은 넣을 때만 고르고, 달력 칸에는 메뉴 이름만 (끼니 순서대로)
// 메뉴에 재료를 적어 두면 '재료 → 장보기'로 장보기 노트의 '살 것'에 표시
const SLOTS = { b: '아침', l: '점심', d: '저녁' };
const slotRank = m => 'bld'.indexOf(m.slot);
const slot = () => prefs.slot || 'd';
const menus = () => recs('menu').sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const mealsOn = s => recs('meal').filter(m => m.date === s).sort((a, b) => slotRank(a) - slotRank(b) || byOrder(a, b));
const menuNamed = name => recs('menu').find(x => norm(x.name) === norm(name)) || null;
// 식단의 메뉴: 연결된 메뉴, 없으면 이름이 같은 메뉴
const menuOf = m => recs('menu').find(x => x.id === m.menu) || menuNamed(m.name);
const mealName = m => (recs('menu').find(x => x.id === m.menu) || m).name;

let selected = todayStr();
let view = { y: ymd(selected)[0], m: ymd(selected)[1] };
function select(s) {
  selected = s;
  const [y, m] = ymd(s);
  view = { y, m };
  render();
}
function shiftMonth(d) {
  let m = view.m + d, y = view.y;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  view = { y, m };
  render();
}

function renderMeals() {
  $('monthTitle').textContent = `${view.y}년 ${view.m}월`;
  renderGrid();
  renderDay();
  renderMenus();
}

// ---------- 달력 ----------
function renderGrid() {
  const grid = $('grid'), today = todayStr(), v = view;
  const first = toNum(`${v.y}-${pad(v.m)}-01`), start = first - weekday(first);
  const weeks = Math.ceil((weekday(first) + new Date(Date.UTC(v.y, v.m, 0)).getUTCDate()) / 7);
  grid.style.gridTemplateRows = phone() ? '' : `repeat(${weeks}, minmax(0, 1fr))`; // 폰: 칸이 내용만큼 늘어남
  grid.replaceChildren();
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const s = toStr(start + i), [, m, d] = ymd(s), hol = HOLIDAYS[s];
    const cell = h('div', 'cell');
    if (m !== v.m) cell.classList.add('out');
    if (s === today) cell.classList.add('today');
    if (s === selected) cell.classList.add('sel');
    if (i % 7 === 0 || hol) cell.classList.add('sun'); else if (i % 7 === 6) cell.classList.add('sat');
    const head = h('div', 'cell-head');
    head.append(h('span', 'num', d));
    if (hol) head.append(h('span', 'hol', hol));
    cell.append(head);
    cell.addEventListener('click', () => { select(s); if (!phone()) $('mealInput').focus(); });
    grid.append(cell);
    cells.push([cell, s]);
  }
  // 칸에 들어가는 줄 수: 한 줄 높이를 실제로 재서 계산 (폰은 다 보여줌)
  const [cell0] = cells[0], head = cell0.firstChild, probe = h('div', 'chip', '가');
  cell0.append(probe);
  const lineH = probe.offsetHeight + 2;
  probe.remove();
  const room = phone() ? Infinity : Math.max(1, Math.floor((cell0.clientHeight - head.offsetTop - head.offsetHeight - 4) / lineH));
  for (const [cell, s] of cells) {
    const list = mealsOn(s), shown = list.length > room ? room - 1 : list.length;
    for (const m of list.slice(0, shown)) {
      const c = h('div', 'chip', mealName(m));
      c.title = `${SLOTS[m.slot]} · ${mealName(m)}`;
      cell.append(c);
    }
    if (list.length > shown) cell.append(h('div', 'more', `+${list.length - shown}개 더`));
  }
}
$('prevBtn').addEventListener('click', () => shiftMonth(-1));
$('nextBtn').addEventListener('click', () => shiftMonth(1));
$('todayBtn').addEventListener('click', () => select(todayStr()));
// 폰: 달력을 옆으로 밀면 달 넘기기
let swipe0 = null;
$('grid').addEventListener('touchstart', e => {
  swipe0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
$('grid').addEventListener('touchend', e => {
  if (!swipe0) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe0.x, dy = t.clientY - swipe0.y;
  swipe0 = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx < 0 ? 1 : -1);
});

// ---------- 그날 식단 ----------
function renderDay() {
  $('dayTitle').textContent = fmtDay(selected) + (HOLIDAYS[selected] ? ` · ${HOLIDAYS[selected]}` : '');
  const list = mealsOn(selected), out = [];
  for (const k of 'bld') {
    const ms = list.filter(m => m.slot === k);
    if (!ms.length) continue;
    const ul = h('ul', 'list');
    ul.append(...ms.map(mealRow));
    out.push(h('div', 'slot-head', SLOTS[k]), ul);
  }
  $('mealList').replaceChildren(...(out.length ? out : [h('p', 'empty', '식단이 없어요')]));
  document.querySelectorAll('#slotSeg [data-slot]').forEach(b => b.classList.toggle('on', b.dataset.slot === slot()));
}
function mealRow(m) {
  const li = h('li'), menu = menuOf(m);
  li.append(h('span', 'title', mealName(m)));
  const n = menu ? (menu.ingredients || []).length : 0;
  li.append(h('span', 'meta', n ? `재료 ${n}` : menu ? '' : '+ 레시피'));
  li.append(iconBtn('✕', '식단에서 빼기', () => { remove(m); save(); }));
  li.title = menu ? '눌러서 레시피 보기' : '눌러서 메뉴(재료·레시피) 등록';
  li.addEventListener('click', () => openMenu(menu || newRec('menu', { name: m.name, ingredients: [], recipe: '', link: '' }), m));
  return li;
}
function addMeal(name) {
  const menu = menuNamed(name), s = slot();
  db.recs.push(newRec('meal', {
    date: selected, slot: s, name: menu ? menu.name : name, menu: menu ? menu.id : null,
    order: nextOrder(mealsOn(selected).filter(m => m.slot === s)),
  }));
  save();
}
$('slotSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-slot]');
  if (!b) return;
  prefs.slot = b.dataset.slot;
  savePrefs();
  renderDay();
  if (!phone()) $('mealInput').focus();
});
// 메뉴 넣기: 적으면 메뉴 목록에서 찾아 보여줌 (없는 이름도 그냥 넣을 수 있음)
const mealInput = $('mealInput'), mealSuggest = $('mealSuggest');
mealInput.addEventListener('input', () => {
  const q = norm(mealInput.value);
  const hits = q ? menus().filter(x => norm(x.name).includes(q)).slice(0, 8) : [];
  mealSuggest.replaceChildren(...hits.map(x => suggestBtn(x.name, () => {
    mealInput.value = '';
    mealSuggest.hidden = true;
    addMeal(x.name);
  })));
  mealSuggest.hidden = !hits.length;
});
mealInput.addEventListener('blur', () => { mealSuggest.hidden = true; });
onEnter(mealInput, text => { mealSuggest.hidden = true; addMeal(text); });

// ---------- 메뉴·레시피 ----------
function renderMenus() {
  const q = norm($('menuSearch').value), all = menus();
  // 재료로도 찾기 (예: '두부' → 두부가 들어가는 메뉴)
  const list = q ? all.filter(x => norm(x.name).includes(q) || (x.ingredients || []).some(g => norm(g).includes(q))) : all;
  $('menuCount').textContent = all.length || '';
  $('menuList').replaceChildren(...(list.length ? list.map(menuRow)
    : [h('li', 'empty', all.length ? '찾는 메뉴가 없어요' : '메뉴를 등록하면 식단에 골라 넣고, 재료를 장보기로 보낼 수 있어요')]));
}
function menuRow(x) {
  const li = h('li'), n = (x.ingredients || []).length;
  li.append(h('span', 'title', x.name));
  if (n) li.append(h('span', 'meta', `재료 ${n}`));
  li.append(iconBtn('＋', `${fmtMD(selected)} ${SLOTS[slot()]}에 넣기`, () => addMeal(x.name)));
  li.addEventListener('click', () => openMenu(x));
  return li;
}
$('menuSearch').addEventListener('input', renderMenus);
$('newMenuBtn').addEventListener('click', () => openMenu(newRec('menu', { name: '', ingredients: [], recipe: '', link: '' })));

// 메뉴 편집 창. meal을 주면 저장할 때 그 식단에 이 메뉴를 연결
const menuForm = $('menuForm');
let editingMenu = null, linkMeal = null;
const parseIngredients = v => [...new Set(v.split(/[\n,]/).map(s => s.trim()).filter(Boolean))];
function syncMenuLink() {
  const v = menuForm.link.value.trim();
  $('menuLinkOpen').hidden = !/^https?:\/\//.test(v);
  $('menuLinkOpen').href = v;
}
function openMenu(menu, meal) {
  editingMenu = menu;
  linkMeal = meal || null;
  menuForm.name.value = menu.name;
  menuForm.ingredients.value = (menu.ingredients || []).join('\n');
  menuForm.recipe.value = menu.recipe || '';
  menuForm.link.value = menu.link || '';
  $('menuDelBtn').hidden = !db.recs.includes(menu);
  syncMenuLink();
  $('menuEditor').showModal();
  if (!menu.name) menuForm.name.focus();
}
menuForm.link.addEventListener('input', syncMenuLink);
menuForm.addEventListener('submit', e => {
  e.preventDefault();
  const m = editingMenu;
  m.name = menuForm.name.value.trim();
  m.ingredients = parseIngredients(menuForm.ingredients.value);
  m.recipe = menuForm.recipe.value;
  m.link = menuForm.link.value.trim();
  touch(m);
  if (!db.recs.includes(m)) db.recs.push(m);
  if (linkMeal && linkMeal.menu !== m.id) { linkMeal.menu = m.id; touch(linkMeal); }
  $('menuEditor').close();
  save();
});
$('menuCancel').addEventListener('click', () => $('menuEditor').close());
$('menuDelBtn').addEventListener('click', () => {
  if (!confirm(`‘${editingMenu.name}’ 메뉴를 지울까요? 달력에 넣은 식단은 이름만 남아요.`)) return;
  remove(editingMenu);
  $('menuEditor').close();
  save();
});
$('menuShopBtn').addEventListener('click', () => {
  const names = parseIngredients(menuForm.ingredients.value);
  if (!names.length) { alert('재료를 먼저 적어 주세요.'); return; }
  addToShop(names, `‘${menuForm.name.value.trim() || '이 메뉴'}’ 재료`);
});
$('weekShopBtn').addEventListener('click', () => {
  const n0 = toNum(selected), a = n0 - weekday(n0), range = `${fmtMD(toStr(a))}~${fmtMD(toStr(a + 6))}`;
  const names = [];
  for (let i = 0; i < 7; i++) {
    for (const m of mealsOn(toStr(a + i))) {
      for (const g of (menuOf(m) || {}).ingredients || []) if (!names.some(x => norm(x) === norm(g))) names.push(g);
    }
  }
  if (!names.length) { alert(`${range} 식단에 재료가 적힌 메뉴가 없어요.\n식단의 메뉴를 눌러 재료를 적어 주세요.`); return; }
  addToShop(names, `${range} 식단 재료`);
});

// 재료를 장보기(첫 번째 장보기 노트)의 '살 것'으로. 목록에 있으면 표시만, 없으면 '기타' 묶음(없으면 미분류)에 새로
function addToShop(names, label) {
  const n = notes().find(x => x.type === 'shop');
  const todo = names.map(name => ({ name, e: n && findEntry(n, name) })).filter(p => !(p.e && toBuy(p.e)));
  if (!todo.length) { toast('이미 모두 살 것에 있어요'); return; }
  const lines = todo.map(p => `· ${p.e ? p.e.text : `${p.name} (새 항목)`}`);
  if (!confirm(`${label}를 ‘${n ? n.title : '장보기'}’의 살 것에 추가할까요?\n\n${lines.join('\n')}`)) return;
  let note = n;
  if (!note) {
    note = newRec('note', { type: 'shop', title: '장보기', sections: [], text: '', order: nextOrder(notes()) });
    db.recs.push(note);
  }
  for (const p of todo) {
    if (p.e) { p.e.need = true; p.e.done = false; touch(p.e); } else addEntry(note, looseSection(note), p.name, { need: true });
  }
  save();
  toast(`장보기에 ${todo.length}개 추가했어요`);
}
