// 결산 계산 확인: node --test (저장소 맨 위에서)
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/recap-core.js');

const TODAY = '2026-10-10';
let n = 0;
const rec = (kind, f) => ({ id: f.id || `r${++n}`, kind, createdAt: 0, updatedAt: 0, ...f });

// 식단 10개 (+ 지운 것 1개): 결산에서 안 세는지 확인용
const MEALS = [
  rec('meal', { date: '2026-01-05', slot: 'l', name: '김치찌개' }),
  rec('meal', { date: '2026-01-05', slot: 'l', name: '밥' }),        // 같은 끼니 (끼니 수는 1)
  rec('meal', { date: '2026-01-20', slot: 'd', name: '카레' }),
  rec('meal', { date: '2026-03-02', slot: 'b', name: '토스트' }),
  rec('meal', { date: '2026-03-02', slot: 'd', name: '김치 찌개' }),  // 띄어쓰기만 다름 → 김치찌개
  rec('meal', { date: '2026-07-15', slot: 'd', name: '카래', menu: 'm1' }), // 연결된 메뉴 이름(카레)으로
  rec('meal', { date: '2026-10-10', slot: 'd', name: '파스타' }),    // 오늘
  rec('meal', { date: '2026-10-11', slot: 'd', name: '떡볶이' }),    // 내일 (계획) → 안 셈
  rec('meal', { date: '2025-12-31', slot: 'd', name: '카레' }),      // 작년 (같은 기간 밖)
  rec('meal', { date: '2025-03-01', slot: 'l', name: '라면' }),      // 작년 같은 기간 안
  rec('meal', { date: '2026-02-01', slot: 'd', name: '지운 메뉴', deleted: true }),
  rec('menu', { id: 'm1', name: '카레', ingredients: [] }),
];
// 가계부: 지출 분류 + 항목 9개, 금액 15칸
const BUDGET = [
  rec('bconf', { id: 'budget', groups: [{ id: 'fixed', name: '고정비' }, { id: 'living', name: '생활비' }], accounts: [] }),
  // 월세: 매달 같은 금액 → 8·10월은 계획 50만, 9월만 52만 적음 (11월부터는 아직 안 옴)
  rec('bline', { side: 'out', group: 'fixed', name: '월세', fixed: true, plans: { '2026-08': 500000 }, actual: { '2026-09': 520000 }, from: '2026-08', to: null }),
  rec('bline', { side: 'out', group: 'living', name: '식비', fixed: false, plans: { '2026-01': 400000 },
    actual: { '2026-01': 380000, '2026-02': 410000, '2026-03': 450000, '2026-08': 300000 }, from: '2026-01', to: null }),
  // 병원: 3월만 있는 항목 (4월부터 없음) → 5월에 적힌 금액은 안 셈
  rec('bline', { side: 'out', group: null, name: '병원', actual: { '2026-03': 50000, '2026-05': 70000 }, plans: {}, from: '2026-03', to: '2026-04' }),
  rec('bline', { side: 'out', group: 'gone', name: '경조사', actual: { '2026-02': 100000 }, plans: {}, from: '2026-01', to: null }), // 지운 분류 → 미분류
  rec('bline', { side: 'in', name: '월급', actual: { '2026-01': 3000000 }, plans: {}, from: '2026-01', to: null }),   // 수입 → 지출 아님
  rec('bline', { side: 'save', name: '적금', actual: { '2026-01': 500000 }, plans: {}, from: '2026-01', to: null }), // 저축 → 지출 아님
  rec('bline', { side: 'out', group: 'living', name: '지운 항목', actual: { '2026-01': 999999 }, plans: {}, from: '2026-01', to: null, deleted: true }),
  rec('bline', { side: 'out', group: 'living', name: '작년 식비', actual: { '2025-02': 200000, '2025-11': 300000 }, plans: {}, from: '2025-01', to: '2026-01' }),
  rec('bline', { side: 'out', group: 'living', name: '내년', actual: { '2027-01': 1000 }, plans: {}, from: '2027-01', to: null }),
];
const card = (res, id) => res.cards.find(c => c.id === id);
const ids = res => res.cards.map(c => c.id);
const freeze = o => { Object.values(o).forEach(v => v && typeof v === 'object' && freeze(v)); return Object.freeze(o); };

