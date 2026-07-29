/* eslint-disable no-unused-vars */
window.TripSync = (function () {
  'use strict';

  const ROOM_KEY = 'austria-trip-room';
  const ROOM_COOKIE = 'austria-trip-room-code';
  const CONFIG_KEY = 'austria-supabase-config';
  const POLL_MS = 2000;
  const FALLBACK_SB = {
    url: 'https://oannwkfrypmgptywjhty.supabase.co',
    key: 'sb_publishable_ldcQP0CMKQsytMjv4IgQFQ_xLzS0rSl',
  };
  let roomId = null;
  let onRemoteCallback = null;
  let pushTimer = null;
  let pollTimer = null;
  let lastAppliedTs = 0;

  function getSupabase() {
    if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
      return {
        url: String(window.SUPABASE_URL).replace(/\/$/, ''),
        key: String(window.SUPABASE_ANON_KEY),
      };
    }
    return { url: FALLBACK_SB.url, key: FALLBACK_SB.key };
  }

  function saveSupabase(url, key) {
    const cfg = { url: url.replace(/\/$/, ''), key };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    return cfg;
  }

  function hasCloud() {
    const sb = getSupabase();
    return !!(sb && sb.url && sb.key);
  }

  function isConfigured() {
    return true;
  }

  function readRoomCookie() {
    const m = document.cookie.match(new RegExp('(?:^|; )' + ROOM_COOKIE + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function writeRoomCookie(code) {
    if (!code) return;
    document.cookie = ROOM_COOKIE + '=' + encodeURIComponent(code)
      + ';path=/;max-age=31536000;SameSite=Lax';
  }

  function clearRoomCookie() {
    document.cookie = ROOM_COOKIE + '=;path=/;max-age=0;SameSite=Lax';
  }

  function resolveRoomId() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('g');
    if (fromUrl) {
      const code = fromUrl.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length >= 6) {
        localStorage.setItem(ROOM_KEY, code);
        writeRoomCookie(code);
        return code;
      }
    }
    const stored = localStorage.getItem(ROOM_KEY) || readRoomCookie();
    if (stored) {
      localStorage.setItem(ROOM_KEY, stored);
      writeRoomCookie(stored);
      return stored;
    }
    return null;
  }

  function getRoomId() {
    return roomId || resolveRoomId();
  }

  function groupShareUrl(code, state) {
    const base = (window.TRIP && window.TRIP.meta && window.TRIP.meta.shareUrl)
      ? window.TRIP.meta.shareUrl.replace(/\?.*$/, '').replace(/#.*$/, '')
      : (location.origin + location.pathname);
    const url = new URL(base, location.origin);
    url.searchParams.set('g', code || getRoomId() || '');
    if (state && !hasCloud()) {
      url.hash = 's=' + encodeState(state);
    }
    return url.toString();
  }

  function encodeState(state) {
    const json = JSON.stringify({
      checks: state.checks || {},
      shopping: state.shopping || {},
      custom: state.custom || {},
      _ts: Date.now(),
    });
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeStateHash() {
    const hash = location.hash || '';
    const m = hash.match(/[#&]s=([^&]+)/);
    if (!m) return null;
    try {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch {
      return null;
    }
  }

  function updateUrl(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('g', code);
    else url.searchParams.delete('g');
    url.hash = '';
    history.replaceState({}, '', url.pathname + url.search);
  }

  function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const FETCH_TIMEOUT_MS = 20000;
  const PUSH_TIMEOUT_MS = 25000;

  function supabaseHeaders(key, extra) {
    return {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/json',
      ...(extra || {}),
    };
  }

  function compactMarks(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (v) out[k] = true;
    }
    return out;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const ms = timeoutMs || FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function supabaseFetch(room) {
    const sb = getSupabase();
    if (!sb) return { ok: false, row: null };
    const endpoint = sb.url + '/rest/v1/trip_states?room_id=eq.' + encodeURIComponent(room) + '&select=*';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(endpoint, {
          method: 'GET',
          cache: 'no-store',
          mode: 'cors',
          headers: supabaseHeaders(sb.key),
        });
        if (res.ok) {
          const rows = await res.json();
          return { ok: true, row: rows[0] || null };
        }
        if (attempt === 0 && res.status === 401) {
          localStorage.removeItem(CONFIG_KEY);
        }
      } catch { /* retry */ }
      if (attempt < 1) await sleep(800);
    }
    return { ok: false, row: null };
  }


  function mergeCustom(a, b) {
    const x = a || {};
    const y = b || {};
    return {
      ...x,
      ...y,
      shopping: { ...(x.shopping || {}), ...(y.shopping || {}) },
      dayNotes: { ...(x.dayNotes || {}), ...(y.dayNotes || {}) },
      stayNotes: { ...(x.stayNotes || {}), ...(y.stayNotes || {}) },
      activities: { ...(x.activities || {}), ...(y.activities || {}) },
      pretrip: { ...(x.pretrip || {}), ...(y.pretrip || {}) },
      forget: [...(x.forget || []), ...(y.forget || [])],
      bookings: [...(x.bookings || []), ...(y.bookings || [])],
      budget: [...(x.budget || []), ...(y.budget || [])],
      shoppingCats: [...(x.shoppingCats || []), ...(y.shoppingCats || [])],
    };
  }

  async function supabasePush(room, state) {
    const sb = getSupabase();
    if (!sb) return false;

    const existing = await supabaseFetch(room);
    const existingShopping = existing.ok && existing.row ? (existing.row.shopping || {}) : {};
    const existingChecks = existing.ok && existing.row ? (existing.row.checks || {}) : {};
    const localShopping = compactMarks(state.shopping);
    const localChecks = compactMarks(state.checks);
    const cloudMarkCount = Object.values(existingShopping).filter(Boolean).length
      + Object.values(existingChecks).filter(Boolean).length;
    const localMarkCount = Object.keys(localShopping).length + Object.keys(localChecks).length;

    if (localMarkCount === 0 && cloudMarkCount > 3) {
      return false;
    }

    const ts = Date.now();
    const body = {
      room_id: room,
      checks: localMarkCount >= Object.values(existingChecks).filter(Boolean).length
        ? localChecks
        : { ...compactMarks(existingChecks), ...localChecks },
      shopping: localMarkCount >= Object.values(existingShopping).filter(Boolean).length
        ? localShopping
        : { ...compactMarks(existingShopping), ...localShopping },
      custom: (existing.ok && existing.row && existing.row.custom && localMarkCount === 0)
        ? existing.row.custom
        : (state.custom || {}),
      updated_at: ts,
    };
    try {
      const res = await fetchWithTimeout(sb.url + '/rest/v1/trip_states', {
        method: 'POST',
        mode: 'cors',
        headers: supabaseHeaders(sb.key, {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        body: JSON.stringify(body),
      }, PUSH_TIMEOUT_MS);
      if (!res.ok) return false;
      lastAppliedTs = ts;
      return true;
    } catch {
      return false;
    }
  }

  async function fetchOnce() {
    const room = getRoomId();
    if (!room) return { error: 'no-room' };
    if (!hasCloud()) return { error: 'no-cloud' };
    const result = await supabaseFetch(room);
    if (!result.ok) return { error: 'network' };
    if (!result.row) {
      return { checks: {}, shopping: {}, custom: {}, _ts: 0 };
    }
    return {
      checks: result.row.checks || {},
      shopping: result.row.shopping || {},
      custom: result.row.custom || {},
      _ts: result.row.updated_at || 0,
    };
  }

  function startPolling() {
    stopPolling();
    if (!getRoomId() || !hasCloud()) return;
    pollTimer = setInterval(async () => {
      const remote = await fetchOnce();
      if (!remote || remote.error) return;
      if (remote._ts && remote._ts <= lastAppliedTs) return;
      lastAppliedTs = remote._ts;
      if (onRemoteCallback) {
        onRemoteCallback({
          checks: remote.checks || {},
          shopping: remote.shopping || {},
          custom: remote.custom || {},
          _ts: remote._ts,
        }, remote._ts);
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function init(onRemote) {
    onRemoteCallback = onRemote;
    roomId = resolveRoomId();
    if (roomId) updateUrl(roomId);

    const fromHash = decodeStateHash();
    if (fromHash && fromHash._ts) {
      lastAppliedTs = fromHash._ts;
      onRemote(fromHash, fromHash._ts);
    }

    if (roomId && hasCloud()) startPolling();
    return { ok: true, roomId, enabled: !!roomId, cloud: hasCloud() };
  }

  function createRoom() {
    roomId = generateRoomId();
    localStorage.setItem(ROOM_KEY, roomId);
    writeRoomCookie(roomId);
    updateUrl(roomId);
    if (hasCloud()) startPolling();
    return roomId;
  }

  function joinRoom(code) {
    code = (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 6) return null;
    roomId = code;
    localStorage.setItem(ROOM_KEY, code);
    writeRoomCookie(code);
    updateUrl(code);
    if (hasCloud()) startPolling();
    return roomId;
  }

  function leaveRoom() {
    stopPolling();
    roomId = null;
    localStorage.removeItem(ROOM_KEY);
    clearRoomCookie();
    updateUrl(null);
  }

  async function provisionRemoteRoom(initialState) {
    if (!hasCloud()) return null;
    const code = generateRoomId();
    const payload = initialState || { checks: {}, shopping: {}, custom: {} };
    const ok = await supabasePush(code, payload);
    return ok ? code : null;
  }

  function push(state) {
    if (!roomId) return Promise.resolve(false);
    clearTimeout(pushTimer);
    return new Promise(resolve => {
      pushTimer = setTimeout(async () => {
        if (hasCloud()) {
          resolve(await supabasePush(roomId, state));
        } else {
          resolve(true);
        }
      }, 350);
    });
  }

  function bumpLastApplied(ts) {
    lastAppliedTs = ts || Date.now();
  }

  function usesCloudSync() {
    return hasCloud();
  }

  return {
    init,
    createRoom,
    joinRoom,
    leaveRoom,
    provisionRemoteRoom,
    push,
    fetchOnce,
    getRoomId,
    resolveRoomId,
    groupShareUrl,
    isConfigured,
    hasCloud: usesCloudSync,
    getSupabase,
    saveSupabase,
    bumpLastApplied,
    encodeState,
    updateUrl,
  };
})();
