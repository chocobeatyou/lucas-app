export default async (request, context) => {
  const url      = new URL(request.url);
  const symbol   = url.searchParams.get('symbol')   || '';
  const exchange = url.searchParams.get('exchange') || '';
  const finnhub  = url.searchParams.get('finnhub')  || '';

  // Exchange codes → Yahoo Finance suffix
  const yahooSuffix = {
    'XAMS': '.AS', 'XETR': '.DE', 'XLON': '.L',
    'XPAR': '.PA', 'XMIL': '.MI', 'XBRU': '.BR',
  };

  let data;
  try {
    if (exchange) {
      // EU ETF via Yahoo Finance — geen key nodig
      const suffix = yahooSuffix[exchange.toUpperCase()] || ('.' + exchange);
      const yahooTicker = symbol + suffix;
      const resp = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=2d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const json = await resp.json();
      const result = json?.chart?.result?.[0];
      const prijs = result?.meta?.regularMarketPrice;
      const vorigeSluit = result?.meta?.chartPreviousClose;
      data = prijs > 0
        ? { price: String(prijs), prev: vorigeSluit ? String(vorigeSluit) : null, currency: result?.meta?.currency || 'EUR' }
        : { error: 'not found', ticker: yahooTicker };

    } else if (finnhub) {
      // Finnhub voor US stocks
      const resp = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhub}`
      );
      const json = await resp.json();
      data = json.c > 0
        ? { price: String(json.c), prev: String(json.pc), currency: 'USD' }
        : { error: 'finnhub: not found', detail: json };

    } else if (symbol === 'USDEUR' || symbol === 'USD/EUR') {
      // Wisselkoers USD→EUR via Yahoo Finance
      const resp = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/USDEUR=X?interval=1d&range=1d',
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const json = await resp.json();
      const rate = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
      data = rate > 0 ? { price: String(rate), currency: 'EUR' } : { error: 'fx not found' };

    } else {
      data = { error: 'no api key or exchange provided' };
    }
  } catch (e) {
    data = { error: e.message };
  }

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
};
