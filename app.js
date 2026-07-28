/* =========================================================================
   İş Takibi — kişisel görev panosu + Google Takvim senkronu
   Saf JavaScript, çerçevesiz. Veriler LocalStorage'da tutulur.
   ========================================================================= */

(() => {
  "use strict";

  const CONFIG = window.ISTAKIP_CONFIG || {};
  const STORAGE_KEY = "istakip.tasks.v1";
  const STATUSES = ["todo", "doing", "done"];
  const PRIO_LABEL = { low: "Düşük", medium: "Orta", urgent: "Acil" };

  /* ---------- Durum (state) ---------- */
  let tasks = load();
  let editingId = null; // düzenleme modundaki görev id'si

  /* ---------- DOM ---------- */
  const $ = (sel) => document.querySelector(sel);
  const form = $("#taskForm");
  const els = {
    title: $("#title"),
    description: $("#description"),
    dueDate: $("#dueDate"),
    autoSync: $("#autoSync"),
    submitBtn: $("#submitBtn"),
    submitLabel: $("#submitLabel"),
    cancelEdit: $("#cancelEdit"),
    googleBtn: $("#googleBtn"),
    googleBtnText: $("#googleBtnText"),
    todayCount: $("#todayCount"),
    overdueCount: $("#overdueCount"),
    toast: $("#toast"),
    cardTpl: $("#cardTpl"),
  };
  const zones = {
    todo: $("#col-todo"),
    doing: $("#col-doing"),
    done: $("#col-done"),
  };

  // Öncelik segment kontrolü (radio) için oku/ayarla
  function getPriority() {
    const el = document.querySelector('input[name="priority"]:checked');
    return el ? el.value : "medium";
  }
  function setPriority(val) {
    const el = document.querySelector(`input[name="priority"][value="${val}"]`);
    if (el) el.checked = true;
  }

  /* =======================================================================
     Depolama
     ===================================================================== */
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }
  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* =======================================================================
     Tarih yardımcıları
     ===================================================================== */
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const isToday = (iso) =>
    iso && startOfDay(iso).getTime() === startOfDay(new Date()).getTime();
  const isOverdue = (task) =>
    task.dueDate && task.status !== "done" && new Date(task.dueDate) < new Date();

  function formatDue(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const opts = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
    let label = d.toLocaleString("tr-TR", opts);
    if (isToday(iso)) {
      label = "Bugün " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    }
    return label;
  }

  // datetime-local değerini güvenle ISO'ya çevirir.
  // Geçersiz tarih (örn. 5 haneli yıl "20265") -> { ok:false } döner ve çökmez.
  function parseDueInput(value) {
    if (!value) return { ok: true, iso: null };
    const d = new Date(value);
    if (isNaN(d.getTime()) || d.getFullYear() > 9999 || d.getFullYear() < 1970) {
      return { ok: false, iso: null };
    }
    return { ok: true, iso: d.toISOString() };
  }

  /* =======================================================================
     Toast bildirimi
     ===================================================================== */
  let toastTimer;
  function toast(msg, type = "") {
    els.toast.textContent = msg;
    els.toast.className = "toast show " + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.className = "toast"), 3200);
  }

  /* =======================================================================
     Render
     ===================================================================== */
  function render() {
    STATUSES.forEach((s) => (zones[s].innerHTML = ""));

    const order = { urgent: 0, medium: 1, low: 2 };

    STATUSES.forEach((status) => {
      const list = tasks.filter((t) => t.status === status);
      if (status !== "done") {
        // Yapılacaklar & Devam Edenler: önem gruplarına göre (Acil > Orta > Düşük).
        // Aynı önemdekiler dizi (manuel) sırasında kalır -> sürükleyerek sıralanır.
        // (Array.sort kararlıdır; eşit önemde sıra korunur.)
        list.sort((a, b) => order[a.priority] - order[b.priority]);
      }
      // Tamamlananlar: manuel (dizi) sırası
      for (const task of list) zones[status].appendChild(buildCard(task));
    });

    updateCounts();
  }

  function buildCard(task) {
    const node = els.cardTpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = task.id;
    node.classList.add("prio-" + task.priority);
    if (task.status === "done") node.classList.add("done");
    if (isOverdue(task)) node.classList.add("overdue");

    const badge = node.querySelector(".badge");
    badge.textContent = PRIO_LABEL[task.priority];
    badge.classList.add(task.priority);

    node.querySelector(".card-title").textContent = task.title;
    node.querySelector(".card-desc").textContent = task.description || "";

    const due = node.querySelector(".due");
    const dueText = node.querySelector(".due-text");
    if (task.dueDate) {
      dueText.textContent = formatDue(task.dueDate);
      if (isOverdue(task)) due.classList.add("is-over");
      else if (isToday(task.dueDate)) due.classList.add("is-today");
    } else {
      due.hidden = true;
    }

    const calBtn = node.querySelector(".cal");
    if (task.calendarEventId) {
      calBtn.classList.add("synced");
      calBtn.title = "Takvimde mevcut · güncellemek için tıkla";
    }

    // İleri / geri butonları
    const idx = STATUSES.indexOf(task.status);
    const back = node.querySelector(".back");
    const fwd = node.querySelector(".fwd");
    back.disabled = idx === 0;
    fwd.disabled = idx === STATUSES.length - 1;

    /* --- olaylar --- */
    calBtn.addEventListener("click", () => addToCalendar(task.id));
    node.querySelector(".edit").addEventListener("click", () => startEdit(task.id));
    node.querySelector(".del").addEventListener("click", () => removeTask(task.id));
    back.addEventListener("click", () => moveTask(task.id, -1));
    fwd.addEventListener("click", () => moveTask(task.id, +1));

    // Sürükle-bırak (pointer tabanlı)
    node.addEventListener("pointerdown", (e) => startPointerDrag(e, task, node));

    return node;
  }

  function updateCounts() {
    STATUSES.forEach((s) => {
      const n = tasks.filter((t) => t.status === s).length;
      const el = document.querySelector(`[data-count="${s}"]`);
      if (el) el.textContent = n;
    });
    const todayN = tasks.filter(
      (t) => t.status !== "done" && isToday(t.dueDate)
    ).length;
    const overdueN = tasks.filter(isOverdue).length;
    els.todayCount.textContent = todayN;
    els.overdueCount.textContent = overdueN;
  }

  /* =======================================================================
     Görev işlemleri
     ===================================================================== */
  function findTask(id) {
    return tasks.find((t) => t.id === id);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = els.title.value.trim();
    if (!title) {
      toast("Görev adı boş olamaz.", "err");
      els.title.focus();
      return;
    }

    const parsed = parseDueInput(els.dueDate.value);
    if (!parsed.ok) {
      toast("Geçersiz tarih — yılı 4 haneli gir (örn. 2026).", "err");
      els.dueDate.focus();
      return;
    }

    const data = {
      title,
      description: els.description.value.trim(),
      priority: getPriority(),
      dueDate: parsed.iso,
    };

    let task;
    if (editingId) {
      task = findTask(editingId);
      Object.assign(task, data);
      toast("Görev güncellendi.", "ok");
      stopEdit();
    } else {
      task = { id: uid(), status: "todo", createdAt: Date.now(), calendarEventId: null, ...data };
      tasks.push(task);
      toast("Görev eklendi.", "ok");
    }

    save();
    render();
    form.reset();
    setPriority("medium");
    els.title.focus();

    // Tarih verildiyse ve otomatik senkron açıksa takvime yaz
    if (task.dueDate && els.autoSync.checked) {
      addToCalendar(task.id, { silent: true });
    }
  });

  function startEdit(id) {
    const t = findTask(id);
    if (!t) return;
    editingId = id;
    els.title.value = t.title;
    els.description.value = t.description || "";
    setPriority(t.priority);
    els.dueDate.value = t.dueDate ? toLocalInput(t.dueDate) : "";
    els.submitLabel.textContent = "Güncelle";
    els.cancelEdit.hidden = false;
    els.title.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function stopEdit() {
    editingId = null;
    els.submitLabel.textContent = "Ekle";
    els.cancelEdit.hidden = true;
  }
  els.cancelEdit.addEventListener("click", () => {
    stopEdit();
    form.reset();
    setPriority("medium");
  });

  // ISO -> datetime-local input değeri (yerel saate göre)
  function toLocalInput(iso) {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
  }

  function removeTask(id) {
    const t = findTask(id);
    if (!t) return;
    if (!confirm(`"${t.title}" görevi silinsin mi?`)) return;
    tasks = tasks.filter((x) => x.id !== id);
    if (editingId === id) stopEdit();
    save();
    render();
    toast("Görev silindi.");
  }

  function moveTask(id, dir) {
    const t = findTask(id);
    if (!t) return;
    const idx = STATUSES.indexOf(t.status) + dir;
    if (idx < 0 || idx >= STATUSES.length) return;
    t.status = STATUSES[idx];
    save();
    render();
  }

  function setStatus(id, status) {
    const t = findTask(id);
    if (!t || t.status === status) return;
    t.status = status;
    save();
    render();
  }

  /* =======================================================================
     Sürükle-bırak (pointer tabanlı)
     - Kart parmağı/imleci takip eder (KATI, saydam değil)
     - Yerinde bir boşluk (placeholder) gösterilir
     - Kart akıştan çıktığı için layout titremesi olmaz
     ===================================================================== */
  let dragging = false; // aktif sürükleme var mı (metin seçimi vs. engellemek için)

  // İmlecin Y'sine göre bu kolonda kartın önüne gireceği kartı bulur
  function getCardAfter(zone, y) {
    const cards = [...zone.querySelectorAll(".card:not(.dragging)")];
    let closest = { offset: -Infinity, el: null };
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, el: card };
    }
    return closest.el;
  }

  function startPointerDrag(e, task, node) {
    if (e.button != null && e.button !== 0) return;         // sadece sol tık / dokunuş
    if (e.target.closest(".icon-btn, .move-btn")) return;   // butonlar sürüklemesin

    const startX = e.clientX, startY = e.clientY;
    const rect = node.getBoundingClientRect();
    let started = false;
    let placeholder = null;

    const begin = () => {
      started = true;
      dragging = true;
      placeholder = document.createElement("div");
      placeholder.className = "card-placeholder";
      placeholder.style.height = rect.height + "px";
      node.parentNode.insertBefore(placeholder, node);
      // ÖNCE "dragging" sınıfını (animation:none) uygula, SONRA taşı.
      // Sıra tersi olursa, tarayıcı taşıma anında elemanın hâlâ animasyonlu
      // (cardIn) olduğunu görüp giriş animasyonunu yeniden başlatabiliyor.
      node.classList.add("dragging");
      // Kartı doğrudan <body>'ye taşı -> hiçbir üst elemanın (örn. .wrap'ın
      // kendi istifleme bağlamı) etkisinde kalmadan HER ZAMAN en üstte kalır.
      document.body.appendChild(node);
      // kartı akıştan çıkar ve sabitle -> parmağı takip etsin, titremesin
      node.style.position = "fixed";
      node.style.zIndex = "1000";
      node.style.width = rect.width + "px";
      node.style.left = rect.left + "px";
      node.style.top = rect.top + "px";
      node.style.pointerEvents = "none";
      // Güvenlik: taşıma yüzünden yeniden tetiklenmiş olabilecek her türlü
      // CSS animasyonunu zorla iptal et (kart soluk/hayalet görünmesin)
      try { node.getAnimations().forEach((a) => a.cancel()); } catch (_) {}
      document.body.classList.add("dragging-active");
    };

    const placeAt = (x, y) => {
      // İmlecin bulunduğu kolonu geometrik olarak bul (pointer-events/stacking'e bağımlı olma)
      let zone = null;
      for (const s of STATUSES) {
        const r = zones[s].getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { zone = zones[s]; break; }
      }
      if (!zone) {
        // dikeyde dışarıda olsa bile yatayda hangi kolona denk geliyorsa onu seç
        for (const s of STATUSES) {
          const r = zones[s].getBoundingClientRect();
          if (x >= r.left && x <= r.right) { zone = zones[s]; break; }
        }
      }
      if (!zone) return;
      const after = getCardAfter(zone, y);
      if (after == null) zone.appendChild(placeholder);
      else zone.insertBefore(placeholder, after);
    };

    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started) {
        if (Math.hypot(dx, dy) < 6) return; // tıklama / sürükleme eşiği
        begin();
      }
      node.style.left = rect.left + dx + "px";
      node.style.top = rect.top + dy + "px";
      placeAt(ev.clientX, ev.clientY);
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("dragging-active");
      dragging = false;
      if (!started) return; // hareket yoktu -> sadece tıklama
      node.remove(); // body'ye taşınan geçici sürükleme kartını kaldır (render() yenisini kuracak)
      commitPointerDrag(task, placeholder);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  // Placeholder'ın son konumuna göre tasks dizisini ve durumu günceller
  function commitPointerDrag(task, placeholder) {
    const zone = placeholder ? placeholder.closest(".dropzone") : null;
    const status = zone ? zone.dataset.status : task.status;
    // placeholder'dan sonra gelen ilk (sürüklenmeyen) kart -> önüne eklenir
    let beforeId = null;
    let n = placeholder ? placeholder.nextElementSibling : null;
    while (n) {
      if (n.classList.contains("card") && !n.classList.contains("dragging")) {
        beforeId = n.dataset.id;
        break;
      }
      n = n.nextElementSibling;
    }
    const idx = tasks.findIndex((t) => t.id === task.id);
    if (idx !== -1) {
      const [t] = tasks.splice(idx, 1);
      t.status = status;
      if (beforeId == null) tasks.push(t);
      else tasks.splice(tasks.findIndex((x) => x.id === beforeId), 0, t);
    }
    save();
    render(); // panoyu yeniden kurar (sabit kart + placeholder temizlenir)
  }

  /* =======================================================================
     Yedekleme
     ===================================================================== */
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `is-takibi-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* =======================================================================
     GOOGLE TAKVİM ENTEGRASYONU
     ---------------------------------------------------------------------
     İki yol:
       1) CLIENT_ID tanımlıysa: OAuth ile giriş yapılır, olaylar API
          üzerinden OTOMATİK yazılır/güncellenir (hatırlatıcılar dahil).
       2) CLIENT_ID boşsa: "Takvime ekle", olayı önceden doldurulmuş
          Google Takvim ekranında açar (tek tık ile kaydet).
     ===================================================================== */
  const google_ = {
    tokenClient: null,
    gapiReady: false,
    connected: false,
  };
  const hasClientId = !!(CONFIG.GOOGLE_CLIENT_ID && CONFIG.GOOGLE_CLIENT_ID.trim());

  // api.js (gapi) yüklendiğinde
  window.gapiLoaded = () => {}; // (script async; aşağıda yoklayarak başlatıyoruz)

  function initGapiClient() {
    if (!window.gapi) return;
    gapi.load("client", async () => {
      try {
        await gapi.client.init({});
        await gapi.client.load(
          "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"
        );
        google_.gapiReady = true;
      } catch (err) {
        console.error("gapi init hatası:", err);
      }
    });
  }

  function initTokenClient() {
    if (!window.google || !google.accounts || !hasClientId) return;
    google_.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID.trim(),
      scope: "https://www.googleapis.com/auth/calendar.events",
      callback: (resp) => {
        if (resp.error) {
          toast("Google girişi iptal edildi.", "err");
          return;
        }
        gapi.client.setToken({ access_token: resp.access_token });
        google_.connected = true;
        updateGoogleBtn();
        toast("Google Takvim'e bağlandın.", "ok");
        if (pendingSync) {
          const id = pendingSync;
          pendingSync = null;
          addToCalendar(id);
        }
      },
    });
  }

  // Kütüphaneler async yüklendiği için hazır olana kadar yokla
  let libPoll = setInterval(() => {
    if (window.gapi && !google_.gapiReady) initGapiClient();
    if (window.google && google.accounts && !google_.tokenClient) initTokenClient();
    if ((google_.gapiReady || !window.gapi) && (google_.tokenClient || !hasClientId)) {
      clearInterval(libPoll);
    }
  }, 400);
  setTimeout(() => clearInterval(libPoll), 15000);

  function updateGoogleBtn() {
    if (google_.connected) {
      els.googleBtn.classList.add("connected");
      els.googleBtnText.textContent = "Google Takvim bağlı";
    } else {
      els.googleBtn.classList.remove("connected");
      els.googleBtnText.textContent = hasClientId
        ? "Google Takvim'e bağlan"
        : "Takvim: hızlı mod";
    }
  }

  let pendingSync = null; // giriş sonrası senkronlanacak görev
  els.googleBtn.addEventListener("click", () => {
    if (!hasClientId) {
      toast("CLIENT_ID girilmedi — 'Takvime ekle' hızlı modda çalışır. (README)", "");
      return;
    }
    if (google_.connected) {
      const t = gapi.client.getToken();
      if (t) {
        google.accounts.oauth2.revoke(t.access_token, () => {});
        gapi.client.setToken(null);
      }
      google_.connected = false;
      updateGoogleBtn();
      toast("Google bağlantısı kesildi.");
    } else {
      google_.tokenClient?.requestAccessToken({ prompt: "" });
    }
  });

  /* --- Bir görevi takvime yaz/güncelle --- */
  async function addToCalendar(id, opts = {}) {
    const task = findTask(id);
    if (!task) return;
    if (!task.dueDate) {
      if (!opts.silent) toast("Önce görevin teslim tarih/saatini gir.", "err");
      return;
    }

    // Yol 2: API yoksa hızlı mod (önceden doldurulmuş takvim ekranı)
    if (!hasClientId) {
      window.open(buildTemplateUrl(task), "_blank", "noopener");
      return;
    }

    // Yol 1: API. Bağlı değilse önce giriş iste, sonra devam et.
    if (!google_.connected) {
      pendingSync = id;
      google_.tokenClient?.requestAccessToken({ prompt: "" });
      return;
    }
    if (!google_.gapiReady) {
      toast("Takvim servisi henüz hazır değil, tekrar dene.", "err");
      return;
    }

    const start = new Date(task.dueDate);
    const end = new Date(start.getTime() + (CONFIG.EVENT_DURATION_MIN || 60) * 60000);
    const event = {
      summary: task.title,
      description: task.description || "",
      start: { dateTime: start.toISOString(), timeZone: CONFIG.TIMEZONE || "Europe/Istanbul" },
      end: { dateTime: end.toISOString(), timeZone: CONFIG.TIMEZONE || "Europe/Istanbul" },
      reminders: {
        useDefault: false,
        overrides: CONFIG.DEFAULT_REMINDERS || [{ method: "popup", minutes: 30 }],
      },
    };

    try {
      let res;
      if (task.calendarEventId) {
        res = await gapi.client.calendar.events.update({
          calendarId: "primary",
          eventId: task.calendarEventId,
          resource: event,
        });
      } else {
        res = await gapi.client.calendar.events.insert({
          calendarId: "primary",
          resource: event,
        });
      }
      task.calendarEventId = res.result.id;
      save();
      render();
      if (!opts.silent) toast("Takvime kaydedildi ✓", "ok");
    } catch (err) {
      console.error(err);
      // Etkinlik silinmişse id'yi temizle
      if (err?.status === 404 || err?.result?.error?.code === 404) {
        task.calendarEventId = null;
        save();
      }
      toast("Takvime yazılamadı. Konsolu kontrol et.", "err");
    }
  }

  // Hızlı mod URL'i (API gerektirmez)
  function buildTemplateUrl(task) {
    const start = new Date(task.dueDate);
    const end = new Date(start.getTime() + (CONFIG.EVENT_DURATION_MIN || 60) * 60000);
    const z = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: task.title,
      dates: `${z(start)}/${z(end)}`,
      details: task.description || "",
    });
    return "https://calendar.google.com/calendar/render?" + params.toString();
  }

  /* =======================================================================
     Tema (açık / koyu) — varsayılan koyu, tercih hatırlanır
     ===================================================================== */
  const THEME_KEY = "istakip.theme";
  $("#themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  /* =======================================================================
     Başlat
     ===================================================================== */
  updateGoogleBtn();
  render();
  els.title.focus();

  // Geciken/bugün rozetlerini dakikada bir tazele
  setInterval(render, 60000);
})();
