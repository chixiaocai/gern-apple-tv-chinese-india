// Region lookups by content ID, following chanollog-gogogo/apple-tv-chinese.
// https://github.com/chanollog-gogogo/apple-tv-chinese
const origin = 'https://uts-api.itunes.apple.com';
const route = /^https:\/\/uts-api\.itunes\.apple\.com(\/uts\/v[123]\/(canvases|shelves|brands|channels|browse|movies|shows|episodes|seasons)(?:\/[a-z0-9._~:%/-]+)?)(?:\?([^#]*))?$/i;
const personal = /(?:up[-_ ]?next|continue[-_ ]?watching|personalized|for[-_ ]?you|watchlist|watch[-_ ]?history|shared[-_ ]?with[-_ ]?you|(?:^|\/)user(?:\/|$)|player[-_ ]?tabs|post[-_ ]?play|play[-_ ]?next)/i;
const skip = new Set([
  'assets', 'offers', 'personalizedOffers', 'upsellOffers', 'itunesMediaApiData',
  'user', 'userProps', 'contentPersonalizedInfo', 'episodesContentPersonalizedInfo',
  'entitlements', 'license', 'licenses', 'playback', 'purchase', 'purchases',
  'playables', 'smartPlayables', 'smartEpisodePlayables', 'howToWatch',
  'contentAvailability', 'images', 'header', 'canonicalMetadata',
]);
const fields = [
  'title', 'shortTitle', 'showTitle', 'movieTitle', 'episodeTitle', 'subtitle',
  'description', 'heroDescription', 'summary', 'seoTitle', 'seoDescription', 'genre', 'localizedType',
];
const summaries = new Set(['description', 'heroDescription', 'summary', 'seoDescription']);
const logosAndCovers = /^(?:contentImage(?:16x9|Tall)?|contentLogo|poster(?:16x9|Art)?|cover|tile(?:16x9)?|shelfImage|showLogo|logo)$/i;
const appleImage = /^https:\/\/is\d+(?:-ssl)?\.mzstatic\.com\/image\//i;
const han = /[\u3400-\u9fff]/;
const responseLimit = 2 * 1024 * 1024;
const sources = [
  ['TW', '143470', 'zh-Hant'],
  ['SG', '143464', 'zh-Hans'],
  ['HK', '143463', 'zh-Hant'],
];

function contentId(item) {
  return [item.id, item.canonicalId, item.contentId]
    .find(id => typeof id === 'string' && /^umc\.cmc\.[a-z0-9]+$/i.test(id));
}

function* displayItems(root) {
  const stack = [root];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item.id === 'string' && personal.test(item.id)) continue;
    if (contentId(item)) yield item;
    const entries = Object.entries(item);
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, value] = entries[index];
      if (value && typeof value === 'object' && !skip.has(key) && !personal.test(key)) stack.push(value);
    }
  }
}

const displayLists = {
  genres: ['id', 'name'],
  countriesOfOrigin: ['countryCode', 'displayName'],
  originalSpokenLanguages: ['locale', 'displayName'],
  audioTrackLocales: ['locale', 'displayName'],
  adLocales: ['locale', 'displayName'],
  closedCaptionedLocales: ['locale', 'displayName'],
  locales: ['locale', 'displayName'],
  sdhLocales: ['locale', 'displayName'],
  subtitledLocales: ['locale', 'displayName'],
};
const advisoryLabels = new Map([
  ['Violence', '暴力'], ['Language', '粗俗语言'], ['Strong Language', '粗俗语言'],
  ['Sexual Content', '性内容'], ['Nudity', '裸露'],
  ['Drugs or Drug Use', '毒品或用药场面'], ['Drug Use', '毒品使用'],
]);

function* displayLabels(item) {
  for (const [list, [identity, label]] of Object.entries(displayLists)) {
    if (!Array.isArray(item[list])) continue;
    for (const entry of item[list]) {
      if (typeof entry?.[identity] === 'string' && typeof entry[label] === 'string') {
        yield [list + '/' + entry[identity], entry, label];
      }
    }
  }
}

