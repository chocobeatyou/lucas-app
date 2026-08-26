// Haalt een supermarkt-productpagina server-side op en probeert de actuele prijs
// te extraheren. Draait als gewone Netlify (AWS Lambda) function i.p.v. Edge Function
// (Deno Deploy) — AH.nl blokkeert het Deno Deploy IP-bereik met een HTTP 403,
// AWS-afkomstige requests hebben een andere kans.
// Geen officiële supermarkt-API — leunt op server-gerenderde HTML (JSON-LD,
// __NEXT_DATA__, meta-tags, of als laatste redmiddel een €-regex) en kan breken
// als een winkel hun website/bot-detectie aanpast.

exports.handler = async (event) => {
  const productUrl = (event.queryStringParameters && event.queryStringParameters.url) || '';
  const debug = (event.queryStringParameters && event.queryStringParameters.debug) === '1';
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!productUrl || !/^https?:\/\//i.test(productUrl)) {
    return { statusCode: 200, headers, body: JSON.stringify({ gevonden: false, error: 'ongeldige of ontbrekende url' }) };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const resp = await fetch(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'nl-NL,nl;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const html = await resp.text();

    if (!resp.ok) {
      const out = { gevonden: false, error: 'http ' + resp.status, lengte: html.length };
      if (debug) out.snippet = html.slice(0, 800);
      return { statusCode: 200, headers, body: JSON.stringify(out) };
    }

    const prijs = extractPrice(html);

    if (prijs) {
      return { statusCode: 200, headers, body: JSON.stringify({ gevonden: true, prijs }) };
    }
    const out = {
      gevonden: false,
      error: 'prijs niet gevonden op pagina',
      lengte: html.length,
      heeftJsonLd: /application\/ld\+json/i.test(html),
      heeftNextData: /__NEXT_DATA__/i.test(html),
      heeftEuroTeken: /€/.test(html),
      leekOpCaptchaOfBlokkade: /captcha|access denied|blocked|are you a robot|niet toegankelijk/i.test(html),
    };
    if (debug) out.snippet = html.slice(0, 1500);
    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ gevonden: false, error: e.message || 'fetch mislukt' }) };
  }
};

function extractPrice(html) {
  // 1) JSON-LD schema.org Product/Offer — meest betrouwbaar, veel webshops gebruiken dit voor SEO
  const ldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldMatches) {
    try {
      const json = JSON.parse(m[1].trim());
      const items = Array.isArray(json) ? json : (Array.isArray(json['@graph']) ? json['@graph'] : [json]);
      for (const item of items) {
        const p = findPriceInObject(item, 0, 3);
        if (p) return p;
      }
    } catch (e) { /* geen geldige JSON, volgende poging */ }
  }

  // 2) Open Graph / product meta-tags
  const metaMatch =
    html.match(/<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([\d.,]+)["']/i) ||
    html.match(/<meta[^>]+content=["']([\d.,]+)["'][^>]+property=["']product:price:amount["']/i);
  if (metaMatch) {
    const v = parseFloat(metaMatch[1].replace(',', '.'));
    if (v > 0 && v < 500) return v;
  }

  // 3) Next.js / vergelijkbare frameworks embedden vaak de volledige pagina-data als JSON
  const dataScriptMatch =
    html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i) ||
    html.match(/<script id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (dataScriptMatch) {
    try {
      const json = JSON.parse(dataScriptMatch[1]);
      const p = findPriceInObject(json, 0, 6);
      if (p) return p;
    } catch (e) { /* skip */ }
  }

  // 4) Laatste redmiddel: eerste plausibele €-bedrag in de ruwe HTML.
  const euroMatches = [...html.matchAll(/€\s*([0-9]{1,4})[.,]([0-9]{2})\b/g)];
  for (const m of euroMatches) {
    const v = parseFloat(m[1] + '.' + m[2]);
    if (v > 0 && v < 500) return v;
  }

  return null;
}

function findPriceInObject(obj, depth, maxDepth) {
  if (!obj || typeof obj !== 'object' || depth > maxDepth) return null;

  if (obj.offers) {
    const offers = Array.isArray(obj.offers) ? obj.offers : [obj.offers];
    for (const o of offers) {
      if (o && o.price != null) {
        const v = parseFloat(String(o.price).replace(',', '.'));
        if (v > 0 && v < 500) return v;
      }
    }
  }
  if (obj.price != null && (typeof obj.price === 'number' || typeof obj.price === 'string')) {
    const v = parseFloat(String(obj.price).replace(',', '.'));
    if (v > 0 && v < 500) return v;
  }
  for (const key of Object.keys(obj)) {
    if (/^price$|priceAmount|currentPrice|salePrice/i.test(key)) {
      const val = obj[key];
      if (val != null && (typeof val === 'number' || typeof val === 'string')) {
        const v = parseFloat(String(val).replace(',', '.'));
        if (v > 0 && v < 500) return v;
      }
    }
  }
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
      const found = findPriceInObject(obj[key], depth + 1, maxDepth);
      if (found) return found;
    }
  }
  return null;
}
