export default async (request, context) => {
  const url      = new URL(request.url);
  const symbol   = url.searchParams.get('symbol')   || '';
  const exchange = url.searchParams.get('exchange') || '';
  const finnhub  = url.searchParams.get('finnhub')  || '';

  let data;

  // Exchange codes → Yahoo Finance suffix
  const yahooSuffix = {
    'XAMS': '.AS',  // Euronext Amsterdam
    'XETR': '.DE',  // Xetra Frankfurt
    'XLON': '.L',   // London Stock Exchange
    'XPAR': '.PA',  // Euronext Paris
    'XMIL': '.MI',  // Borsa Italiana
    'XBRU': '.BR',  // Euronext Brussels
  };

  try {
    if (exchange) {
      // EU ETF via Yahoo Finance — geen key nodig, werkt server-side
      const suffix = yahooSuffix[exchange.toUpperCase()] || ('.' + exchange);
      const yahooTicker = symbol + suffix;
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`;

      const resp = await fetch(yahooUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 LucasApp/1.04' }
      });
      const json = await resp.json();
      const prijs = json?.chart?.result?.[0]?.meta?.regularMarketPrice;

      if (prijs > 0) {
        data = { price: String(prijs) };
      } else {
        data = { error: 'not found', ticker: yahooTicker, raw: JSON.stringify(json).substring(0, 200) };
      }

    } else if (finnhub) {
      // Finnhub voor US stocks
      const fUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhub}`;
      const resp = await fetch(fUrl);
      const json = await resp.json();
      data = json.c > 0 ? { price: String(json.c) } : { error: 'finnhub: not found', detail: json };

    } else {
      // Geen exchange, geen finnhub — probeer Yahoo Finance direct
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const resp = await fetch(yahooUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 LucasApp/1.04' }
      });
      const json = await resp.json();
      const prijs = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
      data = prijs > 0 ? { price: String(prijs) } : { error: 'not found' };
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
