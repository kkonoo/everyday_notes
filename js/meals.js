'use strict';
// 식단: 달력(하루 칸 = 그날 메뉴) + 그날 식단 + 메뉴·레시피 목록
// 아침·점심·저녁은 넣을 때만 고르고, 달력 칸에는 끼니마다 대표 메뉴 하나만 (끼니 색으로)
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
// 칸에는 끼니마다 대표 메뉴 하나 (끼니 색으로). 대표: 메인 > 국 > 반찬 > 밥·면 > 그 밖, 같으면 먼저 넣은 것
const REP = ['메인', '국', '반찬', '밥·면'];
const repRank = m => { const i = REP.indexOf((menuOf(m) || {}).course); return i < 0 ? REP.length : i; };
const slotsOn = s => [...'bld'].map(k => mealsOn(s).filter(m => m.slot === k)).filter(ms => ms.length);
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
// 순서: menu-presets.js 의 CUISINES·COURSES 순서 → 그 밖은 가나다순 → 미분류는 맨 뒤. 하위분류 없는 메뉴는 맨 앞
const NO_CAT = '미분류';
const cuisineOf = x => x.cuisine || NO_CAT;
const courseOf = x => x.course || NO_CAT;
const COURSE_ORDER = Object.keys(COURSES);
const subOrder = course => COURSES[course] || [];
const rankIn = (known, v) => !v ? -1 : known.includes(v) ? known.indexOf(v) : known.length;
const ranker = known => (a, b) => (a === NO_CAT) - (b === NO_CAT) || rankIn(known, a) - rankIn(known, b) || a.localeCompare(b, 'ko');
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

