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

const LINKS = path.resolve(__dirname, '..', 'content', 'video-links.txt');

// content/video-links.txt : 한 줄에 영상 하나. "주소" 또는 "주소 | 제목 | 2026-01-31"(제목·날짜는 생략 가능)
function readLinks() {
  let txt = '';
  try { txt = fs.readFileSync(LINKS, 'utf8'); } catch (e) { return []; }
  const out = [];
  txt.split(/\r?\n/).forEach((line) => {
    line = line.trim();
    if (!line || line[0] === '#') return;
    const parts = line.split('|').map((x) => x.trim());
    const url = parts.shift();
    // 맨 끝 칸이 2026-01-31 같은 날짜면 날짜로, 나머지는 (제목 안에 | 가 있어도) 제목으로 씁니다.
    let date = '';
    if (parts.length && /^\d{4}-\d{2}-\d{2}$/.test(parts[parts.length - 1])) date = parts.pop();
    const title = parts.join(' | ');
    const m = String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
    if (m) out.push({ id: m[1], title: title || '', published: date });
  });
  return out;
}

async function oembedTitle(id) {
  try {
    const j = JSON.parse(await get('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id)));
    return String(j.title || '').trim();
  } catch (e) { return ''; }
}

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
  // 직접 적어 둔 예전 영상(content/video-links.txt)을 합칩니다. 채널 피드에 이미 있는 영상은 그쪽 정보를 우선합니다.
  const links = readLinks();
  if (links.length) {
    store.items = store.items || [];
    const have = new Map(store.items.map((v) => [v.id, v]));
    for (const l of links) {
      const cur = have.get(l.id);
      if (cur && cur.title && !cur.titleMissing) { if (!l.title || !cur.manual) continue; }
      let title = l.title || (cur && !cur.titleMissing && cur.title) || await oembedTitle(l.id);
      const item = Object.assign({}, cur || {}, { id: l.id, title: title || '권오경 원장 영상', published: (cur && cur.published) || l.published || '', manual: true });
      if (!title) item.titleMissing = true; else delete item.titleMissing;
      if (cur) Object.assign(cur, item); else { store.items.push(item); have.set(l.id, item); }
    }
    const rank = (v) => (v.published ? 0 : 1);
    store.items = store.items.map((v, i) => [v, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || (rank(a[0]) === 0 ? String(b[0].published).localeCompare(String(a[0].published)) : a[1] - b[1])).map((x) => x[0]);
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(store, null, 2) + '\n'); } catch (e) {}
    console.log('영상: 직접 적은 링크 ' + links.length + '개 반영');
  }
  return store;
}

module.exports = { main };
if (require.main === module) main();
