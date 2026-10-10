// 놀이 계산 확인: node --test (저장소 맨 위에서)
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/play-core.js');

test('사다리: 무작위 1000개 모두 참가자와 결과가 1:1 (중복·누락 없음)', () => {
  for (let k = 0; k < 1000; k++) {
    const n = 2 + (k % 7); // 2~8명
    const lad = P.makeLadder(n), map = P.ladderMap(lad);
    assert.equal(new Set(map).size, n, `중복 결과: ${map}`);
    assert.ok(map.every(e => e >= 0 && e < n));
    for (const row of lad.rungs) row.forEach(c => assert.ok(!row.includes(c + 1), '한 줄에 가로줄이 붙어 있음'));
    for (let c = 0; c < n - 1; c++) assert.ok(lad.rungs.some(row => row.includes(c)), `${c}–${c + 1} 사이 가로줄 없음`);
  }
});

test('사다리: 그리는 길이 도착한 세로줄에서 끝남', () => {
  const lad = P.makeLadder(5);
  for (let i = 0; i < 5; i++) {
    const { end, path } = P.traceLadder(lad, i);
    assert.deepEqual(path[0], [i, -1]);
    assert.deepEqual(path[path.length - 1], [end, lad.rows]);
    for (let j = 1; j < path.length; j++) { // 가로(같은 줄) 아니면 세로(같은 세로줄)로만 움직임
      const [a, b] = [path[j - 1], path[j]];
      assert.ok(a[0] === b[0] || (a[1] === b[1] && Math.abs(a[0] - b[0]) === 1));
    }
  }
});

test('룰렛: 1만 번 — 멈춘 칸 = 발표 결과, 칸마다 고르게', () => {
  const n = 8, count = Array(n).fill(0);
  let rot = 0;
  for (let k = 0; k < 10000; k++) {
    const { index, rotation } = P.spinWheel(n, rot);
    assert.equal(P.sliceAt(rotation, n), index);
    assert.ok(rotation - rot >= 5 * 360 && rotation - rot < 6 * 360);
    count[index]++;
    rot = rotation;
  }
  for (const c of count) assert.ok(Math.abs(c - 1250) < 1250 * 0.15, `치우침: ${count}`);
});

test('룰렛: 칸 수가 달라도 멈춘 칸 = 발표 결과', () => {
  for (let n = 2; n <= 24; n++) {
    for (let k = 0; k < 300; k++) {
      const from = (k * 137.3) % 5000;
      const { index, rotation } = P.spinWheel(n, from);
      assert.equal(P.sliceAt(rotation, n), index);
    }
  }
});

test('제비뽑기: n장 중 정확히 k장 당첨', () => {
  for (let n = 2; n <= 20; n++) {
    for (let k = 1; k < n; k++) assert.equal(P.drawLots(n, k).filter(Boolean).length, k);
  }
});

test('메뉴 룰렛: 최근 N일(오늘 포함) 먹은 메뉴만 빠짐', () => {
  const today = '2026-03-02';
  const meals = [
    { date: '2026-03-02', name: '김치찌개' },  // 오늘
    { date: '2026-03-01', name: '된장 찌개' }, // 어제 (띄어쓰기 달라도 같은 메뉴)
    { date: '2026-02-28', name: '카레' },      // 2일 전 (달이 바뀜)
    { date: '2026-02-27', name: '파스타' },    // 3일 전
    { date: '2026-03-03', name: '떡볶이' },    // 내일 (계획) — 안 셈
  ];
  const names = ['김치찌개', '된장찌개', '카레', '파스타', '떡볶이', '비빔밥'];
  assert.deepEqual(P.withoutRecent(names, meals, today, 3), ['파스타', '떡볶이', '비빔밥']);
  assert.deepEqual(P.withoutRecent(names, meals, today, 1), ['된장찌개', '카레', '파스타', '떡볶이', '비빔밥']);
  assert.deepEqual(P.withoutRecent(names, meals, today, 4), ['떡볶이', '비빔밥']);
  assert.deepEqual(P.eatenWithin(meals, today, 2), ['김치찌개', '된장 찌개']);
});

test('후보 이름: 띄어쓰기·대소문자만 다른 것은 하나로', () => {
  assert.deepEqual(P.uniqueNames(['된장찌개', '된장 찌개', 'Pasta', 'pasta', '카레']), ['된장찌개', 'Pasta', '카레']);
});

test('randInt: 범위 안, 0 이상', () => {
  for (const max of [1, 2, 3, 7, 1000]) {
    for (let k = 0; k < 2000; k++) {
      const v = P.randInt(max);
      assert.ok(Number.isInteger(v) && v >= 0 && v < max);
    }
  }
});
