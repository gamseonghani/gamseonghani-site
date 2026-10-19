#!/usr/bin/env node
/*
 * 감성한의원 사이트 빌드 스크립트 (외부 패키지 없이 Node.js만 사용)
 *
 * content/columns.json 을 읽어서 아래를 만들어 둡니다.
 *   - column/<글주소>/index.html : 칼럼 한 편마다 본문이 들어 있는 정적 페이지
 *   - column/<글주소>/*.jpg      : 글에 들어 있던 base64 이미지를 파일로 분리
 *   - column.html 의 칼럼 카드(<a href>) 목록, index.html 의 최신 칼럼 2개
 *   - sitemap.xml, robots.txt
 *
 * Netlify 가 배포할 때마다(netlify.toml) 자동으로 실행되므로,
 * 관리자 페이지에서 글을 발행하면 페이지·목록·사이트맵이 함께 갱신됩니다.
 * 직접 실행: node scripts/build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { marked } = require('./vendor/marked.cjs');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://gamseonghani.com';
const SITE_NAME = '감성한의원';
const DEFAULT_AUTHOR = '권오경 원장';
const DEFAULT_OG_IMAGE = SITE + '/og-image.jpg';

const CATEGORY_LABELS = {
  philosophy: '원장 이야기',
  headache: '두통 · 어지러움',
  jaw: '턱관절',
  sensory: '감각기관 · 신경계',
  spine: '척추 · 근골격',
  ankle: '발목관절',
  internal: '내과 질환',
  pediatric: '소아 클리닉',
  special: '다이어트 클리닉'
};
const CATEGORY_ANCHOR = {
  philosophy: 'philosophy', headache: 'cat-headache', jaw: 'cat-jaw', sensory: 'cat-sensory',
  spine: 'cat-spine', ankle: 'cat-ankle', internal: 'cat-internal', pediatric: 'cat-pediatric',
  special: 'cat-special'
};
const CATEGORY_ICONS = {
  philosophy: '<path d="M4 19l3.5-1 10-10a2 2 0 0 0-3-3l-10 10L3 18l1 1z"/><path d="M14 6l3 3"/>',
  headache: '<rect x="4" y="5" width="16" height="14" rx="7"/><path d="M12 5v14"/><path d="M7 9c1 1.2 2 1.2 3 0M14 9c1 1.2 2 1.2 3 0M7 14c1 1.2 2 1.2 3 0M14 14c1 1.2 2 1.2 3 0"/>',
  jaw: '<circle cx="5" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><path d="M5 6.5v2c0 6 3.5 10 7 10s7-4 7-10v-2"/>',
  sensory: '<rect x="4" y="5" width="16" height="14" rx="7"/><path d="M12 5v14"/><path d="M7 9c1 1.2 2 1.2 3 0M14 9c1 1.2 2 1.2 3 0M7 14c1 1.2 2 1.2 3 0M14 14c1 1.2 2 1.2 3 0"/>',
  spine: '<path d="M12 2.5v19"/><path d="M7.5 6h9M7.5 10h9M7.5 14h9M7.5 18h9"/>',
  ankle: '<path d="M9 3v9l-4 4c-1 1-.5 3 1.5 3H18c1.5 0 2-1.5 1-2.5l-3.5-2.5V3"/><path d="M9 12h6"/>',
  internal: '<circle cx="12" cy="12" r="8"/><path d="M9 10c0 3 1 5 3 5s3-2 3-5"/>',
  pediatric: '<circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3-7 7-7s7 3 7 7"/>',
  special: '<path d="M12 21c-5-4-8-7.5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 3.5-3 7-8 11z"/>'
};
const STATIC_PAGES = ['index.html', 'accident.html', 'diet.html', 'pediatric.html', 'sports.html', 'column.html'];

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true }); fs.writeFileSync(path.join(ROOT, p), s); };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escXml = esc;

// 예전 사이트가 쓰던 글 주소 규칙(제목 기반)과 같게 유지합니다. 기존 링크가 그대로 이어집니다.
function slugify(title) {
  return String(title || '').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function dedupeSlugs(items) {
  const used = new Set();
  // 이미 slug 가 저장된 글을 먼저 확정하고, 없는 글은 제목으로 만들어 겹치지 않게 합니다.
  items.forEach((it) => { if (it.slug) { it.slug = slugify(it.slug) || ''; if (it.slug) used.add(it.slug); } });
  items.forEach((it, i) => {
    if (it.slug) return;
    let base = slugify(it.title) || ('column-' + (i + 1));
    let slug = base, n = 2;
    while (used.has(slug)) slug = base + '-' + (n++);
    it.slug = slug; used.add(slug);
  });
}

function sortedNewestFirst(items) {
  return items.map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const d = (b.item.date || '').localeCompare(a.item.date || '');
      return d !== 0 ? d : (b.i - a.i); // 날짜가 같으면 나중에 추가된 글이 먼저
    }).map((x) => x.item);
}

const MIME_EXT = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };
// base64 로 박혀 있는 이미지를 파일로 빼고 주소로 바꿉니다. 같은 이미지는 한 번만 저장합니다.
function extractImages(text, slug, prefix, outDir, counter) {
  return String(text || '').replace(/data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+\/=\s]+)/g, (m, type, b64) => {
    const buf = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
    const hash = crypto.createHash('md5').update(buf).digest('hex').slice(0, 8);
    const name = prefix + '-' + hash + '.' + MIME_EXT[type];
    fs.writeFileSync(path.join(outDir, name), buf);
    counter.n++;
    return '/column/' + encodeURIComponent(slug) + '/' + name;
  });
}

function plainText(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`|~-]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function readMinutes(md) { return Math.max(1, Math.ceil(plainText(md).length / 500)); }
function description(item) {
  const src = (item.metaDescription && item.metaDescription.trim()) || (item.teaser && item.teaser.trim()) || plainText(item.body);
  return src.length > 150 ? src.slice(0, 147).replace(/\s+\S*$/, '') + '...' : src;
}
const absUrl = (u) => (/^https?:/.test(u) ? u : SITE + (u.startsWith('/') ? '' : '/') + u);
const isoDate = (d) => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? d : null);

function cardHtml(item, thumbUrl) {
  const label = CATEGORY_LABELS[item.category] || item.category || '';
  const thumb = thumbUrl
    ? '<img src="' + esc(thumbUrl) + '" alt="" loading="lazy">'
    : '<svg viewBox="0 0 24 24">' + (CATEGORY_ICONS[item.category] || CATEGORY_ICONS.philosophy) + '</svg>';
  return '        <a class="column-card" href="/column/' + esc(encodeURIComponent(item.slug)) + '/" data-category="' + esc(item.category || '') + '">' +
    '<div class="thumb">' + thumb + '</div>' +
    '<div class="card-body"><span class="cat-tag">' + esc(label) + '</span><h3>' + esc(item.title) + '</h3>' +
    '<p class="meta">' + esc(item.author || DEFAULT_AUTHOR) + '<span class="dot">·</span>' + esc(item.date || '') + '</p></div></a>';
}

function replaceBetween(src, startMark, endMark, inner) {
  const a = src.indexOf(startMark), b = src.indexOf(endMark);
  if (a < 0 || b < 0 || b < a) throw new Error('표시(' + startMark + ')를 찾지 못했습니다.');
  return src.slice(0, a + startMark.length) + '\n' + inner + '\n' + src.slice(b);
}

function main() {
  const data = JSON.parse(read('content/columns.json'));
  const items = Array.isArray(data.items) ? data.items : [];
  dedupeSlugs(items);

  // 템플릿: 현재 column.html 에서 머리말/헤더/스타일/오른쪽 아이콘을 그대로 가져옵니다.
  const listSrc = read('column.html');
  const articleSection = read('scripts/article-section.html');

  // 이전에 만든 글 페이지는 모두 지우고 새로 만듭니다(삭제한 글이 남지 않도록).
  fs.rmSync(path.join(ROOT, 'column'), { recursive: true, force: true });

  const imgCounter = { n: 0 };
  const thumbUrls = {};
  const bodies = {};
  items.forEach((item) => {
    const dir = path.join(ROOT, 'column', item.slug);
    fs.mkdirSync(dir, { recursive: true });
    thumbUrls[item.slug] = item.thumbnail ? extractImages(item.thumbnail, item.slug, 'thumb', dir, imgCounter) : null;
    bodies[item.slug] = extractImages(item.body, item.slug, 'img', dir, imgCounter);
  });

  const newest = sortedNewestFirst(items);

  // ---- 칼럼 목록(column.html) 과 홈페이지 최신 칼럼 ----
  const cards = newest.map((it) => cardHtml(it, thumbUrls[it.slug])).join('\n');
  write('column.html', replaceBetween(listSrc, '<!--CARDS_START-->', '<!--CARDS_END-->', cards));

  const teasers = newest.slice(0, 2).map((it) =>
    '        <a class="column-teaser" href="/column/' + esc(encodeURIComponent(it.slug)) + '/">' +
    '<span class="cat-tag">' + esc(CATEGORY_LABELS[it.category] || it.category || '') + '</span>' +
    '<h3>' + esc(it.title) + '</h3><p>' + esc(it.teaser || description(it)) + '</p></a>').join('\n');
  write('index.html', replaceBetween(read('index.html'), '<!--TEASERS_START-->', '<!--TEASERS_END-->', teasers));

  // ---- 글별 페이지 ----
  // 템플릿의 상대 주소(index.html 등)는 /column/글주소/ 안에서도 동작하도록 / 로 시작하게 바꿉니다.
  const rootRel = (html) => html.replace(/\b(href|src)="(?!https?:|\/\/|#|\/|tel:|mailto:|data:|javascript:)([^"]+)"/g, '$1="/$2"');
  const css = (html) => html.replace(/\.page-hero h1/g, '.page-hero h1, .page-hero .hero-h1');

  let tpl = css(rootRel(listSrc));
  // head: 제목~트위터 이미지 메타를 글별 정보로 교체할 자리
  const headRe = /<title>[\s\S]*?<meta name="twitter:image"[^>]*>/;
  if (!headRe.test(tpl)) throw new Error('column.html 의 head 형식이 바뀌어 글 페이지를 만들 수 없습니다.');
  // 본문 영역: 목록 섹션 전체를 글 섹션으로 교체
  const secRe = /<section class="column-list">[\s\S]*?<\/section>/;
  if (!secRe.test(tpl)) throw new Error('column.html 의 목록 영역을 찾지 못했습니다.');
  // 히어로(목록 페이지용 큰 제목)는 글 페이지에서는 빼고, 글 제목이 유일한 h1 이 되게 합니다.
  tpl = tpl.replace(/<section class="page-hero">[\s\S]*?<\/section>\s*/, '');
  tpl = tpl.replace('<main>', '<main class="article-page">');
  // 스크립트: 목록 전용 코드는 빼고 공통(헤더·검색·진료중 표시)만 남깁니다.
  const sA = tpl.lastIndexOf('<script>');
  const cut = tpl.indexOf('  // 칼럼 카드는 배포할 때', sA);
  if (sA < 0 || cut < 0) throw new Error('column.html 의 스크립트 구조가 바뀌었습니다.');
  tpl = tpl.slice(0, cut) + '</script>\n\n</body>\n</html>\n';

  let pageCount = 0;
  items.forEach((item) => {
    const slug = item.slug;
    const url = SITE + '/column/' + encodeURIComponent(slug) + '/';
    const label = CATEGORY_LABELS[item.category] || item.category || '';
    const author = item.author || DEFAULT_AUTHOR;
    const desc = description(item);
    const title = item.title + ' | ' + SITE_NAME;
    const img = thumbUrls[slug] ? absUrl(thumbUrls[slug]) : DEFAULT_OG_IMAGE;
    const published = isoDate(item.date);
    const modified = isoDate(item.modified) || published;
    // 본문의 "4~13명" 같은 물결표가 취소선으로 바뀌지 않도록, 한 개짜리 ~ 는 글자 그대로 보이게 합니다.
    const bodyHtml = marked.parse((bodies[slug] || '').replace(/(?<!~)~(?!~)/g, '\\~'));
    const dates = esc(item.date || '') + (item.modified && item.modified !== item.date ? ' · 수정 ' + esc(item.modified) : '');
    const meta = esc(author) + ' · ' + dates + ' · 약 ' + readMinutes(item.body) + '분 읽기';

    const ld = [{
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: item.title, description: desc, image: [img],
      datePublished: published || undefined, dateModified: modified || undefined,
      author: { '@type': 'Person', name: author },
      publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE + '/' },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      inLanguage: 'ko-KR',
      keywords: Array.isArray(item.tags) && item.tags.length ? item.tags.join(', ') : undefined
    }, {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '홈', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: '원장칼럼', item: SITE + '/column.html' },
        { '@type': 'ListItem', position: 3, name: item.title, item: url }
      ]
    }];
    const head =
      '<title>' + esc(title) + '</title>\n' +
      '<meta name="description" content="' + esc(desc) + '">\n' +
      (Array.isArray(item.tags) && item.tags.length ? '<meta name="keywords" content="' + esc(item.tags.join(', ')) + '">\n' : '') +
      '<link rel="canonical" href="' + esc(url) + '">\n' +
      '<meta property="og:type" content="article">\n' +
      '<meta property="og:site_name" content="' + SITE_NAME + '">\n' +
      '<meta property="og:title" content="' + esc(item.title) + '">\n' +
      '<meta property="og:description" content="' + esc(desc) + '">\n' +
      '<meta property="og:image" content="' + esc(img) + '">\n' +
      '<meta property="og:url" content="' + esc(url) + '">\n' +
      (published ? '<meta property="article:published_time" content="' + published + '">\n' : '') +
      (modified ? '<meta property="article:modified_time" content="' + modified + '">\n' : '') +
      '<meta property="article:author" content="' + esc(author) + '">\n' +
      '<meta name="twitter:card" content="summary_large_image">\n' +
      '<meta name="twitter:title" content="' + esc(item.title) + '">\n' +
      '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
      '<meta name="twitter:image" content="' + esc(img) + '">\n' +
      ld.map((o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>').join('\n');

    const anchor = CATEGORY_ANCHOR[item.category];
    const tags = Array.isArray(item.tags) && item.tags.length
      ? '<div class="article-tags">' + item.tags.map((t) => '<span class="tag">#' + esc(t) + '</span>').join('') + '</div>' : '';
    const sameCat = sortedNewestFirst(items).filter((x) => x.slug !== slug && x.category === item.category).slice(0, 4);
    const more = sameCat.length
      ? '<section class="related-posts"><h2>' + esc(label) + ' 다른 칼럼</h2><ul>' +
        sameCat.map((x) => '<li><a href="/column/' + esc(encodeURIComponent(x.slug)) + '/">' + esc(x.title) + '</a></li>').join('') +
        '</ul></section>' : '';

    const section = '<section class="column-list">\n    <div class="wrap">\n      ' + articleSection
      .replace('{{CAT}}', esc(label)).replace('{{TITLE}}', esc(item.title)).replace('{{META}}', meta)
      .replace('{{BODY}}', () => bodyHtml).replace('{{AUTHOR}}', esc(author))
      .replace('{{RELATED_OPEN}}', anchor ? '<div class="side-card" id="relatedCard">' : '<div class="side-card" id="relatedCard" hidden>')
      .replace('{{RELATED_HREF}}', anchor ? '/index.html#' + anchor : '/index.html')
      .replace('{{RELATED_TEXT}}', anchor ? esc(label) + ' 안내 보기 →' : '')
      .replace('{{TAGS}}', tags).replace('{{MORE}}', more) +
      '\n    </div>\n  </section>';

    let html = tpl.replace(headRe, () => head).replace(secRe, () => rootRel(section));
    write('column/' + slug + '/index.html', html);
    pageCount++;
  });

  // ---- 사이트맵 / robots ----
  const urls = [];
  STATIC_PAGES.forEach((p) => {
    if (!fs.existsSync(path.join(ROOT, p))) return;
    const loc = p === 'index.html' ? SITE + '/' : SITE + '/' + p;
    const last = p === 'column.html' && newest.length ? (isoDate(newest[0].modified) || isoDate(newest[0].date)) : null;
    urls.push({ loc, lastmod: last });
  });
  newest.forEach((it) => urls.push({ loc: SITE + '/column/' + encodeURIComponent(it.slug) + '/', lastmod: isoDate(it.modified) || isoDate(it.date) }));
  write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + escXml(u.loc) + '</loc>' + (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '</url>').join('\n') +
    '\n</urlset>\n');
  write('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE + '/sitemap.xml\n');

  console.log('칼럼 페이지 ' + pageCount + '개, 이미지 ' + imgCounter.n + '개, 사이트맵 URL ' + urls.length + '개 생성');
}

main();
