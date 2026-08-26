// Vraagt de PrijsProfeet API (www.prijsprofeet.nl) om een actuele bonusaanbieding
// voor een zoekterm bij een specifieke supermarkt. Dit is een legitieme, publieke
// API die 10 Nederlandse supermarktketens dagelijks scraped en als nette JSON
// aanbiedt — dus geen eigen scraping/bot-detectie meer nodig.
//
// Belangrijk: dit levert alléén actuele bonusaanbiedingen (promotion_status=active),
// niet de reguliere prijs van elk product. Als een product deze week niet in de
// aanbieding is, komt er simpelweg geen resultaat — dat is geen fout.

const RETAILER_SLUGS = {
  ah: 'albert_heijn',
  jumbo: 'jumbo',
  lidl: 'lidl',
  plus: 'plus',
  aldi: 'aldi',
  vomar: 'vomar',
};

exports.handler = async (event) => {
  const zoekterm = (event.queryStringParameters && event.queryStringParameters.q) || '';
  const winkelId = (event.queryStringParameters && event.queryStringParameters.winkel) || '';
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!zoekterm) {
    return { statusCode: 200, headers, body: JSON.stringify({ gevonden: false, error: 'geen zoekterm opgegeven' }) };
  }

  const retailer = RETAILER_SLUGS[winkelId] || '';

  try {
    const params = new URLSearchParams({
      q: zoekterm,
      promotion_status: 'active',
      page_size: '5',
    });
    if (retailer) params.set('retailer', retailer);

    const resp = await fetch('https://www.prijsprofeet.nl/api/v1/search?' + params.toString(), {
      headers: {
        // Netjes jezelf identificeren zoals de API-voorwaarden vragen — geen "bot"/"crawler" erin.
        'User-Agent': 'LucasApp/1.0 (persoonlijke boodschappen-app, geen commercieel gebruik)',
      },
    });

    if (!resp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ gevonden: false, error: 'prijsprofeet http ' + resp.status }) };
    }

    const data = await resp.json();
    const results = data.results || [];

    // Beste match: hoogste relevantiescore, met een geldige prijs.
    const beste = results
      .filter(r => r.price != null)
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    if (!beste) {
      return { statusCode: 200, headers, body: JSON.stringify({ gevonden: false, error: 'geen actuele aanbieding gevonden' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        gevonden: true,
        prijs: beste.price,
        naam: beste.name || beste.title || null,
        origineel: beste.original_price || null,
        geldigTot: beste.valid_until || null,
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ gevonden: false, error: e.message || 'fetch mislukt' }) };
  }
};