// 알약 줄: 누르면 prefs[key]에 기억 (하나뿐이면 숨김)
function menuPills(box, values, on, key) {
  box.hidden = values.length < 2;
  box.replaceChildren(...values.map(v => button(v, () => {
    prefs[key] = v;
    prefs.menuTag = null;
    savePrefs();
    $('menuSearch').value = '';
    renderMenus();
  }, v === on ? 'on' : '')));
}
// 하위분류 제목: 처음엔 접혀 있고 누르면 펼침 (펼친 것은 prefs.menuOpen에 기억). 펼쳐져 있으면 true
const groupKey = (c, k, s) => [c, k, s].join('›');
function menuSubHead(key, name, n, out) {
  const open = !!(prefs.menuOpen || {})[key];
  const head = h('div', 'menu-sub' + (open ? '' : ' folded'));
  head.append(h('span', 'fold', '▾'), h('span', 'name', name), h('span', 'count', n),
    iconBtn('＋', `‘${name}’에 새 메뉴`, () => newMenu(name)));
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
const tagsOf = x => x.tags || [];
let menuTag = null; // 보고 있는 태그
function renderMenus() {
  const q = norm($('menuSearch').value), all = menus();
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
  const cuisines = groupBy(all, cuisineOf, ranker(CUISINES)).map(([c]) => c);
  menuCuisine = flat ? null : pick(cuisines, prefs.menuCuisine);
  const courses = groupBy(all.filter(x => cuisineOf(x) === menuCuisine), courseOf, ranker(COURSE_ORDER)).map(([c]) => c);
  menuCourse = flat ? null : pick(courses, prefs.menuCourse);
  menuPills($('menuCuisines'), cuisines, menuCuisine, 'menuCuisine');
  menuPills($('menuCourses'), courses, menuCourse, 'menuCourse');
  // 재료·태그로도 찾기 (예: '두부' → 두부가 들어가는 메뉴)
  const list = q ? all.filter(x => [x.name, ...(x.ingredients || []), ...tagsOf(x)].some(v => norm(v).includes(q)))
    : menuTag ? all.filter(x => tagsOf(x).includes(menuTag))
    : all.filter(x => cuisineOf(x) === menuCuisine && courseOf(x) === menuCourse);
  $('menuCount').textContent = all.length || '';
  const out = [];
  for (const [c, inC] of groupBy(list, cuisineOf, ranker(CUISINES))) {
    for (const [k, inK] of groupBy(inC, courseOf, ranker(COURSE_ORDER))) {
      for (const [s, ms] of groupBy(inK, x => x.sub || '', ranker(subOrder(k)))) {
        if (flat) out.push(h('div', 'slot-head', [c, k === NO_CAT ? '' : k, s].filter(Boolean).join(' › ')));
        else if (s && !menuSubHead(groupKey(c, k, s), s, ms.length, out)) continue; // 접힌 하위분류
        const ul = h('ul', 'list');
        ul.append(...ms.map(menuRow));
        out.push(ul);
      }
    }
  }
  $('menuList').replaceChildren(...(out.length ? out
    : [h('p', 'empty', all.length ? '찾는 메뉴가 없어요' : '메뉴를 등록하면 식단에 골라 넣고, 재료를 장보기로 보낼 수 있어요. (설정 › 기본 메뉴 넣기)')]));
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
// 새 메뉴는 지금 보고 있는 종류·분류로 (하위분류 제목의 ＋는 그 하위분류까지, 태그를 보고 있으면 그 태그)
const known = v => v && v !== NO_CAT ? v : '';
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
// 분류 칸 자동완성: 정해 둔 것 + 메뉴에 적힌 것. 하위분류는 고른 분류의 것
function fillCatLists() {
  const all = menus(), course = menuForm.course.value.trim();
  const options = (values, order) => [...new Set(values.filter(Boolean))].sort(order).map(v => {
    const o = h('option');
    o.value = v;
    return o;
  });
  $('menuCuisineList').replaceChildren(...options([...CUISINES, ...all.map(x => x.cuisine)], ranker(CUISINES)));
  $('menuCourseList').replaceChildren(...options([...COURSE_ORDER, ...all.map(x => x.course)], ranker(COURSE_ORDER)));
  $('menuSubList').replaceChildren(...options([...subOrder(course), ...all.filter(x => x.course === course).map(x => x.sub)],
    ranker(subOrder(course))));
}
// 태그: 정해 둔 것 + 메뉴에 붙은 것을 알약으로 (눌러서 붙이기·떼기). 새 태그는 끝 칸에 적고 Enter
let editTags = [];
const tagInput = $('menuTagInput');
function renderTagPills() {
  const typing = document.activeElement === tagInput;
  const names = [...new Set([...TAG_PRESETS, ...menus().flatMap(tagsOf), ...editTags])];
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

// 옛 분류(카테고리 cat › 서브카테고리 sub, 2026-10-06 하루 씀)를 새 분류로. 이 기기 데이터를 읽을 때와 계정에서 받을 때
// 기본 메뉴에 있는 이름이면 그 분류, 아니면 옛 카테고리로 짐작. 바꾼 개수를 돌려줌 (저장은 부르는 쪽에서)
function oldClass(cat = '', sub = '') {
  if (cat === '한식') {
    const course = { 밥: '밥·면', 한그릇: '밥·면', 국밥: '밥·면', 면: '밥·면', '전·부침': '밥·면', 국: '국', 찌개: '국', '탕·전골': '국' }[sub];
    return ['한식', course || (sub ? '메인' : ''), { 한그릇: '밥', '전·부침': '기타' }[sub] || sub];
  }
  if (cat === '반찬') return sub === '단백질' ? ['한식', '메인', '기타'] : ['한식', '반찬', sub];
  if (cat === '유아식') return ['한식', '유아식', sub];
  return [cat === '분식·배달' ? '분식' : cat, '', sub];
}
function upgradeMenus() {
  const preset = new Map(presetMenus().map(p => [norm(p.name), p]));
  let n = 0;
  for (const x of db.recs) {
    if (x.kind !== 'menu' || !('cat' in x)) continue;
    if (!('cuisine' in x)) {
      const p = preset.get(norm(x.name));
      [x.cuisine, x.course, x.sub] = p ? [p.cuisine, p.course, p.sub] : oldClass(x.cat, x.sub);
    }
    delete x.cat;
    touch(x);
    n++;
  }
  return n;
}
if (upgradeMenus()) persist();

// 설정 > 기본 메뉴 넣기. 이름이 같은 메뉴는 건너뛰고, 그 메뉴에 분류가 없으면 분류만 채움
$('presetBtn').addEventListener('click', () => {
  const have = new Map(recs('menu').map(x => [norm(x.name), x]));
  const add = [], fill = [];
  for (const p of presetMenus()) {
    const x = have.get(norm(p.name));
    if (!x) add.push(newRec('menu', { name: p.name, cuisine: p.cuisine, course: p.course, sub: p.sub, ingredients: [], recipe: p.note || '', link: '' }));
    else if (!x.cuisine && !x.course) fill.push([x, p]);
  }
  if (!add.length && !fill.length) { toast('기본 메뉴가 이미 모두 있어요'); return; }
  const lines = [];
  if (add.length) lines.push(`기본 메뉴 ${add.length}개를 메뉴·레시피에 추가해요.`);
  if (fill.length) lines.push(`이미 있는 메뉴 ${fill.length}개는 분류만 채워요.`);
  if (!confirm(`${lines.join('\n')}\n계속할까요?`)) return;
  db.recs.push(...add);
  for (const [x, p] of fill) { [x.cuisine, x.course, x.sub] = [p.cuisine, p.course, p.sub]; touch(x); }
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
