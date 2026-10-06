'use strict';
// 식단: 달력(하루 칸 = 그날 메뉴) + 그날 식단 + 메뉴·레시피 목록
// 아침·점심·간식·저녁·야식은 넣을 때만 고르고, 달력 칸에는 끼니마다 대표 메뉴 하나만 (끼니 색으로)
// 메뉴에 재료를 적어 두면 '재료 → 장보기'로 장보기 노트의 '살 것'에 표시
const SLOTS = { b: '아침', l: '점심', s: '간식', d: '저녁', n: '야식' };
const SLOT_ORDER = 'blsdn';
const slotRank = m => SLOT_ORDER.indexOf(m.slot);
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
// 칸에는 끼니마다 대표 메뉴 하나 (끼니 색으로). 대표: 메인 > 국 > 반찬 > 밥·면 > 그 밖, 같으면 먼저 넣은 것
const REP = ['메인', '국', '반찬', '밥·면'];
const repRank = m => { const i = REP.indexOf((menuOf(m) || {}).course); return i < 0 ? REP.length : i; };
const slotsOn = s => [...SLOT_ORDER].map(k => mealsOn(s).filter(m => m.slot === k)).filter(ms => ms.length);
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
    const list = slotsOn(s), shown = list.length > room ? room - 1 : list.length;
    for (const ms of list.slice(0, shown)) {
      const c = h('div', `chip slot-${ms[0].slot}`, mealName(ms.reduce((a, b) => repRank(b) < repRank(a) ? b : a)));
      c.title = `${SLOTS[ms[0].slot]} · ${ms.map(mealName).join(', ')}`;
      cell.append(c);
    }
    if (list.length > shown) cell.append(h('div', 'more', `+${list.length - shown}개 더`));
  }
}
// 달 넘기기 단추는 가계부와 같이 씀 (가계부는 budget.js)
$('prevBtn').addEventListener('click', () => { if (prefs.view === 'meals') shiftMonth(-1); });
$('nextBtn').addEventListener('click', () => { if (prefs.view === 'meals') shiftMonth(1); });
$('todayBtn').addEventListener('click', () => { if (prefs.view === 'meals') select(todayStr()); });
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
  for (const k of SLOT_ORDER) {
    const ms = list.filter(m => m.slot === k);
    if (!ms.length) continue;
    const ul = h('ul', 'list');
    ul.append(...ms.map(mealRow));
    out.push(h('div', `slot-head slot-dot slot-${k}`, SLOTS[k]), ul);
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
// 식단에 메뉴 하나 (저장은 부르는 쪽에서)
function pushMeal(date, s, name) {
  const menu = menuNamed(name);
  db.recs.push(newRec('meal', {
    date, slot: s, name: menu ? menu.name : name, menu: menu ? menu.id : null,
    order: nextOrder(mealsOn(date).filter(m => m.slot === s)),
  }));
}
function addMeal(name) {
  pushMeal(selected, slot(), name);
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
// 메뉴 이름 칸: 적으면 메뉴 목록에서 찾아 보여주고, 고르거나 Enter면 onPick(이름) (없는 이름도 그냥 됨)
function menuInput(input, box, onPick) {
  input.addEventListener('input', () => {
    const q = norm(input.value);
    const hits = q ? menus().filter(x => norm(x.name).includes(q)).slice(0, 8) : [];
    box.replaceChildren(...hits.map(x => suggestBtn(x.name, () => {
      input.value = '';
      box.hidden = true;
      onPick(x.name);
    })));
    box.hidden = !hits.length;
  });
  input.addEventListener('blur', () => { box.hidden = true; });
  onEnter(input, text => { box.hidden = true; onPick(text); });
}
menuInput($('mealInput'), $('mealSuggest'), addMeal);

// ---------- 메뉴·레시피 ----------
// 분류 = 종류(cuisine) › 분류(course) › 하위분류(sub). 비어 있어도 됨 (종류·분류가 없으면 '미분류')
// 순서: 종류는 menu-presets.js 의 CUISINES 순서, 분류·하위분류·메뉴는 가나다순. '기타'·미분류는 맨 뒤, 하위분류 없는 메뉴는 맨 앞
const NO_CAT = '미분류';
const cuisineOf = x => x.cuisine || NO_CAT;
const courseOf = x => x.course || NO_CAT;
const COURSE_ORDER = Object.keys(COURSES);
// 편집 창 자동완성에 넣는 정해 둔 분류·하위분류 (이름을 바꾼 종류(예: 디저트 → 간식·디저트)는 원래 종류의 분류)
const courseOrder = cuisine => CUISINE_COURSES[cuisine]
  || (CUISINES.includes(cuisine) ? null : CUISINE_COURSES[presetCuisineOf(cuisine)]) || COURSE_ORDER;
const subOrder = course => COURSES[course] || [];
const rankIn = (known, v) => !v ? -1 : known.includes(v) ? known.indexOf(v) : known.length;
// '기타'는 늘 뒤 (직접 만든 이름보다도)
const ranker = known => (a, b) => (a === NO_CAT) - (b === NO_CAT) || (a === '기타') - (b === '기타')
  || rankIn(known, a) - rankIn(known, b) || a.localeCompare(b, 'ko');
const abc = ranker([]); // 가나다순 (분류·하위분류)
function groupBy(list, key, order) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m].sort((a, b) => order(a[0], b[0]));
}
let menuCuisine = null, menuCourse = null; // 지금 보고 있는 종류·분류 (찾는 중이면 null)
const known = v => v && v !== NO_CAT ? v : '';

