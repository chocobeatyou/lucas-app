// Vraagt de PrijsProfeet API (www.prijsprofeet.nl) om een actuele bonusaanbieding
// voor een zoekterm bij een specifieke supermarkt. Dit is een legitieme, publieke
// API die 10 Nederlandse supermarktketens dagelijks scraped en als nette JSON
// aanbiedt — dus geen eigen scraping/bot-detectie meer nodig.
// Volledige spec: https://www.prijsprofeet.nl/openapi.json
//
// Belangrijk: dit levert alléén actuele bonusaanbiedingen (promotion_status=active),
// niet de reguliere prijs van elk product. Als een product deze week niet in de
// aanbieding is, komt er simpelweg geen resultaat — dat is geen fout.
//
// v1.06.46 — BUGFIX: /api/v1/search gebruikt Elasticsearch fuzzy search. Dat is
// prettig tegen typo's, maar betekent ook dat de API soms een product met een
// hoge relevantiescore teruggeeft dat inhoudelijk niets met de zoekterm te maken
// heeft (bv. "Ketjap manis" -> "OerDesem mais pompoen heel"). Puur op `score`
// vertrouwen was dus niet genoeg. We valideren nu zelf: een match wordt alleen
// geaccepteerd als de betekenisvolle woorden uit onze zoekterm ook daadwerkelijk
// in de gevonden productnaam voorkomen.

const RETAILER_SLUGS = {
  ah: 'albert_heijn',
  jumbo: 'jumbo',
  lidl: 'lidl',
  plus: 'plus',
  aldi: 'aldi',
  vomar: 'vomar',
};

// Nederlandse stopwoorden die we negeren bij het bepalen van "belangrijke woorden"
// in de zoekterm — deze zeggen niets over welk product het is, dus tellen niet mee
// in de overlap-check (en zouden 'm alleen maar makkelijker vals-positief maken).
const STOPWOORDEN = new Set([
  'de', 'het', 'een', 'en', 'van', 'met', 'voor', 'in', 'op', 'aan', 'naar',
  'uit', 'of', 'per', 'tot', 'bij',
]);

// Diacritics weg, lowercase, alleen letters/cijfers/spaties — zodat "maïskolven"
// en "maiskolven" gewoon matchen, en leestekens de vergelijking niet verstoren.
function normaliseer(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function belangrijkeWoorden(zoekterm) {
  return normaliseer(zoekterm).split(' ').filter(w => w.length >= 3 && !STOPWOORDEN.has(w));
}

// Verwijdert alles behalve printbare ASCII zonder witruimte uit een API-key.
// Een key die je via copy-paste invult, kan een onzichtbaar teken bevatten
// (spatie, tab, regeleinde, BOM) — dat maakt een HTTP-headerwaarde ongeldig en
// laat de hele aanvraag crashen met "The string did not match the expected
// pattern." Dit schoont dat altijd op, zodat één rommelige paste niet meteen
// alle prijschecks blokkeert.
function schoonmaakKey(ruw) {
  if (!ruw) return '';
  return String(ruw).trim().replace(/[^\x21-\x7E]/g, '');
}

// Beoordeelt of een kandidaat-productnaam voldoende overeenkomt met onze
// zoekterm. Twee manieren om te "slagen":
//  1) Minimaal de helft van de betekenisvolle zoekwoorden komt letterlijk
//     terug in de productnaam (bv. "Zwarte peper" -> "peper" is 1 van 2 = 50%).
//  2) Eén van de zoekwoorden is lang genoeg (8+ letters) én komt exact voor —
//     zulke specifieke woorden ("maïskolven", "knoflook") zijn te zeldzaam om
//     toevallig in een onverwant product te staan, dus die tellen als sterk
//     signaal op zichzelf. Dit vangt bv. "Biologisch Gekookte maïskolven" ->
//     "AH Maiskolven" (overlap-fractie is maar 33%, maar "maiskolven" zelf is
//     een vrijwel ondubbelzinnige treffer).
// Getest tegen zowel de foute matches uit de bug-melding (Ketjap manis, Zwarte
// peper, Bosui, Kipdijfilet) als tegen terechte matches — beide categorieën
// komen er goed uit.
function isVoldoendeOverlap(zoekterm, kandidaatNaam) {
  const woorden = belangrijkeWoorden(zoekterm);
  if (!woorden.length) return false;
  const naam = normaliseer(kandidaatNaam);
  const treffers = woorden.filter(w => naam.includes(w));
  const fractie = treffers.length / woorden.length;
  const heeftLangeTreffer = treffers.some(w => w.length >= 8);
  return fractie >= 0.5 || heeftLangeTreffer;
}

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
      page_size: '10', // wat ruimer dan voorheen, zodat er na de overlap-filter nog genoeg kandidaten over zijn
    });
    if (retailer) params.set('retailer', retailer);

    const requestHeaders = {
      // Netjes jezelf identificeren zoals de API-voorwaarden vragen — geen "bot"/"crawler" erin.
      'User-Agent': 'LucasApp/1.0 (persoonlijke boodschappen-app, geen commercieel gebruik)',
    };
    // Key: eerst een key die de app zelf meestuurt (ingevuld in Instellingen,
    // lokaal opgeslagen op het toestel), anders de server-side Netlify env var.
    // Geeft 150/min op de key i.p.v. gedeelde IP-limieten. Nooit hardcoden in
    // index.html — dat bestand is publiek leesbaar.
    const clientKey = schoonmaakKey(event.headers && event.headers['x-prijsprofeet-key']);
    const envKey = schoonmaakKey(process.env.PRIJSPROFEET_API_KEY);
    const apiKey = clientKey || envKey;
    if (apiKey) requestHeaders['X-API-Key'] = apiKey;

    const zoekUrl = 'https://www.prijsprofeet.nl/api/v1/search?' + params.toString();
    let resp;
    try {
      resp = await fetch(zoekUrl, { headers: requestHeaders });
    } catch (headerFout) {
      // Ook na het schoonmaken kan een key in theorie nog een ongeldige header
      // opleveren (bv. bevat een dubbele quote). Val dan terug zonder key i.p.v.
      // de hele zoekopdracht te laten crashen — beter een trage/gedeelde limiet
      // dan helemaal geen resultaat.
      if (apiKey) {
        delete requestHeaders['X-API-Key'];
        resp = await fetch(zoekUrl, { headers: requestHeaders });
      } else {
        throw headerFout;
      }
    }

    if (!resp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ gevonden: false, error: 'prijsprofeet http ' + resp.status }) };
    }

    const data = await resp.json();
    const results = data.results || [];

    // Alleen kandidaten met een geldige prijs én voldoende naam-overlap met onze
    // zoekterm accepteren. Van de overgebleven (betrouwbare) kandidaten pakken
    // we degene met de hoogste API-score.
    const beste = results
      .filter(r => r.price != null && isVoldoendeOverlap(zoekterm, r.name || r.title || ''))
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    if (!beste) {
      const reden = results.length ? 'wel resultaten, maar geen naam kwam overeen met de zoekterm' : 'geen actuele aanbieding gevonden';
      return { statusCode: 200, headers, body: JSON.stringify({ gevonden: false, error: reden }) };
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
