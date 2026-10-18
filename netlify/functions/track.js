import { getStore } from '@netlify/blobs';

const EXCLUDE_IPS = (process.env.EXCLUDE_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean);

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const body = await request.json();
    const store = getStore({ name: 'tracking', siteID: process.env.SITE_ID });

    const now = Date.now();

    let ip = request.headers.get('x-nf-client-ip') || 
             request.headers.get('x-forwarded-for') || 
             request.headers.get('x-real-ip') || 
             '';
    ip = ip.split(',')[0].trim();

    if (EXCLUDE_IPS.includes(ip)) {
      return new Response(JSON.stringify({ ok: true, excluded: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const dedupKey = `dedup/${body.sessionId}_${body.evento}`;
    const lastEvent = await store.get(dedupKey, { type: 'json' });
    if (lastEvent && (now - lastEvent.timestamp) < 60000) {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    await store.setJSON(dedupKey, { timestamp: now });

    const key = `events/${now}-${Math.random().toString(36).slice(2, 9)}`;
    const data = {
      timestamp: new Date().toISOString(),
      evento: body.evento || 'pageview',
      sessionId: body.sessionId || '',
      userAgent: body.userAgent || request.headers.get('user-agent') || '',
      referrer: body.referrer || '',
      pagina: body.pagina || '',
      ip: ip,
    };

    await store.setJSON(key, data);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*' },
    });
  }
};

export const config = { path: '/api/track' };