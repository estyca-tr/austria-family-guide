const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const room = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!room || room.length < 6 || room.length > 16) {
      return Response.json({ error: 'invalid room' }, { status: 400, headers: CORS });
    }

    const key = 'trip:' + room;

    if (request.method === 'GET') {
      const raw = await env.SYNC_KV.get(key);
      if (!raw) return Response.json({}, { headers: CORS });
      try {
        return Response.json(JSON.parse(raw), { headers: CORS });
      } catch {
        return Response.json({}, { headers: CORS });
      }
    }

    if (request.method === 'PUT') {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'bad json' }, { status: 400, headers: CORS });
      }
      if (!body || typeof body !== 'object') {
        return Response.json({ error: 'bad body' }, { status: 400, headers: CORS });
      }
      const payload = {
        checks: body.checks || {},
        shopping: body.shopping || {},
        custom: body.custom || {},
        _ts: body._ts || Date.now(),
      };
      await env.SYNC_KV.put(key, JSON.stringify(payload));
      return Response.json({ ok: true, _ts: payload._ts }, { headers: CORS });
    }

    return Response.json({ error: 'method not allowed' }, { status: 405, headers: CORS });
  },
};
