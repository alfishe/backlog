#!/usr/bin/env node
/**
 * bundle.js — Flatten an HTML app and all its local deps into a single
 * self-contained .html artifact, ready to open offline.
 *
 * What it does:
 *   - Inlines every local <script src> and <link rel="stylesheet" href>.
 *   - Pre-compiles JSX (type="text/babel") to plain JS using @babel/core,
 *     then removes the Babel CDN <script> tag — it's no longer needed.
 *   - Replaces React/ReactDOM dev CDN builds with production minified builds
 *     (much smaller; fetched once per run).
 *   - Skips anything inside HTML comments — commented-out blocks stay inert.
 *   - Leaves other remote URLs (fonts, etc.) untouched.
 *
 * Usage:
 *   node bundle.js <input.html> [output.html]
 *
 * Example:
 *   node bundle.js index.html ../webapp/index-style-v2.html
 *
 * Requirements:
 *   Node 18+ (uses global fetch to pull prod React builds).
 *   Run `npm install` once to get @babel/core + @babel/preset-react.
 */

const fs   = require('fs');
const path = require('path');

// JSX compiler — graceful no-op if not installed.
// Require the preset as a module reference so Babel doesn't try to resolve it
// by name from cwd (which may differ from __dirname when invoked from another dir).
let babel, babelPresetReact;
try {
  babel           = require('@babel/core');
  babelPresetReact = require('@babel/preset-react');
} catch { /* npm install to enable */ }