// 그룹 = 종류 › 분류 › 하위분류 경로 (앞쪽 일부만이어도 됨). 메뉴마다 적힌 분류 값으로 정해지고,
// 직접 만든 빈 그룹(설정 › 메뉴 분류 정리의 ＋)만 따로 계정에 저장 (id 고정 rec 하나라 기기끼리 겹치지 않음)
const LEVELS = ['cuisine', 'course', 'sub'];
const GROUPS_ID = 'menu-groups';
const pkey = p => p.join('›');
const pathOf = x => LEVELS.map(f => x[f] || '');
const startsWith = (p, q) => q.every((v, i) => p[i] === v); // p가 q 그룹 안
const menusIn = p => menus().filter(x => startsWith(pathOf(x), p));
const extraGroups = () => (recs('groups').find(r => r.id === GROUPS_ID) || {}).paths || [];
function setExtraGroups(paths) { // 저장은 부르는 쪽에서
  let r = db.recs.find(x => x.id === GROUPS_ID);
  if (!r) { r = { ...newRec('groups', {}), id: GROUPS_ID }; db.recs.push(r); }
  r.paths = paths;
  touch(r);
}
// 그룹 p 바로 아래 그룹 이름들 (메뉴에 적힌 것 + 직접 만든 것)
function childrenOf(p) {
  const L = p.length, names = new Set();
  if (L === 3) return [];
  menusIn(p).forEach(x => names.add(x[LEVELS[L]] || ''));
  extraGroups().filter(q => q.length > L && startsWith(q, p)).forEach(q => names.add(q[L]));
  names.delete('');
  return [...names].sort(L === 0 ? ranker(CUISINES) : abc);
}
// 메뉴 하나를 그룹 p로 (메뉴·레시피에서 ⋮⋮로 끌어 놓기). 종류·분류에 놓으면 아래 분류가 거기에도 있을 때만 그대로
function moveMenu(x, p) {
  const to = [...p];
  let keep = true;
  while (to.length < 3) {
    const v = x[LEVELS[to.length]] || '';
    keep = keep && !!v && childrenOf(to).includes(v);
    to.push(keep ? v : '');
  }
  if (pkey(to) === pkey(pathOf(x))) return;
  [x.cuisine, x.course, x.sub] = to;
  touch(x);
  save();
  toast(`‘${x.name}’ → ${to.filter(Boolean).join(' › ') || NO_CAT}`);
}
// 끌어 놓을 수 있는 곳: data-path = 그룹 경로
function dropAt(el, p) {
  if (p) el.dataset.path = JSON.stringify(p);
  return el;
}

