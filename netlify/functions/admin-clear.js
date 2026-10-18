import { getStore } from '@netlify/blobs';

const AUTH_USER = process.env.ADMIN_USER || 'admin';
const AUTH_PASS = process.env.ADMIN_PASS || 'admin123';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });

  if (!checkAuth(request)) {
    return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"', ...CORS_HEADERS } });
  }

  try {
    const store = getStore({ name: 'tracking', siteID: process.env.SITE_ID });
    const { blobs } = await store.list();
    for (const blob of blobs) {
      if (blob.key.startsWith('events/')) await store.delete(blob.key);
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  }
};

export const config = { path: '/api/admin/clear' };
