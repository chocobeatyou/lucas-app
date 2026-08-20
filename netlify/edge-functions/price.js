export default async (request, context) => {
  const url = new URL(request.url);
  const symbol   = url.searchParams.get('symbol') || '';
  const exchange = url.searchParams.get('exchange') || '';
  const apikey   = url.searchParams.get('apikey') || '';
  const finnhub  = url.searchParams.get('finnhub') || '';

  let data;

  if (finnhub && !exchange) {
    // Finnhub voor US stocks — werkt altijd met gratis key
    const fUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhub}`;
    const resp = await fetch(fUrl);
    const json = await resp.json();
    // Finnhub geeft {c: currentPrice, ...} terug
    data = json.c ? { price: json.c.toString() } : { error: 'not found', raw: json };
  } else {
    // Twelve Data voor EU ETFs — Secret key werkt hier want call komt van server
    const tdUrl = new URL('https://api.twelvedata.com/price');
    tdUrl.searchParams.set('symbol', symbol);
    if (exchange) tdUrl.searchParams.set('exchange', exchange);
    tdUrl.searchParams.set('apikey', apikey);
    const resp = await fetch(tdUrl.toString());
    data = await resp.json();
  }

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
