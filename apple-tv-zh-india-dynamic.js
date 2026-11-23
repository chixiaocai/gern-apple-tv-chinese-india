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
  'badge', 'caption', 'explainabilityLine', 'eyebrow',
];
const summaries = new Set(['description', 'heroDescription', 'summary', 'seoDescription']);
const logosAndCovers = /^(?:contentImage(?:16x9|Tall)?|contentLogo|poster(?:16x9|Art)?|cover|tile(?:16x9)?|shelfImage(?:Background)?|shelfItemImage|shelfItemOverlayImage|transitionImage|showLogo|logo)$/i;
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

function* displayItems(root, includePersonal = false) {
  const stack = [root];
  while (stack.length) {
    const item = stack.pop();
    if (!includePersonal && typeof item.id === 'string' && personal.test(item.id)) continue;
    if (contentId(item)) yield item;
    const entries = Object.entries(item);
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, value] = entries[index];
      if (value && typeof value === 'object' && !skip.has(key) && (includePersonal || !personal.test(key))) stack.push(value);
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
  const { url, width, height, isP3, joeColor, supportsLayeredImage } = image;
  return { url, width, height, isP3, joeColor, supportsLayeredImage };
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
    if (payload?.data && !payload.error) {
      return { region, items: indexRegion(payload.data, wanted), shelves: shelfTitles(payload.data) };
    }
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

// Public Taiwan and Hong Kong Apple TV channel artwork, used when a live lookup times out.
const channelSeed = [
  ["umc.cmc.1srk2goyh2q2zdxcx605w8vtx","人生切割術",{"contentImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/sWbO9RKGr81f6-iTFF9d4g/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"contentImage16X9":{"url":"https://is1-ssl.mzstatic.com/image/thumb/FZeLkh7-c_hlLrgolPvhmw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"contentImageTall":{"url":"https://is1-ssl.mzstatic.com/image/thumb/_705uGqVmFkkNIXfLCXHRw/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/MQKsFd7A4EW1-_2voUvmBA/{w}x{h}.{f}","width":6985,"height":1382,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/oJxJ1hOP8UxGztEcoaAXxw/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/_705uGqVmFkkNIXfLCXHRw/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/sWbO9RKGr81f6-iTFF9d4g/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/R8-NyavUNgWqAfUoUtUjNA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.5gf63v7zj97yiozkpj26lpy55","身而為人：茱蒂休曼",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/bNhxn1g6QVRLWrbB6nBL2Q/{w}x{h}.{f}","width":4435,"height":873,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/PFJuj6vm6ou7LbgVX8TZ8g/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/33rsmzDsPRs4PmEVJyJ8tQ/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/C1aHJzbqDImjSO2cbhsv7g/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/PFJuj6vm6ou7LbgVX8TZ8g/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.2szz3fdt71tl1ulnbp8utgq5o","外放特務組",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/C6Z8mycqm0lq6gsVyKIOxg/{w}x{h}.{f}","width":5838,"height":1447,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/EJo0K6ENwDN0rmv0m5br2g/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfItemOverlayImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/30/9f/f6/309ff603-591d-d476-fbc1-13ad910fdfcb/e24654c-ab7b-4bc7-b076-e2d641ee92d9.png/{w}x{h}.{f}","width":1210,"height":880,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/_WSLu8vBLiisvKv8yvmX2Q/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/gaxT8-02hxIwn62aKXvgkA/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/EJo0K6ENwDN0rmv0m5br2g/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.4cfsq1juke72zutv5xp0pw3rj","夜行殺機",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/-3B_hFw37I6dfnVvDphP-A/{w}x{h}.{f}","width":2269,"height":634,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/qxsmvAwVk-gqQEtlLsrjfg/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/L8_Gb5AJvi6GstwAQl1uoA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/m3T3dmN1diaMgGx7mXC4Dg/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/qxsmvAwVk-gqQEtlLsrjfg/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.52w04zy67tiv11p8xvbc57wmc","高桿拍檔",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/5wMODwKFs1n1VGydv_szsA/{w}x{h}.{f}","width":3600,"height":1126,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/CDP2__d0VAO2B7EQzOwDZQ/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/bYaK9q8UU40m1XDYWIHFRA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/nIgRyMr--AbTx2vJB1HDbA/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/CDP2__d0VAO2B7EQzOwDZQ/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.4luj45vtqpmjsvb6sc2675oeg","人生複本",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/kkwYfie82E-vYWJcPoZ0Rw/{w}x{h}.{f}","width":3126,"height":794,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/C7ajZSlk19LEco3WngrE7A/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Tb4ntWOyVa8pZbNFmf0Ndw/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/9awBIuKvX_ZQxTQLgHRGKA/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/C7ajZSlk19LEco3WngrE7A/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.3yksgc857px0k0rqe5zd4jice","末日地堡",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/RsGlludPi0sLpkEtkBuypg/{w}x{h}.{f}","width":3189,"height":546,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Ts1eX5lbkAKXD4FfvBoEFA/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/V1TPsNOWpMdEV5XI50efwQ/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Lwb2DbNDJAhMoh5jrnMx3Q/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Ts1eX5lbkAKXD4FfvBoEFA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.3t6dvnnr87zwd4wmvpdx5came","F1 電影",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/8-B3yIoVIfKmdkQ9oJxkJw/{w}x{h}.{f}","width":6418,"height":3223,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/5xJYlxdYAJ_jba_RBxlbuQ/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/vMnfISVLtOuZZOkMDWbZ1w/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/ZBJu4aifHuc_51WYSqdk4w/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/5xJYlxdYAJ_jba_RBxlbuQ/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.vtoh0mn0xn7t3c643xqonfzy","泰德拉索：錯棚教練趣事多",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/kelLnYLmFPkc3OSn1vfFKg/{w}x{h}.{f}","width":4874,"height":1769,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/t4WfFAvdWg608nQz0Mt_OQ/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Cs1Fy-kh67BRev66ZOJCcg/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/71MOIRL0meBFMCDlwISAkg/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/t4WfFAvdWg608nQz0Mt_OQ/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.1zzly0vah46bnvnwf0qkrjhh2","寡婦灣",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/FbwIQ2hTNWUYtxiCwazB2A/{w}x{h}.{f}","width":2682,"height":863,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/jG_wwoRFw53ir-NGH9jK3g/{w}x{h}{c}.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfItemOverlayImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/66/36/ff/6636ff8f-e120-6272-22cc-5991de1d36b5/5771431-2fc8-418f-935d-db67d7e6f375.png/{w}x{h}.{f}","width":1210,"height":880,"supportsLayeredImage":false}}],
  ["umc.cmc.17g1y5mzqp92sc0ge1c0hdorg","無間兄弟情",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/-GWdD743kT9GbQsFxdSP9A/{w}x{h}bb.{f}","width":4669,"height":1036,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/E06bRS4RDHu5qJJ-HAkWvA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/5RK_t6B-pr9W9AtJtIzT3g/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/GM0b6AGcTMd51NbBdNeWaw/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/UW8YjKtLOeWraeA-Cqe68g/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.62l8x0ixrhyq3yaqa5y8yo7ew","君主計畫：神祕組織與怪獸之謎",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/SASblfltdW4oq8d8w2Rp4w/{w}x{h}bb.{f}","width":3971,"height":1650,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/2Z6edSSxCTUrVJ7o38tdlQ/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Wl0B3Vg3NoDmJTOkexwWjA/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/BwMgB_etCOsDJ_-W-raPTw/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/FaVd7WkKTQxadk8iW67g9g/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.295lpojxtonf6dqc4za2i97lr","一級玩家",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/2a/1f/ae/2a1fae2e-e0dd-bdc2-d726-1bc2b4fb296d/igi11403859995604352376.png/{w}x{h}bb.{f}","width":4312,"height":1038,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Video221/v4/c3/a5/c7/c3a5c745-994a-667e-8976-56da3e9d93de/0dc14da2-90e6-44f0-91c9-7afdda3bfd9d_Ready_PlayerOne_V_DD_KA_TT_2000x3000_300dpi_TW.lsr/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":true},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/FyZuBOe4Hbo7cu4xvjZVJQ/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Q_NszZTJsSRgRwyMO6V71g/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/83bUOPLBaZsb96Hz0OSrhg/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.1xnsjqmhn8a93iy2vgj36w3d1","蜘蛛人：離家日",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/VRRIzWNZ4ROdnSgfyZ8PPw/{w}x{h}bb.{f}","width":4047,"height":1300,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Video211/v4/11/ed/4a/11ed4aab-54ce-c4ed-a0c5-7636d4c20f88/DP_10266279_SpiderManFarFromHome_2000x3000_TW.jpg/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features221/v4/d8/65/ad/d865ad34-eede-8a5d-124d-6f22aed28d71/mzl.pmaxthje.png/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/4c/ac/48/4cac4839-1e65-f700-79fe-97fbf1e1596b/mzl.rtxvdqsf.png/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/vfGz0-yJjuTb3hkCkh_5dg/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.kjbya937j82mxlexdhbh3rg1","太陽浩劫",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/8rGdNn3h8gzvata1tMYvDg/{w}x{h}bb.{f}","width":4250,"height":1146,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/0lgKPkXL8Xk2T8v_jCzy8A/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Ey3eHqXF4kMsNQ873PfI3Q/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/QjzuZpM2MYmR6jT199Y7EA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/a_Ox-I0F8c4UsDGTNvUCqw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.31qa8j1tn2cnpyk3fx43w928d","Matchbox 電影",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/xqMjoLkyiOaNsaon2Dnbsg/{w}x{h}bb.{f}","width":7916,"height":2099,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/6yUkp60mgDXylbZVi0DqNw/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/MymxLkEYEeCsKg_g9Df5vQ/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/OaTmcpv-Wt10AgLusF29Kw/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/lkoRwMk0OYmP_gZGMj_DEA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.shin43vzfoz3h4ggx41z8rf","礙的迫降",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/nMTsIKzZMU6V-R9CA78ruA/{w}x{h}bb.{f}","width":3541,"height":898,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/dIfV-otKvyMS06dzwKgwpw/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/cbBPfga4TKAdWbkjPergbg/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/uIZsuU0icVko54iDwm59sg/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/sps4_V8G6cqlpJOY6esopg/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.3f1fb5wz6e4418nucy3ej1lrn","享受吧！一個人的旅行",{"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Video/v4/88/6a/03/886a03ad-ee6c-1ad7-a9a4-74e191b01183/ticket.knpxqpfz.jpg/{w}x{h}CA.TVA23C01.{f}","width":1400,"height":2100,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Video/v4/88/6a/03/886a03ad-ee6c-1ad7-a9a4-74e191b01183/ticket.knpxqpfz.jpg/{w}x{h}nr.{f}","width":1400,"height":2100,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/tlb_xG4rI7lD_KaFyIJOgA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/0NQz8tnAOVoxoQlTQMShXA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.26o403koqo2klixc0jtqy6tmc","禁谷",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/mXrH3uQmcnlfWi6WrMUz1A/{w}x{h}bb.{f}","width":3487,"height":1829,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/IuWvE4W0UALFX02Yv9gbJQ/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/atB16fDyA9l0RdfRsFXaMw/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/1yccMF-r5KnerGwioaubNA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/C87f9kbBZI4WQOUrh5uikQ/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false}}],
  ["umc.cmc.6xerenwn1999cjd2y6421r2ex","瘋狂麥斯：憤怒道",{"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features221/v4/16/23/0c/16230cc4-518e-7977-820f-291adb889633/jig644115808676016404.png/{w}x{h}bb.{f}","width":4319,"height":1199,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Video211/v4/e3/10/4d/e3104d5e-bd80-db7e-138d-a565454c746f/27efc2c8-2f51-48de-9c30-7dd902bfa952_MadMaxFuryRoad_4K_V_DD_KA_TT_2000x3000_300dpi_TW-srgb.lsr/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":true},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features221/v4/d2/bc/79/d2bc799f-b93a-0dde-d146-0ecbf98a8251/mzl.qiokhtgw.png/{w}x{h}nr.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/a5/21/13/a5211342-f41b-4712-e8b0-b3a05e9f3477/mzl.wpbhmvub.png/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/ga4rS5gpkEpTonYjEpvMXQ/{w}x{h}.{f}","width":7360,"height":4140,"supportsLayeredImage":false}}],
  ["umc.cmc.6svjiemf03726764bsl038sfp","媽媽咪呀",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/SaVY6Lqjv7EReBgo3LeEQQ/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/0u_jF6Ufh4mmyJNshX96Yw/{w}x{h}BDT.TVA23D01.{f}","width":1680,"height":3636,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/RvxAZUCeQ3GbqoyLJetj1g/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/kYMwoCKkOvVm5FrOL079DA/{w}x{h}bb.{f}","width":4319,"height":1275,"supportsLayeredImage":false}}],
  ["umc.cmc.1fhnal2vix2077ouh1hjy2eoc","奧卡菲娜：天兵大廚",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/YeFbsX6TMPxPFHkA3poVNw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/U4oH96OPxjJ2eMgovTvI9A/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/5vZZ5RmEYFyugm5Y24hnCw/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/SaODRf1QyNiHSTATaNfm_w/{w}x{h}bb.{f}","width":4784,"height":1916,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/U4oH96OPxjJ2eMgovTvI9A/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false}}],
  ["umc.cmc.2hc9ggvxaqddv779k4zupmrw","格林姊妹大冒險",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/35oKJzPPIU9gVH0EMYTyfw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/ijvA8Sgqt0_ULv2JVCYzNg/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/wrmFAp_Dqe4QMGNZq2Gd3w/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.3qvemsb6f04actuyzdporeelt","萬人之上：冬攀喬戈里峰",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/OOPKnSq7kAMlXUS6SQ13vQ/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/_9WiRlewAMeh6K0xsCwd4w/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/hIYOO5DibU_CwdANHdd6Gg/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.6x0wb0zjilppb9tlwlva08izm","瓶中小先知",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/yovlggGLawgx9ifBFj2tLA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/i-iZimr0CyLnAl33FauKIg/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/d9QUldswhHQIDKUx-fN9JA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.6muy4la7lj1omu5nci4bt2m66","而立人生",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/02ctz4r8QFa1NwzgO8eD_g/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/up-k6n7OMOb7Qc8BQyDFqA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/asB4tqPwT6jDxbw7G2FuFw/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.7js98w9pfzw394wpm8da3cuzq","史努比開心呈獻：12天耶誕倒數",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/uY2MJUU9pZ4AacL9GHTFlQ/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/05dgMy6q91rRnMOBCyNmkQ/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/8XgdLPPDIw-F7ogeG7xzvA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.2yhce9h11ctctdi23b29k1ek3","廚刀難握：摘星米其林",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/W_69UwI-QZSvDvHoApNIjA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/DNiYw3KzQqYinSbg--Q-Fw/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/n7geddR8dfQOh_UcysjG7A/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.4pbw9c936a4pigdvsg23u2bsa","有人看見她",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/u149PGIblLUVKwG1w8Bfgg/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/4MVYAGp-cHRQw8Dah9nZEg/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/QMAplm1QCKqziJl9O7SeRA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.6lic0hhuxkrbem0n29vzjopii","雪山之虎：丹增諾蓋",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/c85uuZhv88vkrCDTh7rWsA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/aXp1ZEFEWaCJbizR5KqUUA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/x9edCqARMqaaTXLXWq_Flg/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false},"contentLogo":{"url":"https://is1-ssl.mzstatic.com/image/thumb/89yLb732lY7HWMYG6kckTg/{w}x{h}bb.{f}","width":6173,"height":682,"supportsLayeredImage":false},"posterArt":{"url":"https://is1-ssl.mzstatic.com/image/thumb/aXp1ZEFEWaCJbizR5KqUUA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false}}],
  ["umc.cmc.73wmdmkfpta5ul1vbwckmme39","女警急先鋒",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/-AkCvWOheHJm7mc0nbkyIg/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/ALEO6fGqzdoRJcuNLPEY4A/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/96-XJtGKGNdMXb1Q88W0Kg/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.o5z5ztufuu3uv8lx7m0jcega","怒海戰艦",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/AAHZjxENyEVKxJ25uocdLg/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/ZNWcNbohSU8p_g7y4W-V4Q/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/IqcQoc9JGJG0LWUrSXCVwQ/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.25tn3v8ku4b39tr6ccgb8nl6m","晨間直播秀",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/hTCxkCt67vbxTbTYNXvQFw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/jU2rDSry1Nu-G2YZwcaayQ/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/8TJ8sRluzeJ9Ju1VB7riQA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.3s4mgg2y7h95fks9gnc4pw13m","末日光明",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/eNmGfFw28h0wRyjEHIaxmQ/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/h2hik9N4GVSHR0p5gHcy-g/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/rV4S9xWc5p3ow4CuIZ5sTg/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.70b7z97fv7azfzn5baqnj88p6","全面入侵",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/YLkVAeqFn7Zz1tGujelspg/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/FWZkJYk6l9BWkAuhEB9WGg/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/w5-aFmRGPHWRNsHSqnNQrQ/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.6wsi780sz5tdbqcf11k76mkp7","太空使命",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/e1J3uXrKIItsN6URbjFXpA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/5tvRekE_UVFeRsHtNiofEw/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/0teCn9ovbw_pxmscMcGnfg/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.5983fipzqbicvrve6jdfep4x3","基地",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/S1dMJZeFCFNwrw-OsuIqGw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/s18lfcTuW5STTj3ICDhziA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/djWEh0WrOhJFCXt6h0SspA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.1dg08zn0g3zx52hs8npoj5qe3","劫持驚魂錄",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Kep5_JPD___toU-9i6TPiA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/6qh5kmDgSf4Au6DOAs39ZA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/BJyD_-sJotv9c5hfPIMnjA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.c3xhu25rw4jxxxzq4oio6snu","惡狼特工",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/dDI0l-Xvhf813qs0924L1w/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/-ki2pQb_dn27iB62-mWARQ/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/KN-ebYSSwrP_VbMyFh0KAQ/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.4y25wuby7pck9o6vaubbbk7gb","靈異女僕",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/F9ZN15aiLrqroG6n4aoNxA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/B0Cv1iGqncAI_V91gLLecA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/ojNft7bO8SqdVqLdmcnhcQ/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.1nfdfd5zlk05fo1bwwetzldy3","神話任務",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/o2HeXwBjkOBidWP69tOSoQ/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/9xbI1gO8x7jWXtU8E3-12Q/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/JOrS-mjQdfzUI4hvwe_l5g/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.6o6y3wel2lez2tkdu2cv8dzd1","全家逃走中",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/3QeIazFewU4Mox-YZ1BBhA/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/CoUmOw_13FYWpVMKoj6HeA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/zOQ4Gz7BdkLtExHLasRDdg/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.17vf6g68dy89kk1l1nnb6min4","柏青哥",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/kjahq02RGpA4woJjww2Fow/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/tjU49aFESNeIqF891RAOGA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/6W6mq5o3qokge1ya8yw8cA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.337cdk1ou0bmn6frmzxwm7xqd","德黑蘭行動",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/lGMdHbrgYRukMrX9Jo_otw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/i9w-Bxhk8LdSWfx2k9Wycg/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/4eOr8cFzDPWk0_WEn1hakA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.47dkj9f2ho3h8dwxixflz65q5","芬奇的旅程",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/rMlwItrh1RP9Zy9OvF5Ksw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/rraVQ0xyaChSvJdz8iiTQA/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Osow7aAfrey-FvDZb95kzA/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.74o37kzay0yuuub8iumddjsg","掩耳盜鄰",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/EJC5ndGdzotqFNrBZYf0Dw/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Vs3ueygRK-ieRd-u8pfXbw/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/NgtxvYhct6wz0TIAThwS1g/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
  ["umc.cmc.7bxcni0vwgll9kmicq738k5q2","空戰群英",{"shelfImageBackground":{"url":"https://is1-ssl.mzstatic.com/image/thumb/bguDRTLJslV5Eug8Ibn9OQ/{w}x{h}.{f}","width":3840,"height":2160,"supportsLayeredImage":false},"shelfItemImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/FQuGcmSVmVzyc5bzJzyEUQ/{w}x{h}CA.TVA23C01.{f}","width":2000,"height":3000,"supportsLayeredImage":false},"transitionImage":{"url":"https://is1-ssl.mzstatic.com/image/thumb/ccD7XsLI6hfm8Pd9Ye2gsQ/{w}x{h}sr.{f}","width":4320,"height":3240,"supportsLayeredImage":false}}],
];
const displayCopy = new Map([
  ['Continue Watching on Apple TV', '在 Apple TV 上繼續觀看'],
  ['Continue Watching', '繼續觀看'],
  ['Top 10 on Apple TV', 'Apple TV 熱門前 10 名'],
  ['Top 10 TV Shows', '10 大熱門電視節目'],
  ['Top 10 Movies', '10 大熱門電影'],
  ['Must-See Hits', '必看熱門作品'],
  ['Watch Premieres for Free', '首播作品免費看'],
  ['Featured', '精選'], ['New Releases', '新上架'],
  ['TV Show', '電視節目'], ['Movie', '電影'],
  ['Crime', '犯罪'], ['Action', '動作'], ['Thriller', '驚悚'],
  ['Comedy', '喜劇'], ['Drama', '劇情片'], ['Mystery', '懸疑'],
  ['Adventure', '冒險'], ['Sci-Fi', '科幻'], ['Documentary', '紀錄片'],
  ['Resume', '繼續播放'], ['Play', '播放'], ['More', '更多'], ['MORE', '更多'],
]);
const weekdays = new Map(Object.entries({
  Monday: '一', Tuesday: '二', Wednesday: '三', Thursday: '四',
  Friday: '五', Saturday: '六', Sunday: '日',
}));

function localizedLabel(value) {
  if (typeof value !== 'string') return;
  const plain = value.replace(/\u00a0/g, ' ').trim();
  if (displayCopy.has(plain)) return displayCopy.get(plain);
  let match = /^New Episodes? (?:Every )?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?$/i.exec(plain);
  if (match) {
    const day = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    return '每週' + weekdays.get(day) + '更新';
  }
  match = /^#(\d+) (Show|Movie) on Apple TV$/i.exec(plain);
  if (match) return 'Apple TV 熱門' + (/show/i.test(match[2]) ? '節目' : '電影') + '第 ' + match[1] + ' 名';
  match = /^Resume S(\d+),?\s*E(\d+)$/i.exec(plain);
  if (match) return '繼續播放第 ' + match[1] + ' 季第 ' + match[2] + ' 集';
  match = /^Episode (\d+)$/i.exec(plain);
  if (match) return '第 ' + match[1] + ' 集';
}

function shelfTitles(data) {
  const result = new Map();
  const shelves = data.canvas?.shelves || data.shelves || [];
  if (Array.isArray(shelves)) {
    for (const shelf of shelves) {
      const title = shelf?.header?.title;
      if (typeof shelf?.id === 'string' && typeof title === 'string' && han.test(title)) {
        result.set(shelf.id, title);
      }
    }
  }
  return result;
}

function localizeLabels(root, results) {
  let changed = 0;
  const stack = [root];
  while (stack.length) {
    const object = stack.pop();
    if (object.header && typeof object.header.title === 'string') {
      const localized = sources.map(([region]) => results.find(result => result.region === region && result.shelves?.has(object.id))).find(Boolean)?.shelves.get(object.id);
      if (localized && localized !== object.header.title) {
        object.header.title = localized;
        changed++;
      }
      const label = localizedLabel(object.header.title);
      if (label) { object.header.title = label; changed++; }
    }
    for (const [key, value] of Object.entries(object)) {
      if (value && typeof value === 'object' && !skip.has(key)) stack.push(value);
      if (!['badge', 'caption', 'localizedType', 'explainabilityLine', 'eyebrow', 'label',
        'buttonText', 'accessibilityLabel', 'genre'].includes(key) &&
        !(key === 'name' && object.type === 'Genre') &&
        !(key === 'title' && typeof value === 'string' && /^Episode \d+$/i.test(value))) continue;
      const label = localizedLabel(value);
      if (label && label !== value) { object[key] = label; changed++; }
    }
  }
  return changed;
}

function imageCandidate(item, key, current, records) {
  for (const [, record] of records) {
    if (!record.fields.has('/title')) continue;
    const image = record.images.get(key);
    if (image && (/logo/i.test(key) ||
        Math.abs(image.width / image.height - current.width / current.height) < 0.12)) return image;
  }
  // Continue Watching uses a landscape shelf slot. Match the same title's public 16:9 artwork.
  if (item.type === 'Show' || item.type === 'Movie') {
    if (/^shelfItemImage$/i.test(key) && Math.abs(current.width / current.height - 16 / 9) < 0.12) {
      for (const [, record] of records) {
        const image = record.images.get('contentImage16X9') || record.images.get('shelfImageBackground');
        if (record.fields.has('/title') && image &&
            Math.abs(image.width / image.height - 16 / 9) < 0.12) return image;
      }
    }
  }
}

const seededChannel = {
  region: 'seed',
  items: new Map(channelSeed.map(([id, title, images]) => [
    id, { fields: new Map([['/title', title]]), images: new Map(Object.entries(images)) },
  ])),
};

function applyLocalization(items, results) {
  const stats = { text: 0, images: 0 };
  const regionRank = ['TW', 'SG', 'HK', 'seed'];
  const ordered = results.slice().sort((a, b) => regionRank.indexOf(a.region) - regionRank.indexOf(b.region));
  for (const item of items) {
    const id = contentId(item);
    const records = ordered.map(result => [result.region, result.items.get(id)]).filter(([, record]) => record);
    if (!records.length) continue;
    const artOrder = records.slice().sort((a, b) => ['HK', 'TW', 'SG', 'seed'].indexOf(a[0]) - ['HK', 'TW', 'SG', 'seed'].indexOf(b[0]));
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
      const image = imageCandidate(item, key, current, artOrder);
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
    const personalShelf = /\/shelves\/(?:group-)?(?:continue-watching(?:-v2)?|up-next)(?:\/|$)/i.test(decodedPath);
    if (/(?:^|&)atv_zh_helper(?:=|&|$)/.test(query) || (personal.test(decodedPath) && !personalShelf) ||
        /(?:^|\/)\.{1,2}(?:\/|$)|[?#\\]/.test(decodedPath)) return;
    const body = await response.text();
    if (!body || body.length > responseLimit) return;
    const payload = JSON.parse(body);
    if (!payload?.data || payload.error) return;
    const items = [...displayItems(payload.data, true), ...detailItems(payload.data)];
    const publicItems = personalShelf ? [] : [...displayItems(payload.data), ...detailItems(payload.data)];

    const browse = /^(?:canvases|shelves|brands|channels|browse)$/i.test(endpoint);
    const budget = browse ? 2400 : 3500;
    const wanted = new Set(publicItems.map(contentId));
    const isChannel = /\/canvases\/channels\/tvs\.sbd\.4000(?:\/|$)/i.test(decodedPath);
    const jobs = wanted.size ? sources.map(source => () => lookup(ctx, path, isChannel ? query.replace(/(?:^|&)pfm=[^&]*/g, '') + '&pfm=atv' : query, source, budget, wanted)) : [];
    if (browse && !isChannel) {
      // A regional page may feature different titles. Also resolve the first movie/show directly.
      const featured = publicItems.find(item => /^(?:Movie|Show)$/i.test(item.type || ''));
      if (featured) {
        const collection = /^movie$/i.test(featured.type) ? 'movies' : 'shows';
        const detail = '/uts/v3/' + collection + '/' + contentId(featured);
        jobs.push(() => lookup(ctx, detail, '', sources[0], budget, wanted));
      }
    }
    const results = await collectLookups(jobs, budget);
    const stats = applyLocalization(items, browse ? [...results, seededChannel] : results);
    stats.text += localizeLabels(payload.data, results);
    const storefront = /^(?:\d{6})(?:[-,]|$)/.exec(readParam(query, 'sf'))?.[0].slice(0, 6) || '默认';
    console.log('[AppleTV-ZH-DYNAMIC v3] 片库=' + storefront + ' 查询结果=' +
      results.filter(result => result.items.size).length + ' 文字=' + stats.text + ' 图片=' + stats.images);
    if (stats.text || stats.images) return { body: JSON.stringify(payload) };
  } catch {
    console.log('[AppleTV-ZH-DYNAMIC v3] 保留原始响应');
  }
}
