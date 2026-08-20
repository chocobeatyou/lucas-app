export default async (request, context) => {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol') || '';
  const exchange = url.searchParams.get('exchange') || '';
  const apikey = url.searchParams.get('apikey') || '';

  const tdUrl = new URL('https://api.twelvedata.com/price');
  tdUrl.searchParams.set('symbol', symbol);
  if (exchange) tdUrl.searchParams.set('exchange', exchange);
  tdUrl.searchParams.set('apikey', apikey);

  const resp = await fetch(tdUrl.toString());
  const data = await resp.json();

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
