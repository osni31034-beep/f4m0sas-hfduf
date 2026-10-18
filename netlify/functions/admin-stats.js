import { getStore } from '@netlify/blobs';

const AUTH_USER = process.env.ADMIN_USER || 'admin';
const AUTH_PASS = process.env.ADMIN_PASS || 'admin123';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function checkAuth(request) {
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const [user, pass] = atob(auth.split(' ')[1]).split(':');
  return user === AUTH_USER && pass === AUTH_PASS;
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (!checkAuth(request)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Admin"', ...CORS_HEADERS },
    });
  }

  try {
    const store = getStore({ name: 'tracking', siteID: process.env.SITE_ID });
    const { blobs } = await store.list();

    const events = [];
    for (const blob of blobs) {
      if (blob.key.startsWith('events/')) {
        const data = await store.get(blob.key, { type: 'json' });
        if (data) events.push({ key: blob.key, ...data });
      }
    }

    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const stats = {
      total: events.length,
      pageviews: events.filter(e => e.evento === 'pageview').length,
      clicks: events.filter(e => e.evento === 'click_botao').length,
      eventos: events,
    };

    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
};

export const config = { path: '/api/admin/stats' };
