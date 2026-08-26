// Haalt een supermarkt-productpagina server-side op en probeert de actuele prijs
// te extraheren. Werkt zonder browser/JS-uitvoering: leunt op server-gerenderde
// HTML (JSON-LD, __NEXT_DATA__, meta-tags, of als laatste redmiddel een €-regex).
// Geen officiële supermarkt-API — kan breken als een winkel hun website aanpast.

export default async (request, context) => {
  const url = new URL(request.url);
  const productUrl = url.searchParams.get('url') || '';
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!productUrl || !/^https?:\/\//i.test(productUrl)) {
    return new Response(JSON.stringify({ gevonden: false, error: 'ongeldige of ontbrekende url' }), { headers });
  }

  try {
    const resp = await fetch(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'nl-NL,nl;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ gevonden: false, error: 'http ' + resp.status }), { headers });
    }

    const html = await resp.text();
    const prijs = extractPrice(html);

    if (prijs) {
      return new Response(JSON.stringify({ gevonden: true, prijs }), { headers });
    }
    return new Response(JSON.stringify({ gevonden: false, error: 'prijs niet gevonden op pagina' }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ gevonden: false, error: e.message || 'fetch mislukt' }), { headers });
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
  //    Minst betrouwbaar (kan bijv. een verzendkosten- of vergelijkingsbedrag pakken),
  //    daarom pas als de bovenstaande, gerichtere pogingen niets opleverden.
  const euroMatches = [...html.matchAll(/€\s*([0-9]{1,4})[.,]([0-9]{2})\b/g)];
  for (const m of euroMatches) {
    const v = parseFloat(m[1] + '.' + m[2]);
    if (v > 0 && v < 500) return v;
  }

  return null;
}

// Doorzoekt een (geparsete) JSON-structuur recursief op een bruikbaar prijsveld.
// Geeft voorrang aan schema.org-achtige "offers.price", valt daarna terug op
// elk veld waarvan de naam "price" bevat.
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