// ---- CDN substitution table -------------------------------------------------
// key: substring present in the CDN src URL
// value: prod URL to fetch & inline, or null to remove the tag entirely
const CDN_SWAP = [
  { match: 'unpkg.com/react-dom@',       prod: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js' },
  { match: 'unpkg.com/react@',           prod: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js' },
  { match: 'unpkg.com/@babel/standalone', prod: null },  // removed — we pre-compile
];
// react-dom must come before react in the list so substring matching works correctly
// (react-dom URL also contains "react@")

// ---- Helpers -----------------------------------------------------------------
const args       = process.argv.slice(2).filter(a => !a.startsWith('--'));

if (args.length < 1) {
  console.error('Usage: node bundle.js <input.html> [output.html]');
  process.exit(1);
}

const inputPath  = args[0];
const inputDir   = path.dirname(path.resolve(inputPath));
const inputBase  = path.basename(inputPath, '.html');
const outputPath = args[1] || path.join(inputDir, `${inputBase} (single file).html`);

function isRemote(url) { return /^(https?:)?\/\//i.test(url) || url.startsWith('data:'); }

function readLocal(ref) {
  const full = path.resolve(inputDir, ref);
  if (!fs.existsSync(full)) { console.warn(`  ⚠ missing: ${ref}`); return null; }
  return fs.readFileSync(full, 'utf8');
}

async function fetchRemote(url) {
  console.log(`  ⤓ fetching ${url}`);
  const r = await fetch(url);
  if (!r.ok) { console.warn(`  ⚠ ${r.status} ${url}`); return null; }
  return r.text();
}

// Returns [start, end] pairs for every <!-- ... --> span in html.
function commentSpans(html) {
  const spans = [];
  const re = /<!--[\s\S]*?-->/g;
  let m;
  while ((m = re.exec(html)) !== null) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function insideComment(pos, spans) {
  return spans.some(([s, e]) => pos >= s && pos < e);
}

// Escape </script inside a <script> block so the browser doesn't close it early.
function escForScript(src) { return src.replace(/<\/script/gi, '<\\/script'); }
function escForStyle(src)  { return src.replace(/<\/style/gi,  '<\\/style');  }

// Pre-compile JSX → JS. Falls back to raw source if babel isn't installed.
function compileJSX(src, filename) {
  if (!babel || !babelPresetReact) return { code: src, compiled: false };
  try {
    const result = babel.transformSync(src, {
      presets: [babelPresetReact],
      filename,
      sourceMaps: false,
      compact: false,
    });
    return { code: result.code, compiled: true };
  } catch (e) {
    console.warn(`  ⚠ JSX compile error in ${filename}: ${e.message}`);
    return { code: src, compiled: false };
  }
}

// ---- Inline local stylesheets -----------------------------------------------
async function inlineStylesheets(html) {
  const comments = commentSpans(html);
  const re = /<link\b([^>]*?)\brel\s*=\s*["']stylesheet["']([^>]*?)>/gi;
  const matches = [...html.matchAll(re)];
  let out = '', cursor = 0;
  for (const m of matches) {
    if (insideComment(m.index, comments)) {
      out += html.slice(cursor, m.index + m[0].length);
      cursor = m.index + m[0].length;
      continue;
    }
    out += html.slice(cursor, m.index);
    const hrefM = (m[1] + ' ' + m[2]).match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const href  = hrefM?.[1];
    const body  = href && !isRemote(href) ? readLocal(href) : null;
    if (body) { console.log(`  ✓ stylesheet ${href}`); out += `<style>\n${escForStyle(body)}\n</style>`; }
    else        out += m[0];
    cursor = m.index + m[0].length;
  }
  return out + html.slice(cursor);
}

// ---- Inline / swap / remove <script src="..."> tags -------------------------
async function inlineScripts(html) {
  const comments = commentSpans(html);
  const re = /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi;
  const matches = [...html.matchAll(re)];
  let out = '', cursor = 0;

  for (const m of matches) {
    // Keep everything inside HTML comments verbatim.
    if (insideComment(m.index, comments)) {
      out += html.slice(cursor, m.index + m[0].length);
      cursor = m.index + m[0].length;
      continue;
    }

    out += html.slice(cursor, m.index);
    const [full, attrsBefore, src, attrsAfter] = m;
    const allAttrs = (attrsBefore + ' ' + attrsAfter).trim();
    const isBabel  = /type\s*=\s*["']text\/babel["']/i.test(allAttrs);

    if (isRemote(src)) {
      // Look for a CDN substitution rule.
      const rule = CDN_SWAP.find(r => src.includes(r.match));
      if (rule === undefined) {
        out += full; // unknown CDN — keep as-is
      } else if (rule.prod === null) {
        console.log(`  ✗ removed ${src}`);
        // tag dropped
      } else {
        const body = await fetchRemote(rule.prod);
        if (body) { console.log(`  ✓ inlined prod build`); out += `<script>\n${escForScript(body)}\n</script>`; }
        else         out += full;
      }
    } else {
      // Local file.
      let body = readLocal(src);
      if (body == null) { out += full; }
      else {
        let label = src;
        if (isBabel) {
          const r = compileJSX(body, src);
          body  = r.code;
          label = r.compiled ? `${src} (JSX→JS)` : src;
        }
        console.log(`  ✓ script ${label}`);
        // Strip type="text/babel", integrity, crossorigin — content has changed.
        const attrs = allAttrs
          .replace(/\btype\s*=\s*["']text\/babel["']/gi, '')
          .replace(/\bintegrity\s*=\s*["'][^"']*["']/gi, '')
          .replace(/\bcrossorigin\s*=\s*["'][^"']*["']/gi, '')
          .replace(/\s+/g, ' ').trim();
        out += `<script${attrs ? ' ' + attrs : ''}>\n${escForScript(body)}\n</script>`;
      }
    }
    cursor = m.index + full.length;
  }
  return out + html.slice(cursor);
}

// ---- Compile remaining inline <script type="text/babel">…</script> blocks ---
function compileInlineBabel(html) {
  const comments = commentSpans(html);
  const re = /(<script\b[^>]*\btype\s*=\s*["']text\/babel["'][^>]*>)([\s\S]*?)(<\/script>)/gi;
  return html.replace(re, (full, open, body, close, offset) => {
    if (insideComment(offset, comments)) return full;
    const { code, compiled } = compileJSX(body, 'inline.jsx');
    if (!compiled) return full;
    const attrs = open
      .replace(/^<script\b/i, '')
      .replace(/>$/, '')
      .replace(/\btype\s*=\s*["']text\/babel["']/gi, '')
      .replace(/\s+/g, ' ').trim();
    console.log('  ✓ inline babel block compiled');
    return `<script${attrs ? ' ' + attrs : ''}>\n${escForScript(code)}\n${close}`;
  });
}

// ---- Main -------------------------------------------------------------------
(async () => {
  if (babel && babelPresetReact) console.log('JSX: pre-compile enabled (@babel/core)');
  else                          console.log('JSX: no @babel/core — run npm install to enable');

  console.log(`\nReading ${inputPath}…`);
  let html = fs.readFileSync(inputPath, 'utf8');

  console.log('\nStylesheets:');
  html = await inlineStylesheets(html);

  console.log('\nScripts:');
  html = await inlineScripts(html);

  if (babel) {
    console.log('\nInline Babel blocks:');
    html = compileInlineBabel(html);
  }

  fs.writeFileSync(outputPath, html);
  const kb = (fs.statSync(outputPath).size / 1024).toFixed(0);
  console.log(`\n✔ wrote ${outputPath} (${kb} KB)`);
})();
