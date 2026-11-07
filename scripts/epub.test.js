'use strict';

// The EPUB's semantics from app.js, run on their own: what each section is
// called for reading apps (epub:type) and for screen readers (DPUB-ARIA),
// and the accessibility metadata. The whole export runs in Electron.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- EPUB semantics:');
const to = app.indexOf('// ---- end of EPUB semantics ----');
const kinds = /const CHAPTER_KINDS = (\[[^\]]*\]);/.exec(app)[1];
// the export's own escaping, as app.js has it
const escXmlSrc = /const escXml = [\s\S]*?;\n/.exec(app)[0];
const context = vm.createContext({
  t: (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o && k in o ? o[k] : m)),
  escXml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
});
vm.runInContext(escXmlSrc.replace('const escXml', 'var escXmlReal') + app.slice(from, to) + `\nthis.api = { escXmlReal, EPUB_SEMANTICS, epubSemantics, epubSectionOpen, epubA11yMeta, epubTitleMeta, EPUB_STYLESHEETS, EPUB_CSS_LINKS, epubMatter, epubHeadingRank, CHAPTER_KINDS: ${kinds} };`, context);
const epub = context.api;
const blitzFile = () => fs.readFileSync(path.join(__dirname, '..', 'epub', 'blitz', 'blitz-lite.css'), 'utf8');
const neoFile = () => fs.readFileSync(path.join(__dirname, '..', 'epub', 'neo.css'), 'utf8');
const bothCss = () => blitzFile() + '\n' + neoFile();

// the roles DPUB-ARIA 1.1 has, and the epub:type terms these sections use
// from the EPUB 3 Structural Semantics Vocabulary
const DPUB_ROLES = ['doc-acknowledgments', 'doc-chapter', 'doc-dedication', 'doc-epigraph', 'doc-epilogue', 'doc-part', 'doc-prologue'];
const SSV = ['acknowledgments', 'backmatter', 'chapter', 'copyright-page', 'dedication', 'epigraph', 'epilogue', 'part', 'prologue', 'volume'];

test('every kind of section a book can export has semantics', () => {
  // a Contents page isn't exported: the EPUB has its own table of contents
  for (const kind of epub.CHAPTER_KINDS.filter((k) => k !== 'contents')) {
    assert.ok(epub.EPUB_SEMANTICS[kind], kind);
  }
  assert.ok(epub.EPUB_SEMANTICS.opener, 'a book’s own first page in a bound shelf');
});

test('every epub:type is a Structural Semantics term, every role a DPUB-ARIA one', () => {
  for (const [kind, sem] of Object.entries(epub.EPUB_SEMANTICS)) {
    assert.ok(SSV.includes(sem.type), `${kind}: ${sem.type}`);
    assert.ok(sem.role === '' || DPUB_ROLES.includes(sem.role), `${kind}: ${sem.role}`);
  }
});

test('a prologue or epilogue is a chapter whose role says which', () => {
  assert.equal(epub.epubSemantics({ kind: 'chapter', role: 'prologue' }).role, 'doc-prologue');
  assert.equal(epub.epubSemantics({ kind: 'chapter', role: 'epilogue' }).type, 'epilogue');
  assert.equal(epub.epubSemantics({ kind: 'chapter', role: '' }).role, 'doc-chapter');
  assert.equal(epub.epubSemantics({}).type, 'chapter', 'no kind: a chapter');
});

test('a section is named by its heading, or by a label when it has none', () => {
  assert.equal(epub.epubSectionOpen({ kind: 'chapter' }, { headingId: 'h3' }),
    '<section epub:type="chapter" role="doc-chapter" aria-labelledby="h3">');
  assert.equal(epub.epubSectionOpen({ kind: 'dedication' }, { cls: 'dedication', label: 'Dedication' }),
    '<section epub:type="dedication" role="doc-dedication" class="dedication" aria-label="Dedication">');
  // no DPUB-ARIA role for a copyright page: its epub:type and its name only
  assert.equal(epub.epubSectionOpen({ kind: 'copyright' }, { label: 'Copyright' }),
    '<section epub:type="copyright-page" aria-label="Copyright">');
  assert.equal(epub.epubSectionOpen({ kind: 'chapter' }, { label: 'Tom & "Jerry"' }),
    '<section epub:type="chapter" role="doc-chapter" aria-label="Tom &amp; &quot;Jerry&quot;">', 'a label is escaped');
});

