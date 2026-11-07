// End-to-end test for Export → EPUB, on a throwaway library: a book with
// every kind of section NEO has (copyright, dedication, epigraph, part,
// prologue, chapter, unnumbered, epilogue, acknowledgments, about, a
// footnote and a scene break), and a shelf of two books exported as one.
// Each page names what it is for reading apps (epub:type) and screen
// readers (DPUB-ARIA role, the section's name), every page says its
// language, and content.opf carries the accessibility metadata. Every
// XHTML file must parse as XML. Run with `npm run test:epub` (under
// xvfb-run without a display). EPUBCheck (the W3C's validator) and DAISY Ace
// (the accessibility checker) are run by hand on the books it leaves in the
// temp folder: java -jar epubcheck.jar book.epub; npx @daisy/ace -o report book.epub

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-epub-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-epub-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: 'Ada Writer', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night', hintShown: true, spellLanguage: 'en',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }, { id: 'shelf-2', name: 'Harbor Stories', bookIds: [] }, { id: 'shelf-3', name: 'Coast Stories', bookIds: [] }]
}));
let saveTo = '';
dialog.showSaveDialog = async () => ({ canceled: false, filePath: saveTo });
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');
const JSZip = require('jszip');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const P = (text) => ({ text });
const prose = [P('The tide came in at dusk, and the boats rocked against their ropes.'), P('“Not tonight,” she said.'), P('He walked down to the water and did not come back until the lamps were lit.')];
const BOOK = [
  ['Copyright', 'copyright', [P('Copyright © 2026 Ada Writer'), P('All rights reserved.')]],
  ['Dedication', 'dedication', [P('For the ones who stayed.')]],
  ['Epigraph', 'epigraph', [P('The sea is everything.'), P('— Jules Verne')]],
  ['Part One', 'part', [P('The Harbor')]],
  ['Prologue', 'prologue', prose],
  ['The Docks', 'chapter', prose],
  ['Interlude', 'unnumbered', prose],
  ['Epilogue', 'epilogue', prose],
  ['Thanks', 'acknowledgments', [P('Thank you to everyone at the harbor.')]],
  ['About', 'about', [P('Ada Writer lives by the sea.')]]
];
// what each page's section must say it is: [epub:type, role ('' for none), named by]
const WANT = {
  copyright: ['copyright-page', '', 'label'], dedication: ['dedication', 'doc-dedication', 'label'],
  epigraph: ['epigraph', 'doc-epigraph', 'label'], part: ['part', 'doc-part', 'heading'],
  prologue: ['prologue', 'doc-prologue', 'heading'], chapter: ['chapter', 'doc-chapter', 'heading'],
  unnumbered: ['chapter', 'doc-chapter', 'heading'], epilogue: ['epilogue', 'doc-epilogue', 'heading'],
  acknowledgments: ['acknowledgments', 'doc-acknowledgments', 'heading'], about: ['backmatter', '', 'heading'],
  opener: ['volume', '', 'heading']
};
const epubs = {};
let emptyToast = '';
const files = async (name) => {
  const zip = await JSZip.loadAsync(fs.readFileSync(epubs[name]));
  const out = {};
  for (const f of Object.keys(zip.files)) if (!zip.files[f].dir && !/\.(jpe?g|png)$/.test(f)) out[f] = await zip.file(f).async('string');
  return out;
};
const attr = (tag, a) => { const m = new RegExp(`\\s${a}="([^"]*)"`).exec(tag); return m ? m[1] : null; };
const sectionOf = (html) => /<section\b[^>]*>/.exec(html)[0];
// a section's name: its heading's id must be there, or a label of its own
function assertNamed(html, how, where) {
  const sec = sectionOf(html);
  if (how === 'heading') {
    const id = attr(sec, 'aria-labelledby');
    assert.ok(id, where + ': aria-labelledby');
    assert.match(html, new RegExp(`<h[1-6] id="${id}"`), where + ': the heading it names');
  } else assert.ok(attr(sec, 'aria-label'), where + ': aria-label');
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('every page of the book says what it is, for reading apps and for screen readers', async () => {
  const f = await files('book');
  BOOK.forEach(([, kind], i) => {
    const html = f[`OEBPS/ch${i + 1}.xhtml`];
    assert.ok(html, `ch${i + 1}.xhtml`);
    const [type, role, how] = WANT[kind];
    const sec = sectionOf(html);
    assert.equal(attr(sec, 'epub:type'), type, kind);
    assert.equal(attr(sec, 'role'), role || null, kind);
    assertNamed(html, how, kind);
  });
});

test('a heading’s rank follows its depth: what’s in a part is an <h2>, the rest an <h1>', async () => {
  const f = await files('book');
  const rank = (i) => /<h([1-6]) id=/.exec(f[`OEBPS/ch${i}.xhtml`])[1];
  // ch4 is the part; the prologue, chapter and interlude are in it. The
  // epilogue closes the book, out of the part (BACK_KINDS), as in the contents
  assert.deepEqual([4, 5, 6, 7, 8, 9, 10].map(rank), ['1', '2', '2', '2', '1', '1', '1']);
});

test('a part’s heading reads “Part I The Harbor”, not run together', async () => {
  assert.match((await files('book'))['OEBPS/ch4.xhtml'], /<span class="pl">Part I<\/span> <span class="pt">The Harbor<\/span>/);
});

test('a footnote is a note a reading app can open, and a scene break isn’t read as stars', async () => {
  const ch = (await files('book'))['OEBPS/ch6.xhtml'];
  assert.match(ch, /<a epub:type="noteref" role="doc-noteref" href="#fn1" id="fnr1">1<\/a>/);
  assert.match(ch, /<aside epub:type="footnote" role="doc-footnote" id="fn1" class="footnote"><p><a role="doc-backlink" href="#fnr1">1<\/a>/);
  assert.match(ch, /<p class="brk" role="separator" aria-label="Scene break">\* \* \*<\/p>/);
});

test('the stylesheets are Blitz lite and NEO’s rules, each as it is, linked from every page in that order', async () => {
  const f = await files('book');
  const own = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  assert.equal(f['OEBPS/blitz-lite.css'], own('epub/blitz/blitz-lite.css'), 'Blitz untouched');
  assert.equal(f['OEBPS/neo.css'], own('epub/neo.css'));
  assert.ok(!('OEBPS/style.css' in f));
  const links = '<link rel="stylesheet" type="text/css" href="blitz-lite.css"/><link rel="stylesheet" type="text/css" href="neo.css"/>';
  for (const [p, x] of Object.entries(f)) if (p.endsWith('.xhtml')) assert.ok(x.includes(links), p);
  for (const item of ['<item id="css1" href="blitz-lite.css" media-type="text/css"/>', '<item id="css2" href="neo.css" media-type="text/css"/>']) {
    assert.ok(f['OEBPS/content.opf'].includes(item), item);
  }
});

test('the title page, cover and contents', async () => {
  const f = await files('book');
  assert.match(f['OEBPS/title.xhtml'], /<section epub:type="titlepage" class="titlepage" aria-labelledby="title"><h1 id="title">Harbor<\/h1>/);
  assert.match(f['OEBPS/title.xhtml'], /<p class="sub" epub:type="subtitle" role="doc-subtitle">A Novel of the Coast<\/p>/);
  assert.match(f['OEBPS/cover.xhtml'], /<div class="coverimg" epub:type="cover"><img class="portrait" role="doc-cover" src="cover\.\w+" alt="Harbor, by Ada Writer"\/>/);
  assert.match(f['OEBPS/nav.xhtml'], /<nav epub:type="toc" role="doc-toc" id="toc">/);
});

test('every page and the package say the book’s language', async () => {
  for (const name of ['book', 'anthology']) {
    const f = await files(name);
    for (const [p, html] of Object.entries(f)) {
      if (!p.endsWith('.xhtml')) continue;
      assert.match(html, /<html [^>]*xml:lang="en" lang="en"/, `${name} ${p}`);
    }
    assert.match(f['OEBPS/content.opf'], /<package [^>]*xml:lang="en"/, name);
  }
});

test('content.opf carries the accessibility metadata, and claims no conformance', async () => {
  const opf = (await files('book'))['OEBPS/content.opf'];
  for (const m of ['accessMode">textual', 'accessModeSufficient">textual', 'accessibilityFeature">structuralNavigation',
    'accessibilityFeature">tableOfContents', 'accessibilityFeature">readingOrder', 'accessibilityFeature">alternativeText',
    'accessibilityHazard">none', 'accessibilitySummary">']) {
    assert.ok(opf.includes(`<meta property="schema:${m}`), m);
  }
  assert.ok(!opf.includes('conformsTo'));
});

test('a shelf exported as one book: each book’s first page is a volume, named by its title', async () => {
  const f = await files('anthology');
  const openers = Object.entries(f).filter(([p, html]) => p.endsWith('.xhtml') && /class="opener"/.test(html));
  assert.equal(openers.length, 2);
  for (const [p, html] of openers) {
    const [type, role, how] = WANT.opener;
    assert.equal(attr(sectionOf(html), 'epub:type'), type, p);
    assert.equal(attr(sectionOf(html), 'role'), role || null, p);
    assertNamed(html, how, p);
  }
  const chapters = Object.entries(f).filter(([p, html]) => /ch\d+\.xhtml$/.test(p) && !/class="opener"/.test(html));
  assert.ok(chapters.length >= 4);
  for (const [p, html] of chapters) {
    assert.equal(attr(sectionOf(html), 'role'), 'doc-chapter', p);
    assert.match(html, /<h2 id=/, p + ': a chapter of one of the books is an <h2>');
  }
  for (const [p, html] of openers) assert.match(html, /<h1 id=/, p);
  assert.match(openers[0][1], /<p class="sub" epub:type="subtitle" role="doc-subtitle">Two Nights<\/p>/);
});

test('no page is non-linear: the cover is the first page, and a one-entry contents page isn’t in the spine', async () => {
  for (const name of ['book', 'anthology', 'single']) {
    const opf = (await files(name))['OEBPS/content.opf'];
    assert.ok(!opf.includes('linear='), name);
    assert.match(opf, /<spine toc="ncx">\n<itemref idref="cover"\/>\n<itemref idref="titlepage"\/>/, name);
  }
  assert.match((await files('book'))['OEBPS/content.opf'], /<itemref idref="nav"\/>/);
  const single = (await files('single'))['OEBPS/content.opf'];
  assert.ok(!single.includes('<itemref idref="nav"'), 'one chapter: no contents page to read through');
  assert.match(single, /<item id="nav" href="nav\.xhtml" media-type="application\/xhtml\+xml" properties="nav"\/>/, 'the nav document is still in the book');
});

test('a book of one chapter: the story is named for the book', async () => {
  const f = await files('single');
  const html = f['OEBPS/ch1.xhtml'];
  assert.match(html, /<section epub:type="chapter" role="doc-chapter" aria-label="Solo">/);
  assert.ok(!/<h[1-6]/.test(html), 'no heading of its own');
});

test('each page’s <body> says which part of the book it is in', async () => {
  const f = await files('book');
  const matter = (p) => /<body epub:type="(\w+)"/.exec(f[`OEBPS/${p}`])[1];
  assert.deepEqual(BOOK.map((x, i) => matter(`ch${i + 1}.xhtml`)),
    ['frontmatter', 'frontmatter', 'frontmatter', 'bodymatter', 'bodymatter', 'bodymatter', 'bodymatter', 'bodymatter', 'backmatter', 'backmatter']);
  assert.equal(matter('title.xhtml'), 'frontmatter');
  assert.equal(matter('nav.xhtml'), 'frontmatter');
});

test('a stanza is marked by class, so its spacing works where sibling selectors don’t (Kindle)', async () => {
  const ch = (await files('extras'))['OEBPS/ch3.xhtml'];
  assert.match(ch, /<p class="poetry stanza">Ventus erat in velis,<\/p>\n<p class="poetry">mare sub carina.<\/p>\n<p class="after-verse">/);
});

test('footnotes on the dedication and epigraph pages: note links there too, numbered through the book', async () => {
  const f = await files('extras');
  assert.match(f['OEBPS/ch1.xhtml'], /<a epub:type="noteref" role="doc-noteref" href="#fn1" id="fnr1">1<\/a>/);
  assert.match(f['OEBPS/ch1.xhtml'], /<aside epub:type="footnote" role="doc-footnote" id="fn1"/);
  assert.match(f['OEBPS/ch2.xhtml'], /href="#fn2" id="fnr2">2<\/a>/);
  assert.match(f['OEBPS/ch3.xhtml'], /href="#fn3" id="fnr3">3<\/a>/);
});

test('a contents page placed by the writer: the nav document stands where it was put', async () => {
  const opf = (await files('extras'))['OEBPS/content.opf'];
  assert.match(opf, /<itemref idref="titlepage"\/>\n<itemref idref="ch1"\/>\n<itemref idref="ch2"\/>\n<itemref idref="nav"\/>\n<itemref idref="ch3"\/>/);
});

test('a part with no title, and a part that is only a quote', async () => {
  const f = await files('parts');
  const part = (n) => f[`OEBPS/ch${n}.xhtml`];
  assert.match(part(1), /<h1 id="h1"><span class="pl">Part I<\/span><\/h1>/, 'no title: the part’s number alone');
  assert.match(part(3), /<h1 id="h3"><span class="pl">Part II<\/span><\/h1>\n<p class="attr">— Virgil<\/p>/, 'only a quote: the quote stays a line of the page, not a title');
  for (const n of [1, 3]) assert.match(part(n), /<section epub:type="part" role="doc-part" class="part" aria-labelledby="h\d+">/);
});

// (only a bound shelf carries its pages, a part among them; a shelf exported
// as an anthology leaves them out)
test('a bound shelf with a part holding books: the books’ chapters are <h3>', async () => {
  const f = await files('deep');
  const ranks = Object.entries(f).filter(([p]) => /ch\d+\.xhtml$/.test(p)).sort(([a], [b]) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))
    .map(([, h]) => /<(h\d) id=/.exec(h)[1]);
  assert.deepEqual(ranks, ['h1', 'h2', 'h3', 'h3', 'h2', 'h3', 'h3'], 'part, book, its chapters, book, its chapters');
});

