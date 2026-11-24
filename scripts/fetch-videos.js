/*
 * 유튜브 채널의 최신 영상 목록을 content/videos.json 에 보관합니다. (외부 패키지 없음)
 *
 * - 채널의 공개 RSS(https://www.youtube.com/feeds/videos.xml)에서 최근 영상(최대 15개)을 읽어,
 *   이미 저장된 영상과 합칩니다. 예전 영상은 지우지 않고 계속 쌓입니다.
 * - 네트워크 오류나 채널 문제로 가져오지 못해도 빌드는 멈추지 않고, 저장된 목록을 그대로 씁니다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'content', 'videos.json');
const HANDLE = 'pain_dr_kwon';
const DEFAULT_CHANNEL_ID = 'UCsUhHpWv93V82MHzECnJX5A';

const decode = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { channel: {}, items: [] }; }
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; gamseonghani-build)', 'accept-language': 'ko' } });
  if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
  return res.text();
}

function parseFeed(xml) {
  const title = decode((xml.match(/<title>([^<]*)<\/title>/) || [])[1]);
  const items = [];
  (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).forEach((e) => {
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    if (!id) return;
    items.push({
      id,
      title: decode((e.match(/<title>([^<]*)<\/title>/) || [])[1]).trim(),
      published: (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '',
      description: decode((e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1]).trim(),
    });
  });
  return { title, items };
}

async function readFeed(channelId) {
  return parseFeed(await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId));
}

async function main() {
  const store = load();
  store.channel = store.channel || {};
  if (typeof fetch !== 'function') { console.log('영상: 이 Node 버전은 fetch 를 지원하지 않아 저장된 목록을 사용합니다.'); return store; }
  let id = store.channel.id || DEFAULT_CHANNEL_ID, feed = null;
  try {
    try { feed = await readFeed(id); }
    catch (e) {
      // 저장된 채널 ID 가 맞지 않으면 채널 핸들 페이지에서 ID 를 다시 찾습니다.
      const html = await get('https://www.youtube.com/@' + HANDLE);
      const m = html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/);
      if (!m) throw e;
      id = m[1]; feed = await readFeed(id);
    }
    const byId = new Map((store.items || []).map((v) => [v.id, v]));
    feed.items.forEach((v) => byId.set(v.id, Object.assign({}, byId.get(v.id) || {}, v)));
    store.items = [...byId.values()].sort((a, b) => String(b.published).localeCompare(String(a.published)));
    store.channel = { id, handle: HANDLE, title: feed.title || store.channel.title || '' };
    store.updated = new Date().toISOString();
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2) + '\n');
    console.log('영상: 채널에서 ' + feed.items.length + '개를 읽어 총 ' + store.items.length + '개 보관');
  } catch (e) {
    console.log('영상: 유튜브에서 가져오지 못해 저장된 ' + (store.items || []).length + '개를 사용합니다 (' + e.message + ')');
  }
  return store;
}

module.exports = { main };
if (require.main === module) main();
