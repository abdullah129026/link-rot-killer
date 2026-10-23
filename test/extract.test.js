import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTargets } from '../lib/crawl/extract.js';

const HTML = `
<html><body>
  <a href="/about">About <b>us</b></a>
  <a href="mailto:hi@x.com">mail</a>
  <a href="javascript:void(0)">js</a>
  <a href="#frag">frag</a>
  <img src="/img/a.png" alt="logo">
  <img data-src="/img/lazy.png" alt="lazy image">
  <img src="/img/s.png" data-srcset="/img/s1.png 1x, /img/s2.png 2x" alt="">
  <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
  <iframe src="https://player.vimeo.com/video/123"></iframe>
  <embed src="https://www.youtube-nocookie.com/embed/9bZkp7q19f0">
</body></html>`;

test('extracts links with anchor text, skips dead schemes', () => {
  const { links } = extractTargets(HTML, 'https://example.com/page');
  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://example.com/about');
  assert.equal(links[0].anchor, 'About us');
});

test('reads data-src and data-srcset, keeps alt context', () => {
  const { images } = extractTargets(HTML, 'https://example.com/');
  const urls = images.map((i) => i.url).sort();
  assert.deepEqual(urls, [
    'https://example.com/img/a.png',
    'https://example.com/img/lazy.png',
    'https://example.com/img/s.png',
    'https://example.com/img/s1.png',
    'https://example.com/img/s2.png',
  ]);
  const byUrl = new Map(images.map((i) => [i.url, i.alt]));
  assert.equal(byUrl.get('https://example.com/img/a.png'), 'logo');
  assert.equal(byUrl.get('https://example.com/img/lazy.png'), 'lazy image');
});

test('pulls youtube ids from embeds and iframes', () => {
  const { iframes, embeds } = extractTargets(HTML, 'https://example.com/');
  assert.equal(iframes.length, 1);
  assert.equal(iframes[0].url, 'https://player.vimeo.com/video/123');
  assert.equal(embeds.length, 2);
  const ids = embeds.map((e) => e.youtubeId).sort();
  assert.deepEqual(ids, ['9bZkp7q19f0', 'dQw4w9WgXcQ']);
});

test('dedupes the same url on one page', () => {
  const { links } = extractTargets('<a href="/a">one</a><a href="/a">two</a>', 'https://example.com/');
  assert.equal(links.length, 1);
  assert.equal(links[0].anchor, 'one');
});
