(function () {
  'use strict';

  const STORAGE_KEY = 'austria-trip-2026-v3';
  const SYNC_META_KEY = 'austria-trip-2026-v3-sync';
  let state = loadState();
  let currentTab = 'home';
  let moreSubTab = 'stay';
  let shoppingFilter = 'all';
  let applyingRemote = false;
  let syncStatus = 'offline'; // offline | live | pending

  function defaultCustom() {
    return {
      shopping: {},
      shoppingCats: [],
      activities: {},
      dayNotes: {},
      stayNotes: {},
      forget: [],
      pretrip: {},
      budget: [],
      bookings: [],
    };
  }

  function getSyncMeta() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setSyncMeta(patch) {
    const meta = { ...getSyncMeta(), ...patch };
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
    return meta;
  }

  function stateHasMarks(s) {
    const checks = Object.keys(s.checks || {}).length;
    const shopping = Object.keys(s.shopping || {}).length;
    const c = s.custom || {};
    const custom = (c.forget || []).length + (c.bookings || []).length
      + Object.keys(c.dayNotes || {}).length + Object.keys(c.stayNotes || {}).length
      + Object.keys(c.shopping || {}).length + (c.shoppingCats || []).length;
    return checks + shopping + custom > 0;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      return {
        checks: saved.checks || {},
        shopping: saved.shopping || {},
        custom: { ...defaultCustom(), ...(saved.custom || {}) },
      };
    } catch {
      return { checks: {}, shopping: {}, custom: defaultCustom() };
    }
  }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function customShoppingList(catId) {
    return state.custom.shopping[catId] || [];
  }

  function allShoppingItems() {
    const items = [];
    TRIP.shopping.forEach(cat => {
      cat.items.forEach(item => items.push({ catId: cat.id, item, custom: false }));
      customShoppingList(cat.id).forEach(c => items.push({ catId: cat.id, item: c.text, custom: true, customId: c.id }));
    });
    (state.custom.shoppingCats || []).forEach(cat => {
      (cat.items || []).forEach(c => items.push({ catId: cat.id, item: c.text, custom: true, customId: c.id }));
    });
    return items;
  }

  function renderAddBar(opts) {
    const { type, cat, day, placeholder, withTime, label } = opts;
    return `
      ${label ? `<div class="add-section-label">${esc(label)}</div>` : ''}
      <div class="add-bar" data-add-type="${esc(type)}" data-add-cat="${esc(cat || '')}" data-add-day="${esc(day || '')}">
        ${withTime ? '<input class="add-input add-input-time" type="text" inputmode="numeric" placeholder="שעה" maxlength="8" />' : ''}
        <input class="add-input add-input-text" type="text" placeholder="${esc(placeholder)}" />
        <button type="button" class="add-btn" aria-label="הוסף">+</button>
      </div>`;
  }

  function addShoppingItem(catId, text) {
    const customCat = (state.custom.shoppingCats || []).find(c => c.id === catId);
    if (customCat) {
      if (!customCat.items) customCat.items = [];
      customCat.items.push({ id: uid(), text });
    } else {
      if (!state.custom.shopping[catId]) state.custom.shopping[catId] = [];
      state.custom.shopping[catId].push({ id: uid(), text });
    }
  }

  function renderShoppingQuickAdd() {
    const cats = [
      ...TRIP.shopping.map(c => ({ id: c.id, name: c.name })),
      ...(state.custom.shoppingCats || []).map(c => ({ id: c.id, name: c.name + ' (שלי)' })),
    ];
    const options = cats.map(c =>
      `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

    return `
      <div class="card shopping-quick-add">
        <div class="card-title">➕ הוסיפי פריט לרשימת קניות</div>
        <p class="quick-add-hint">בחרי קטגוריה, כתבי מה לקנות, ולחצי הוסף</p>
        <select class="add-select" id="shop-quick-cat" aria-label="קטגוריה">${options}</select>
        <div class="shop-quick-row">
          <input class="add-input add-input-text" type="text" id="shop-quick-text" placeholder="למשל: חלב סויה, במבה..." />
          <button type="button" class="add-btn add-btn-wide" id="shop-quick-btn">הוסף</button>
        </div>
      </div>`;
  }

  function renderDeleteBtn(dataAttr, id) {
    return `<button type="button" class="del-btn" data-${dataAttr}="${esc(id)}" aria-label="מחק">×</button>`;
  }

  function saveState() {
    const now = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setSyncMeta({ lastLocalEdit: now });
    if (!applyingRemote && typeof TripSync !== 'undefined' && TripSync.getRoomId()) {
      syncStatus = 'pending';
      updateSyncDot();
      TripSync.push(state).then(ok => {
        syncStatus = ok === false ? 'error' : 'live';
        updateSyncDot();
        if (ok === false) {
          showToast('סנכרון נכשל — בדקי אינטרנט');
        } else if (ok) {
          setSyncMeta({ lastAppliedRemote: Date.now() });
        }
        const urlEl = document.getElementById('group-share-url');
        if (urlEl && !TripSync.hasCloud()) {
          urlEl.textContent = TripSync.groupShareUrl(TripSync.getRoomId(), state);
        }
      });
    }
  }

  function applyRemoteState(remote, remoteTs) {
    applyingRemote = true;
    state = {
      checks: remote.checks || {},
      shopping: remote.shopping || {},
      custom: { ...defaultCustom(), ...(remote.custom || {}) },
    };
    const ts = remoteTs || remote._ts || Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setSyncMeta({ lastAppliedRemote: ts, lastLocalEdit: ts });
    renderMain();
    updateBadges();
    syncStatus = 'live';
    updateSyncDot();
    applyingRemote = false;
  }

  function initSync() {
    if (typeof TripSync === 'undefined') return;

    const urlCode = new URLSearchParams(location.search).get('g');
    const normalizedUrl = urlCode
      ? urlCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      : '';
    const storedBefore = localStorage.getItem('austria-trip-room');
    const isFirstJoinViaLink = !!(normalizedUrl.length >= 6 && storedBefore !== normalizedUrl);

    TripSync.init(applyRemoteState);
    const room = TripSync.getRoomId();
    if (!room) {
      syncStatus = 'offline';
      updateSyncDot();
      return;
    }

    TripSync.fetchOnce().then(remote => {
      if (remote && remote._ts) {
        const remoteHasData = stateHasMarks(remote);
        const localHasData = stateHasMarks(state);
        // In a shared room: always load cloud on first open via link, or when cloud has
        // marks and local is empty, or when cloud is newer than last applied remote.
        const meta = getSyncMeta();
        const cloudIsNewer = remote._ts > (meta.lastAppliedRemote || 0);
        if (isFirstJoinViaLink || (remoteHasData && !localHasData) || cloudIsNewer) {
          TripSync.bumpLastApplied(remote._ts);
          applyRemoteState(remote, remote._ts);
        } else {
          TripSync.push(state);
        }
      } else if (!isFirstJoinViaLink && stateHasMarks(state)) {
        TripSync.push(state);
      }
      syncStatus = 'live';
      updateSyncDot();
    });
  }

  async function pullFromCloud(notify) {
    if (typeof TripSync === 'undefined' || !TripSync.getRoomId()) return;
    const remote = await TripSync.fetchOnce();
    if (!remote || !remote._ts) return;
    const meta = getSyncMeta();
    if (remote._ts <= (meta.lastAppliedRemote || 0)) return;
    TripSync.bumpLastApplied(remote._ts);
    applyRemoteState(remote, remote._ts);
    if (notify) showToast('✓ עודכן מהענן');
  }

  function updateSyncDot() {
    const el = document.getElementById('sync-status-pill');
    if (!el) return;
    const room = typeof TripSync !== 'undefined' ? TripSync.getRoomId() : null;
    if (!room) {
      el.textContent = 'סנכרון: צרי קבוצה';
      el.className = 'sync-pill sync-warn';
      return;
    }
    if (syncStatus === 'pending') {
      el.textContent = 'מסנכרן…';
      el.className = 'sync-pill sync-pending';
      return;
    }
    if (syncStatus === 'error') {
      el.textContent = '🔴 שגיאת סנכרון';
      el.className = 'sync-pill sync-warn';
      return;
    }
    const mode = typeof TripSync !== 'undefined' && TripSync.hasCloud() ? 'אוטומטי' : 'קישור';
    el.textContent = '🟢 ' + mode + ' · ' + room;
    el.className = 'sync-pill sync-live';
  }

  function renderGroupCard() {
    const room = typeof TripSync !== 'undefined' ? TripSync.getRoomId() : null;
    const shareLink = room && typeof TripSync !== 'undefined' ? TripSync.groupShareUrl(room, state) : '';
    const cloud = typeof TripSync !== 'undefined' && TripSync.hasCloud();

    if (!room) {
      return `
        <div class="section-title">👨‍👩‍👧‍👦 סנכרון משפחתי</div>
        <div class="card group-card group-card-active">
          <div class="card-title">צרו קבוצה משפחתית</div>
          <p class="group-hint">בלי הרשמות — פשוט לוחצים ושולחים לבעל בוואטסאפ.<br>זוג אחר = <strong>קבוצה חדשה</strong> (רשימה נפרדת).</p>
          <div class="group-actions">
            <button type="button" class="maps-btn" id="create-room-btn">✨ צרי קבוצה חדשה</button>
          </div>
          <div class="join-room-box">
            <p class="group-hint">או הצטרפי לקבוצה קיימת (קוד מבעלך):</p>
            <div class="shop-quick-row">
              <input class="add-input" type="text" id="join-room-input" placeholder="קוד קבוצה (למשל ABC12XYZ)" maxlength="12" style="text-transform:uppercase" />
              <button type="button" class="add-btn add-btn-wide" id="join-room-btn">הצטרפי</button>
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="section-title">👨‍👩‍👧‍👦 סנכרון משפחתי</div>
      <div class="card group-card group-card-live">
        <div class="card-title">🟢 קבוצה פעילה: <span class="room-code">${esc(room)}</span></div>
        ${cloud
          ? '<p class="group-hint">סנכרון אוטומטי פעיל — בעלך רואה שינויים בזמן אמת.</p>'
          : '<p class="group-hint"><strong>שלחי לבעל את הקישור</strong> — הוא יראה את הסימונים שלך.<br>אחרי שינויים חדשים — לחצי שוב «שלחי עדכון».</p>'}
        <div class="husband-link-box">
          <div class="husband-link-label">קישור לבעל:</div>
          <div class="share-url husband-link-url" id="group-share-url">${esc(shareLink)}</div>
        </div>
        <button type="button" class="maps-btn husband-wa-btn" id="whatsapp-husband-btn">💬 ${cloud ? 'שלחי לבעל בוואטסאפ' : 'שלחי / עדכני את בעלך בוואטסאפ'}</button>
        <button type="button" class="maps-btn" id="copy-group-link-btn">📋 העתקת קישור</button>
        ${cloud ? '<button type="button" class="maps-btn" id="sync-refresh-btn" style="background:var(--green-light);margin-top:0.35rem">🔄 רענן עכשיו מהענן</button>' : ''}
        ${cloud ? `
        <div class="couple-invite-box">
          <p class="group-hint"><strong>זוג שמטייל איתכם?</strong> שלחי להם את המדריך — הם רק יוצרים קבוצה חדשה (בלי הגדרות טכניות).</p>
          <button type="button" class="maps-btn" style="background:#25d366;width:100%" id="whatsapp-couple-btn">👫 שלחי לזוג אחר (וואטסאפ)</button>
        </div>` : ''}
        ${cloud ? '' : `
        <details class="group-advanced" open>
          <summary>⚡ סנכרון אוטומטי (אופציונלי, בלי Google)</summary>
          <p class="group-hint">הרשמה ב-<a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> עם <strong>מייל</strong> (לא Google Cloud). פעם אחת — ואז בלי לשלוח שוב.</p>
          <input class="add-input" type="url" id="supabase-url" placeholder="Project URL (https://xxx.supabase.co)" style="margin-bottom:0.35rem" />
          <input class="add-input" type="text" id="supabase-key" placeholder="anon public key" style="margin-bottom:0.35rem" />
          <button type="button" class="maps-btn" id="save-supabase-btn">הפעלת סנכרון אוטומטי</button>
          <p class="group-hint" style="font-size:0.72rem">צריך גם ליצור טבלה — הוראות בלחיצה על «?» למטה</p>
          <details style="margin-top:0.35rem">
            <summary style="font-size:0.75rem;cursor:pointer">? איך יוצרים טבלה ב-Supabase</summary>
            <ol class="setup-steps">
              <li>supabase.com → Sign up עם מייל</li>
              <li>New project → המתיני דקה</li>
              <li>SQL Editor → הדביקי את הקוד מ-<code>supabase-setup.sql</code> בגיטהאב</li>
              <li>Settings → API → העתיקי URL + anon key</li>
            </ol>
          </details>
        </details>`}
        <details class="group-advanced">
          <summary>זוג אחר / גיבוי</summary>
          <button type="button" class="maps-btn" style="background:#c44;margin-top:0.35rem" id="new-room-btn">קבוצה חדשה (זוג אחר)</button>
          <button type="button" class="maps-btn" style="background:var(--text-muted);margin-top:0.35rem" id="export-state-btn">גיבוי טכני (לא לבעל!)</button>
          <button type="button" class="maps-btn" style="background:var(--green-light);margin-top:0.35rem" id="import-state-btn">ייבוא גיבוי</button>
        </details>
      </div>`;
  }

  function otherCoupleInviteMessage() {
    const base = (TRIP.meta && TRIP.meta.shareUrl) ? TRIP.meta.shareUrl.replace(/\?.*$/, '').replace(/#.*$/, '') : 'https://estyca-tr.github.io/austria-family-guide/';
    return 'היי! 🏔️\n'
      + 'מדריך הטיול שלנו לאוסטריה:\n'
      + base + '\n\n'
      + 'הוראות (2 דקות, בלי הגדרות טכניות):\n'
      + '1️⃣ נכנסים לקישור\n'
      + '2️⃣ בית → סנכרון משפחתי → «צרו קבוצה חדשה»\n'
      + '   ⚠️ חשוב: קבוצה שלכם! לא להצטרף לקבוצה שלנו\n'
      + '3️⃣ שולחים את הקישור לבן/בת הזוג — מסתנכרן אוטומטית ביניכם\n\n'
      + 'בהצלחה! 🇦🇹';
  }

  function openWhatsAppOtherCouple() {
    const waUrl = 'https://wa.me/?text=' + encodeURIComponent(otherCoupleInviteMessage());
    window.open(waUrl, '_blank', 'noopener');
  }

  function husbandInviteMessage(room, link) {
    return 'היי! 🏔️ המדריך שלנו לאוסטריה — לחץ על הקישור ונהיה באותה רשימה (קניות, סימונים):\n\n'
      + (link || '') + '\n\nקוד קבוצה: ' + (room || '');
  }

  function openWhatsAppInvite(room) {
    const link = TripSync.groupShareUrl(room, state);
    const text = husbandInviteMessage(room, link);
    const waUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(waUrl, '_blank', 'noopener');
  }

  function exportStateJson() {
    return JSON.stringify({ checks: state.checks, shopping: state.shopping, custom: state.custom }, null, 0);
  }

  function importStateJson(raw) {
    const data = JSON.parse(raw);
    state = {
      checks: data.checks || {},
      shopping: data.shopping || {},
      custom: { ...defaultCustom(), ...(data.custom || {}) },
    };
    saveState();
    renderMain();
    showToast('✓ יובא בהצלחה');
  }

  function bindGroupEvents() {
    document.getElementById('save-supabase-btn')?.addEventListener('click', () => {
      const url = document.getElementById('supabase-url')?.value?.trim();
      const key = document.getElementById('supabase-key')?.value?.trim();
      if (!url || !key) return showToast('מלאי URL ו-anon key');
      TripSync.saveSupabase(url, key);
      initSync();
      TripSync.push(state);
      showToast('✓ סנכרון אוטומטי הופעל!');
      renderMain();
    });

    document.getElementById('whatsapp-couple-btn')?.addEventListener('click', () => {
      openWhatsAppOtherCouple();
    });

    document.getElementById('create-room-btn')?.addEventListener('click', async () => {
      const code = TripSync.createRoom();
      if (!code) return showToast('שגיאה — בדקי חיבור לאינטרנט');
      await TripSync.push(state);
      showToast('✓ קבוצה נוצרה: ' + code);
      renderMain();
      setTimeout(() => openWhatsAppInvite(code), 600);
    });

    document.getElementById('join-room-btn')?.addEventListener('click', async () => {
      const input = document.getElementById('join-room-input');
      const code = TripSync.joinRoom(input?.value || '');
      if (!code) return showToast('קוד לא תקין');
      const remote = await TripSync.fetchOnce();
      if (remote && remote._ts) {
        TripSync.bumpLastApplied(remote._ts);
        applyRemoteState(remote, remote._ts);
        showToast('✓ הצטרפת לקבוצה ' + code);
      } else {
        await TripSync.push(state);
        showToast('✓ הצטרפת — העלית את הסימונים שלך');
      }
      renderMain();
    });

    document.getElementById('sync-refresh-btn')?.addEventListener('click', async () => {
      await pullFromCloud(true);
    });

    document.getElementById('copy-group-link-btn')?.addEventListener('click', () => {
      const room = TripSync.getRoomId();
      const link = TripSync.groupShareUrl(room, state);
      navigator.clipboard.writeText(link).then(() => showToast('✓ הקישור הועתק')).catch(() => showToast(link));
    });

    document.getElementById('whatsapp-husband-btn')?.addEventListener('click', () => {
      const room = TripSync.getRoomId();
      if (!room) return showToast('צרי קבוצה קודם');
      openWhatsAppInvite(room);
    });

    document.getElementById('share-group-native-btn')?.addEventListener('click', async () => {
      const room = TripSync.getRoomId();
      const link = TripSync.groupShareUrl(room);
      const text = 'הצטרף לקבוצת הטיול שלנו (סימונים משותפים)';
      if (navigator.share) {
        try { await navigator.share({ title: 'קבוצת טיול אוסטריה', text, url: link }); } catch { /* cancelled */ }
      } else {
        navigator.clipboard.writeText(link).then(() => showToast('✓ הקישור הועתק'));
      }
    });

    document.getElementById('new-room-btn')?.addEventListener('click', async () => {
      if (!confirm('ליצור קבוצה חדשה? זוג אחר יקבל רשימה נפרדת. הסימונים הנוכחיים יישארו אצלך מקומית.')) return;
      TripSync.leaveRoom();
      state = { checks: {}, shopping: {}, custom: defaultCustom() };
      saveState();
      const code = TripSync.createRoom();
      await TripSync.push(state);
      showToast('קבוצה חדשה: ' + code);
      renderMain();
    });

    document.getElementById('export-state-btn')?.addEventListener('click', () => {
      const json = exportStateJson();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(json).then(() => showToast('גיבוי טכני הועתק (לא לבעל!)')).catch(() => prompt('גיבוי:', json));
      } else {
        prompt('גיבוי טכני:', json);
      }
    });

    document.getElementById('import-state-btn')?.addEventListener('click', () => {
      const raw = prompt('הדביקי את הקוד שקיבלת (ייצוא מוואטסאפ):');
      if (!raw) return;
      try {
        importStateJson(raw.trim());
        if (TripSync.getRoomId()) TripSync.push(state);
      } catch {
        showToast('קוד לא תקין');
      }
    });
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function dayImage(day) {
    if (day.placeKey && typeof PLACES !== 'undefined' && PLACES[day.placeKey]) {
      return PLACES[day.placeKey].image;
    }
    return null;
  }

  function activityMaps(a) {
    if (a.maps) return a.maps;
    if (typeof PLACES !== 'undefined' && a.placeKey && PLACES[a.placeKey]?.maps) return PLACES[a.placeKey].maps;
    return null;
  }

  function renderLinks(a) {
    const parts = [];
    if (a.book) parts.push(`<a class="link-btn link-book" href="${esc(a.book)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🎫 הזמנה</a>`);
    if (a.url) parts.push(`<a class="link-btn" href="${esc(a.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🌐 אתר</a>`);
    const maps = activityMaps(a);
    if (maps) parts.push(`<a class="link-btn link-maps" href="${esc(maps)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📍 מפה</a>`);
    return parts.length ? `<div class="activity-links">${parts.join('')}</div>` : '';
  }

  function renderCoverageLinks(c) {
    const parts = [];
    if (c.book) parts.push(`<a class="link-btn link-book" href="${esc(c.book)}" target="_blank" rel="noopener">🎫 הזמנה</a>`);
    if (c.url) parts.push(`<a class="link-btn" href="${esc(c.url)}" target="_blank" rel="noopener">🌐 אתר</a>`);
    const maps = c.maps || (c.placeKey && typeof PLACES !== 'undefined' && PLACES[c.placeKey]?.maps);
    if (maps) parts.push(`<a class="link-btn link-maps" href="${esc(maps)}" target="_blank" rel="noopener">📍 מפה</a>`);
    return parts.length ? `<div class="activity-links" style="margin-top:0.35rem">${parts.join('')}</div>` : '';
  }

  function shoppingKey(catId, item) {
    return `shop-${catId}-${item}`;
  }

  function shoppingProgress() {
    const all = allShoppingItems();
    const done = all.filter(i => state.shopping[shoppingKey(i.catId, i.item)]).length;
    return { done, total: all.length };
  }

  function init() {
    document.getElementById('trip-title').textContent = TRIP.meta.title;
    document.title = TRIP.meta.shareTitle || TRIP.meta.title;
    document.getElementById('trip-dates').textContent = `${TRIP.meta.dates} · ${TRIP.meta.tripCore}`;
    document.getElementById('trip-family').textContent = TRIP.meta.family;
    renderCountdown();
    applyHeroImage();
    renderMain();
    bindNav();
    updateBadges();
    openTodayDay();
    initSync();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pullFromCloud(false);
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js?v=16').catch(() => {});
    }
  }

  function applyHeroImage() {
    const bg = document.querySelector('.hero-bg');
    if (bg && TRIP.meta.heroImage) {
      bg.style.backgroundImage = `linear-gradient(160deg, rgba(26,77,62,0.88) 0%, rgba(45,106,79,0.75) 45%, rgba(64,145,108,0.55) 100%), url('${TRIP.meta.heroImage}')`;
      bg.style.backgroundSize = 'cover';
      bg.style.backgroundPosition = 'center';
    }
  }

  function renderCountdown() {
    const el = document.getElementById('countdown');
    const target = new Date('2026-08-02T00:00:00');
    const diff = target - new Date();

    if (diff <= 0) {
      el.innerHTML = '<div class="countdown-item"><span class="countdown-num">🎒</span><span class="countdown-label">בטיול!</span></div>';
      return;
    }

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    el.innerHTML = `
      <div class="countdown-item"><span class="countdown-num">${days}</span><span class="countdown-label">ימים</span></div>
      <div class="countdown-item"><span class="countdown-num">${hours}</span><span class="countdown-label">שעות</span></div>`;
  }

  function getTodayDay() {
    const dd = String(new Date().getDate()).padStart(2, '0');
    const mm = String(new Date().getMonth() + 1).padStart(2, '0');
    return TRIP.days.find(d => d.date === `${dd}.${mm}`);
  }

  function openTodayDay() {
    const today = getTodayDay();
    if (today && currentTab === 'days') {
      setTimeout(() => {
        const card = document.querySelector(`[data-day-id="${today.id}"]`);
        if (card) {
          card.classList.add('open');
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }

  function pendingBookings() {
    const builtIn = TRIP.bookings.filter(b => b.priority !== 'optional' && !state.checks['booking-' + b.id]).length;
    const custom = (state.custom.bookings || []).filter(b => !state.checks['booking-custom-' + b.id]).length;
    return builtIn + custom;
  }

  function updateBadges() {
    const bookingBadge = document.getElementById('booking-badge');
    const bn = pendingBookings();
    bookingBadge.textContent = bn;
    bookingBadge.hidden = bn === 0;

    const shopBadge = document.getElementById('shopping-badge');
    const { done, total } = shoppingProgress();
    const remaining = total - done;
    shopBadge.textContent = remaining;
    shopBadge.hidden = remaining === 0;
  }

  function bindNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTab = btn.dataset.tab;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderMain();
        if (currentTab === 'days') openTodayDay();
      });
    });
  }

  function renderMain() {
    const main = document.getElementById('main-content');
    const renderers = {
      home: renderHome,
      days: renderDays,
      shopping: renderShopping,
      bookings: renderBookings,
      more: renderMore,
    };
    main.innerHTML = (renderers[currentTab] || renderHome)();
    bindDynamicEvents();
    updateBadges();
    updateSyncDot();
  }

  function progressBar(done, total, label) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-label"><span>${label}</span><span>${done}/${total} (${pct}%)</span></div>
      </div>`;
  }

  function renderCheckItem(key, title, meta, done) {
    return `
      <div class="check-item ${done ? 'done' : ''}" data-check="${esc(key)}">
        <div class="check-box">${done ? '✓' : ''}</div>
        <div class="check-content">
          <div class="check-title">${title}</div>
          ${meta || ''}
        </div>
      </div>`;
  }

  function renderHome() {
    const today = getTodayDay();
    const critical = TRIP.bookings.filter(b => b.priority === 'critical' && !state.checks['booking-' + b.id]);
    const shop = shoppingProgress();
    const dontDone = TRIP.dontForget.filter(i => state.checks['forget-' + i.id]).length
      + (state.custom.forget || []).filter(i => state.checks['forget-custom-' + i.id]).length;
    const dontTotal = TRIP.dontForget.length + (state.custom.forget || []).length;

    let todayHtml = '';
    if (today) {
      const img = dayImage(today);
      todayHtml = `
        <div class="card today-card ${img ? 'has-img' : ''}">
          ${img ? `<div class="day-card-img" style="background-image:url('${esc(img)}')"></div>` : ''}
          <div class="day-card-body">
            <div class="card-title">📍 היום: ${esc(today.title)}</div>
            <p class="day-summary-text">${esc(today.weekday)} ${esc(today.date)} — ${esc(today.summary)}</p>
            <button class="maps-btn" data-goto="days">פתחי את היום המלא ←</button>
          </div>
        </div>`;
    }

    let alertHtml = '';
    if (critical.length) {
      alertHtml = `<div class="alert"><strong>⚠️ ${critical.length} הזמנות קריטיות!</strong>${critical.map(c => c.what).join(' • ')}</div>`;
    }

    return `
      <div class="tab-panel active">
        ${alertHtml}
        ${todayHtml}
        ${TRIP.meta.gallery ? `
        <div class="section-title">רגעים מהטיול</div>
        <div class="gallery-scroll">
          ${TRIP.meta.gallery.map(g => `
            <a class="gallery-item" href="${esc(g.url || '#')}" target="_blank" rel="noopener">
              <img src="${esc(g.image)}" alt="${esc(g.title)}" loading="lazy" />
              <span class="gallery-label">${esc(g.title)}</span>
            </a>`).join('')}
        </div>` : ''}
        <div class="section-title">עקרונות הטיול שלנו</div>
        <div class="card">
          <ul class="principles-list">${TRIP.meta.principles.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
          <div class="tip-box" style="margin-top:0.5rem">🎫 ${esc(TRIP.meta.card)} — ${esc(TRIP.meta.cardNote)}</div>
        </div>
        <div class="section-title">גישה מהירה</div>
        <div class="quick-grid">
          <button class="quick-btn" data-goto="shopping"><span class="qb-icon">🛒</span>קניות (${shop.total - shop.done})</button>
          <button class="quick-btn" data-goto="bookings"><span class="qb-icon">✅</span>הזמנות</button>
          <button class="quick-btn" data-goto-sub="forget"><span class="qb-icon">🧠</span>לא לשכוח</button>
          <button class="quick-btn" data-goto-sub="checklist"><span class="qb-icon">📋</span>צ'קליסט לחול</button>
          <button class="quick-btn" data-goto-sub="stay"><span class="qb-icon">🏡</span>לינה</button>
          <button class="quick-btn" data-goto-sub="kosher"><span class="qb-icon">✡️</span>כשרות</button>
        </div>
        <div id="sync-status-pill" class="sync-pill sync-offline">סנכרון</div>
        ${renderGroupCard()}
        <div class="section-title">שיתוף המדריך</div>
        <div class="card share-card">
          <div class="card-title">${esc(TRIP.meta.shareTitle || TRIP.meta.title)}</div>
          <p style="font-size:0.85rem;color:var(--text-muted);margin:0.4rem 0">שלחי את הקישור למי שצריך — עובד בטלפון ומחשב</p>
          <div class="share-url" id="share-url">${esc(TRIP.meta.shareUrl || window.location.href)}</div>
          <button class="maps-btn" id="copy-share-btn" type="button">📋 העתקת קישור</button>
          <button class="maps-btn" style="background:var(--green-light);margin-top:0.4rem" id="share-native-btn" type="button">↗️ שליחה</button>
        </div>
        <div class="section-title">סטטוס הכנות</div>
        <div class="card">
          ${progressBar(shop.done, shop.total, 'רשימת קניות')}
          ${progressBar(dontDone, dontTotal, 'לא לשכוח (וואטסאפ)')}
        </div>
        <div class="section-title">טיסות</div>
        <div class="card">
          <div class="card-title">✈️ הלוך — ${esc(TRIP.flights.outbound.date)}</div>
          <div class="confirm-row"><span class="confirm-label">המראה</span><span>${esc(TRIP.flights.outbound.depart)} מ${esc(TRIP.flights.outbound.from)}</span></div>
          <div class="confirm-row"><span class="confirm-label">נחיתה</span><span>${esc(TRIP.flights.outbound.arrive)} ב${esc(TRIP.flights.outbound.to)}</span></div>
          <div class="confirm-row"><span class="confirm-label">טיסה</span><span>${esc(TRIP.flights.outbound.flight)}</span></div>
          <div class="tip-box">${esc(TRIP.flights.outbound.note)}</div>
        </div>
        ${TRIP.flights.inbound.map(f => `
          <div class="card" style="margin-top:0.5rem">
            <div class="card-title">🛫 ${esc(f.label)}</div>
            <div class="confirm-row"><span class="confirm-label">תאריך</span><span>${esc(f.date)}</span></div>
            <div class="confirm-row"><span class="confirm-label">המראה</span><span>${esc(f.depart)} מ${esc(f.from)}</span></div>
            <div class="confirm-row"><span class="confirm-label">טיסה</span><span>${esc(f.flight)}</span></div>
            <div class="tip-box">${esc(f.note)}</div>
          </div>`).join('')}
        <div class="alert" style="margin-top:0.5rem"><strong>פיצול חזרה!</strong>${esc(TRIP.flights.note)}</div>
      </div>`;
  }

  function renderDays() {
    const coverage = TRIP.cardCoverage.map(c => `
      <div class="coverage-row coverage-card">
        <div>
          <strong>${esc(c.name)}</strong><br>
          <small style="color:var(--text-muted)">${esc(c.note)}</small>
          ${renderCoverageLinks(c)}
        </div>
        <span class="${c.status === 'כלול' || c.status === 'חינם' ? 'coverage-included' : 'coverage-extra'}">${esc(c.status)}</span>
      </div>`).join('');

    const daysHtml = TRIP.days.map(d => {
      const img = dayImage(d);
      const customActs = (state.custom.activities[d.id] || []);
      const allActivities = [
        ...d.activities.map(a => ({ ...a, custom: false })),
        ...customActs.map(a => ({ ...a, custom: true })),
      ];

      const activities = allActivities.map(a => `
        <div class="activity ${a.custom ? 'activity-custom' : ''}">
          <span class="activity-time">${esc(a.time || '—')}</span>
          <div class="activity-info">
            <div class="activity-name">${a.custom ? '<span class="custom-tag">שלי</span> ' : ''}${esc(a.name)}</div>
            ${a.notes ? `<div class="activity-notes">${esc(a.notes)}</div>` : ''}
            ${a.custom ? '' : renderLinks(a)}
          </div>
          <div class="activity-side">
            ${a.price ? `<span class="activity-price">${esc(a.price)}</span>` : ''}
            ${a.custom ? renderDeleteBtn('del-activity', a.id) : ''}
          </div>
        </div>`).join('');

      const dayNote = state.custom.dayNotes[d.id] || '';

      const checklist = d.dailyChecklist ? `
        <div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px dashed var(--border)">
          <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);margin-bottom:0.25rem">צ'קליסט יומי</div>
          ${d.dailyChecklist.map(item => `<span class="badge badge-ok" style="margin:0.15rem">${esc(item)}</span>`).join('')}
        </div>` : '';

      return `
        <div class="card day-card ${img ? 'has-day-img' : ''}" data-day-id="${d.id}">
          ${img ? `<div class="day-card-img" style="background-image:url('${esc(img)}')"><span class="day-img-badge">${d.emoji} ${esc(d.date)}</span></div>` : ''}
          <div class="day-header" data-toggle-day="${d.id}">
            ${img ? '' : `<span class="day-emoji">${d.emoji}</span>`}
            <div class="day-meta">
              <div class="day-date">${esc(d.weekday)} ${esc(d.date)}</div>
              <div class="day-title">${esc(d.title)}</div>
              <div class="day-summary">${esc(d.summary)}</div>
            </div>
            <span class="day-expand-icon">▼</span>
          </div>
          <div class="day-body">
            ${activities}
            ${renderAddBar({ type: 'activity', day: d.id, placeholder: 'הוסיפי פעילות...', withTime: true })}
            <div class="day-note-wrap">
              <label class="day-note-label">📝 הערות אישיות ליום</label>
              <textarea class="day-note-input" data-day-note="${esc(d.id)}" placeholder="רעיונות, שינויים, תזכורות...">${esc(dayNote)}</textarea>
            </div>
            ${checklist}
            <div class="day-footer">
              ${d.totalEstimate ? `<span class="badge badge-medium">💰 ${esc(d.totalEstimate)}</span>` : ''}
              ${d.weatherTip ? `<span class="badge badge-ok">🌤 ${esc(d.weatherTip)}</span>` : ''}
              ${d.swap ? `<span class="badge badge-critical">🔄 ${esc(d.swap)}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="tab-panel active">
        <div class="section-title">מה כלול בכרטיס</div>
        <div class="card">${coverage}</div>
        <div class="section-title">מסלול יום-יום</div>
        <div class="tip-box">💡 בכל יום אפשר להוסיף פעילויות והערות אישיות — נשמר בטלפון</div>
        ${daysHtml}
        <div class="tip-box">${esc(TRIP.friendPlanNote)}</div>
      </div>`;
  }

  function renderShoppingItem(catId, item, isCustom, customId) {
    const key = shoppingKey(catId, item);
    const isDone = state.shopping[key];
    return `
      <div class="check-item ${isDone ? 'done' : ''} ${isCustom ? 'item-custom' : ''}" data-shop="${esc(key)}">
        <div class="check-box">${isDone ? '✓' : ''}</div>
        <div class="check-content">
          <div class="check-title">${isCustom ? '<span class="custom-tag">+</span> ' : ''}${esc(item)}</div>
        </div>
        ${isCustom ? renderDeleteBtn('del-shop', customId) : ''}
      </div>`;
  }

  function renderShopping() {
    const { done, total } = shoppingProgress();
    const showPending = shoppingFilter === 'pending';

    const catsHtml = TRIP.shopping.map(cat => {
      const builtIn = cat.items.map(item => ({ item, custom: false }));
      const extra = customShoppingList(cat.id).map(c => ({ item: c.text, custom: true, customId: c.id }));
      const allItems = [...builtIn, ...extra].filter(({ item }) => {
        const key = shoppingKey(cat.id, item);
        return showPending ? !state.shopping[key] : true;
      });

      const totalInCat = cat.items.length + customShoppingList(cat.id).length;
      const catDone = [...cat.items, ...customShoppingList(cat.id).map(c => c.text)]
        .filter(item => state.shopping[shoppingKey(cat.id, item)]).length;

      const itemsHtml = allItems.map(({ item, custom, customId }) =>
        renderShoppingItem(cat.id, item, custom, customId)).join('');

      const emptyPending = showPending && !allItems.length;

      return `
        <div class="card">
          <div class="shopping-cat-title">
            <span>${esc(cat.name)}</span>
            <span class="cat-progress">${catDone}/${totalInCat}</span>
          </div>
          ${emptyPending ? '<p class="empty-cat-hint">הכל נקנה בקטגוריה זו ✓</p>' : itemsHtml}
          ${renderAddBar({ type: 'shop', cat: cat.id, placeholder: 'הוסיפי ל' + cat.name + '...', label: '➕ הוסיפי פריט' })}
        </div>`;
    }).join('');

    const customCatsHtml = (state.custom.shoppingCats || []).map(cat => {
      const items = (cat.items || []).filter(c => {
        const key = shoppingKey(cat.id, c.text);
        return showPending ? !state.shopping[key] : true;
      });
      const totalInCat = (cat.items || []).length;
      const catDone = (cat.items || []).filter(c => state.shopping[shoppingKey(cat.id, c.text)]).length;
      return `
        <div class="card">
          <div class="shopping-cat-title">
            <span>${esc(cat.name)} <span class="custom-tag">קטגוריה שלי</span></span>
            <span class="cat-progress">${catDone}/${totalInCat}</span>
            ${renderDeleteBtn('del-shop-cat', cat.id)}
          </div>
          ${items.map(c => renderShoppingItem(cat.id, c.text, true, c.id)).join('')}
          ${renderAddBar({ type: 'shop', cat: cat.id, placeholder: 'הוסיפי פריט...' })}
        </div>`;
    }).join('');

    return `
      <div class="tab-panel active">
        ${renderShoppingQuickAdd()}
        ${progressBar(done, total, 'סה"כ קניות')}
        <div class="filter-pills">
          <button class="filter-pill ${shoppingFilter === 'all' ? 'active' : ''}" data-shop-filter="all">הכל</button>
          <button class="filter-pill ${shoppingFilter === 'pending' ? 'active' : ''}" data-shop-filter="pending">נשאר לקנות (${total - done})</button>
        </div>
        <div class="tip-box">לחצי פריט לסמן ✓ שנקנת · למטה בכל קטגוריה או למעלה — להוסיף חדש</div>
        ${catsHtml}
        ${customCatsHtml}
        <div class="card add-cat-card">
          <div class="add-section-label">➕ קטגוריה חדשה לגמרי</div>
          ${renderAddBar({ type: 'shop-cat', placeholder: 'שם קטגוריה (למשל: חטיפים לדרך)' })}
        </div>
        ${!catsHtml && !customCatsHtml && showPending ? '<div class="card" style="text-align:center;color:var(--green)">🎉 הכל נקנה!</div>' : ''}
      </div>`;
  }

  function renderBookings() {
    const sorted = [...TRIP.bookings].sort((a, b) => {
      const order = { critical: 0, medium: 1, recommended: 2, optional: 3 };
      return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
    });

    const items = sorted.map(b => {
      const done = state.checks['booking-' + b.id];
      const badgeClass = b.priority === 'critical' ? 'badge-critical' : b.priority === 'optional' ? 'badge-ok' : 'badge-medium';
      const badgeLabel = { critical: 'קריטי!', medium: 'חשוב', recommended: 'מומלץ', optional: 'אופציונלי' }[b.priority] || '';

      return renderCheckItem(
        'booking-' + b.id,
        `${esc(b.what)} <span class="badge ${badgeClass}">${badgeLabel}</span>`,
        `<div class="check-meta">⏰ ${esc(b.when)}</div>
         <div class="check-meta">📋 ${esc(b.how)}</div>
         ${b.note ? `<div class="check-meta">💡 ${esc(b.note)}</div>` : ''}
         <div class="check-meta">💰 ${esc(b.cost)}</div>
         ${b.url ? `<a class="check-link" href="${esc(b.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${b.url.startsWith('tel:') ? '📞 התקשרי' : '🔗 פתח קישור'}</a>` : ''}`,
        done
      );
    }).join('');

    const customBookingItems = (state.custom.bookings || []).map(b => {
      const done = state.checks['booking-custom-' + b.id];
      return `
        <div class="check-item ${done ? 'done' : ''} item-custom" data-check="booking-custom-${esc(b.id)}">
          <div class="check-box">${done ? '✓' : ''}</div>
          <div class="check-content">
            <div class="check-title"><span class="custom-tag">שלי</span> ${esc(b.what)}</div>
            ${b.when ? `<div class="check-meta">⏰ ${esc(b.when)}</div>` : ''}
            ${b.note ? `<div class="check-meta">${esc(b.note)}</div>` : ''}
          </div>
          ${renderDeleteBtn('del-booking', b.id)}
        </div>`;
    }).join('');

    return `
      <div class="tab-panel active">
        <div class="alert"><strong>הזמנות לפני ובמהלך הטיול</strong>לחצי לסמן ✓ — נשמר בטלפון</div>
        <div class="card">${items}${customBookingItems}</div>
        ${renderAddBar({ type: 'booking', placeholder: 'הוסיפי תזכורת הזמנה...' })}
      </div>`;
  }

  function renderMore() {
    const menus = [
      { id: 'stay', label: '🏡 לינה' },
      { id: 'forget', label: '🧠 לא לשכוח' },
      { id: 'checklist', label: '📋 צ\'קליסט' },
      { id: 'kosher', label: '✡️ כשרות' },
      { id: 'car', label: '🚗 רכב' },
      { id: 'budget', label: '💰 תקציב' },
      { id: 'shabbat', label: '🕯️ שבת' },
      { id: 'emergency', label: '🆘 חירום' },
    ];

    return `
      <div class="tab-panel active">
        <div class="more-menu">
          ${menus.map(m => `<button class="more-tab-btn ${moreSubTab === m.id ? 'active' : ''}" data-more-tab="${m.id}">${m.label}</button>`).join('')}
        </div>
        <div class="sub-panel active" id="sub-panel">${renderSubPanel(moreSubTab)}</div>
      </div>`;
  }

  function renderSubPanel(id) {
    const panels = {
      stay: renderStay,
      forget: renderDontForget,
      checklist: renderPreTripChecklist,
      kosher: renderKosher,
      car: renderCar,
      budget: renderBudget,
      shabbat: renderShabbat,
      emergency: renderEmergency,
    };
    return (panels[id] || renderStay)();
  }

  function renderStay() {
    return TRIP.accommodations.map(a => {
      const contacts = (a.contact || []).map(c => `
        <div class="confirm-row">
          <span class="confirm-label">${esc(c.label)}</span>
          ${c.tel ? `<a href="tel:${c.value.replace(/\s/g, '')}" style="color:var(--green);font-weight:600;text-decoration:none">${esc(c.value)}</a>` :
            `<span>${esc(c.value)}</span>`}
        </div>`).join('');

      const links = [
        a.bookingUrl ? `<a class="maps-btn" href="${esc(a.bookingUrl)}" target="_blank" rel="noopener">📋 Booking.com</a>` : '',
        a.website ? `<a class="maps-btn" style="background:var(--green-light);margin-right:0.4rem" href="${esc(a.website)}" target="_blank" rel="noopener">🌐 אתר</a>` : '',
        a.maps ? `<a class="maps-btn" style="background:var(--text-muted)" href="${esc(a.maps)}" target="_blank" rel="noopener">🗺 ניווט</a>` : '',
      ].filter(Boolean).join(' ');

      return `
      <div class="card">
        <div class="stay-name">${esc(a.name)}</div>
        <div class="stay-address">📍 ${a.maps ? `<a href="${esc(a.maps)}" target="_blank" rel="noopener" class="stay-maps-link">${esc(a.address)}</a>` : esc(a.address)}</div>
        <div class="stay-dates">
          <span class="stay-date-pill">כניסה: ${esc(a.checkIn)}</span>
          <span class="stay-date-pill">יציאה: ${esc(a.checkOut)}</span>
          <span class="stay-date-pill">${a.nights} לילות</span>
        </div>
        <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.5rem">${esc(a.type)}</div>
        ${a.highlights ? `<ul class="info-list">${a.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${a.confirmations ? `
          <div class="section-title" style="margin-top:0.75rem">אישורים</div>
          ${a.confirmations.map(c => `<div class="confirm-row"><span class="confirm-label">${esc(c.label)}</span><span>${esc(c.value)}</span></div>`).join('')}
        ` : ''}
        ${contacts ? `<div class="section-title" style="margin-top:0.75rem">יצירת קשר</div>${contacts}` : ''}
        ${a.tips && a.tips.length ? `<div class="tip-box">${a.tips.map(t => esc(t)).join('<br>')}</div>` : ''}
        <div class="day-note-wrap" style="margin-top:0.75rem">
          <label class="day-note-label">📝 הערות אישיות (קוד כניסה, סכומים...)</label>
          <textarea class="day-note-input" data-stay-note="${esc(a.id)}" placeholder="מספר אישור, קוד WiFi, תזכורות...">${esc(state.custom.stayNotes[a.id] || '')}</textarea>
        </div>
        <div style="margin-top:0.6rem;display:flex;flex-wrap:wrap;gap:0.4rem">${links}</div>
      </div>`;
    }).join('');
  }

  function renderDontForget() {
    const cats = [...new Set(TRIP.dontForget.map(i => i.cat))];
    const allBuiltIn = TRIP.dontForget.length;
    const customItems = state.custom.forget || [];
    const doneBuiltIn = TRIP.dontForget.filter(i => state.checks['forget-' + i.id]).length;
    const doneCustom = customItems.filter(i => state.checks['forget-custom-' + i.id]).length;

    const html = cats.map(cat => {
      const items = TRIP.dontForget.filter(i => i.cat === cat);
      const customInCat = customItems.filter(i => i.cat === cat);
      return `
        <div class="card">
          <div class="shopping-cat-title"><span>${esc(cat)}</span></div>
          ${items.map(i => renderCheckItem('forget-' + i.id, esc(i.text), '', state.checks['forget-' + i.id])).join('')}
          ${customInCat.map(i => `
            <div class="check-item item-custom ${state.checks['forget-custom-' + i.id] ? 'done' : ''}" data-check="forget-custom-${esc(i.id)}">
              <div class="check-box">${state.checks['forget-custom-' + i.id] ? '✓' : ''}</div>
              <div class="check-content"><div class="check-title"><span class="custom-tag">+</span> ${esc(i.text)}</div></div>
              ${renderDeleteBtn('del-forget', i.id)}
            </div>`).join('')}
          ${renderAddBar({ type: 'forget', cat, placeholder: 'הוסיפי ל' + cat + '...' })}
        </div>`;
    }).join('');

    const personalCat = customItems.filter(i => i.cat === 'אישי');
    const personalHtml = personalCat.length || true ? `
      <div class="card">
        <div class="shopping-cat-title"><span>אישי</span></div>
        ${personalCat.map(i => `
          <div class="check-item item-custom ${state.checks['forget-custom-' + i.id] ? 'done' : ''}" data-check="forget-custom-${esc(i.id)}">
            <div class="check-box">${state.checks['forget-custom-' + i.id] ? '✓' : ''}</div>
            <div class="check-content"><div class="check-title">${esc(i.text)}</div></div>
            ${renderDeleteBtn('del-forget', i.id)}
          </div>`).join('')}
        ${renderAddBar({ type: 'forget', cat: 'אישי', placeholder: 'תזכורת אישית...' })}
      </div>` : '';

    return `${progressBar(doneBuiltIn + doneCustom, allBuiltIn + customItems.length, 'לא לשכוח')}
      <div class="tip-box">לחצי + להוסיף תזכורות משלך</div>${html}${personalHtml}`;
  }

  function renderPreTripChecklist() {
    return TRIP.preTripChecklist.map(cat => {
      const extra = (state.custom.pretrip[cat.id] || []);
      const allItems = [...cat.items, ...extra.map(e => e.text)];
      const done = cat.items.filter((_, i) => state.checks[`pretrip-${cat.id}-${i}`]).length
        + extra.filter(e => state.checks[`pretrip-custom-${e.id}`]).length;
      return `
        <div class="card">
          <div class="shopping-cat-title">
            <span>${esc(cat.name)}</span>
            <span class="cat-progress">${done}/${allItems.length}</span>
          </div>
          ${cat.items.map((item, i) => renderCheckItem(`pretrip-${cat.id}-${i}`, esc(item), '', state.checks[`pretrip-${cat.id}-${i}`])).join('')}
          ${extra.map(e => `
            <div class="check-item item-custom ${state.checks['pretrip-custom-' + e.id] ? 'done' : ''}" data-check="pretrip-custom-${esc(e.id)}">
              <div class="check-box">${state.checks['pretrip-custom-' + e.id] ? '✓' : ''}</div>
              <div class="check-content"><div class="check-title"><span class="custom-tag">+</span> ${esc(e.text)}</div></div>
              ${renderDeleteBtn('del-pretrip', e.id)}
            </div>`).join('')}
          ${renderAddBar({ type: 'pretrip', cat: cat.id, placeholder: 'הוסיפי ל' + cat.name + '...' })}
        </div>`;
    }).join('');
  }

  function renderKosher() {
    const k = TRIP.kosher;
    const appsHtml = k.apps.map(a => {
      let links = '';
      if (a.ios) links += `<a class="check-link" href="${esc(a.ios)}" target="_blank" rel="noopener">🍎 iOS</a> `;
      if (a.android) links += `<a class="check-link" href="${esc(a.android)}" target="_blank" rel="noopener">🤖 Android</a>`;
      return `<div class="app-card"><div class="app-name">${esc(a.name)}</div><div class="app-desc">${esc(a.desc)}</div>${links}</div>`;
    }).join('');

    return `
      <div class="card"><div class="card-title">אפליקציות</div>${appsHtml}</div>
      <div class="card">
        <div class="card-title">קניות בוינה (02.08)</div>
        ${k.vienna.map(v => {
          const maps = v.maps || (v.placeKey && PLACES[v.placeKey]?.maps);
          const mapLink = maps ? ` <a class="link-btn link-maps" href="${esc(maps)}" target="_blank" rel="noopener">📍 מפה</a>` : '';
          return `<div style="font-size:0.85rem;padding:0.3rem 0"><strong>${esc(v.name)}</strong> — ${esc(v.note)}${mapLink}</div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="card-title">טיפים</div>
        <ul class="info-list">${k.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        <p style="font-size:0.8rem;margin-top:0.5rem;color:var(--text-muted)">חותמות: ${k.symbols.join(', ')}</p>
      </div>`;
  }

  function renderCar() {
    const v = TRIP.car.vignette;
    const r = TRIP.car.rental;
    return `
      <div class="card">
        <div class="card-title">🚗 ${esc(r.company)}</div>
        <div class="confirm-row"><span class="confirm-label">איסוף</span><span>${esc(r.pickup)}</span></div>
        <div class="confirm-row"><span class="confirm-label">החזרה</span><span>${esc(r.return)}</span></div>
        <div class="tip-box">${esc(r.note)}</div>
        ${r.url ? `<a class="check-link" href="${esc(r.url)}" target="_blank" rel="noopener">אתר Europcar</a>` : ''}
        ${r.maps ? `<a class="link-btn link-maps" href="${esc(r.maps)}" target="_blank" rel="noopener" style="margin-right:0.5rem">📍 מפה — שדה תעופה</a>` : ''}
        <ul class="info-list" style="margin-top:0.5rem">${r.checklist.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>
      <div class="alert"><strong>${esc(v.title)}</strong>${esc(v.description)}</div>
      <div class="card">
        ${v.where.map(w => `<div style="padding:0.35rem 0;font-size:0.85rem"><strong>${esc(w.place)}</strong> — ${esc(w.how)}${w.url ? ` <a class="check-link" href="${esc(w.url)}" target="_blank" rel="noopener">פתח</a>` : ''}</div>`).join('')}
        ${v.types.map(t => `<div class="confirm-row"><span>${esc(t.name)}</span><span><strong>${esc(t.price)}</strong></span></div>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">פרטי הזמנה</div>
        ${TRIP.car.rentalDetails.map(d => `<div class="confirm-row"><span class="confirm-label">${esc(d.label)}</span><span>${esc(d.value)}</span></div>`).join('')}
      </div>`;
  }

  function renderBudget() {
    const customRows = (state.custom.budget || []).map(b => `
      <div class="budget-row item-custom">
        <span><span class="custom-tag">+</span> ${esc(b.name)}</span>
        <span style="color:var(--text-muted);font-size:0.8rem">${esc(b.estimate || '⬜')}</span>
        <span class="budget-paid">${esc(b.paid || '⬜')}</span>
        ${renderDeleteBtn('del-budget', b.id)}
      </div>`).join('');

    return `
      <div class="card">
        <div class="card-title">סיכום עלויות</div>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.5rem">שורות עם + נוספו על ידך</p>
        ${TRIP.budget.categories.map(c => `
          <div class="budget-row">
            <span>${esc(c.name)}</span>
            <span style="color:var(--text-muted);font-size:0.8rem">${esc(c.estimate)}</span>
            <span class="budget-paid">${esc(c.paid)}</span>
          </div>`).join('')}
        ${customRows}
        ${renderAddBar({ type: 'budget', placeholder: 'הוסיפי שורת הוצאה (למשל: ביטוח נסיעות)' })}
      </div>`;
  }

  function renderShabbat() {
    const s = TRIP.shabbat;
    return `
      <div class="card">
        <div class="card-title">🕯️ שבת ${esc(s.date)}</div>
        <p style="font-size:0.85rem">${esc(s.plan)}</p>
        <div class="tip-box"><strong>הכנה:</strong> ${esc(s.prep)}</div>
        <ul class="info-list" style="margin-top:0.5rem">${s.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      </div>`;
  }

  function renderEmergency() {
    return `
      <div class="card">
        ${TRIP.emergency.map(e => `
          <div class="emergency-item">
            <span style="font-size:0.85rem">${esc(e.label)}</span>
            ${e.tel ? `<a href="tel:${e.value.replace(/\s/g, '')}">${esc(e.value)}</a>` : `<strong>${esc(e.value)}</strong>`}
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">אפליקציות שימושיות</div>
        ${TRIP.apps.map(a => `<div class="app-card"><div class="app-name">${esc(a.name)}</div><div class="app-desc">${esc(a.desc)}</div></div>`).join('')}
      </div>`;
  }

  function bindCustomEvents() {
    document.querySelectorAll('.add-bar').forEach(bar => {
      const btn = bar.querySelector('.add-btn');
      const textInput = bar.querySelector('.add-input-text');
      const timeInput = bar.querySelector('.add-input-time');
      const type = bar.dataset.addType;
      const cat = bar.dataset.addCat;
      const day = bar.dataset.addDay;

      const submit = () => {
        const text = (textInput?.value || '').trim();
        if (!text) return;

        if (type === 'shop') {
          addShoppingItem(cat, text);
        } else if (type === 'shop-cat') {
          const id = uid();
          if (!state.custom.shoppingCats) state.custom.shoppingCats = [];
          state.custom.shoppingCats.push({ id, name: text, items: [] });
        } else if (type === 'activity') {
          if (!state.custom.activities[day]) state.custom.activities[day] = [];
          state.custom.activities[day].push({
            id: uid(),
            time: (timeInput?.value || '').trim() || '—',
            name: text,
            notes: '',
          });
        } else if (type === 'forget') {
          state.custom.forget.push({ id: uid(), cat: cat || 'אישי', text });
        } else if (type === 'pretrip') {
          if (!state.custom.pretrip[cat]) state.custom.pretrip[cat] = [];
          state.custom.pretrip[cat].push({ id: uid(), text });
        } else if (type === 'budget') {
          state.custom.budget.push({ id: uid(), name: text, estimate: '⬜', paid: '⬜' });
        } else if (type === 'booking') {
          state.custom.bookings.push({ id: uid(), what: text, when: '', note: '' });
        }

        saveState();
        renderMain();
        showToast('✓ נוסף');
      };

      btn?.addEventListener('click', e => { e.stopPropagation(); submit(); });
      textInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    });

    const quickBtn = document.getElementById('shop-quick-btn');
    const quickText = document.getElementById('shop-quick-text');
    const quickCat = document.getElementById('shop-quick-cat');
    if (quickBtn) {
      const submitQuick = () => {
        const text = (quickText?.value || '').trim();
        const catId = quickCat?.value;
        if (!text || !catId) return;
        addShoppingItem(catId, text);
        if (quickText) quickText.value = '';
        saveState();
        renderMain();
        showToast('✓ נוסף לרשימה');
      };
      quickBtn.addEventListener('click', e => { e.stopPropagation(); submitQuick(); });
      quickText?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitQuick(); }
      });
    }

    document.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.delActivity || btn.dataset.delShop || btn.dataset.delShopCat
          || btn.dataset.delForget || btn.dataset.delPretrip || btn.dataset.delBudget
          || btn.dataset.delBooking;

        if (btn.dataset.delActivity) {
          Object.keys(state.custom.activities).forEach(dayId => {
            state.custom.activities[dayId] = (state.custom.activities[dayId] || [])
              .filter(a => a.id !== id);
          });
        } else if (btn.dataset.delShop) {
          Object.keys(state.custom.shopping).forEach(catId => {
            state.custom.shopping[catId] = (state.custom.shopping[catId] || [])
              .filter(i => i.id !== id);
          });
          (state.custom.shoppingCats || []).forEach(c => {
            if (c.items) c.items = c.items.filter(i => i.id !== id);
          });
        } else if (btn.dataset.delShopCat) {
          state.custom.shoppingCats = (state.custom.shoppingCats || []).filter(c => c.id !== id);
        } else if (btn.dataset.delForget) {
          state.custom.forget = (state.custom.forget || []).filter(i => i.id !== id);
        } else if (btn.dataset.delPretrip) {
          Object.keys(state.custom.pretrip).forEach(catId => {
            state.custom.pretrip[catId] = (state.custom.pretrip[catId] || [])
              .filter(i => i.id !== id);
          });
        } else if (btn.dataset.delBudget) {
          state.custom.budget = (state.custom.budget || []).filter(i => i.id !== id);
        } else if (btn.dataset.delBooking) {
          state.custom.bookings = (state.custom.bookings || []).filter(i => i.id !== id);
        }

        saveState();
        renderMain();
        showToast('נמחק');
      });
    });

    document.querySelectorAll('.day-note-input').forEach(ta => {
      const save = () => {
        if (ta.dataset.dayNote) {
          state.custom.dayNotes[ta.dataset.dayNote] = ta.value;
        } else if (ta.dataset.stayNote) {
          state.custom.stayNotes[ta.dataset.stayNote] = ta.value;
        }
        saveState();
      };
      ta.addEventListener('input', save);
      ta.addEventListener('click', e => e.stopPropagation());
    });
  }

  function bindDynamicEvents() {
    document.querySelectorAll('[data-toggle-day]').forEach(el => {
      el.addEventListener('click', () => el.closest('.day-card').classList.toggle('open'));
    });

    document.querySelectorAll('[data-check]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.check;
        state.checks[key] = !state.checks[key];
        saveState();
        renderMain();
        showToast(state.checks[key] ? '✓ סומן' : 'בוטל');
      });
    });

    document.querySelectorAll('[data-shop]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.shop;
        state.shopping[key] = !state.shopping[key];
        saveState();
        renderMain();
        showToast(state.shopping[key] ? '✓ נקנה' : 'הוסר מהרשימה');
      });
    });

    document.querySelectorAll('[data-shop-filter]').forEach(el => {
      el.addEventListener('click', () => {
        shoppingFilter = el.dataset.shopFilter;
        renderMain();
      });
    });

    document.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => {
        currentTab = el.dataset.goto;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
        renderMain();
        if (currentTab === 'days') openTodayDay();
      });
    });

    document.querySelectorAll('[data-goto-sub]').forEach(el => {
      el.addEventListener('click', () => {
        moreSubTab = el.dataset.gotoSub;
        currentTab = 'more';
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'more'));
        renderMain();
      });
    });

    document.querySelectorAll('[data-more-tab]').forEach(el => {
      el.addEventListener('click', () => {
        moreSubTab = el.dataset.moreTab;
        document.getElementById('sub-panel').innerHTML = renderSubPanel(moreSubTab);
        document.querySelectorAll('.more-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.moreTab === moreSubTab));
        bindCustomEvents();
      });
    });

    bindCustomEvents();
    bindGroupEvents();

    const copyBtn = document.getElementById('copy-share-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const url = TRIP.meta.shareUrl || window.location.href;
        navigator.clipboard.writeText(url).then(() => showToast('✓ הקישור הועתק!')).catch(() => showToast(url));
      });
    }

    const shareBtn = document.getElementById('share-native-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const url = TRIP.meta.shareUrl || window.location.href;
        const title = TRIP.meta.shareTitle || TRIP.meta.title;
        if (navigator.share) {
          try { await navigator.share({ title, text: 'מדריך הטיול המשפחתי שלנו לאוסטריה', url }); } catch { /* cancelled */ }
        } else {
          navigator.clipboard.writeText(url).then(() => showToast('✓ הקישור הועתק!'));
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