test('가계부 카드: 손으로 센 값과 같음', () => {
  const r = R.recapCards([...BUDGET], 2026, TODAY);
  // 1월 38만 · 2월 41만+10만 · 3월 45만+5만 · 4~7월 기록 없음 · 8월 50만+30만 · 9월 52만 · 10월 50만(매달 같은 금액)
  const months = [380000, 510000, 500000, null, null, null, null, 800000, 520000, 500000];
  assert.deepEqual(card(r, 'spentMonths').months.map(x => x.amount), months);
  // 합계 321만, 기록한 달 6, 작년 1~10월 = 2월 20만 (11월은 기간 밖)
  assert.deepEqual(card(r, 'spent'), { id: 'spent', total: 3210000, recorded: 6, upTo: 10, last: 200000 });
  // 생활비 154만 · 고정비 152만 · 미분류(병원 5만 + 지운 분류의 경조사 10만) 15만
  assert.deepEqual(card(r, 'groups').items.map(x => [x.name, x.amount]), [['생활비', 1540000], ['고정비', 1520000], ['미분류', 150000]]);
  assert.ok(Math.abs(card(r, 'groups').items.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  assert.deepEqual(card(r, 'topMonth'), { id: 'topMonth', month: 8, amount: 800000 });
});

test('지난해(한 해 전체)', () => {
  const r = R.recapCards([...MEALS, ...BUDGET], 2025, TODAY);
  // 2025년 지출: 2월 20만 + 11월 30만, 2024년 기록 없음 → 작년 비교 없음
  assert.deepEqual(ids(r), ['spent', 'groups', 'topMonth', 'spentMonths']);
  assert.deepEqual(card(r, 'spent'), { id: 'spent', total: 500000, recorded: 2, upTo: 12, last: null });
  assert.deepEqual(card(r, 'topMonth'), { id: 'topMonth', month: 11, amount: 300000 });
});

test('식단은 안 셈, 가계부 지출 기록이 없으면 카드 없음', () => {
  assert.deepEqual(R.recapCards([...MEALS], 2026, TODAY).cards, []); // 식단 결산은 없앰
  assert.deepEqual(ids(R.recapCards([...MEALS, ...BUDGET], 2026, TODAY)), ['spent', 'groups', 'topMonth', 'spentMonths']);
  assert.deepEqual(R.recapCards([], 2026, TODAY).cards, []);
  assert.deepEqual(R.recapCards([...MEALS, ...BUDGET], 2024, TODAY).cards, []); // 기록 없는 해
  assert.deepEqual(R.recapCards([...MEALS, ...BUDGET], 2027, TODAY).cards, []); // 아직 안 온 해
  // 한 달만 적었으면 '달마다 쓴 돈'은 없음 (두 달 이상일 때만)
  const one = [rec('bline', { side: 'out', group: 'living', name: '생활비', actual: { '2026-10': 2229704 }, plans: {}, from: '2026-10', to: null })];
  assert.deepEqual(ids(R.recapCards(one, 2026, TODAY)), ['spent', 'groups', 'topMonth']);
});

test('데이터를 바꾸지 않음 (얼린 데이터로 계산해도 오류 없음)', () => {
  const data = freeze(JSON.parse(JSON.stringify([...MEALS, ...BUDGET])));
  assert.doesNotThrow(() => R.recapCards(data, 2026, TODAY));
  assert.doesNotThrow(() => R.recapYears(data, TODAY));
});

test('볼 수 있는 해 · 배너 기간', () => {
  assert.deepEqual(R.recapYears([...MEALS, ...BUDGET], TODAY), [2026, 2025]); // 내년 항목은 안 셈
  assert.deepEqual(R.recapYears([...MEALS], TODAY), [2026]); // 식단은 안 셈
  assert.deepEqual(R.recapYears([], TODAY), [2026]);
  assert.equal(R.recapSeason('2026-11-30'), null);
  assert.equal(R.recapSeason('2026-12-01'), 2026);
  assert.equal(R.recapSeason('2026-12-31'), 2026);
  assert.equal(R.recapSeason('2027-01-31'), 2026);
  assert.equal(R.recapSeason('2027-02-01'), null);
});
