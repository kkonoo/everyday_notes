'use strict';
// 놀이 계산 (화면 없음): play.js 가 쓰고, tests/play.test.js 가 Node에서 확인
// 난수는 모두 crypto.getRandomValues. 결과를 먼저 정하고, 화면은 그 결과에 맞춰 움직이기만 함

// 0 이상 max 미만 정수, 고르게 (2^32를 max로 나눈 나머지 구간은 버리고 다시 → 앞쪽 숫자가 더 나오지 않게)
function randInt(max) {
  const lim = Math.floor(0x100000000 / max) * max, a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return a[0] % max;
}
// 순서 섞기 (Fisher–Yates). 원래 배열은 그대로
function cryptoShuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 룰렛 ----------
// 칸 i = 위(0°)에서 시계 방향으로 i·s ~ (i+1)·s 도 (s = 360/n). 판을 시계 방향으로 rot도 돌리면 위 바늘 아래는 판의 −rot도
const sliceAt = (rot, n) => Math.floor((((-rot % 360) + 360) % 360) / (360 / n)) % n;
// 돌리기: 칸을 먼저 뽑고(index), 바늘이 그 칸 안쪽(양 끝 15%는 피해서)에 오도록 지금 각도(from)에서 turns바퀴 더 돈 각도
function spinWheel(n, from = 0, turns = 5) {
  const index = randInt(n), at = (index + 0.15 + 0.7 * randInt(1001) / 1000) * 360 / n;
  const delta = (((-at - from) % 360) + 360) % 360;
  return { index, rotation: from + turns * 360 + delta };
}

// ---------- 제비뽑기: n장 중 k장 당첨 (당첨이면 true) ----------
function drawLots(n, k) {
  const win = new Set(cryptoShuffle([...Array(n).keys()]).slice(0, k));
  return Array.from({ length: n }, (_, i) => win.has(i));
}

// ---------- 사다리타기 ----------
// rungs[r] = 위에서 r번째 줄의 가로줄들 (가로줄이 잇는 두 세로줄 중 왼쪽 번호). 한 줄에 가로줄끼리 붙지 않게
// 이웃한 세로줄 사이마다 가로줄이 하나는 있게 (없으면 다시 만듦 → 아무도 곧장 내려가기만 하지 않게)
function makeLadder(n, rows = Math.max(8, n + 6)) {
  for (;;) {
    const rungs = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < n - 1; c++) if (!row.includes(c - 1) && randInt(2)) row.push(c);
      rungs.push(row);
    }
    if ([...Array(n - 1).keys()].every(c => rungs.some(row => row.includes(c)))) return { n, rows, rungs };
  }
}
// start번 세로줄에서 내려간 길: 꺾이는 점 [세로줄, 줄] 목록 (줄 −1 = 맨 위, rows = 맨 아래)과 도착한 세로줄
function traceLadder({ rows, rungs }, start) {
  let c = start;
  const path = [[c, -1]];
  rungs.forEach((row, r) => {
    const to = row.includes(c) ? c + 1 : row.includes(c - 1) ? c - 1 : c;
    if (to !== c) { path.push([c, r], [to, r]); c = to; }
  });
  path.push([c, rows]);
  return { end: c, path };
}
// 참가자 i → 결과 번호
const ladderMap = lad => Array.from({ length: lad.n }, (_, i) => traceLadder(lad, i).end);

// ---------- 메뉴 룰렛 후보 ----------
const nameKey = s => s.toLowerCase().replace(/\s+/g, ''); // app.js 의 norm과 같음 (띄어쓰기·대소문자 무시)
// 겹치는 이름 빼기 (처음 나온 이름으로)
function uniqueNames(names) {
  const seen = new Set();
  return names.filter(x => !seen.has(nameKey(x)) && seen.add(nameKey(x)));
}
// 'YYYY-MM-DD' ± d일
function addDays(s, d) {
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + d)).toISOString().slice(0, 10);
}
// 오늘 포함 최근 days일(오늘·어제…) 식단에 나온 메뉴 이름. meals = [{ date, name }]. 앞으로 계획된 식단은 안 셈
function eatenWithin(meals, today, days) {
  const from = addDays(today, 1 - days);
  return uniqueNames(meals.filter(m => m.date >= from && m.date <= today).map(m => m.name));
}
// 후보에서 최근 days일 안에 먹은 메뉴 빼기
function withoutRecent(names, meals, today, days) {
  const eaten = new Set(eatenWithin(meals, today, days).map(nameKey));
  return names.filter(x => !eaten.has(nameKey(x)));
}

if (typeof module !== 'undefined') {
  module.exports = { randInt, cryptoShuffle, sliceAt, spinWheel, drawLots, makeLadder, traceLadder, ladderMap, uniqueNames, addDays, eatenWithin, withoutRecent };
}
