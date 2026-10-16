import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, html, page, raw } from '../src/html.js';

test('escapeHtml ubeži vseh pet posebnih znakov in prenese prazne vrednosti', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
});

test('html ubeži vrednosti, gnezdene predloge in raw pa pusti', () => {
  const name = '<b>Ana</b>';
  assert.equal(html`<p>${name}</p>`.value, '<p>&lt;b&gt;Ana&lt;/b&gt;</p>');
  assert.equal(html`<ul>${['a', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`.value, '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(html`<p>${raw('<br>')}</p>`.value, '<p><br></p>');
  assert.equal(html`<p>${false}${null}${undefined}${''}</p>`.value, '<p></p>');
  assert.equal(html`${['<', html`<i>`]}`.value, '&lt;<i>');
});

test('page vrne celoten dokument v slovenščini z ubeženim naslovom', () => {
  const out = page({ title: 'A & B', body: html`<p>x</p>` });
  assert.match(out, /^<!doctype html>/);
  assert.match(out, /<html lang="sl">/);
  assert.match(out, /<title>A &amp; B · Popravni izpiti<\/title>/);
  assert.match(out, /<p>x<\/p>/);
});