// 알약 줄: 누르면 prefs[key]에 기억 (미분류 하나뿐이면 숨김). pathFor(값) = 메뉴를 끌어 놓으면 갈 그룹
function menuPills(box, values, on, key, pathFor) {
  box.hidden = values.length < 2 && !known(values[0]);
  box.replaceChildren(...values.map(v => dropAt(button(v, () => {
    prefs[key] = v;
    prefs.menuTag = null;
    savePrefs();
    $('menuSearch').value = '';
    renderMenus();
  }, v === on ? 'on' : ''), pathFor(v))));
}
// 하위분류 제목: 처음엔 접혀 있고 누르면 펼침 (펼친 것은 prefs.menuOpen에 기억). 펼쳐져 있으면 true
const groupKey = (c, k, s) => [c, k, s].join('›');
function menuSubHead(c, k, s, n, out) {
  const key = groupKey(c, k, s), open = !!(prefs.menuOpen || {})[key];
  const head = dropAt(h('div', 'menu-sub' + (open ? '' : ' folded')), [known(c), known(k), s]);
  head.append(h('span', 'fold', '▾'), h('span', 'name', s), h('span', 'count', n),
    iconBtn('＋', `‘${s}’에 새 메뉴`, () => newMenu(s)));
  head.title = open ? '접기' : '펼치기';
  head.addEventListener('click', () => {
    const o = { ...prefs.menuOpen };
    if (open) delete o[key]; else o[key] = true;
    prefs.menuOpen = o;
    savePrefs();
    renderMenus();
  });
  out.push(head);
  return open;
}
// 종류 → 분류를 골라 그 메뉴만 하위분류별로. 찾을 때·태그를 골랐을 때는 모든 메뉴에서 (다 펼쳐서)
// 메뉴의 ⋮⋮를 끌어 하위분류 제목·분류·종류 알약·다른 메뉴 위에 놓으면 그 그룹으로 옮김
const tagsOf = x => x.tags || [];
let menuTag = null; // 보고 있는 태그
function renderMenus() {
  const q = norm($('menuSearch').value), all = menus(), ex = extraGroups();
  const pick = (values, v) => values.includes(v) ? v : values[0];
  const tags = [...new Set(all.flatMap(tagsOf))].sort(ranker(TAG_PRESETS));
  menuTag = !q && tags.includes(prefs.menuTag) ? prefs.menuTag : null;
  $('menuTags').hidden = !tags.length;
  $('menuTags').replaceChildren(...tags.map(t => button(`#${t}`, () => {
    prefs.menuTag = t === menuTag ? null : t; // 다시 누르면 태그 보기 끝
    savePrefs();
    $('menuSearch').value = '';
    renderMenus();
  }, t === menuTag ? 'on' : '')));
  const flat = q || menuTag;
  const cuisines = [...new Set([...all.map(cuisineOf), ...ex.map(p => p[0])])].sort(ranker(CUISINES));
  menuCuisine = flat ? null : pick(cuisines, prefs.menuCuisine);
  const courses = [...new Set([...all.filter(x => cuisineOf(x) === menuCuisine).map(courseOf),
    ...ex.filter(p => p[0] === menuCuisine && p[1]).map(p => p[1])])].sort(abc);
  menuCourse = flat ? null : pick(courses, prefs.menuCourse);
  menuPills($('menuCuisines'), cuisines, menuCuisine, 'menuCuisine', v => v === NO_CAT ? null : [v]);
  menuPills($('menuCourses'), courses, menuCourse, 'menuCourse', v => known(menuCuisine) && known(v) ? [menuCuisine, v] : null);
  // 재료·태그로도 찾기 (예: '두부' → 두부가 들어가는 메뉴)
  const list = q ? all.filter(x => [x.name, ...(x.ingredients || []), ...tagsOf(x)].some(v => norm(v).includes(q)))
    : menuTag ? all.filter(x => tagsOf(x).includes(menuTag))
    : all.filter(x => cuisineOf(x) === menuCuisine && courseOf(x) === menuCourse);
  $('menuCount').textContent = all.length || '';
  const out = [], ul = ms => {
    const e = h('ul', 'list');
    e.append(...ms.map(menuRow));
    return e;
  };
  if (flat) {
    for (const [c, inC] of groupBy(list, cuisineOf, ranker(CUISINES))) {
      for (const [k, inK] of groupBy(inC, courseOf, abc)) {
        for (const [s, ms] of groupBy(inK, x => x.sub || '', abc)) {
          out.push(dropAt(h('div', 'slot-head', [c, known(k), s].filter(Boolean).join(' › ')), [known(c), known(k), s]), ul(ms));
        }
      }
    }
  } else {
    // 메뉴가 없어도 직접 만든 하위분류는 보여줌 (끌어 놓을 수 있게)
    const subs = [...new Set([...list.map(x => x.sub || ''),
      ...ex.filter(p => p[0] === menuCuisine && p[1] === menuCourse && p[2]).map(p => p[2])])].sort(abc);
    for (const s of subs) {
      const ms = list.filter(x => (x.sub || '') === s);
      if (s && !menuSubHead(menuCuisine, menuCourse, s, ms.length, out)) continue; // 접힌 하위분류
      if (ms.length) out.push(ul(ms));
    }
  }
  $('menuList').replaceChildren(...(out.length ? out
    : [h('p', 'empty', !all.length ? '메뉴를 등록하면 식단에 골라 넣고, 재료를 장보기로 보낼 수 있어요. (설정 › 기본 메뉴 넣기)'
      : q ? '찾는 메뉴가 없어요' : '아직 메뉴가 없어요')]));
}
function menuRow(x) {
  const li = dropAt(h('li', 'menu-row'), pathOf(x)), n = (x.ingredients || []).length, handle = dragHandle();
  handle.title = '끌어서 다른 하위분류·분류·종류 위에 놓기';
  handle.addEventListener('click', e => e.stopPropagation()); // 끌고 난 뒤 편집 창이 열리지 않게
  li.append(handle, h('span', 'title', x.name));
  if (n) li.append(h('span', 'meta', `재료 ${n}`));
  li.append(iconBtn('＋', `${fmtMD(selected)} ${SLOTS[slot()]}에 넣기`, () => addMeal(x.name)));
  li.addEventListener('click', () => openMenu(x));
  sortable(handle, li, '#menuPanel [data-path]', t => moveMenu(x, JSON.parse(t.dataset.path)));
  return li;
}
$('menuSearch').addEventListener('input', renderMenus);
// 새 메뉴는 지금 보고 있는 종류·분류로 (하위분류 제목의 ＋는 그 하위분류까지, 태그를 보고 있으면 그 태그)
const newMenu = (sub = '') => openMenu(newRec('menu', {
  name: '', cuisine: known(menuCuisine), course: known(menuCourse), sub, tags: menuTag ? [menuTag] : [],
  ingredients: [], recipe: '', link: '',
}));
$('newMenuBtn').addEventListener('click', () => newMenu());

