(function () {
  'use strict';

  const STORAGE_KEY = 'austria-trip-2026-v2';
  let state = loadState();
  let currentTab = 'home';
  let moreSubTab = 'stay';
  let shoppingFilter = 'all';

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved || { checks: {}, shopping: {} };
    } catch {
      return { checks: {}, shopping: {} };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

  function shoppingKey(catId, item) {
    return `shop-${catId}-${item}`;
  }

  function allShoppingItems() {
    const items = [];
    TRIP.shopping.forEach(cat => {
      cat.items.forEach(item => items.push({ catId: cat.id, item }));
    });
    return items;
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
    renderMain();
    bindNav();
    updateBadges();
    openTodayDay();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
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
    return TRIP.bookings.filter(b => b.priority !== 'optional' && !state.checks['booking-' + b.id]).length;
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
    const dontDone = TRIP.dontForget.filter(i => state.checks['forget-' + i.id]).length;

    let todayHtml = '';
    if (today) {
      todayHtml = `
        <div class="card today-card">
          <div class="card-title">📍 היום: ${esc(today.title)}</div>
          <p style="font-size:0.85rem;color:var(--text-muted)">${esc(today.weekday)} ${esc(today.date)} — ${esc(today.summary)}</p>
          <button class="maps-btn" style="margin-top:0.6rem" data-goto="days">פתחי את היום המלא ←</button>
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
          ${progressBar(dontDone, TRIP.dontForget.length, 'לא לשכוח (וואטסאפ)')}
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
      <div class="coverage-row">
        <span>${esc(c.name)}<br><small style="color:var(--text-muted)">${esc(c.note)}</small></span>
        <span class="${c.status === 'כלול' ? 'coverage-included' : 'coverage-extra'}">${esc(c.status)}</span>
      </div>`).join('');

    const daysHtml = TRIP.days.map(d => {
      const activities = d.activities.map(a => `
        <div class="activity">
          <span class="activity-time">${esc(a.time)}</span>
          <div class="activity-info">
            <div class="activity-name">${esc(a.name)}</div>
            ${a.notes ? `<div class="activity-notes">${esc(a.notes)}</div>` : ''}
          </div>
          ${a.price ? `<span class="activity-price">${esc(a.price)}</span>` : ''}
        </div>`).join('');

      const checklist = d.dailyChecklist ? `
        <div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px dashed var(--border)">
          <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);margin-bottom:0.25rem">צ'קליסט יומי</div>
          ${d.dailyChecklist.map(item => `<span class="badge badge-ok" style="margin:0.15rem">${esc(item)}</span>`).join('')}
        </div>` : '';

      return `
        <div class="card day-card" data-day-id="${d.id}">
          <div class="day-header" data-toggle-day="${d.id}">
            <span class="day-emoji">${d.emoji}</span>
            <div class="day-meta">
              <div class="day-date">${esc(d.weekday)} ${esc(d.date)}</div>
              <div class="day-title">${esc(d.title)}</div>
              <div class="day-summary">${esc(d.summary)}</div>
            </div>
            <span class="day-expand-icon">▼</span>
          </div>
          <div class="day-body">
            ${activities}
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
        ${daysHtml}
        <div class="tip-box">${esc(TRIP.friendPlanNote)}</div>
      </div>`;
  }

  function renderShopping() {
    const { done, total } = shoppingProgress();
    const showPending = shoppingFilter === 'pending';

    const catsHtml = TRIP.shopping.map(cat => {
      const catItems = cat.items.filter(item => {
        const key = shoppingKey(cat.id, item);
        const isDone = state.shopping[key];
        return showPending ? !isDone : true;
      });
      if (!catItems.length) return '';

      const catDone = cat.items.filter(item => state.shopping[shoppingKey(cat.id, item)]).length;

      const itemsHtml = catItems.map(item => {
        const key = shoppingKey(cat.id, item);
        const isDone = state.shopping[key];
        return `
          <div class="check-item ${isDone ? 'done' : ''}" data-shop="${esc(key)}">
            <div class="check-box">${isDone ? '✓' : ''}</div>
            <div class="check-content"><div class="check-title">${esc(item)}</div></div>
          </div>`;
      }).join('');

      return `
        <div class="card">
          <div class="shopping-cat-title">
            <span>${esc(cat.name)}</span>
            <span class="cat-progress">${catDone}/${cat.items.length}</span>
          </div>
          ${itemsHtml}
        </div>`;
    }).join('');

    return `
      <div class="tab-panel active">
        ${progressBar(done, total, 'סה"כ קניות')}
        <div class="filter-pills">
          <button class="filter-pill ${shoppingFilter === 'all' ? 'active' : ''}" data-shop-filter="all">הכל</button>
          <button class="filter-pill ${shoppingFilter === 'pending' ? 'active' : ''}" data-shop-filter="pending">נשאר לקנות (${total - done})</button>
        </div>
        <div class="tip-box">לחצי על פריט לסמן שקנית. הסימון נשמר בטלפון.</div>
        ${catsHtml || '<div class="card" style="text-align:center;color:var(--green)">🎉 הכל נקנה!</div>'}
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

    return `
      <div class="tab-panel active">
        <div class="alert"><strong>הזמנות לפני ובמהלך הטיול</strong>לחצי לסמן ✓ — נשמר בטלפון</div>
        <div class="card">${items}</div>
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
        <div class="stay-address">📍 ${esc(a.address)}</div>
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
        <div style="margin-top:0.6rem;display:flex;flex-wrap:wrap;gap:0.4rem">${links}</div>
      </div>`;
    }).join('');
  }

  function renderDontForget() {
    const cats = [...new Set(TRIP.dontForget.map(i => i.cat))];
    const done = TRIP.dontForget.filter(i => state.checks['forget-' + i.id]).length;

    const html = cats.map(cat => {
      const items = TRIP.dontForget.filter(i => i.cat === cat);
      return `
        <div class="card">
          <div class="shopping-cat-title"><span>${esc(cat)}</span></div>
          ${items.map(i => renderCheckItem('forget-' + i.id, esc(i.text), '', state.checks['forget-' + i.id])).join('')}
        </div>`;
    }).join('');

    return `${progressBar(done, TRIP.dontForget.length, 'מוואטסאפ')}<div class="tip-box">רשימה מוואטסאפ + הערות משפחתיות</div>${html}`;
  }

  function renderPreTripChecklist() {
    return TRIP.preTripChecklist.map(cat => {
      const done = cat.items.filter((_, i) => state.checks[`pretrip-${cat.id}-${i}`]).length;
      return `
        <div class="card">
          <div class="shopping-cat-title">
            <span>${esc(cat.name)}</span>
            <span class="cat-progress">${done}/${cat.items.length}</span>
          </div>
          ${cat.items.map((item, i) => renderCheckItem(`pretrip-${cat.id}-${i}`, esc(item), '', state.checks[`pretrip-${cat.id}-${i}`])).join('')}
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
        ${k.vienna.map(v => `<div style="font-size:0.85rem;padding:0.3rem 0"><strong>${esc(v.name)}</strong> — ${esc(v.note)}</div>`).join('')}
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
    return `
      <div class="card">
        <div class="card-title">סיכום עלויות</div>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.5rem">עמודת "שולם" — לעדכן ב-data.js</p>
        ${TRIP.budget.categories.map(c => `
          <div class="budget-row">
            <span>${esc(c.name)}</span>
            <span style="color:var(--text-muted);font-size:0.8rem">${esc(c.estimate)}</span>
            <span class="budget-paid">${esc(c.paid)}</span>
          </div>`).join('')}
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
      });
    });

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