test('the accessibility metadata: what every NEO book is, and no conformance claim', () => {
  const meta = epub.epubA11yMeta();
  const props = [...meta.matchAll(/<meta property="schema:(\w+)">([^<]*)<\/meta>/g)].map((m) => m[1] + '=' + m[2]);
  for (const want of ['accessMode=textual', 'accessModeSufficient=textual', 'accessibilityFeature=structuralNavigation',
    'accessibilityFeature=tableOfContents', 'accessibilityFeature=readingOrder', 'accessibilityFeature=ARIA',
    'accessibilityFeature=unlocked', 'accessibilityHazard=none']) {
    assert.ok(props.includes(want), want);
  }
  assert.ok(props.some((p) => p.startsWith('accessibilitySummary=') && p.length > 40));
  assert.equal(meta.split('\n').length, props.length, 'one meta per line, nothing else');
  assert.ok(!meta.includes('conformsTo'));
  assert.ok(!meta.includes('printPageNumbers'), 'an EPUB has no print page numbers yet');
});

test('content.opf’s title and author: title-types, the author’s role, the rights only from a copyright page', () => {
  const meta = epub.epubTitleMeta({ title: 'Wool & Shift', subtitle: 'Silo Stories', author: 'Hugh Howey' });
  assert.equal(meta, [
    '<dc:title id="title">Wool &amp; Shift</dc:title>',
    '<meta refines="#title" property="title-type">main</meta>',
    '<dc:title id="subtitle">Silo Stories</dc:title>',
    '<meta refines="#subtitle" property="title-type">subtitle</meta>',
    '<dc:creator id="creator">Hugh Howey</dc:creator>',
    '<meta refines="#creator" property="role" scheme="marc:relators">aut</meta>'
  ].join('\n'), 'no copyright page, no rights');
  const plain = epub.epubTitleMeta({ title: 'Wool', subtitle: '  ', author: 'Anonymous' });
  assert.ok(!plain.includes('subtitle'), 'no subtitle, no second title');
  assert.ok(plain.includes('<dc:title id="title">Wool</dc:title>'));
  const own = epub.epubTitleMeta({ title: 'Wool', author: 'Hugh Howey', sections: [
    { kind: 'chapter', paras: [{ text: 'Holston climbed.' }] },
    { kind: 'copyright', paras: [{ text: '  ' }, { text: 'Copyright © 2011 Hugh Howey' }, { text: 'All rights reserved.' }] }
  ] });
  assert.ok(own.endsWith('<dc:rights>Copyright © 2011 Hugh Howey</dc:rights>'), 'the page’s first line');
});

// The EPUB carries Blitz and NEO's rules as two files, linked from every
// page in that order. Where two rules are equally specific the later sheet
// wins, so NEO's rules override Blitz's without Blitz being edited (it stays
// the upstream file, easy to update). A byte-order mark or Windows line ends
// are what a copy taken from another tool brings in (the copy in DAISY's
// installer had both), so the check keeps the files as Blitz releases them.
test('the two stylesheets: Blitz linked first, so NEO’s rules win; both go in as they are, with no BOM or Windows line ends', () => {
  assert.deepEqual([...epub.EPUB_STYLESHEETS], ['blitz-lite.css', 'neo.css']);
  assert.ok(epub.EPUB_CSS_LINKS.indexOf('href="blitz-lite.css"') < epub.EPUB_CSS_LINKS.indexOf('href="neo.css"'));
  for (const css of [blitzFile(), neoFile()]) assert.ok(!css.includes('\r') && !css.startsWith('\uFEFF'));
});

// epub/blitz/ is Blitz lite as released (github.com/FriendsOfEpub/Blitz,
// 1.5.2, MIT), with its LICENSE, so a future update is a file swap; every
// change goes in neo.css. An @import would fetch a file the book may not
// hold, and reading apps differ on whether they follow one.
test('the files the EPUB is built from: Blitz lite untouched, NEO’s rules importing nothing', () => {
  const blitz = blitzFile();
  const neo = neoFile();
  assert.match(blitz, /Version 1\.5\.2 by Jiminy Panoz/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'epub', 'blitz', 'LICENSE')));
  assert.ok(!/@import/.test(neo), 'everything a book needs is in its two files');
  // braces balance: a stray one would drop every rule after it on some readers
  const bare = neo.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((bare.match(/\{/g) || []).length, (bare.match(/\}/g) || []).length);
});