function* detailItems(data) {
  for (const object of Object.values(data.playables || {})) {
    if (object && typeof object === 'object' && contentId(object)) yield object;
  }
}

function artwork(image) {
  if (!appleImage.test(image?.url) ||
      !Number.isFinite(image.width) || image.width <= 0 ||
      !Number.isFinite(image.height) || image.height <= 0) return;
  const { url, width, height, isP3, joeColor } = image;
  return { url, width, height, isP3, joeColor };
}

function indexRegion(data, wanted) {
  const found = new Map();
  for (const item of [...displayItems(data), ...detailItems(data)]) {
    const id = contentId(item);
    if (!wanted.has(id)) continue;
    const record = found.get(id) || { fields: new Map(), images: new Map() };
    for (const [key, entry, label] of displayLabels(item)) {
      if (han.test(entry[label])) record.fields.set(key, entry[label]);
    }
    const displays = [[item.canonicalId ? 'playable' : '', item], ['header', item.header], ['canonicalMetadata', item.canonicalMetadata]];
    for (const [section, object] of displays) {
      for (const key of fields) {
        const value = object?.[key];
        if (typeof value === 'string' && han.test(value)) record.fields.set(section + '/' + key, value);
      }
    }
    for (const [key, image] of Object.entries(item.canonicalId ? {} : item.images || {})) {
      if (!logosAndCovers.test(key)) continue;
      const valid = artwork(image);
      if (valid) record.images.set(key, valid);
    }
    found.set(id, record);
  }
  return found;
}

function readParam(query, key) {
  const entry = query.split('&').find(part => part.startsWith(key + '='));
  return entry ? decodeURIComponent(entry.slice(key.length + 1)) : '';
}

async function lookup(ctx, path, query, source, budget, wanted) {
  const [region, storefront, locale] = source;
  try {
    const endpoint = path.split('/')[3];
    const requestedPlatform = readParam(query, 'pfm');
    const platform = /^(?:atv|iphone|ipad|ios|desktop|web)$/i.test(requestedPlatform)
      ? requestedPlatform : /^(?:canvases|shelves|brands|channels|browse)$/i.test(endpoint) ? 'atv' : 'desktop';
    const nextToken = readParam(query, 'nextToken');
    let url = origin + path + '?caller=js&v=100&sf=' + storefront +
      '&locale=' + locale + '&pfm=' + platform + '&utsk=0&atv_zh_helper=1';
    if (/^\d{1,6}:\d{1,3}$/.test(nextToken)) url += '&nextToken=' + encodeURIComponent(nextToken);
    if (readParam(query, 'includeSeasonSummary') === 'true') url += '&includeSeasonSummary=true';
    const response = await ctx.http.get(url, {
      timeout: budget,
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json', 'Accept-Language': locale, 'X-Apple-I-Locale': locale },
    });
    if (response.status !== 200 || Number(response.headers?.get('content-length')) > responseLimit) return;
    const body = await response.text();
    if (!body || body.length > responseLimit) return;
    const payload = JSON.parse(body);
    if (payload?.data && !payload.error) return { region, items: indexRegion(payload.data, wanted) };
  } catch {
    // Other regions can still provide matching metadata.
  }
}

async function collectLookups(jobs, budget) {
  const results = [];
  const pending = Promise.all(jobs.map(async job => {
    const data = await job();
    if (data) results.push(data);
  }));
  // Egern also applies the per-request timeout when timers are unavailable.
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
    await pending;
    return results;
  }
  let timer;
  try {
    await Promise.race([pending, new Promise(resolve => { timer = setTimeout(resolve, budget); })]);
    return results.slice();
  } finally {
    clearTimeout(timer);
  }
}

