// 구글 계정 로그인 + 기기 간 동기화 (Firebase Auth + Firestore). 캘린더x플래너와 같은 Firebase 프로젝트·계정.
// firebase-config.js 가 비어 있으면 아무것도 하지 않음 → 이 브라우저에만 저장.
// 저장 위치: users/{uid}/everyday/{rec id} — 플래너의 items·meta와 따로. 한 줄(rec)씩 updatedAt이 늦은 쪽이 이김
// app.js 의 db, persist, render 등을 그대로 사용.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const COL = 'everyday';

if (firebaseConfig) start();

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  // 같은 주소의 플래너와 기기 캐시(IndexedDB)를 같이 쓰므로 여러 탭 방식 (플래너도 같은 설정)
  const fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });

  let uid = null, unsub = null, synced = {}, ready = false;
  const clean = v => JSON.parse(JSON.stringify(v)); // Firestore는 undefined 값을 못 받음

  // ---------- 화면 ----------
  const accountBtn = $('accountBtn');
  $('accountSection').hidden = false;
  accountBtn.hidden = false;
  const login = () => A.signInWithPopup(auth, new A.GoogleAuthProvider()).catch(e => {
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') alert(`로그인하지 못했어요: ${e.code}`);
  });
  accountBtn.addEventListener('click', () => auth.currentUser ? $('settingsBtn').click() : login());
  $('loginBtn').addEventListener('click', login);
  $('logoutBtn').addEventListener('click', () => A.signOut(auth));

  function showAccount(user) {
    accountBtn.textContent = user ? (user.displayName || user.email || '?').slice(0, 1) : '로그인';
    accountBtn.className = user ? 'avatar' : 'btn';
    accountBtn.title = user ? user.email : 'Google 계정으로 로그인';
    $('accountInfo').textContent = user ? `${user.email} 으로 로그인됨 · 자동 동기화` : '로그인하면 PC와 폰에서 같은 노트를 볼 수 있어요.';
    $('loginBtn').hidden = !!user;
    $('logoutBtn').hidden = !user;
  }

  // ---------- 올리기: 마지막으로 맞춘 뒤 바뀐 것만 ----------
  function push() {
    if (!uid || !ready) return;
    const writes = db.recs.filter(r => r.updatedAt > (synced[r.id] || 0));
    writes.forEach(r => { synced[r.id] = r.updatedAt; });
    for (let i = 0; i < writes.length; i += 400) { // 한 번에 최대 500개 제한
      const batch = F.writeBatch(fs);
      for (const r of writes.slice(i, i + 400)) batch.set(F.doc(fs, 'users', uid, COL, r.id), clean(r));
      batch.commit().catch(e => console.error('동기화 실패', e));
    }
  }
  window.onSave = push;

  // ---------- 받기 ----------
  // 올리기는 서버 값을 한 번 받은 뒤부터 (기기 캐시 값만 보고 올리지 않게 — 플래너에서 겪은 문제)
  function subscribe() {
    unsub = F.onSnapshot(F.collection(fs, 'users', uid, COL), { includeMetadataChanges: true }, snap => {
      let changed = false;
      for (const ch of snap.docChanges()) {
        const r = ch.doc.data();
        synced[r.id] = Math.max(synced[r.id] || 0, r.updatedAt);
        const local = db.recs.find(x => x.id === r.id);
        if (!local) { db.recs.push(r); changed = true; }
        else if (r.updatedAt > local.updatedAt) {
          // 화면(편집 창 등)이 같은 객체를 잡고 있을 수 있어서 바꿔 끼우지 않고 내용만 교체
          for (const k of Object.keys(local)) if (!(k in r)) delete local[k];
          Object.assign(local, r);
          changed = true;
        }
      }
      if (changed) { if (upgradeMenus()) save(); else { persist(); render(); } } // 옛 분류로 온 메뉴는 바꿔서 다시 올림
      if (!ready && !snap.metadata.fromCache) { ready = true; push(); }
    }, e => console.error('동기화 실패', e));
  }

  // ---------- 로그인 / 로그아웃 ----------
  A.onAuthStateChanged(auth, user => {
    if (unsub) unsub();
    unsub = null; synced = {}; ready = false;
    uid = user ? user.uid : null;
    showAccount(user);

    if (!user) {
      // 로그아웃: 이 기기에 남은 계정 데이터는 지움 (계정에는 그대로 있음)
      if (db.owner) { db = { version: 1, recs: [] }; persist(); render(); }
      return;
    }
    if (db.owner !== uid) {
      const n = db.recs.filter(r => !r.deleted).length;
      const merge = !db.owner && n > 0 &&
        confirm(`이 기기에 저장된 노트·식단·가계부 ${n}개를 ${user.email} 계정에 합칠까요?\n(취소하면 계정에 있는 것만 보여요)`);
      if (!merge) db = { version: 1, recs: [] };
      db.owner = uid;
      persist();
      render();
    }
    subscribe();
  });
}