test('the language is the book’s, on every page and the package: pt-BR and en-GB', async () => {
  for (const [name, lang] of [['pt', 'pt-BR'], ['gb', 'en-GB']]) {
    const f = await files(name);
    assert.match(f['OEBPS/content.opf'], new RegExp(`<package [^>]*xml:lang="${lang}"`));
    assert.match(f['OEBPS/content.opf'], new RegExp(`<dc:language>${lang}</dc:language>`));
    for (const [p, html] of Object.entries(f)) if (p.endsWith('.xhtml')) assert.match(html, new RegExp(`<html [^>]*xml:lang="${lang}" lang="${lang}"`), `${name} ${p}`);
  }
});

// an empty book exports as one blank page, still a whole EPUB
test('a book with nothing written in it exports as one blank page, named for the book', async () => {
  assert.match(emptyToast, /Exported: empty\.epub/);
  const f = await files('empty');
  assert.match(f['OEBPS/ch1.xhtml'], /<section epub:type="chapter" role="doc-chapter" aria-label="Empty">\n\n<\/section>/);
});

// The book must be whole on its own: a reading app shouldn't fetch anything
// to show it (EPUB 3.3 asks remote resources to be declared; NEO has none),
// and NEO never writes a script. Links to a website in the text are fine:
// they're the writer's, and a reader opens them only when tapped.
test('nothing from outside the book: no remote picture, stylesheet, font or script, in any book', async () => {
  for (const name of Object.keys(epubs)) {
    const f = await files(name);
    for (const [p, text] of Object.entries(f)) {
      if (p.endsWith('.xhtml')) {
        assert.ok(!/<(script|iframe|object|embed|audio|video)\b/i.test(text), `${name} ${p}: no scripts or embeds`);
        assert.ok(!/\ssrc="(?!(?:[\w.-]+\/)*[\w.-]+")/.test(text), `${name} ${p}: every src is a file in the book`);
        assert.ok(!/<link [^>]*href="(?:[a-z]+:|\/\/)/i.test(text), `${name} ${p}: stylesheets are the book's`);
        assert.ok(!/javascript:/i.test(text), `${name} ${p}`);
      }
      if (p.endsWith('.css')) {
        assert.ok(!/@import/i.test(text.replace(/\/\*[\s\S]*?\*\//g, '')), `${name}: no @import`);
        assert.ok(!/url\(\s*['"]?(?:[a-z]+:|\/\/)/i.test(text), `${name}: no remote url()`);
      }
      if (p.endsWith('.opf')) assert.ok(!/href="(?:[a-z]+:|\/\/)/i.test(text) && !text.includes('remote-resources'), `${name}: every manifest item is in the book`);
    }
  }
});

test('markup pasted into a chapter, a remote picture or a script, comes out as text or not at all', async () => {
  const ch = Object.entries(await files('pasted')).find(([p]) => /ch\d+\.xhtml$/.test(p))[1];
  assert.ok(!/<img|<script|<iframe/i.test(ch), 'no element of it');
  assert.ok(!ch.includes('example.com/x.png'), 'not even the address');
  assert.match(ch, /Look {2}here\./, 'the picture gone, the two spaces round it left');
});

test('every XHTML file is well-formed XML', async () => {
  for (const name of Object.keys(epubs)) {
    const f = await files(name);
    const bad = await js(`(() => {
      const pages = ${JSON.stringify(Object.entries(f).filter(([p]) => /\.(xhtml|opf|ncx)$/.test(p) || p.endsWith('container.xml')))};
      return pages.filter(([, x]) => new DOMParser().parseFromString(x, 'application/xml').querySelector('parsererror')).map(([p]) => p);
    })()`);
    assert.deepEqual(bad, [], name);
  }
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    win.focus();
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      const spec = ${JSON.stringify(BOOK)};
      await addImportedBooks([{ name: 'Harbor', chapters: spec.map(([title, , paras]) => ({ title, paras })) }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      book.subtitle = 'A Novel of the Coast';
      book.chapterOrder.forEach((c, i) => setChapterKind(c, spec[i][1]));
      // a footnote and a scene break in the chapter
      const ch = book.chapterOrder[5];
      chapterHTML[ch] = chapterHTML[ch].replace('dusk,', 'dusk<span class="fn" data-note="Around eight in the evening." contenteditable="false">\\u200B</span>,')
        .replace('<p>“Not tonight,”', '<p class="scene-break">***</p><p>“Not tonight,”');
      await saveMeta();
      for (const c of book.chapterOrder) await persistChapter(c);
      renderChapters();
    })()`);
    await tick(500);
    epubs.book = saveTo = path.join(tmp, 'book.epub');
    await js(`doExport('epub')`);
    // two books of two chapters: each gets its own first page in the shelf's book
    epubs.anthology = saveTo = path.join(tmp, 'anthology.epub');
    const two = JSON.stringify([{ title: 'One', paras: prose }, { title: 'Two', paras: prose }]);
    await js(`(async () => {
      await addImportedBooks([{ name: 'Low Water', chapters: ${two} }], library.shelves[1]);
      await addImportedBooks([{ name: 'High Tide', chapters: ${two} }], library.shelves[1]);
      const id = library.shelves[1].bookIds[0];
      const m = await window.neo.readBookMeta(id);
      m.subtitle = 'Two Nights';
      await window.neo.writeBookMeta(id, m);
      const data = await shelfBookData(library.shelves[1], { title: 'Harbor Stories' });
      await window.neo.exportSave(await shelfPayload(data, 'epub'));
    })()`);
    // a book of one chapter: no heading, no contents page to read through
    epubs.single = saveTo = path.join(tmp, 'single.epub');
    await js(`(async () => {
      await addImportedBooks([{ name: 'Solo', chapters: [{ title: 'One', paras: ${JSON.stringify(prose)} }] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      await doExport('epub');
    })()`);
    const book1 = async (name, chapters, after = '') => js(`(async () => {
      await addImportedBooks([{ name: ${JSON.stringify(name)}, chapters: ${JSON.stringify(chapters.map(([title]) => ({ title, paras: [{ text: "x" }] })))} }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      const spec = ${JSON.stringify(chapters)};
      book.chapterOrder.forEach((c, i) => { setChapterKind(c, spec[i][1]); chapterHTML[c] = spec[i][2]; });
      await saveMeta();
      for (const c of book.chapterOrder) await persistChapter(c);
      renderChapters();
      ${after}
      await doExport('epub');
      return document.getElementById('hint').textContent;
    })()`);
    const fn = (note) => `<span class="fn" data-note="${note}" contenteditable="false">\u200B</span>`;
    // footnotes on the front pages, a stanza in a chapter, a contents page placed by the writer
    epubs.extras = saveTo = path.join(tmp, 'extras.epub');
    await book1('Extras', [
      ['Dedication', 'dedication', `<p>For the ones who stayed.${fn('They know who they are.')}</p>`],
      ['Epigraph', 'epigraph', `<p>The sea is everything.${fn('Twenty Thousand Leagues.')}</p><p>— Jules Verne</p>`],
      ['Contents', 'contents', '<p></p>'],
      ['The Docks', 'chapter', `<p>The tide came in.${fn('At dusk.')}</p><p class="poetry">Ventus erat in velis,</p><p class="poetry">mare sub carina.</p><p>And the night came down.</p>`],
      ['Low Tide', 'chapter', '<p>The water went out.</p>']
    ]);
    // a part with no title, and a part with only a quote
    epubs.parts = saveTo = path.join(tmp, 'parts.epub');
    await book1('Parts', [
      ['Part', 'part', '<p></p>'], ['One', 'chapter', '<p>A beginning.</p>'],
      ['Part', 'part', '<p>— Virgil</p>'], ['Two', 'chapter', '<p>An ending.</p>']
    ]);
    // the language of the book: Brazilian Portuguese, British English
    for (const [name, lang] of [['pt', 'pt-BR'], ['gb', 'en-GB']]) {
      epubs[name] = saveTo = path.join(tmp, name + '.epub');
      await book1('Lang ' + lang, [['Um', 'chapter', '<p>Era uma vez.</p>'], ['Dois', 'chapter', '<p>Fim.</p>']], `library.spellLanguage = '${lang}';`);
    }
    await js(`library.spellLanguage = 'en'`);
    // markup pasted into a chapter: a remote picture, a script, a frame
    epubs.pasted = saveTo = path.join(tmp, 'pasted.epub');
    await book1('Pasted', [['One', 'chapter', '<p>Look <img src="https://example.com/x.png"> here.<script>void 0</script><iframe src="https://example.com/"></iframe></p>'], ['Two', 'chapter', '<p>Fine.</p>']]);
    // nothing written: no file, a message
    epubs.empty = saveTo = path.join(tmp, 'empty.epub');
    emptyToast = await book1('Empty', [['One', 'chapter', '<p></p>']]);
    // a shelf with a part holding two books of two chapters: part h1, book h2, chapter h3
    epubs.deep = saveTo = path.join(tmp, 'deep.epub');
    await js(`(async () => {
      const shelf = library.shelves[2];
      for (const name of ['North Shore', 'South Shore']) await addImportedBooks([{ name, chapters: ${two} }], shelf);
      const part = await createPageBook(shelf, 'part');
      await window.neo.writeChapter(part.id, part.chapterOrder[0], '<p>The Coast</p>');
      shelf.bookIds = [part.id, ...shelf.bookIds.filter((b) => b !== part.id)];
      shelf.binding = { bound: true, numbering: 'through', parked: [] };
      await writeLibrary(library);
      const data = await shelfBookData(shelf, { bound: true });
      await window.neo.exportSave(await shelfPayload(data, 'epub'));
    })()`);
    for (const f of Object.values(epubs)) assert.ok(fs.existsSync(f), f);
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.stack || err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