function applyLocalization(items, results) {
  const stats = { text: 0, images: 0 };
  const regionRank = ['TW', 'SG', 'HK'];
  const ordered = results.slice().sort((a, b) => regionRank.indexOf(a.region) - regionRank.indexOf(b.region));
  for (const item of items) {
    const id = contentId(item);
    const records = ordered.map(result => [result.region, result.items.get(id)]).filter(([, record]) => record);
    if (!records.length) continue;
    for (const [section, object] of [[item.canonicalId ? 'playable' : '', item], ['header', item.header], ['canonicalMetadata', item.canonicalMetadata]]) {
      for (const key of fields) {
        if (typeof object?.[key] !== 'string') continue;
        const field = section + '/' + key;
        const simplified = summaries.has(key) && records.find(([region]) => region === 'SG')?.[1].fields.get(field);
        const localized = simplified || records.find(([, record]) => record.fields.has(field))?.[1].fields.get(field)
          || (section === 'canonicalMetadata' && key === 'episodeTitle' && item.canonicalId
            ? records.find(([, record]) => record.fields.has('/title'))?.[1].fields.get('/title') : undefined);
        if (localized && localized !== object[key]) {
          object[key] = localized;
          stats.text++;
        }
      }
    }
    for (const [key, entry, label] of displayLabels(item)) {
      const localized = records.find(([, record]) => record.fields.has(key))?.[1].fields.get(key);
      if (localized && localized !== entry[label]) {
        entry[label] = localized;
        stats.text++;
      }
    }
    if (Array.isArray(item.contentAdvisoryDetails)) {
      for (const advisory of item.contentAdvisoryDetails) {
        const localized = advisoryLabels.get(advisory?.description);
        if (localized) {
          advisory.description = localized;
          stats.text++;
        }
      }
    }
    if (item.canonicalId) continue;
    for (const [key, current] of Object.entries(item.images || {})) {
      if (!appleImage.test(current?.url)) continue;
      const candidate = records.find(([region, record]) => region === 'HK' && record.images.has(key) && record.fields.has('/title'))
        || records.find(([, record]) => record.images.has(key) && record.fields.has('/title'));
      const image = candidate?.[1].images.get(key);
      if (image && image.url !== current.url) {
        const { url, width, height, ...attributes } = image;
        item.images[key] = { url, width, height, ...attributes };
        stats.images++;
      }
    }
  }
  return stats;
}

export default async function (ctx) {
  const { request, response } = ctx;
  if (request?.method !== 'GET' || response?.status !== 200) return;
  try {
    const match = route.exec(request.url);
    if (!match) return;
    const [, path, endpoint, query = ''] = match;
    const decodedPath = decodeURIComponent(path);
    if (/(?:^|&)atv_zh_helper(?:=|&|$)/.test(query) || personal.test(decodedPath) ||
        /(?:^|\/)\.{1,2}(?:\/|$)|[?#\\]/.test(decodedPath)) return;
    const body = await response.text();
    if (!body || body.length > responseLimit) return;
    const payload = JSON.parse(body);
    if (!payload?.data || payload.error) return;
    const items = [...displayItems(payload.data), ...detailItems(payload.data)];
    if (!items.length) return;

    const browse = /^(?:canvases|shelves|brands|channels|browse)$/i.test(endpoint);
    const budget = browse ? 2400 : 3500;
    const wanted = new Set(items.map(contentId));
    const jobs = sources.map(source => () => lookup(ctx, path, query, source, budget, wanted));
    if (browse) {
      // A regional page may feature different titles. Also resolve the first movie/show directly.
      const featured = items.find(item => /^(?:Movie|Show)$/i.test(item.type || ''));
      if (featured) {
        const collection = /^movie$/i.test(featured.type) ? 'movies' : 'shows';
        const detail = '/uts/v3/' + collection + '/' + contentId(featured);
        jobs.push(() => lookup(ctx, detail, '', sources[0], budget, wanted));
      }
    }
    const results = await collectLookups(jobs, budget);
    const stats = applyLocalization(items, results);
    const storefront = /^(?:\d{6})(?:[-,]|$)/.exec(readParam(query, 'sf'))?.[0].slice(0, 6) || '默认';
    console.log('[AppleTV-ZH-DYNAMIC v2] 片库=' + storefront + ' 查询结果=' +
      results.filter(result => result.items.size).length + ' 文字=' + stats.text + ' 图片=' + stats.images);
    if (stats.text || stats.images) return { body: JSON.stringify(payload) };
  } catch {
    console.log('[AppleTV-ZH-DYNAMIC v2] 保留原始响应');
  }
}
