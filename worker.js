// Couple Ledger sync Worker.
// Bindings needed: KV namespace "LEDGER", secret/variable "SECRET".
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'X-Key,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};
const TYPES = ['genesis', 'earn', 'spend', 'approve', 'reject'];
const ZERO = '0'.repeat(64);

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const hashOf = b => sha256(JSON.stringify([b.i, b.t, b.type, b.by, b.amount, b.note, b.ref, b.prev]));

function shapeOk(b) {
  return b && Number.isInteger(b.i) && Number.isFinite(b.t) && TYPES.includes(b.type) &&
    (b.by === 0 || b.by === 1) && typeof b.amount === 'number' && b.amount >= 0 && b.amount <= 1000 &&
    typeof b.note === 'string' && b.note.length <= 200 &&
    (b.ref === null || Number.isInteger(b.ref)) && typeof b.prev === 'string' && typeof b.hash === 'string';
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (new URL(req.url).pathname === '/') return new Response('couple-ledger worker ok', { headers: CORS });
    if (!env.SECRET || req.headers.get('X-Key') !== env.SECRET) return json({ error: 'unauthorized' }, 401);

    const path = new URL(req.url).pathname;
    const data = JSON.parse((await env.LEDGER.get('data')) || '{"blocks":[],"menu":null}');

    if (req.method === 'GET' && path === '/chain') return json(data);

    if (req.method === 'POST' && path === '/blocks') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const incoming = body.blocks;
      if (!Array.isArray(incoming) || !incoming.length || incoming.length > 500) return json({ error: 'bad blocks' }, 400);
      if (data.blocks.length + incoming.length > 5000) return json({ error: 'ledger full' }, 400);
      for (const b of incoming) {
        const prev = data.blocks.length ? data.blocks[data.blocks.length - 1].hash : ZERO;
        if (!shapeOk(b)) return json({ error: 'bad block' }, 400);
        if (b.i !== data.blocks.length || b.prev !== prev) return json({ error: 'conflict' }, 409);
        if (b.hash !== (await hashOf(b))) return json({ error: 'bad hash' }, 400);
        data.blocks.push(b);
      }
      await env.LEDGER.put('data', JSON.stringify(data));
      return json({ ok: true, length: data.blocks.length });
    }

    if (req.method === 'POST' && path === '/menu') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const m = body.menu;
      if (!Array.isArray(m) || m.length > 50 ||
          !m.every(x => x && typeof x.n === 'string' && x.n.length <= 60 && typeof x.c === 'number' && x.c > 0 && x.c <= 1000))
        return json({ error: 'bad menu' }, 400);
      data.menu = m;
      await env.LEDGER.put('data', JSON.stringify(data));
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  },
};
