'use strict';
// 메뉴 분류 정리 (설정 > 메뉴 분류 정리): 종류 › 분류 › 하위분류 그룹만 접힌 목록으로 (메뉴 하나씩은 메뉴·레시피에서)
//  - 그룹의 ⋮⋮를 끌어 위 단계 그룹에 놓으면 그 아래로 옮기고, 같은 단계 그룹에 놓으면 합침 (안의 메뉴 전부)
//    맨 위 '종류로 꺼내기'에 놓으면 분류·하위분류를 종류로 (예: 한식 › 유아식 › 국 → 유아식 › 국)
//  - ✎ 이름 바꾸기, ＋ 새 그룹 (빈 그룹도 계정에 저장), ✕ 빈 그룹 지우기
// 그룹 도우미(childrenOf, menusIn, extraGroups 등)는 meals.js

const LEVEL_NAMES = ['종류', '분류', '하위분류'];
const groupOpen = new Set(); // 펼친 그룹 (앱을 켜 둔 동안 기억)

function renderGroups() {
  const root = dropAt(h('div', 'grp-root', '⤒ 여기에 놓으면 종류로 꺼내기'), []);
  $('groupTree').replaceChildren(root, ...childrenOf([]).map(name => groupNode([name])));
}
function groupNode(p) {
  const key = pkey(p), L = p.length, n = menusIn(p).length, kids = childrenOf(p), open = kids.length && groupOpen.has(key);
  const box = h('div', `grp lv${L}` + (open ? '' : ' folded'));
  const head = dropAt(h('div', 'grp-head' + (n ? '' : ' empty')), p), handle = dragHandle();
  handle.title = '끌어서 다른 그룹 위에 놓기';
  handle.addEventListener('click', e => e.stopPropagation()); // 끌고 난 뒤 접히지 않게
  head.append(handle, h('span', 'fold' + (kids.length ? '' : ' none'), '▾'), h('span', 'name', p[L - 1]), h('span', 'count', n),
    iconBtn('✎', `${LEVEL_NAMES[L - 1]} 이름 바꾸기`, () => renameGroup(p)));
  if (L < 3) head.append(iconBtn('＋', `${LEVEL_NAMES[L]} 추가`, () => addGroup(p)));
  if (!n) head.append(iconBtn('✕', '빈 그룹 지우기', () => dropGroup(p)));
  if (kids.length) {
    head.title = open ? '접기' : '펼치기';
    head.addEventListener('click', () => {
      if (open) groupOpen.delete(key); else groupOpen.add(key);
      renderGroups();
    });
  }
  // 놓을 수 있는 곳: 같은 단계(합치기)와 그 위 단계 그룹 (자기 안쪽은 빼고), 분류·하위분류는 '종류로 꺼내기'도
  const targets = [...Array.from({ length: L }, (_, i) => `.grp.lv${i + 1} > .grp-head`), ...L > 1 ? ['.grp-root'] : []].join(', ');
  sortable(handle, box, targets, t => {
    const tp = JSON.parse(t.dataset.path);
    if (!tp.length) { promoteGroup(p); return; }
    moveGroup(p, tp.length === L ? tp : [...tp, ...p.slice(tp.length)]);
  });
  box.append(head);
  if (open) box.append(...kids.map(name => groupNode([...p, name])));
  return box;
}

// 그룹 p(안의 메뉴 전부)를 같은 단계의 경로 np로. 거기에 메뉴가 이미 있으면 합칠지 물어봄
function moveGroup(p, np) {
  if (pkey(np) === pkey(p)) return;
  const L = p.length, inside = menusIn(p), there = menusIn(np).length;
  if (there && !confirm(`‘${np.join(' › ')}’에 메뉴 ${there}개가 이미 있어요. 합칠까요?`)) return;
  for (const x of inside) { [x.cuisine, x.course, x.sub] = [...np, ...pathOf(x).slice(L)]; touch(x); }
  const moved = q => startsWith(q, p) ? [...np, ...q.slice(L)] : q;
  if (extraGroups().some(q => startsWith(q, p))) setExtraGroups(extraGroups().map(moved));
  for (const k of [...groupOpen]) {
    const q = k.split('›');
    if (startsWith(q, p)) { groupOpen.delete(k); groupOpen.add(pkey(moved(q))); }
  }
  for (let i = 1; i < L; i++) groupOpen.add(pkey(np.slice(0, i))); // 옮긴 곳이 보이게
  save();
  renderGroups();
  toast(`‘${p[L - 1]}’ → ${np.join(' › ')}`);
}
// 분류·하위분류 p를 종류로 꺼내기: 그 아래 단계가 한 칸씩 올라감
function promoteGroup(p) {
  const L = p.length, name = p[L - 1], there = menusIn([name]).length;
  if (there && !confirm(`종류 ‘${name}’에 메뉴 ${there}개가 이미 있어요. 합칠까요?`)) return;
  const up = q => [name, ...q.slice(L)];
  for (const x of menusIn(p)) { [x.cuisine, x.course, x.sub] = [...up(pathOf(x)), '', ''].slice(0, 3); touch(x); }
  if (extraGroups().some(q => startsWith(q, p))) setExtraGroups(extraGroups().map(q => startsWith(q, p) ? up(q) : q));
  save();
  renderGroups();
  toast(`‘${name}’ → 종류`);
}
async function renameGroup(p) {
  const old = p[p.length - 1], name = await ask(`${LEVEL_NAMES[p.length - 1]} 이름`, old);
  if (name && name !== old) moveGroup(p, [...p.slice(0, -1), name]);
}
async function addGroup(p) {
  const L = p.length, name = await ask(`새 ${LEVEL_NAMES[L]} 이름`);
  if (!name) return;
  const q = [...p, name];
  if (!childrenOf(p).includes(name)) { setExtraGroups([...extraGroups(), q]); save(); }
  for (let i = 1; i < q.length; i++) groupOpen.add(pkey(q.slice(0, i)));
  renderGroups();
}
function dropGroup(p) {
  setExtraGroups(extraGroups().filter(q => !startsWith(q, p)));
  save();
  renderGroups();
}

$('groupsBtn').addEventListener('click', () => {
  $('settings').close();
  renderGroups();
  $('menuGroups').showModal();
});
$('groupAddCuisine').addEventListener('click', () => addGroup([]));
$('groupsClose').addEventListener('click', () => $('menuGroups').close());