// 메뉴 편집 창. meal을 주면 저장할 때 그 식단에 이 메뉴를 연결
const menuForm = $('menuForm');
let editingMenu = null, linkMeal = null;
const parseIngredients = v => [...new Set(v.split(/[\n,]/).map(s => s.trim()).filter(Boolean))];
function syncMenuLink() {
  const v = menuForm.link.value.trim();
  $('menuLinkOpen').hidden = !/^https?:\/\//.test(v);
  $('menuLinkOpen').href = v;
}
// 분류 칸 자동완성: 정해 둔 것 + 메뉴에 적힌 것. 분류는 고른 종류의 것, 하위분류는 고른 분류의 것
function fillCatLists() {
  const all = menus(), cuisine = menuForm.cuisine.value.trim(), course = menuForm.course.value.trim();
  const options = (values, order) => [...new Set(values.filter(Boolean))].sort(order).map(v => {
    const o = h('option');
    o.value = v;
    return o;
  });
  $('menuCuisineList').replaceChildren(...options([...CUISINES, ...all.map(x => x.cuisine)], ranker(CUISINES)));
  $('menuCourseList').replaceChildren(...options([...courseOrder(cuisine), ...all.filter(x => x.cuisine === cuisine).map(x => x.course)],
    abc));
  $('menuSubList').replaceChildren(...options([...subOrder(course), ...all.filter(x => x.course === course).map(x => x.sub)],
    abc));
}
// 태그 고르는 목록 = 정해 둔 것(TAG_PRESETS, 설정에서 지운 것은 빼고) + 메뉴에 붙은 것
// 지운 기본 태그는 계정에 저장 (id 고정 rec 하나라 기기끼리 겹치지 않음)
const TAGS_ID = 'menu-tags';
const hiddenTags = () => (recs('tags').find(r => r.id === TAGS_ID) || {}).hidden || [];
function setHiddenTags(list) { // 저장은 부르는 쪽에서
  let r = db.recs.find(x => x.id === TAGS_ID);
  if (!r) { r = { ...newRec('tags', {}), id: TAGS_ID }; db.recs.push(r); }
  r.hidden = list;
  touch(r);
}
const tagChoices = () => [...new Set([...TAG_PRESETS.filter(t => !hiddenTags().includes(t)), ...menus().flatMap(tagsOf)])]
  .sort(ranker(TAG_PRESETS));
