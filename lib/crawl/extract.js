import * as cheerio from 'cheerio';

// Extraction quality is the product: cheerio, not regexes, because real-world
// markup is messy. Lazy-loaded images hide in data-src and data-srcset, which
// most checkers never read.
const SKIP_SCHEME = /^(mailto|tel|javascript|data):/i;
const YOUTUBE_EMBED = /^(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\/([\w-]{11})/i;

function absolutize(href, pageUrl) {
  if (!href || SKIP_SCHEME.test(href) || href.startsWith('#')) return null;
  try {
    const u = new URL(href, pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function imgUrls($el) {
  const out = [];
  const src = $el.attr('src');
  const dataSrc = $el.attr('data-src');
  if (src) out.push(src);
  if (dataSrc && dataSrc !== src) out.push(dataSrc);
  const srcset = $el.attr('data-srcset') || $el.attr('srcset');
  if (srcset) {
    for (const part of srcset.split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u && u !== src && u !== dataSrc) out.push(u);
    }
  }
  return out;
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let m = (host + u.pathname).match(YOUTUBE_EMBED);
    if (!m && host === 'youtu.be') m = u.pathname.match(/^\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function extractTargets(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = new Map(); // url -> anchor (first context wins)
  const images = new Map(); // url -> alt
  const iframes = [];
  const embeds = [];

  $('a[href]').each((_, el) => {
    const $el = $(el);
    const url = absolutize($el.attr('href'), pageUrl);
    if (!url || links.has(url)) return;
    const anchor = $el.text().trim().slice(0, 200) || null;
    links.set(url, anchor);
  });

  $('img').each((_, el) => {
    const $el = $(el);
    const alt = ($el.attr('alt') || '').trim().slice(0, 200) || null;
    for (const raw of imgUrls($el)) {
      const url = absolutize(raw, pageUrl);
      if (url && !images.has(url)) images.set(url, alt);
    }
  });

  $('iframe[src], embed[src]').each((_, el) => {
    const $el = $(el);
    const url = absolutize($el.attr('src'), pageUrl);
    if (!url) return;
    const id = youtubeId(url);
    if (id) {
      embeds.push({ url, youtubeId: id });
    } else {
      iframes.push({ url });
    }
  });

  return {
    links: [...links].map(([url, anchor]) => ({ url, anchor })),
    images: [...images].map(([url, alt]) => ({ url, alt })),
    iframes,
    embeds,
  };
}
