export default async (request, context) => {
  const url      = new URL(request.url);
  const symbol   = url.searchParams.get('symbol')   || '';
  const exchange = url.searchParams.get('exchange') || '';
  const apikey   = url.searchParams.get('apikey')   || '';
  const finnhub  = url.searchParams.get('finnhub')  || '';
  const debug    = url.searchParams.get('debug')    === '1';

  let data, raw;

  try {
    if (finnhub && !exchange) {
      const fUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhub}`;
      const resp = await fetch(fUrl);
      const json = await resp.json();
      data = json.c > 0 ? { price: String(json.c) } : { error: 'not found', detail: json };

    } else if (apikey) {
      const tdUrl = new URL('https://api.twelvedata.com/price');
      tdUrl.searchParams.set('symbol', symbol);
      if (exchange) tdUrl.searchParams.set('exchange', exchange);
      tdUrl.searchParams.set('apikey', apikey);

      const resp = await fetch(tdUrl.toString(), {
        headers: { 'User-Agent': 'LucasApp/1.04' }
      });
      raw = await resp.text();
      data = JSON.parse(raw);
      if (debug) data._debug = { url: tdUrl.toString(), status: resp.status, raw };

    } else {
      data = { error: 'no api key' };
    }
  } catch (e) {
    data = { error: e.message, raw };
  }

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
