'use strict';
// 메뉴 분류 정리 (설정 > 메뉴 분류 정리): 종류 › 분류 › 하위분류를 접힌 목록으로
//  - 메뉴의 ⋮⋮를 끌어 그룹 이름(또는 그 그룹의 메뉴) 위에 놓으면 그 그룹으로 옮김
//  - ✎ 그룹 이름 바꾸기 = 그 안 메뉴 전부의 분류를 바꿈. ＋ 새 그룹 (메뉴를 넣기 전까지는 이 창에만 있음)
// 그룹을 따로 저장하지 않음 (분류는 메뉴마다 적힌 값). meals.js 의 menus, ranker 등을 그대로 사용

const LEVELS = ['cuisine', 'course', 'sub'];
const LEVEL_NAMES = ['종류', '분류', '하위분류'];
const groupOpen = new Set(); // 펼친 그룹 (앱을 켜 둔 동안 기억)
let groupNew = [];           // 새로 만든 빈 그룹의 경로

const pathOf = x => LEVELS.map(f => x[f] || '');
const pkey = p => p.join('›');
const startsWith = (p, q) => q.every((v, i) => p[i] === v); // p가 q 그룹 안
const menusIn = p => menus().filter(x => startsWith(pathOf(x), p));

// 그룹 p 바로 아래: 하위 그룹이 없는 메뉴(loose) + 하위 그룹 이름들 (정해 둔 것 → 메뉴에 있는 것 → 새로 만든 것)
function childrenOf(p) {
  const L = p.length, inside = menusIn(p);
  if (L === 3) return { loose: inside, kids: [] };
  const names = new Set(L === 0 ? CUISINES : L === 2 ? subOrder(p[1]) : []);
  inside.forEach(x => names.add(x[LEVELS[L]] || ''));
  groupNew.filter(q => q.length > L && startsWith(q, p)).forEach(q => names.add(q[L]));
  names.delete('');
  const order = L === 0 ? ranker(CUISINES) : L === 1 ? ranker(COURSE_ORDER) : ranker(subOrder(p[1]));
  return { loose: inside.filter(x => !x[LEVELS[L]]), kids: [...names].sort(order) };
}

function renderGroups() {
  $('groupTree').replaceChildren(...groupBody([]));
}
function groupBody(p) {
  const { loose, kids } = childrenOf(p), out = [];
  if (loose.length) {
    const ul = h('ul', 'list');
    ul.append(...loose.map(groupMenu));
    out.push(ul);
  }
  return [...out, ...kids.map(name => groupNode([...p, name]))];
}
function groupNode(p) {
  const key = pkey(p), open = groupOpen.has(key), n = menusIn(p).length, L = p.length;
  const box = h('div', `grp lv${L}` + (open ? '' : ' folded'));
  const head = h('div', 'grp-head' + (n ? '' : ' empty'));
  head.dataset.path = JSON.stringify(p);
  head.append(h('span', 'fold', '▾'), h('span', 'name', p[L - 1]), h('span', 'count', n),
    iconBtn('✎', `${LEVEL_NAMES[L - 1]} 이름 바꾸기`, () => renameGroup(p)));
  if (L < 3) head.append(iconBtn('＋', `${LEVEL_NAMES[L]} 추가`, () => addGroup(p)));
  head.title = open ? '접기' : '펼치기';
  head.addEventListener('click', () => {
    if (open) groupOpen.delete(key); else groupOpen.add(key);
    renderGroups();
  });
  box.append(head);
  if (open) box.append(...groupBody(p));
  return box;
}
function groupMenu(x) {
  const li = h('li', 'grp-menu'), handle = dragHandle();
  handle.title = '끌어서 다른 그룹 위에 놓기';
  li.dataset.path = JSON.stringify(pathOf(x));
  li.append(handle, h('span', 'title', x.name));
  sortable(handle, li, '.grp-head, .grp-menu', t => moveMenu(x, JSON.parse(t.dataset.path)));
  return li;
}

// 메뉴를 그룹 p로. 종류·분류에 놓으면 원래 아래 분류가 거기에도 있을 때만 그대로 (없으면 비움)
function moveMenu(x, p) {
  const to = [...p];
  let keep = true;
  while (to.length < 3) {
    const v = x[LEVELS[to.length]] || '';
    keep = keep && !!v && childrenOf(to).kids.includes(v);
    to.push(keep ? v : '');
  }
  if (pkey(to) === pkey(pathOf(x))) return;
  [x.cuisine, x.course, x.sub] = to;
  touch(x);
  save();
  renderGroups();
  toast(`‘${x.name}’ → ${to.filter(Boolean).join(' › ') || NO_CAT}`);
}
function renameGroup(p) {
  const L = p.length, old = p[L - 1], parent = p.slice(0, -1);
  const name = (prompt(`${LEVEL_NAMES[L - 1]} 이름`, old) || '').trim();
  if (!name || name === old) return;
  if (childrenOf(parent).kids.includes(name) && !confirm(`‘${name}’이(가) 이미 있어요. 합칠까요?`)) return;
  const np = [...parent, name], inside = menusIn(p);
  for (const x of inside) { x[LEVELS[L - 1]] = name; touch(x); }
  const moved = q => startsWith(q, p) ? [...np, ...q.slice(L)] : q;
  groupNew = groupNew.map(moved);
  if (!inside.length) groupNew.push(np); // 정해 둔 빈 그룹(예: 국 › 기타)을 바꾼 경우
  for (const k of [...groupOpen]) {
    const q = k.split('›');
    if (startsWith(q, p)) { groupOpen.delete(k); groupOpen.add(pkey(moved(q))); }
  }
  if (inside.length) save();
  renderGroups();
}
function addGroup(p) {
  const L = p.length, name = (prompt(`새 ${LEVEL_NAMES[L]} 이름`) || '').trim();
  if (!name) return;
  const q = [...p, name];
  if (!childrenOf(p).kids.includes(name)) groupNew.push(q);
  for (let i = 1; i <= q.length; i++) groupOpen.add(pkey(q.slice(0, i)));
  renderGroups();
}

$('groupsBtn').addEventListener('click', () => {
  $('settings').close();
  renderGroups();
  $('menuGroups').showModal();
});
$('groupAddCuisine').addEventListener('click', () => addGroup([]));
$('groupsClose').addEventListener('click', () => $('menuGroups').close());
