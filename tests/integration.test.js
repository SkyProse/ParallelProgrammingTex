const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const objectId = (kind, bytes) => crypto.createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest();
function treeId(dir) {
  const entries = fs.readdirSync(dir, {withFileTypes: true}).map(e => {
    assert.ok(e.isFile() || e.isDirectory(), `Unexpected special file: ${e.name}`);
    const directory = e.isDirectory();
    const name = Buffer.from(e.name);
    return {sort: Buffer.concat([name, Buffer.from(directory ? '/' : '')]), bytes: Buffer.concat([
      Buffer.from(directory ? '40000 ' : '100644 '), name, Buffer.from([0]),
      directory ? treeId(path.join(dir, e.name)) : objectId('blob', fs.readFileSync(path.join(dir, e.name)))
    ])};
  }).sort((a,b) => Buffer.compare(a.sort,b.sort));
  return objectId('tree', Buffer.concat(entries.map(e=>e.bytes)));
}
function active(text) { return text.split('\n').filter(l => !/^\s*%/.test(l)).join('\n'); }
function texGraph(file, visited = new Set()) {
  if (visited.has(file)) return visited;
  visited.add(file);
  const text = active(read(file));
  assert.doesNotMatch(text, /^(<<<<<<<|=======|>>>>>>>)/m, file);
  for (const m of text.matchAll(/\\(?:include|input)\{([^}]+)\}/g)) {
    const child = m[1].endsWith('.tex') ? m[1] : `${m[1]}.tex`;
    assert.ok(fs.existsSync(path.join(root,child)), `Missing ${child} included by ${file}`);
    texGraph(child,visited);
  }
  return visited;
}
test('Russian upstream is preserved byte-for-byte as its exact Git tree', () => {
  const lock = JSON.parse(read('upstreams.lock.json'));
  assert.equal(lock.ru.commit, '53535f92db505a5d0442dca5a3918fe3ea78189a');
  assert.equal(treeId(path.join(root,'editions/ru')).toString('hex'), lock.ru.tree);
});
test('all 16 restored C listings keep the upstream bytes', () => {
  const lock = JSON.parse(read('upstreams.lock.json'));
  assert.equal(Object.keys(lock.importedListings).length,16);
  for (const [p,sha] of Object.entries(lock.importedListings)) {
    assert.equal(objectId('blob',fs.readFileSync(path.join(root,p))).toString('hex'),sha,p);
  }
});
test('English book includes both restored labs, references and the theatre', () => {
  const graph = texGraph('main.tex');
  for (const file of ['section8.tex','section9.tex','bibliography.tex','concurrencyTheatre.tex','section2_6.tex','intelIPP.tex','posixThreads.tex','CoverTitlePage.tex','TitlePage.tex']) {
    assert.ok(graph.has(file), `${file} missing from active book`);
  }
});
test('chapter mapping restores missing topics without duplicating OpenCL or error chapters', () => {
  const graph=texGraph('main.tex');
  const text=[...graph].map(f=>active(read(f))).join('\n');
  assert.equal([...text.matchAll(/\\subsection\{OpenCL Technology\}/g)].length,1);
  assert.equal([...text.matchAll(/\\subsection\{Errors in multithreaded applications\}/g)].length,1);
  const section=read('section3.tex');
  assert.ok(section.indexOf('{intelIPP}') < section.indexOf('{section3_3}'));
  assert.ok(section.indexOf('{posixThreads}') > section.indexOf('{section3_3}'));
  assert.ok(section.indexOf('{posixThreads}') < section.indexOf('{section3_4}'));
});
test('restored lab 5 refers to lab 4 rather than to itself', () => {
  const text=read('section8_1.tex');
  assert.match(text,/Laboratory research \\#4/);
  assert.doesNotMatch(text,/Laboratory research \\#5/);
  assert.match(text,/\\subsection\{Work sequence\}/);
});
test('2026 safety corrections survive the English merge', () => {
  assert.match(read('section1_8.tex'), /Neither approach has a universal throughput multiplier/);
  assert.match(read('section3_5.tex'), /undefined behavior/);
  assert.match(read('main.tex'), /setdefaultlanguage\{english\}/);
  assert.match(read('main.tex'), /\\usepackage\[russian,english\]\{babel\}/);
});
test('all listing and figure dependencies in the active English book exist', () => {
  for (const file of texGraph('main.tex')) {
    const text=active(read(file));
    for (const m of text.matchAll(/\\lstinputlisting(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
      assert.ok(['', 'listings/'].some(p=>fs.existsSync(path.join(root,p+m[1]))), `${file}: ${m[1]}`);
    }
    for (const m of text.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
      assert.ok(['','.png','.jpg','.pdf','.eps'].some(ext=>fs.existsSync(path.join(root,'images',m[1]+ext))), `${file}: ${m[1]}`);
    }
  }
});

test('the updated lab-1 task and its separately named sketch both use 100 repetitions', () => {
  assert.match(read('section4_1.tex'), /100 times/);
  assert.match(read('section4_1.tex'), /exceeds 5 s/);
  assert.match(read('section4_1.tex'), /lab1Example2026\.cpp/);
  assert.match(read('listings/lab1Example2026.cpp'), /i<100/);
  assert.match(read('listings/lab1Example.cpp'), /i<50/);
});
test('the exact Russian edition has 152 files and retains its additional author credit', () => {
  function count(dir) { return fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?count(path.join(dir,e.name)):1),0); }
  assert.equal(count(path.join(root,'editions/ru')),152);
  assert.match(read('integrationNotes.tex'), /D\. A\. Pushkarev/);
});
