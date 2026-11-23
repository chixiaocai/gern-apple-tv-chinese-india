// Apple TV display metadata from the public Apple TV Taiwan and Hong Kong pages.
// https://tv.apple.com/tw/show/severance/umc.cmc.1srk2goyh2q2zdxcx605w8vtx
// https://tv.apple.com/hk/show/silo/umc.cmc.3yksgc857px0k0rqe5zd4jice
// https://tv.apple.com/tw/show/ted-lasso/umc.cmc.vtoh0mn0xn7t3c643xqonfzy
// https://tv.apple.com/hk/show/foundation/umc.cmc.5983fipzqbicvrve6jdfep4x3
const catalog = new Map([
  ['umc.cmc.1srk2goyh2q2zdxcx605w8vtx', ['Severance', '人生切割術', 'SVBL0CGDrmTzIOaRF1C7yg']],
  ['umc.cmc.3yksgc857px0k0rqe5zd4jice', ['Silo', '末日地堡', 'NqwTu1czsR6xsKTxnXMviw']],
  ['umc.cmc.vtoh0mn0xn7t3c643xqonfzy', ['Ted Lasso', '泰德拉索：錯棚教練趣事多', 'qErPpGcOiJLHCPgTyVIfRQ']],
  ['umc.cmc.5983fipzqbicvrve6jdfep4x3', ['Foundation', '基地', 'ZjkP9c5rv8fAw4VytVJEhg']],
  // Apple TV Taiwan supplies a separate logo for the iPhone hero.
  ['umc.cmc.5gf63v7zj97yiozkpj26lpy55', [
    'Being Heumann', '身而為人：茱蒂休曼', 'iu2hOg3AxRgW6XzV20OmHg',
    {
      contentImage16X9: [
        'https://is1-ssl.mzstatic.com/image/thumb/iu2hOg3AxRgW6XzV20OmHg/{w}x{h}.{f}', 3840, 2160,
      ],
      contentLogo: [
        'https://is1-ssl.mzstatic.com/image/thumb/bNhxn1g6QVRLWrbB6nBL2Q/{w}x{h}.{f}', 4435, 873,
      ],
      posterArt: [
        'https://is1-ssl.mzstatic.com/image/thumb/33rsmzDsPRs4PmEVJyJ8tQ/{w}x{h}CA.TVA23C01.{f}', 2000, 3000,
      ],
    },
    '茱蒂休曼與其他身心障礙者發起抗爭，要求政府保障他們的平等權利。',
  ]],
  ['umc.cmc.2xeasogpeiwbaegczytrdg1uh', [
    '12 12 12', '12 12 12', null, null,
    '一場銀行大劫案，讓聯邦探員與職業罪犯在歐洲展開追逐。',
  ]],
]);

const route = /^https:\/\/uts-api\.itunes\.apple\.com\/uts\/v[123]\/(?:canvases|shelves|brands|channels|shows|movies)(?:\/[^?#]*)?(?:\?([^#]*))?$/;
const appleImage = /^https:\/\/is\d+(?:-ssl)?\.mzstatic\.com\/image\//;
const coverSlots = /^(?:cover|poster|tile|tile16x9|poster16x9|contentImage16x9|shelfImage)$/i;
const bodyLimit = 1280 * 1024;
// Descend into the display tree and skip playback, account and engagement objects.
const skip = new Set([
  'assets', 'offers', 'personalizedOffers', 'upsellOffers', 'itunesMediaApiData',
  'user', 'userProps', 'contentPersonalizedInfo', 'episodesContentPersonalizedInfo',
  'entitlements', 'license', 'licenses', 'playback', 'purchase', 'purchases',
  'playables', 'smartPlayables', 'smartEpisodePlayables', 'howToWatch',
  'contentAvailability', 'images', 'header', 'canonicalMetadata',
]);

function changeTitles(object, english, chinese) {
  if (!object || typeof object !== 'object') return 0;
  let count = 0;
  for (const key of ['title', 'shortTitle', 'showTitle', 'movieTitle']) {
    if (object[key] !== english || english === chinese) continue;
    object[key] = chinese;
    count++;
  }
  return count;
}

function changeCovers(images, asset, regionalImages) {
  if (!images || typeof images !== 'object') return 0;
  let count = 0;
  for (const [key, image] of Object.entries(images)) {
    if (!appleImage.test(image?.url)) continue;
    const regional = regionalImages?.[key];
    let replacement = regional;
    if (!replacement && asset && coverSlots.test(key) &&
        image.width > 0 && image.height > 0 &&
        Math.abs(image.width / image.height - 16 / 9) <= 0.05) {
      replacement = [
        'https://is1-ssl.mzstatic.com/image/thumb/' + asset + '/1200x675.jpg', 1200, 675,
      ];
    }
    if (!replacement || image.url === replacement[0]) continue;
    const [url, width, height] = replacement;
    images[key] = { url, width, height };
    count++;
  }
  return count;
}

export default async function (ctx) {
  const { request, response } = ctx;
  if (request?.method !== 'GET' || response?.status !== 200) return;
  try {
    const match = route.exec(request.url);
    if (!match) return;
    const query = match[1] || '';
    if (/(?:^|&)atv_zh_helper(?:=|&|$)/.test(query)) return;
    const storefront = /(?:^|&)sf=(\d+)(?:-|,|&|$)/.exec(query)?.[1] || '默认';

    const text = await response.text();
    if (!text || text.length > bodyLimit) return;
    const payload = JSON.parse(text);
    if (!payload?.data || payload.error) return;

    let titles = 0;
    let artwork = 0;
    let descriptions = 0;
    const pending = [payload.data];
    while (pending.length) {
      const item = pending.pop();
      const entry = catalog.get(item.id);
      if (entry) {
        const [english, chinese, asset, regionalImages, description] = entry;
        titles += changeTitles(item, english, chinese);
        titles += changeTitles(item.header, english, chinese);
        titles += changeTitles(item.canonicalMetadata, english, chinese);
        artwork += changeCovers(item.images, asset, regionalImages);
        for (const key of ['description', 'heroDescription']) {
          if (description && typeof item[key] === 'string' && item[key] !== description) {
            item[key] = description;
            descriptions++;
          }
        }
      }
      for (const [key, value] of Object.entries(item)) {
        if (!skip.has(key) && value && typeof value === 'object') pending.push(value);
      }
    }
    console.log('[AppleTV-ZH-IN-STATIC v2] 片库=' + storefront +
      ' 片名=' + titles + ' 图片=' + artwork + ' 简介=' + descriptions);
    if (titles || artwork || descriptions) return { body: JSON.stringify(payload) };
  } catch {
    console.log('[AppleTV-ZH-IN-STATIC] 保留原始响应');
  }
}
