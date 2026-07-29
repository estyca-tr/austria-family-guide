/* eslint-disable no-unused-vars */
window.TripSync = (function () {
  'use strict';

  const ROOM_KEY = 'austria-trip-room';
  const ROOM_COOKIE = 'austria-trip-room-code';
  const CONFIG_KEY = 'austria-supabase-config';
  const POLL_MS = 2000;
  let roomId = null;
  let onRemoteCallback = null;
  let pushTimer = null;
  let pollTimer = null;
  let lastAppliedTs = 0;

  function getSupabase() {
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
      return { url: window.SUPABASE_URL, key: window.SUPABASE_ANON_KEY };
    }
    return null;
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
    }
    return stored || null;
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

  async function supabaseFetch(room) {
    const sb = getSupabase();
    if (!sb) return null;
    const endpoint = sb.url + '/rest/v1/trip_states?room_id=eq.' + encodeURIComponent(room) + '&select=*';
    try {
      const res = await fetch(endpoint, {
        headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  async function supabasePush(room, state) {
    const sb = getSupabase();
    if (!sb) return;
    const ts = Date.now();
    const body = {
      room_id: room,
      checks: state.checks || {},
      shopping: state.shopping || {},
      custom: state.custom || {},
      updated_at: ts,
    };
    try {
      const res = await fetch(sb.url + '/rest/v1/trip_states', {
        method: 'POST',
        headers: {
          apikey: sb.key,
          Authorization: 'Bearer ' + sb.key,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return false;
      lastAppliedTs = ts;
      return true;
    } catch {
      return false;
    }
  }

  async function fetchOnce() {
    const room = getRoomId();
    if (!room) return null;
    if (hasCloud()) {
      const row = await supabaseFetch(room);
      if (!row) return null;
      return {
        checks: row.checks || {},
        shopping: row.shopping || {},
        custom: row.custom || {},
        _ts: row.updated_at || 0,
      };
    }
    return decodeStateHash();
  }

  function startPolling() {
    stopPolling();
    if (!getRoomId() || !hasCloud()) return;
    pollTimer = setInterval(async () => {
      const remote = await fetchOnce();
      if (!remote || !remote._ts) return;
      if (remote._ts <= lastAppliedTs) return;
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
  };
})();
