(function () {
  "use strict";

  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  const cfg = window.FIREBASE_CONFIG || {};
  const configured =
    !!cfg.apiKey &&
    !/PASTE_/.test(cfg.apiKey) &&
    !/PASTE_/.test(cfg.projectId || "PASTE_");

  const DEMO_KEY = "demoEmergencyReports";
  const SEND_TIMEOUT = 15000;

  /* ---------- Firebase loader ---------- */
  let loading = null;

  function load() {
    if (!loading) {
      loading = (async () => {
        const [app, auth, fs] = await Promise.all([
          import(SDK + "firebase-app.js"),
          import(SDK + "firebase-auth.js"),
          import(SDK + "firebase-firestore.js")
        ]);
        const a = app.initializeApp(cfg);
        const db = fs.initializeFirestore(a, { experimentalForceLongPolling: true });
        return { auth: auth.getAuth(a), db: db, A: auth, F: fs };
      })();
      loading.catch(() => { loading = null; });
    }
    return loading;
  }

  /* ---------- Helpers ---------- */
  const toMs = (v) =>
    v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null;

  function normalize(id, d) {
    return {
      id: id,
      type: d.type,
      label: d.label,
      person: d.person,
      phone: d.phone,
      place: d.place,
      channel: d.channel,
      map: d.map || null,
      status: d.status,
      handler: d.handler || "",
      createdAt: toMs(d.createdAt),
      startedAt: toMs(d.startedAt),
      doneAt: toMs(d.doneAt)
    };
  }

  /* ---------- Demo mode (kapag wala pang Firebase config) ---------- */
  const demoListeners = [];

  function demoRead() {
    try {
      const d = JSON.parse(localStorage.getItem(DEMO_KEY));
      return Array.isArray(d) ? d : [];
    } catch (e) {
      return [];
    }
  }

  function demoWrite(list) {
    localStorage.setItem(DEMO_KEY, JSON.stringify(list));
    demoListeners.forEach((fn) => fn());
  }

  function demoSubscribe(onData) {
    let known = null;
    const push = () => {
      const list = demoRead().map((r) => normalize(r.id, r));
      list.sort((a, b) => b.createdAt - a.createdAt);
      const added = known ? list.filter((r) => !known.has(r.id)).map((r) => r.id) : [];
      known = new Set(list.map((r) => r.id));
      onData(list, added);
    };
    const onStorage = (e) => { if (e.key === DEMO_KEY) push(); };
    window.addEventListener("storage", onStorage);
    demoListeners.push(push);
    push();
    return () => {
      window.removeEventListener("storage", onStorage);
      const i = demoListeners.indexOf(push);
      if (i >= 0) demoListeners.splice(i, 1);
    };
  }

  /* ---------- Public API ---------- */
  async function submitReport(data) {
    if (!configured) {
      const id = "demo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      const list = demoRead();
      list.push(Object.assign({}, data, {
        id: id,
        status: "waiting",
        handler: "",
        createdAt: Date.now(),
        startedAt: null,
        doneAt: null
      }));
      demoWrite(list);
      return { id: id, queued: false };
    }

    const { db, F } = await load();
    const payload = Object.assign({}, data, {
      status: "waiting",
      handler: "",
      createdAt: F.serverTimestamp()
    });

    const send = F.addDoc(F.collection(db, "reports"), payload);
    const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), SEND_TIMEOUT));
    const result = await Promise.race([send, timeout]);

    if (result === "timeout") {
      send.catch(() => {});
      return { id: null, queued: true };
    }
    return { id: result.id, queued: false };
  }

  async function onAuth(callback) {
    if (!configured) {
      callback({ email: "demo mode", uid: "demo" });
      return function () {};
    }
    const { auth, A } = await load();
    return A.onAuthStateChanged(auth, (u) => callback(u ? { email: u.email, uid: u.uid } : null));
  }

  async function signIn(email, password) {
    const { auth, A } = await load();
    await A.signInWithEmailAndPassword(auth, email, password);
  }

  async function signOut() {
    if (!configured) return;
    const { auth, A } = await load();
    await A.signOut(auth);
  }

  async function subscribe(onData, onError) {
    if (!configured) return demoSubscribe(onData);

    const { db, F } = await load();
    let first = true;
    const q = F.query(F.collection(db, "reports"), F.orderBy("createdAt", "desc"));

    return F.onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) =>
          normalize(d.id, d.data({ serverTimestamps: "estimate" }))
        );
        const added = first
          ? []
          : snap.docChanges().filter((c) => c.type === "added").map((c) => c.doc.id);
        first = false;
        onData(list, added);
      },
      (err) => { if (onError) onError(err); }
    );
  }

  async function update(id, patch) {
    if (!configured) {
      const list = demoRead();
      const r = list.find((x) => x.id === id);
      if (!r) return;
      Object.keys(patch).forEach((k) => {
        r[k] = patch[k] === "now" ? Date.now() : patch[k];
      });
      demoWrite(list);
      return;
    }
    const { db, F } = await load();
    const data = {};
    Object.keys(patch).forEach((k) => {
      data[k] = patch[k] === "now" ? F.serverTimestamp() : patch[k];
    });
    await F.updateDoc(F.doc(db, "reports", id), data);
  }

  async function remove(id) {
    if (!configured) {
      demoWrite(demoRead().filter((x) => x.id !== id));
      return;
    }
    const { db, F } = await load();
    await F.deleteDoc(F.doc(db, "reports", id));
  }

  window.Backend = {
    mode: configured ? "firebase" : "demo",
    configured: configured,
    submitReport: submitReport,
    onAuth: onAuth,
    signIn: signIn,
    signOut: signOut,
    subscribe: subscribe,
    update: update,
    remove: remove
  };
})();
