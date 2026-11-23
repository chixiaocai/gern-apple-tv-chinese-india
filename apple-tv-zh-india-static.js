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
]);

const route = /^https:\/\/uts-api\.itunes\.apple\.com\/uts\/v[23]\/(?:canvases|shelves|shows|movies)(?:\/[^?#]*)?(?:\?([^#]*))?$/;
const appleImage = /^https:\/\/is\d+(?:-ssl)?\.mzstatic\.com\/image\//;
const coverSlots = /^(?:cover|poster|tile|tile16x9|poster16x9|shelfImage)$/i;
const bodyLimit = 1280 * 1024;
// Descend into the display tree and skip playback, account and engagement objects.
const skip = new Set([
  'assets', 'offers', 'personalizedOffers', 'upsellOffers', 'itunesMediaApiData',
  'user', 'userProps', 'contentPersonalizedInfo', 'episodesContentPersonalizedInfo',
  'entitlements', 'license', 'licenses', 'playback', 'purchase', 'purchases',
  'images', 'header', 'canonicalMetadata',
]);

function changeTitles(object, english, chinese) {
  if (!object || typeof object !== 'object') return 0;
  let count = 0;
  for (const key of ['title', 'shortTitle', 'showTitle', 'movieTitle']) {
    if (object[key] !== english) continue;
    object[key] = chinese;
    count++;
  }
  return count;
}

function changeCovers(images, asset) {
  if (!images || typeof images !== 'object') return 0;
  const localizedURL = 'https://is1-ssl.mzstatic.com/image/thumb/' + asset + '/1200x675.jpg';
  let count = 0;
  for (const [key, image] of Object.entries(images)) {
    if (!coverSlots.test(key) || !appleImage.test(image?.url) || image.url === localizedURL) continue;
    if (!(image.width > 0 && image.height > 0)) continue;
    if (Math.abs(image.width / image.height - 16 / 9) > 0.05) continue;
    images[key] = { url: localizedURL, width: 1200, height: 675 };
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
    const storefront = /(?:^|&)sf=([^&]*)/.exec(query)?.[1];
    if (storefront && !/^143467(?:-|$)/.test(decodeURIComponent(storefront))) return;

    const text = await response.text();
    if (!text || text.length > bodyLimit) return;
    const payload = JSON.parse(text);
    if (!payload?.data || payload.error) return;

    let titles = 0;
    let covers = 0;
    const pending = [payload.data];
    while (pending.length) {
      const item = pending.pop();
      const entry = catalog.get(item.id);
      if (entry) {
        const [english, chinese, asset] = entry;
        titles += changeTitles(item, english, chinese);
        titles += changeTitles(item.header, english, chinese);
        titles += changeTitles(item.canonicalMetadata, english, chinese);
        covers += changeCovers(item.images, asset);
      }
      for (const [key, value] of Object.entries(item)) {
        if (!skip.has(key) && value && typeof value === 'object') pending.push(value);
      }
    }
    console.log('[AppleTV-ZH-IN-STATIC] 片名=' + titles + ' 封面=' + covers);
    if (titles || covers) return { body: JSON.stringify(payload) };
  } catch {
    console.log('[AppleTV-ZH-IN-STATIC] 保留原始响应');
  }
}