// 편집 창 태그: 알약을 눌러서 붙이기·떼기. 새 태그는 끝 칸에 적고 Enter
let editTags = [];
const tagInput = $('menuTagInput');
function renderTagPills() {
  const typing = document.activeElement === tagInput;
  const names = [...new Set([...tagChoices(), ...editTags])];
  $('menuTagPills').replaceChildren(...names.map(t => button(`#${t}`, () => {
    editTags = editTags.includes(t) ? editTags.filter(x => x !== t) : [...editTags, t];
    renderTagPills();
  }, editTags.includes(t) ? 'on' : '')), tagInput);
  if (typing) tagInput.focus();
}
onEnter(tagInput, text => {
  const t = text.replace(/^#/, '');
  if (t && !editTags.includes(t)) editTags.push(t);
  renderTagPills();
});
function openMenu(menu, meal) {
  editingMenu = menu;
  linkMeal = meal || null;
  menuForm.name.value = menu.name;
  menuForm.cuisine.value = menu.cuisine || '';
  menuForm.course.value = menu.course || '';
  menuForm.sub.value = menu.sub || '';
  fillCatLists();
  editTags = [...tagsOf(menu)];
  tagInput.value = '';
  renderTagPills();
  menuForm.ingredients.value = (menu.ingredients || []).join('\n');
  menuForm.recipe.value = menu.recipe || '';
  menuForm.link.value = menu.link || '';
  $('menuDelBtn').hidden = !db.recs.includes(menu);
  syncMenuLink();
  $('menuEditor').showModal();
  if (!menu.name) menuForm.name.focus();
}
menuForm.link.addEventListener('input', syncMenuLink);
menuForm.cuisine.addEventListener('input', fillCatLists);
menuForm.course.addEventListener('input', fillCatLists);
menuForm.addEventListener('submit', e => {
  e.preventDefault();
  const m = editingMenu;
  m.name = menuForm.name.value.trim();
  m.cuisine = menuForm.cuisine.value.trim();
  m.course = menuForm.course.value.trim();
  m.sub = menuForm.sub.value.trim();
  const typed = tagInput.value.trim().replace(/^#/, ''); // Enter 없이 적어 둔 태그도
  m.tags = typed && !editTags.includes(typed) ? [...editTags, typed] : editTags;
  if (m.tags.some(t => hiddenTags().includes(t))) setHiddenTags(hiddenTags().filter(t => !m.tags.includes(t))); // 지웠던 기본 태그를 다시 쓰면
  m.ingredients = parseIngredients(menuForm.ingredients.value);
  m.recipe = menuForm.recipe.value;
  m.link = menuForm.link.value.trim();
  touch(m);
  // 새 메뉴는 목록에서 그 종류·분류·하위분류를 열어 보여줌
  if (!db.recs.includes(m)) {
    db.recs.push(m);
    prefs.menuCuisine = cuisineOf(m);
    prefs.menuCourse = courseOf(m);
    prefs.menuOpen = { ...prefs.menuOpen, [groupKey(cuisineOf(m), courseOf(m), m.sub)]: true };
    savePrefs();
  }
  if (linkMeal && linkMeal.menu !== m.id) { linkMeal.menu = m.id; touch(linkMeal); }
  $('menuEditor').close();
  save();
});
$('menuCancel').addEventListener('click', () => $('menuEditor').close());

// 설정 › 메뉴 태그: ✕로 지우기 (모든 메뉴에서 떼고, 기본 태그면 고르는 목록에서도 뺌)
function renderTagManage() {
  const tags = tagChoices();
  $('tagManage').replaceChildren(...(tags.length ? tags.map(t => {
    const n = menus().filter(x => tagsOf(x).includes(t)).length, b = button(`#${t} ${n} ✕`, () => deleteTag(t));
    b.title = '이 태그 지우기';
    return b;
  }) : [h('span', 'hint', '태그가 없어요')]));
}
function deleteTag(t) {
  const ms = menus().filter(x => tagsOf(x).includes(t));
  if (!confirm(`‘#${t}’ 태그를 지울까요?` + (ms.length ? `
메뉴 ${ms.length}개에서 떼요.` : ''))) return;
  for (const x of ms) { x.tags = tagsOf(x).filter(v => v !== t); touch(x); }
  if (TAG_PRESETS.includes(t) && !hiddenTags().includes(t)) setHiddenTags([...hiddenTags(), t]);
  save();
  renderTagManage();
}
$('settingsBtn').addEventListener('click', renderTagManage);
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

// 기본 메뉴(menu-presets.js) 하나씩 { name, note, cuisine, course, sub }
const presetMenus = () => MENU_PRESETS.flatMap(([cuisine, course, sub, names]) => names.split(',').map(item => {
  const [, name, note] = item.trim().match(/^(.+?)(?:\s*\((.+)\))?$/); // '김치찌개(참치/…)' → 이름, 메모
  return { name, note, cuisine, course, sub };
}));
let presetIndex = null; // 이름 → 기본 메뉴
const presetOf = x => (presetIndex = presetIndex || new Map(presetMenus().map(p => [norm(p.name), p]))).get(norm(x.name));
// 기본 메뉴의 그룹(예: ['디저트'])이 지금 있는 곳 = 그 그룹 기본 메뉴들이 가장 많이 있는 그룹. 이름을 바꾸거나 옮겼어도 따라감
function presetHome(pp) {
  const n = new Map();
  for (const x of menus()) {
    const p = presetOf(x);
    if (p && startsWith([p.cuisine, p.course, p.sub], pp)) {
      const k = pkey(pathOf(x).slice(0, pp.length));
      n.set(k, (n.get(k) || 0) + 1);
    }
  }
  return n.size ? [...n].sort((a, b) => b[1] - a[1])[0][0].split('›') : null;
}
// 거꾸로: 지금 종류 c에 있는 기본 메뉴들의 원래 종류 (예: 간식·디저트 → 디저트)
function presetCuisineOf(c) {
  const n = new Map();
  for (const x of menus()) {
    const p = x.cuisine === c && presetOf(x);
    if (p) n.set(p.cuisine, (n.get(p.cuisine) || 0) + 1);
  }
  return n.size ? [...n].sort((a, b) => b[1] - a[1])[0][0] : null;
}

// 옛 분류(카테고리 cat › 서브카테고리 sub, 2026-10-06 하루 씀)를 새 분류로. 이 기기 데이터를 읽을 때와 계정에서 받을 때
// 기본 메뉴에 있는 이름이면 그 분류, 아니면 옛 카테고리로 짐작. 바꾼 개수를 돌려줌 (저장은 부르는 쪽에서)
function oldClass(cat = '', sub = '') {
  if (cat === '한식') {
    const course = { 밥: '밥·면', 한그릇: '밥·면', 국밥: '밥·면', 면: '밥·면', '전·부침': '밥·면', 국: '국', 찌개: '국', '탕·전골': '국' }[sub];
    return ['한식', course || (sub ? '메인' : ''), { 한그릇: '밥', '전·부침': '기타' }[sub] || sub];
  }
  if (cat === '반찬') return sub === '단백질' ? ['한식', '메인', '기타'] : ['한식', '반찬', sub];
  if (cat === '유아식') return ['유아식', sub, ''];
  return [cat === '분식·배달' ? '분식' : cat, '', sub];
}
// 2026-10-06 저녁 재분류: 유아식은 한식의 분류 → 종류로 (하위분류가 분류로), 분류 없는 디저트는 음료·빵·케이크·떡·기타로,
// 태그 봄·여름·가을·겨울은 '계절' 하나로. 그 전에 저장된 메뉴만 (한 번 바꾸면 저장 시각이 늦어져서 다시 안 바뀜)
const REORG_AT = Date.UTC(2026, 9, 6, 9, 0); // 2026-10-06 18:00 (한국)
const SEASON_TAGS = ['봄', '여름', '가을', '겨울'];
function reorg(x, preset) {
  let changed = true;
  if (x.cuisine === '한식' && x.course === '유아식') [x.cuisine, x.course, x.sub] = ['유아식', x.sub || '', ''];
  else if (x.cuisine === '디저트' && !x.course) {
    const p = preset.get(norm(x.name));
    x.course = p && p.cuisine === '디저트' ? p.course : '기타';
  } else changed = false;
  if (tagsOf(x).some(t => SEASON_TAGS.includes(t))) {
    x.tags = [...new Set(tagsOf(x).map(t => SEASON_TAGS.includes(t) ? '계절' : t))];
    changed = true;
  }
  return changed;
}
function upgradeMenus() {
  const preset = new Map(presetMenus().map(p => [norm(p.name), p]));
  let n = 0;
  for (const x of db.recs) {
    if (x.kind !== 'menu') continue;
    const old = x.updatedAt < REORG_AT;
    let changed = false;
    if ('cat' in x) {
      if (!('cuisine' in x)) {
        const p = preset.get(norm(x.name));
        [x.cuisine, x.course, x.sub] = p ? [p.cuisine, p.course, p.sub] : oldClass(x.cat, x.sub);
      }
      delete x.cat;
      changed = true;
    }
    if (old && reorg(x, preset)) changed = true;
    if (changed) { touch(x); n++; }
  }
  return n;
}
if (upgradeMenus()) persist();

// 설정 > 기본 메뉴 넣기. 이름이 같은 메뉴와 지운 메뉴는 건너뛰고, 있는 메뉴에 분류가 없으면 분류만 채움
// 넣는 그룹은 같은 기본 그룹 메뉴들이 지금 있는 곳 (예: 디저트를 간식·디저트로 바꿨으면 간식·디저트 › 떡)
function presetPlace(p) {
  const pp = [p.cuisine, p.course, p.sub];
  for (let L = 3; L > 0; L--) {
    const home = presetHome(pp.slice(0, L));
    if (home) return [...home, ...pp.slice(L)];
  }
  return pp;
}
$('presetBtn').addEventListener('click', () => {
  const have = new Map(recs('menu').map(x => [norm(x.name), x]));
  const gone = new Set(db.recs.filter(r => r.kind === 'menu' && r.deleted).map(r => norm(r.name))); // 지운 건 다시 넣지 않음
  const add = [], fill = [];
  for (const p of presetMenus()) {
    const x = have.get(norm(p.name));
    if (!x) {
      if (gone.has(norm(p.name))) continue;
      const [cuisine, course, sub] = presetPlace(p);
      add.push(newRec('menu', { name: p.name, cuisine, course, sub, ingredients: [], recipe: p.note || '', link: '' }));
    } else if (!x.cuisine && !x.course) fill.push([x, p]);
  }
  if (!add.length && !fill.length) { toast('기본 메뉴가 이미 모두 있어요'); return; }
  const lines = [];
  if (add.length) lines.push(`기본 메뉴 ${add.length}개를 메뉴·레시피에 추가해요.` + (add.length <= 30 ? `\n(${add.map(x => x.name).join(', ')})` : ''));
  if (fill.length) lines.push(`이미 있는 메뉴 ${fill.length}개는 분류만 채워요.`);
  if (!confirm(`${lines.join('\n')}\n계속할까요?`)) return;
  db.recs.push(...add);
  for (const [x, p] of fill) { [x.cuisine, x.course, x.sub] = presetPlace(p); touch(x); }
  $('settings').close();
  save();
  toast(`메뉴 ${add.length + fill.length}개를 정리했어요`);
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
