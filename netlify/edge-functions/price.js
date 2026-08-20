export default async (request, context) => {
  const url      = new URL(request.url);
  const symbol   = url.searchParams.get('symbol')   || '';
  const exchange = url.searchParams.get('exchange') || '';
  const apikey   = url.searchParams.get('apikey')   || '';
  const finnhub  = url.searchParams.get('finnhub')  || '';

  let data;

  try {
    if (finnhub && !exchange) {
      // Finnhub voor US stocks
      const fUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhub}`;
      const resp = await fetch(fUrl);
      const json = await resp.json();
      data = json.c > 0 ? { price: String(json.c) } : { error: 'not found', detail: json };

    } else if (apikey) {
      // Twelve Data voor EU ETFs — roept API aan van server-side
      // Geen Referer / Origin header meesturen zodat het niet geblokkeerd wordt
      const tdUrl = new URL('https://api.twelvedata.com/price');
      tdUrl.searchParams.set('symbol',   symbol);
      if (exchange) tdUrl.searchParams.set('exchange', exchange);
      tdUrl.searchParams.set('apikey', apikey);

      const resp = await fetch(tdUrl.toString(), {
        headers: {
          'User-Agent': 'LucasApp/1.04',
          // Geen Origin of Referer — zo ziet Twelve Data het als server call
        }
      });
      data = await resp.json();

    } else {
      data = { error: 'no api key provided' };
    }
  } catch (e) {
    data = { error: e.message };
  }

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
