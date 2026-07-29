/* eslint-disable no-unused-vars */
window.TripSync = (function () {
  'use strict';

  const ROOM_KEY = 'austria-trip-room';
  const CONFIG_KEY = 'austria-trip-firebase-config';
  let db = null;
  let roomId = null;
  let onRemoteCallback = null;
  let pushTimer = null;
  let lastAppliedTs = 0;
  let subscribed = false;

  function getFirebaseConfig() {
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return window.FIREBASE_CONFIG || null;
  }

  function saveFirebaseConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    window.FIREBASE_CONFIG = config;
  }

  function isConfigured() {
    const cfg = getFirebaseConfig();
    return !!(cfg && cfg.apiKey && cfg.databaseURL);
  }

  function resolveRoomId() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('g');
    if (fromUrl) {
      const code = fromUrl.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (code.length >= 6) {
        localStorage.setItem(ROOM_KEY, code);
        return code;
      }
    }
    return localStorage.getItem(ROOM_KEY) || null;
  }

  function getRoomId() {
    return roomId || resolveRoomId();
  }

  function groupShareUrl(code) {
    const base = (window.TRIP && window.TRIP.meta && window.TRIP.meta.shareUrl)
      ? window.TRIP.meta.shareUrl.replace(/\?.*$/, '')
      : (location.origin + location.pathname);
    const url = new URL(base, location.origin);
    url.searchParams.set('g', code || getRoomId() || '');
    return url.toString();
  }

  function updateUrl(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('g', code);
    else url.searchParams.delete('g');
    history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
  }

  function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  function ensureDb() {
    if (db) return true;
    const cfg = getFirebaseConfig();
    if (!cfg || typeof firebase === 'undefined') return false;
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    db = firebase.database();
    return true;
  }

  function subscribe() {
    if (!ensureDb() || !roomId || subscribed) return;
    const ref = db.ref('trips/' + roomId + '/state');
    ref.off();
    ref.on('value', snap => {
      const val = snap.val();
      if (!val || typeof val !== 'object') return;
      const ts = val._ts || 0;
      if (ts <= lastAppliedTs) return;
      lastAppliedTs = ts;
      const payload = { checks: val.checks || {}, shopping: val.shopping || {}, custom: val.custom || {} };
      if (onRemoteCallback) onRemoteCallback(payload, ts);
    });
    subscribed = true;
  }

  function init(onRemote) {
    onRemoteCallback = onRemote;
    roomId = resolveRoomId();
    if (!isConfigured()) return { ok: false, reason: 'no-config', roomId };
    if (!ensureDb()) return { ok: false, reason: 'no-sdk', roomId };
    if (roomId) subscribe();
    return { ok: true, roomId, enabled: !!roomId };
  }

  function createRoom() {
    if (!ensureDb()) return null;
    roomId = generateRoomId();
    localStorage.setItem(ROOM_KEY, roomId);
    updateUrl(roomId);
    subscribed = false;
    subscribe();
    return roomId;
  }

  function joinRoom(code) {
    if (!ensureDb()) return null;
    code = (code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (code.length < 6) return null;
    roomId = code;
    localStorage.setItem(ROOM_KEY, roomId);
    updateUrl(roomId);
    subscribed = false;
    subscribe();
    return roomId;
  }

  function leaveRoom() {
    if (db && roomId) db.ref('trips/' + roomId + '/state').off();
    roomId = null;
    subscribed = false;
    localStorage.removeItem(ROOM_KEY);
    updateUrl(null);
  }

  function push(state) {
    if (!ensureDb() || !roomId) return Promise.resolve();
    clearTimeout(pushTimer);
    return new Promise(resolve => {
      pushTimer = setTimeout(() => {
        const ts = Date.now();
        lastAppliedTs = ts;
        db.ref('trips/' + roomId + '/state').set({
          checks: state.checks || {},
          shopping: state.shopping || {},
          custom: state.custom || {},
          _ts: ts,
        }).then(resolve).catch(resolve);
      }, 350);
    });
  }

  function fetchOnce() {
    if (!ensureDb() || !roomId) return Promise.resolve(null);
    return db.ref('trips/' + roomId + '/state').once('value').then(s => s.val());
  }

  function bumpLastApplied(ts) {
    lastAppliedTs = ts || Date.now();
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
    getFirebaseConfig,
    saveFirebaseConfig,
    bumpLastApplied,
  };
})();