// Adobe's reading engine (RMSDK: Adobe Digital Editions, and the engine
// Kobo uses for plain EPUB) discards the *whole* stylesheet when it meets a
// CSS value function it doesn't know: calc(), min(), max(), clamp(), var(),
// env(). A browser drops just that declaration; RMSDK drops every rule, so a
// book opens unstyled, or not at all, and EPUBCheck still passes it. A
// fallback declaration in front doesn't help: it goes with the rest.
// Custom properties (--x) go the same way. Sources: Readium CSS's notes on
// legacy reading systems (readium.org/css/docs/CSS21-epub_compat.html), and
// a 2026 case where one max-width: min(…) kept a book from opening in ADE
// (gigazine.net/gsc_news/en/20260616-epub-kobo-adobe). So NEO's EPUB
// stylesheet uses plain values only. (Unknown *properties*, like
// adobe-hyphenate or -webkit-hyphenate-limit-before, are skipped one by one
// and are safe; Blitz, which supports RMSDK, uses them.)
test('the EPUB stylesheet has no CSS value functions or custom properties, which make RMSDK drop it whole', () => {
  const bare = bothCss().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(bare.match(/\b(calc|min|max|clamp|var|env)\s*\(/gi) || [], []);
  assert.deepEqual(bare.match(/(^|[;{\s])--[\w-]+\s*:/g) || [], []);
});

// Kindle ignores max-width and max-height: Amazon's Kindle Publishing
// Guidelines (version 2026.3, the CSS support table) list both as "No" on
// KF8 devices and apps. A size that rests on them is no size at all on a
// Kindle, so NEO's own rules size things with width and height, in % or em
// (Amazon: "a percentage value for the width" of block images). Blitz's
// img { max-width: 100% } stays: it's vendored, and it only adds a limit
// other readers use; Kindle fits images to its screen itself.
test('NEO’s EPUB rules use no max-width or max-height, which Kindle ignores', () => {
  const neo = fs.readFileSync(path.join(__dirname, '..', 'epub', 'neo.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(neo.match(/max-(width|height)\s*:[^;}]*/g) || [], []);
});

const neoCss = () => fs.readFileSync(path.join(__dirname, '..', 'epub', 'neo.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Kindle ignores the sibling combinators (E + F, E ~ F), the structural
// pseudo-classes (:first-child, :last-child, :nth-child, :only-child,
// :first-of-type …) and the pseudo-elements ::before, ::after,
// ::first-letter, ::first-line: Kindle Publishing Guidelines 2026.3, §19.2,
// the selector rows, every one "No". A rule written with them does nothing
// on a Kindle, silently. So NEO's rules style by class, and the export sets
// the class (.first, .stanza, .after-verse) where a selector would have
// found the element. (Blitz's own body > :last-child stays: it's vendored,
// and only trims a margin.)
test('NEO’s EPUB rules use no sibling selectors, structural pseudo-classes or pseudo-elements, which Kindle ignores', () => {
  const css = neoCss();
  const selectors = css.replace(/\{[^}]*\}/g, ',');
  assert.deepEqual(selectors.match(/[+~]/g) || [], [], 'no + or ~ combinator');
  assert.deepEqual(selectors.match(/:(first|last|nth|only)[\w-]*/g) || [], [], 'no structural pseudo-class');
  assert.deepEqual(selectors.match(/::?(before|after|first-letter|first-line)\b/g) || [], [], 'no pseudo-element');
});

// Barnes & Noble's older Nooks ignore the CSS shorthands for margin, and by
// some accounts for padding. A rule like
//     h1 { margin: 3em 0 2em; }
// does nothing at all on such a Nook, while the same thing written side by
// side,
//     h1 { margin-top: 3em; margin-right: 0; margin-bottom: 2em; margin-left: 0; }
// works. So on those readers every heading, scene break and poetry indent
// set with the shorthand loses its spacing, silently.
//   Source: MobileRead forum reports from 2013 to 2015, chiefly about the
// Nook Simple Touch ("Nook devices have an old bug and ignore the shorthand
// CSS margin rule"; users expand margin into margin-top, margin-left and so
// on, or let Calibre's "expand CSS" do it): mobileread.com/forums/
// showthread.php?p=3143027. Some tie it to the Nook's "publisher defaults"
// setting. There is no Barnes & Noble document, and nobody says which models
// or software versions are affected, so treat it as likely, not certain.
//   Why bother: the longhands mean exactly the same everywhere else, cost
// nothing, and Kindle's own guidelines write them out too. NEO's rules
// therefore never use the margin, padding or border shorthands (border's
// only to keep one habit; no reader is reported to mishandle it).
//   Blitz's reset (margin: 0 on every block) stays a shorthand: Blitz is
// vendored and never edited, and on such a Nook the default margins it
// fails to reset are harmless.
test('NEO’s EPUB rules write margins, padding and borders side by side, never as the shorthand', () => {
  assert.deepEqual(neoCss().match(/(^|[\s{;])(margin|padding|border(-(top|right|bottom|left))?)\s*:/gm) || [], []);
});

// text-align: left is only a fallback. start is the side a line begins on (the
// right in Arabic or Hebrew), so each left must be followed by start in the
// same rule; an older reading app that doesn't know start drops just that
// declaration and keeps the left before it. right has the same problem in
// reverse, but NEO's right means "aligned right" on purpose, so it's left alone.
test('NEO’s EPUB rules follow every text-align: left with text-align: start', () => {
  const css = neoCss();
  assert.ok(css.includes('text-align: start'));
  assert.deepEqual(css.match(/text-align:\s*left;(?!\s*text-align:\s*start)/g) || [], []);
});

test('the stylesheets: an @charset only at the top of its file; no rem; viewport units only inside @supports', () => {
  for (const f of [blitzFile(), neoFile()]) {
    const n = (f.match(/@charset/g) || []).length;
    assert.ok(n === 0 || (n === 1 && f.startsWith('@charset')));
  }
  const css = bothCss();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // rem is relative to the root's font size, which some reading apps set
  // themselves; em follows the text the reader chose
  assert.deepEqual(bare.match(/\d(\.\d+)?rem\b/g) || [], []);
  // vh and vw size against the screen, not the page: older readers (some
  // Kobo firmware, ADE) mishandle or ignore them, and Blitz itself only uses
  // them inside @supports, which those readers skip; NEO does the same
  const outside = bare.replace(/@supports[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.deepEqual(outside.match(/\d(\.\d+)?(d|s|l)?v[hw]\b/g) || [], []);
});

test('which part of the book each page is in: front, body or back matter', () => {
  const m = (kind, role) => epub.epubMatter({ kind, role });
  for (const k of ['copyright', 'dedication', 'epigraph']) assert.equal(m(k), 'frontmatter', k);
  for (const k of ['chapter', 'unnumbered', 'part', 'opener']) assert.equal(m(k), 'bodymatter', k);
  assert.equal(m('chapter', 'prologue'), 'bodymatter', 'a prologue is the story');
  assert.equal(m('chapter', 'epilogue'), 'bodymatter', 'so is an epilogue');
  for (const k of ['acknowledgments', 'about']) assert.equal(m(k), 'backmatter', k);
  assert.equal(epub.epubMatter({}), 'bodymatter');
  // every kind a book can export has a place
  for (const k of epub.CHAPTER_KINDS.filter((k) => k !== 'contents')) assert.match(m(k), /^(front|body|back)matter$/, k);
});

test('a heading’s rank follows its depth, h1 to h6', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(epub.epubHeadingRank), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h6', 'h6']);
  assert.equal(epub.epubHeadingRank(undefined), 'h1');
  assert.equal(epub.epubHeadingRank(-1), 'h1');
});

// The DPUB-ARIA roles W3C's ARIA in HTML allows on <section> (the section
// row). A role outside it is an error to a checker and noise to a screen reader.
const SECTION_ROLES = ['doc-abstract', 'doc-acknowledgments', 'doc-afterword', 'doc-appendix', 'doc-bibliography', 'doc-chapter', 'doc-colophon', 'doc-conclusion', 'doc-credit', 'doc-credits', 'doc-dedication', 'doc-endnotes', 'doc-epigraph', 'doc-epilogue', 'doc-errata', 'doc-example', 'doc-foreword', 'doc-glossary', 'doc-index', 'doc-introduction', 'doc-notice', 'doc-pagelist', 'doc-part', 'doc-preface', 'doc-prologue', 'doc-pullquote', 'doc-qna', 'doc-toc'];
test('every role NEO puts on a section is one ARIA in HTML allows there', () => {
  for (const [kind, sem] of Object.entries(epub.EPUB_SEMANTICS)) if (sem.role) assert.ok(SECTION_ROLES.includes(sem.role), `${kind}: ${sem.role}`);
});

// schema.org's accessibility vocabulary (W3C's EPUB Accessibility, the
// values stores and the display guide read). A value outside it is shown as
// nothing, or flagged.
const ACCESS_MODES = ['auditory', 'chartOnVisual', 'chemOnVisual', 'colorDependent', 'diagramOnTactile', 'diagramOnVisual', 'mathOnVisual', 'musicOnVisual', 'tactile', 'textOnVisual', 'textual', 'visual'];
const FEATURES = ['annotations', 'ARIA', 'bookmarks', 'index', 'pageBreakMarkers', 'printPageNumbers', 'pageNavigation', 'readingOrder', 'structuralNavigation', 'tableOfContents', 'taggedPDF', 'alternativeText', 'audioDescription', 'closedCaptions', 'captions', 'describedMath', 'longDescription', 'openCaptions', 'signLanguage', 'transcript', 'displayTransformability', 'synchronizedAudioText', 'timingControl', 'unlocked', 'ChemML', 'latex', 'latex-chemistry', 'MathML', 'MathML-chemistry', 'ttsMarkup', 'highContrastAudio', 'highContrastDisplay', 'largePrint', 'braille', 'tactileGraphic', 'tactileObject', 'fullRubyAnnotations', 'horizontalWriting', 'rubyAnnotations', 'verticalWriting', 'withAdditionalWordSegmentation', 'withoutAdditionalWordSegmentation', 'none', 'unknown'];
const HAZARDS = ['flashing', 'noFlashingHazard', 'unknownFlashingHazard', 'motionSimulation', 'noMotionSimulationHazard', 'unknownMotionSimulationHazard', 'sound', 'noSoundHazard', 'unknownSoundHazard', 'unknown', 'none'];
test('the accessibility metadata uses only schema.org’s values', () => {
  for (const [, prop, value] of epub.epubA11yMeta().matchAll(/<meta property="schema:(\w+)">([^<]*)<\/meta>/g)) {
    if (prop === 'accessMode') assert.ok(ACCESS_MODES.includes(value), value);
    if (prop === 'accessModeSufficient') for (const v of value.split(',')) assert.ok(ACCESS_MODES.includes(v.trim()), v);
    if (prop === 'accessibilityFeature') assert.ok(FEATURES.includes(value), value);
    if (prop === 'accessibilityHazard') assert.ok(HAZARDS.includes(value), value);
  }
});

// Every page carries the book's language as lang and xml:lang, which must
// be a BCP 47 tag; a reader picks the voice and the hyphenation by it. The
// language comes from NEO's spellcheck languages or the interface's.
test('every language NEO can write a book in is a valid language tag', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const spell = /const SPELL_LANGUAGES = \{([\s\S]*?)\n\};/.exec(main)[1];
  const codes = [...spell.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1])
    .concat(fs.readdirSync(path.join(__dirname, '..', 'locales')).filter((f) => /^[a-z]/.test(f)).map((f) => f.replace(/\.json$/, '')));
  assert.ok(codes.length > 10);
  for (const c of codes) assert.match(c, /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/, c);
});

test('escaping: markup characters, and what XML 1.0 can’t carry', () => {
  const x = epub.escXmlReal;
  assert.equal(x(`Tom & "Jerry" <b>'s</b>`), 'Tom &amp; &quot;Jerry&quot; &lt;b&gt;&apos;s&lt;/b&gt;');
  assert.equal(x('a\u0001b\u000Bc￾d'), 'abcd', 'control characters go');
  assert.equal(x('tab\tnew\nline'), 'tab\tnew\nline', 'tab and newline stay');
  assert.equal(x('🌊 Zoë'), '🌊 Zoë', 'a whole emoji and accents stay');
});
