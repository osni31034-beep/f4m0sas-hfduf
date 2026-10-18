import { getStore } from '@netlify/blobs';

const AUTH_USER = process.env.ADMIN_USER || 'admin';
const AUTH_PASS = process.env.ADMIN_PASS || 'admin123';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

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

function getQueryStats(events, query) {
  const lower = query.toLowerCase();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const yesterday = new Date(todayStart.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);

  let filtered = events;
  if (lower.includes('hoje') || lower.includes('hoje')) {
    filtered = events.filter(e => new Date(e.timestamp) >= todayStart);
  } else if (lower.includes('ontem')) {
    filtered = events.filter(e => new Date(e.timestamp) >= yesterday && new Date(e.timestamp) < todayStart);
  } else if (lower.includes('semana') || lower.includes('7 dias')) {
    filtered = events.filter(e => new Date(e.timestamp) >= weekAgo);
  } else if (lower.includes('mes') || lower.includes('30 dias') || lower.includes('mês')) {
    filtered = events.filter(e => new Date(e.timestamp) >= monthAgo);
  }

  const sessions = [...new Set(filtered.map(e => e.sessionId).filter(Boolean))];
  const pageviews = filtered.filter(e => e.evento === 'pageview').length;
  const clicks = filtered.filter(e => e.evento === 'click_botao').length;

  return {
    periodo: lower.includes('hoje') ? 'hoje' : lower.includes('ontem') ? 'ontem' : lower.includes('semana') ? 'últimos 7 dias' : lower.includes('mes') || lower.includes('mês') ? 'últimos 30 dias' : 'total',
    totalVisitas: sessions.length,
    pageviews,
    cliques: clicks,
    taxaConversao: pageviews > 0 ? ((clicks / pageviews) * 100).toFixed(1) + '%' : '0%',
    totalEventos: filtered.length
  };
}

function simpleQueryResponse(query, stats) {
  const lower = query.toLowerCase();
  let response = '';

  if (lower.includes('relatório') || lower.includes('relatorio') || lower.includes('resumo') || lower.includes('hoje')) {
    response = `📊 **Relatório (${stats.periodo})**\n\n`;
    response += `• Visitas únicas: ${stats.totalVisitas}\n`;
    response += `• Pageviews: ${stats.pageviews}\n`;
    response += `• Cliques no botão: ${stats.cliques}\n`;
    response += `• Taxa de conversão: ${stats.taxaConversao}\n`;
    response += `• Total de eventos: ${stats.totalEventos}`;
  } else if (lower.includes('visita') || lower.includes('acesso')) {
    response = `📈 **Visitas (${stats.periodo})**\n\n`;
    response += `Total de visitantes únicos: ${stats.totalVisitas}\n`;
    response += `(Cada pessoa conta uma vez, mesmo se clicou no botão)`;
  } else if (lower.includes('clique') || lower.includes('botão') || lower.includes('botao')) {
    response = `🖱️ **Cliques (${stats.periodo})**\n\n`;
    response += `Total de cliques no botão: ${stats.cliques}\n`;
    response += `Taxa de conversão: ${stats.taxaConversao}`;
  } else if (lower.includes('conversão') || lower.includes('conversao')) {
    response = `🎯 **Taxa de Conversão (${stats.periodo})**\n\n`;
    response = `Taxa de conversão: ${stats.taxaConversao}\n`;
    response += `Pageviews: ${stats.pageviews}\n`;
    response += `Cliques: ${stats.cliques}`;
  } else {
    response = `📊 **Estatísticas (${stats.periodo})**\n\n`;
    response += `• Visitas únicas: ${stats.totalVisitas}\n`;
    response += `• Pageviews: ${stats.pageviews}\n`;
    response += `• Cliques: ${stats.cliques}\n`;
    response += `• Taxa de conversão: ${stats.taxaConversao}`;
  }

  return response;
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (!checkAuth(request)) {
    return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"', ...CORS_HEADERS } });
  }
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });

  try {
    const body = await request.json();
    const query = body.query || '';

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

    const stats = getQueryStats(events, query);
    let response;

    if (OPENAI_API_KEY && events.length > 0) {
      const prompt = `Você é um assistente de IA que analisa dados de tracking de um site. 
      
      Dados atualizados em tempo real:
      - Total de eventos: ${events.length}
      - Eventos de hoje: ${stats.totalEventos}
      - Visitas únicas: ${stats.totalVisitas}
      - Pageviews: ${stats.pageviews}
      - Cliques: ${stats.cliques}
      - Taxa de conversão: ${stats.taxaConversao}
      
      Período selecionado: ${stats.periodo}
      
      Últimos eventos (timestamp | evento | ip):
      ${events.slice(0, 10).map(e => `${e.timestamp} | ${e.evento} | ${e.ip || 'N/A'}`).join('\n')}
      
      Regra de contagem: uma pessoa que entra no site gera 1 pageview, e se clicar gera 1 click_botao. Conte uma pessoa como UM visitante único, baseado no sessionId.
      
      Pergunta do usuário: "${query}"
      
      Responda de forma clara e concisa em português, usando os dados reais.`;
      
      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          temperature: 0.3,
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        response = aiData.choices[0].message.content;
      } else {
        response = simpleQueryResponse(query, stats);
      }
    } else {
      response = simpleQueryResponse(query, stats);
    }

    return new Response(JSON.stringify({ ok: true, resposta: response, stats }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, resposta: 'Erro ao processar sua pergunta. Tente novamente.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
};

export const config = { path: '/api/admin/chat' };
