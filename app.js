
(function () {
  "use strict";

  var STATUSES = { learning: "Learning", ready: "Ready", parked: "Parked" };

  var state = {
    songs: [],
    filter: "all",
    query: "",
    openId: null,
    editId: null,     // null = not editing, "" = new song
    canWrite: null,   // null = unknown
    cuQueue: [],
    cuIdx: 0,
    loaded: false,
    dbError: null
  };

  var db = null;

  var el = {
    list: document.getElementById("list"),
    empty: document.getElementById("empty"),
    notice: document.getElementById("notice"),
    count: document.getElementById("count"),
    search: document.getElementById("search"),
    add: document.getElementById("add"),
    filters: document.getElementById("filters"),
    catchup: document.getElementById("catchup"),
    cuInner: document.getElementById("cu-inner"),
    cuProgress: document.getElementById("cu-progress"),
    cuPrompt: document.getElementById("catchup-prompt"),
    perf: document.getElementById("perf"),
    perfInner: document.getElementById("perf-inner"),
    perfEdit: document.getElementById("perf-edit"),
    edit: document.getElementById("edit"),
    formErr: document.getElementById("form-err"),
    deleteSlot: document.getElementById("delete-slot"),
    awake: document.getElementById("awake"),
    f: {
      title: document.getElementById("f-title"),
      artist: document.getElementById("f-artist"),
      key: document.getElementById("f-key"),
      capo: document.getElementById("f-capo"),
      status: document.getElementById("f-status"),
      bpm: document.getElementById("f-bpm"),
      tuning: document.getElementById("f-tuning"),
      notes: document.getElementById("f-notes"),
      lyrics: document.getElementById("f-lyrics")
    }
  };

  /* ---------- lyric size (per-viewer convenience) ---------- */

  var MIN_SIZE = 16, MAX_SIZE = 34;
  var lyricSize = 20;
  try {
    var saved = parseInt(localStorage.getItem("songbook.lyricSize"), 10);
    if (saved >= MIN_SIZE && saved <= MAX_SIZE) lyricSize = saved;
  } catch (e) {}
  applySize();

  function applySize() {
    document.documentElement.style.setProperty("--lyric-size", lyricSize + "px");
  }
  function bumpSize(delta) {
    lyricSize = Math.min(MAX_SIZE, Math.max(MIN_SIZE, lyricSize + delta));
    applySize();
    try { localStorage.setItem("songbook.lyricSize", String(lyricSize)); } catch (e) {}
  }
  document.getElementById("size-up").addEventListener("click", function () { bumpSize(2); });
  document.getElementById("size-down").addEventListener("click", function () { bumpSize(-2); });

  /* ---------- keep the screen awake while a song is open ---------- */

  var wakeLock = null;

  function requestWake() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      el.awake.hidden = false;
      lock.addEventListener("release", function () {
        wakeLock = null;
        el.awake.hidden = true;
      });
    }).catch(function () {});
  }
  function releaseWake() {
    el.awake.hidden = true;
    if (!wakeLock) return;
    var lock = wakeLock;
    wakeLock = null;
    try { lock.release(); } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && state.openId && !state.editId && !wakeLock) requestWake();
  });

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function capoLabel(capo) {
    var n = Number(capo);
    if (!n || n < 1) return "";
    return "Capo " + n;
  }

  function statusOf(s) {
    return STATUSES[s.status] ? s.status : "learning";
  }

  function byId(id) {
    for (var i = 0; i < state.songs.length; i++) if (state.songs[i].id === id) return state.songs[i];
    return null;
  }

  function visibleSongs() {
    var q = state.query.trim().toLowerCase();
    return state.songs.filter(function (s) {
      if (state.filter !== "all" && statusOf(s) !== state.filter) return false;
      if (!q) return true;
      return ((s.title || "") + " " + (s.artist || "") + " " + (s.lyrics || "") + " " + (s.notes || "") + " " + (s.tuning || ""))
        .toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) {
      return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
    });
  }

  function writable() { return state.canWrite !== false; }

  /* ---------- list ---------- */

  function renderList() {
    var rows = visibleSongs();

    el.count.textContent = state.loaded
      ? state.songs.length + (state.songs.length === 1 ? " song" : " songs")
      : "loading…";

    el.add.hidden = !writable();

    el.list.innerHTML = rows.map(function (s) {
      var st = statusOf(s);
      var capo = capoLabel(s.capo);
      return '<button class="song" data-id="' + esc(s.id) + '">' +
        '<span class="dot ' + st + '" aria-hidden="true"></span>' +
        '<span class="song-main">' +
          '<span class="song-title">' + esc(s.title || "Untitled") + '</span>' +
          (s.artist ? '<span class="song-artist">' + esc(s.artist) + '</span>' : '') +
        '</span>' +
        '<span class="meta">' +
          (s.tuning ? '<span class="tuning">' + esc(s.tuning) + '</span>' : '') +
          (s.key ? '<span class="key">' + esc(s.key) + '</span>' : '') +
          (capo ? '<span class="capo">' + esc(capo) + '</span>' : '') +
        '</span>' +
      '</button>';
    }).join("");

    var showEmpty = rows.length === 0;
    el.empty.hidden = !showEmpty;
    if (showEmpty) {
      if (!state.loaded) {
        el.empty.innerHTML = '<p>Loading your songs…</p>';
      } else if (state.dbError) {
        // The notice below explains it; don't also invite them to add a song.
        el.empty.hidden = true;
      } else if (state.songs.length === 0) {
        el.empty.innerHTML =
          '<h2>No songs yet</h2>' +
          '<p>Add the first one and it shows up on both phones.</p>' +
          (writable() ? '<button class="btn btn-primary" id="empty-add">Add a song</button>' : '');
        var ea = document.getElementById("empty-add");
        if (ea) ea.addEventListener("click", function () { openEdit(""); });
      } else {
        el.empty.innerHTML = '<p>Nothing matches that.</p>';
      }
    }

    var missing = state.songs.filter(function (s) { return !(s.lyrics || "").trim(); }).length;
    if (state.loaded && missing > 0 && writable()) {
      el.cuPrompt.hidden = false;
      el.cuPrompt.innerHTML =
        '<span>' + missing + (missing === 1 ? ' song has' : ' songs have') + ' no lyrics yet.</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary" id="cu-start">Paste lyrics</button>';
      document.getElementById("cu-start").addEventListener("click", openCatchup);
    } else {
      el.cuPrompt.hidden = true;
    }

    if (state.dbError) {
      el.notice.hidden = false;
      el.notice.textContent = state.dbError;
    } else {
      el.notice.hidden = true;
    }
  }

  el.list.addEventListener("click", function (e) {
    var btn = e.target.closest(".song");
    if (btn) openPerf(btn.getAttribute("data-id"));
  });

  el.search.addEventListener("input", function () {
    state.query = el.search.value;
    renderList();
  });

  el.filters.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    state.filter = chip.getAttribute("data-filter");
    Array.prototype.forEach.call(el.filters.querySelectorAll(".chip"), function (c) {
      c.setAttribute("aria-pressed", String(c === chip));
    });
    renderList();
  });

  el.add.addEventListener("click", function () { openEdit(""); });

  /* ---------- performance view ---------- */

  function openPerf(id) {
    var s = byId(id);
    if (!s) return;
    state.openId = id;
    renderPerf();
    el.perf.hidden = false;
    el.perf.querySelector(".sheet-body").scrollTop = 0;
    requestWake();
  }

  function closePerf() {
    state.openId = null;
    el.perf.hidden = true;
    releaseWake();
  }

  function renderPerf() {
    var s = byId(state.openId);
    if (!s) { closePerf(); return; }

    var st = statusOf(s);
    var capo = Number(s.capo) > 0 ? String(s.capo) : "–";

    el.perfEdit.hidden = !writable();

    el.perfInner.innerHTML =
      '<div class="perf-head">' +
        '<h2 class="perf-title">' + esc(s.title || "Untitled") + '</h2>' +
        (s.artist ? '<div class="perf-artist">' + esc(s.artist) + '</div>' : '') +
        '<div class="perf-meta">' +
          '<div class="stat key-stat"><div class="lbl">Key</div><div class="val">' + esc(s.key || "–") + '</div></div>' +
          '<div class="stat"><div class="lbl">Capo</div><div class="val">' + esc(capo) + '</div></div>' +
          (Number(s.bpm) > 0
            ? '<div class="stat"><div class="lbl">Tempo</div><div class="val">' + esc(s.bpm) + '</div></div>'
            : '') +
          (s.tuning
            ? '<div class="stat tuning-stat"><div class="lbl">Tuning</div><div class="val">' + esc(s.tuning) + '</div></div>'
            : '') +
          '<span class="status-tag ' + st + '">' + STATUSES[st] + '</span>' +
        '</div>' +
      '</div>' +
      (s.notes ? '<div class="notes"><span class="lbl">Notes</span>' + esc(s.notes) + '</div>' : '') +
      (s.lyrics
        ? '<div class="lyrics">' + esc(s.lyrics) + '</div>'
        : '<div class="lyrics blank">No lyrics saved yet.</div>');
  }

  document.getElementById("perf-back").addEventListener("click", closePerf);
  el.perfEdit.addEventListener("click", function () { openEdit(state.openId); });

  /* ---------- lyrics catch-up ---------- */

  function openCatchup() {
    state.cuQueue = state.songs
      .filter(function (s) { return !(s.lyrics || "").trim(); })
      .sort(function (a, b) {
        return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
      })
      .map(function (s) { return s.id; });
    state.cuIdx = 0;
    el.catchup.hidden = false;
    releaseWake();
    renderCatchup();
  }

  function closeCatchup() {
    el.catchup.hidden = true;
    state.cuQueue = [];
    state.cuIdx = 0;
  }

  function renderCatchup() {
    var done = state.cuIdx >= state.cuQueue.length;
    var saveBtn = document.getElementById("cu-save");
    var skipBtn = document.getElementById("cu-skip");

    if (done) {
      el.cuProgress.textContent = "";
      saveBtn.hidden = true;
      skipBtn.hidden = true;
      el.cuInner.innerHTML =
        '<div class="cu-done"><h2>That\'s the list</h2>' +
        '<p>Every song has lyrics now.</p></div>';
      return;
    }

    saveBtn.hidden = false;
    skipBtn.hidden = false;

    var s = byId(state.cuQueue[state.cuIdx]);
    if (!s) { state.cuIdx++; renderCatchup(); return; }

    var bits = [];
    if (s.artist) bits.push(esc(s.artist));
    if (s.key) bits.push('<span class="m">' + esc(s.key) + '</span>');
    if (Number(s.capo) > 0) bits.push('<span class="m">Capo ' + esc(s.capo) + '</span>');

    var q = encodeURIComponent(((s.title || "") + " " + (s.artist || "") + " lyrics").trim());

    el.cuProgress.textContent = (state.cuIdx + 1) + " / " + state.cuQueue.length;
    el.cuInner.innerHTML =
      '<div class="cu-song">' +
        '<h2 class="cu-title">' + esc(s.title || "Untitled") + '</h2>' +
        (bits.length ? '<div class="cu-sub">' + bits.join(" &middot; ") + '</div>' : '') +
        '<div class="cu-links">' +
          '<a class="lookup" target="_blank" rel="noopener noreferrer" ' +
            'href="https://genius.com/search?q=' + q + '">Genius</a>' +
          '<a class="lookup" target="_blank" rel="noopener noreferrer" ' +
            'href="https://www.google.com/search?q=' + q + '">Search</a>' +
        '</div>' +
      '</div>' +
      '<textarea id="cu-text" placeholder="Paste the lyrics for this one"></textarea>' +
      '<p class="err" id="cu-err"></p>';

    el.catchup.querySelector(".sheet-body").scrollTop = 0;
    document.getElementById("cu-text").focus();
  }

  document.getElementById("cu-close").addEventListener("click", closeCatchup);

  document.getElementById("cu-skip").addEventListener("click", function () {
    state.cuIdx++;
    renderCatchup();
  });

  document.getElementById("cu-save").addEventListener("click", function () {
    var box = document.getElementById("cu-text");
    var err = document.getElementById("cu-err");
    if (!box) return;

    var text = box.value;
    if (!text.trim()) {
      state.cuIdx++;
      renderCatchup();
      return;
    }
    if (!db) {
      if (err) err.textContent = "Can't reach the songbook, so that wasn't saved.";
      return;
    }

    var id = state.cuQueue[state.cuIdx];
    if (err) err.textContent = "Saving\u2026";

    db.collection("songs").doc(id).update({
      lyrics: text,
      updatedAt: new Date().toISOString()
    }).then(function () {
      state.cuIdx++;
      renderCatchup();
    }).catch(function (e) {
      if (err) err.textContent = writeError(e, "save");
    });
  });

  /* ---------- edit view ---------- */

  function openEdit(id) {
    state.editId = id;
    var s = id ? byId(id) : null;

    el.f.title.value  = s ? (s.title || "") : "";
    el.f.artist.value = s ? (s.artist || "") : "";
    el.f.key.value    = s ? (s.key || "") : "";
    el.f.capo.value   = s && Number(s.capo) > 0 ? String(s.capo) : "";
    el.f.status.value = s ? statusOf(s) : "learning";
    el.f.bpm.value    = s && Number(s.bpm) > 0 ? String(s.bpm) : "";
    el.f.tuning.value = s ? (s.tuning || "") : "";
    el.f.notes.value  = s ? (s.notes || "") : "";
    el.f.lyrics.value = s ? (s.lyrics || "") : "";
    el.formErr.textContent = "";

    el.deleteSlot.innerHTML = s
      ? '<button type="button" class="btn btn-danger" id="del">Delete song</button>'
      : "";
    var del = document.getElementById("del");
    if (del) del.addEventListener("click", askDelete);

    el.edit.hidden = false;
    el.edit.querySelector(".sheet-body").scrollTop = 0;
    releaseWake();
    el.f.title.focus();
  }

  function closeEdit() {
    state.editId = null;
    el.edit.hidden = true;
    if (state.openId) { renderPerf(); requestWake(); }
  }

  function askDelete() {
    el.deleteSlot.innerHTML =
      '<span class="confirm">Delete for good?' +
      '<button type="button" class="btn btn-danger" id="del-yes">Yes, delete</button>' +
      '<button type="button" class="btn btn-quiet" id="del-no">Keep it</button></span>';
    document.getElementById("del-no").addEventListener("click", function () {
      el.deleteSlot.innerHTML = '<button type="button" class="btn btn-danger" id="del">Delete song</button>';
      document.getElementById("del").addEventListener("click", askDelete);
    });
    document.getElementById("del-yes").addEventListener("click", doDelete);
  }

  function doDelete() {
    if (!db || !state.editId) return;
    el.formErr.textContent = "";
    db.collection("songs").doc(state.editId).delete().then(function () {
      state.openId = null;
      el.perf.hidden = true;
      closeEdit();
    }).catch(function (err) {
      el.formErr.textContent = writeError(err, "delete");
    });
  }

  function writeError(err, verb) {
    var code = err && err.code;
    if (code === "invalid_argument") {
      state.canWrite = false;
      renderList();
      return "You have view-only access to this songbook, so nothing was saved. Ask Geoff to make you an editor.";
    }
    if (code === "quota_exceeded") return "The songbook is full. Delete a song to make room.";
    if (code === "resource_exhausted") return "Too many changes at once. Wait a moment and try again.";
    return "Couldn't " + verb + " that — try again.";
  }

  document.getElementById("edit-cancel").addEventListener("click", closeEdit);

  document.getElementById("edit-save").addEventListener("click", function () {
    var title = el.f.title.value.trim();
    if (!title) {
      el.formErr.textContent = "Give the song a title.";
      el.f.title.focus();
      return;
    }
    if (!db) {
      el.formErr.textContent = "Can't reach the shared songbook right now, so this wasn't saved.";
      return;
    }

    var capoNum = parseInt(el.f.capo.value, 10);
    if (!(capoNum >= 1 && capoNum <= 12)) capoNum = 0;

    var bpmNum = parseInt(el.f.bpm.value, 10);
    if (!(bpmNum >= 20 && bpmNum <= 300)) bpmNum = 0;

    var body = {
      title: title,
      artist: el.f.artist.value.trim(),
      key: el.f.key.value.trim(),
      capo: capoNum,
      bpm: bpmNum,
      tuning: el.f.tuning.value.trim(),
      status: STATUSES[el.f.status.value] ? el.f.status.value : "learning",
      notes: el.f.notes.value,
      lyrics: el.f.lyrics.value,
      updatedAt: new Date().toISOString()
    };

    var isNew = !state.editId;
    var ref = isNew ? db.collection("songs").doc() : db.collection("songs").doc(state.editId);
    if (isNew) body.createdAt = body.updatedAt;

    el.formErr.textContent = "Saving…";
    ref.set(body).then(function () {
      if (isNew) state.openId = ref.id;
      closeEdit();
      if (state.openId) { el.perf.hidden = false; renderPerf(); requestWake(); }
    }).catch(function (err) {
      el.formErr.textContent = writeError(err, "save");
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!el.edit.hidden) closeEdit();
    else if (!el.catchup.hidden) closeCatchup();
    else if (!el.perf.hidden) closePerf();
  });

  /* ---------- wire up the shared store ---------- */

  // Signed out means read-only until Firebase says otherwise.
  state.canWrite = false;

  var signinBtn  = document.getElementById("signin");
  var signoutBtn = document.getElementById("signout");
  var whoami     = document.getElementById("whoami");

  renderList();

  signinBtn.addEventListener("click", function () {
    if (window.__sb) window.__sb.signIn();
  });
  signoutBtn.addEventListener("click", function () {
    if (window.__sb) window.__sb.signOut();
  });

  function connect(sb) {
    signinBtn.hidden = false;

    // A hung promise must not leave the page saying "Loading" forever.
    var settled = false;
    setTimeout(function () {
      if (settled) return;
      settled = true;
      state.loaded = true;
      state.dbError = "Couldn't reach the songbook. Check your connection and reload.";
      renderList();
    }, 12000);

    sb.ready.then(function (ctx) {
      if (settled) return;
      settled = true;
      db = ctx.db;

      ctx.onUser(function (user, canWrite) {
        state.canWrite = canWrite;
        whoami.textContent = user ? (user.email || "") : "";
        whoami.hidden = !user;
        signinBtn.hidden = !!user;
        signoutBtn.hidden = !user;

        if (user && !canWrite) {
          state.dbError = "Signed in as " + (user.email || "that account") +
            ", which isn't on the editor list \u2014 you can read the songbook but not change it.";
        } else if (state.dbError && state.dbError.indexOf("editor list") !== -1) {
          state.dbError = null;
        }

        renderList();
        if (state.openId) renderPerf();
        if (!el.edit.hidden && !canWrite) closeEdit();
        if (!el.catchup.hidden && !canWrite) closeCatchup();
      });

      db.collection("songs").onSnapshot(function (snap) {
        state.loaded = true;
        state.songs = snap.docs.map(function (d) {
          var data = d.data() || {};
          return {
            id: d.id,
            title: data.title, artist: data.artist, key: data.key,
            capo: data.capo, bpm: data.bpm, tuning: data.tuning,
            status: data.status,
            notes: data.notes, lyrics: data.lyrics,
            updatedAt: data.updatedAt
          };
        });
        renderList();
        if (state.openId) renderPerf();
      }, function (err) {
        state.loaded = true;
        state.dbError = err && err.code === "invalid_argument"
          ? "This songbook isn't readable from here \u2014 the link may be wrong."
          : "Lost the connection to the songbook. Reload the page.";
        renderList();
      });
    }).catch(function (e) {
      if (settled) return;
      settled = true;
      state.loaded = true;
      state.dbError = (e && /placeholder/i.test(e.message || ""))
        ? "This copy isn't configured yet \u2014 see SETUP.md."
        : "Couldn't reach the songbook. Check your connection and reload.";
      renderList();
    });
  }

  // The bridge is a module, so it may land either side of this script.
  if (window.__sb) {
    connect(window.__sb);
  } else {
    window.addEventListener("sb-ready", function () { connect(window.__sb); }, { once: true });
    setTimeout(function () {
      if (!db && !state.loaded) {
        state.loaded = true;
        state.dbError = "The songbook didn't load. Check your connection and reload.";
        renderList();
      }
    }, 12000);
  }
})();
