import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  SCENES,
  SOURCES,
  CAPABILITY_NOTES,
  PROVENANCE,
  DATA_KINDS,
} from '../src/content/curriculum.js';

const PIN = '1c53d6eb08a7d0041a6f54728b6ba90a59507454';
const ARCHIVE = `https://github.com/SkyProse/ParallelProgrammingTex/blob/${PIN}/`;
const AS_OF = '2026-10-24';
const ids = ['deadlock', 'race', 'memory', 'cas', 'gpu', 'benchmark'];
const repo = new URL('../../', import.meta.url);
const scene = (id) => SCENES.find((entry) => entry.id === id);
const meaningful = (value, field) => {
  assert.equal(typeof value, 'string', field);
  assert.ok(value.trim().length >= 12, `${field} must explain something`);
  assert.ok(!/TODO|TBD|lorem ipsum/i.test(value), `${field} must be finished copy`);
};

test('the six scenes expose complete Russian learning modules in a stable order', () => {
  assert.deepEqual(SCENES.map(({ id }) => id), ids);
  for (const entry of SCENES) {
    for (const key of ['title', 'eyebrow', 'summary', 'question', 'scope', 'lesson']) {
      meaningful(entry[key], `${entry.id}.${key}`);
      assert.match(entry[key], /[А-Яа-яЁё]/u);
    }
    assert.ok(['model', 'measured'].includes(entry.dataKind));
    assert.ok(entry.objectives.length >= 2);
    entry.objectives.forEach((objective) => meaningful(objective, `${entry.id}.objective`));
  }
});

test('each challenge and transfer question has one declared answer and distinct readable options', () => {
  for (const entry of SCENES) {
    for (const key of ['challenge', 'transfer']) {
      const exercise = entry[key];
      meaningful(exercise.prompt, `${entry.id}.${key}.prompt`);
      meaningful(exercise.explanation, `${entry.id}.${key}.explanation`);
      assert.ok(exercise.options.length >= 2 && exercise.options.length <= 4);
      assert.equal(new Set(exercise.options.map(({ id }) => id)).size, exercise.options.length);
      assert.equal(new Set(exercise.options.map(({ label }) => label)).size, exercise.options.length);
      assert.equal(exercise.options.filter(({ id }) => id === exercise.answer).length, 1);
      for (const option of exercise.options) {
        assert.match(option.id, /^[a-z][a-z0-9-]*$/);
        meaningful(option.label, `${entry.id}.${key}.option`);
      }
    }
    assert.notEqual(entry.challenge.prompt, entry.transfer.prompt, 'transfer must ask a new question');
  }
});

test('every chapter source is pinned to the audited archive and is present in the repository', () => {
  for (const entry of SCENES) {
    assert.ok(!entry.source.path.includes('..'));
    assert.ok(existsSync(new URL(entry.source.path, repo)), `${entry.source.path} exists`);
    assert.equal(entry.source.url, ARCHIVE + entry.source.path);
    meaningful(entry.source.label, `${entry.id}.source.label`);
    meaningful(entry.source.section, `${entry.id}.source.section`);
    assert.ok(entry.sourceIds.length > 0);
    entry.sourceIds.forEach((id) => assert.ok(SOURCES.some((source) => source.id === id), id));
  }
});

test('the unsafe race is explicitly an SC adaptation and does not enumerate C++ undefined behavior', () => {
  const text = `${scene('race').scope} ${scene('race').lesson}`;
  assert.match(text, /последовательн[а-яё]* согласован/u);
  assert.match(text, /C\+\+/);
  assert.match(text, /неопредел[её]нн[а-яё]* поведени/u);
  assert.match(text, /снимок/u);
  assert.match(text, /контракт/u);
});

test('cache and queue scope forbid claims unsupported by their small teaching models', () => {
  assert.match(scene('memory').scope, /не.*измерени/u);
  assert.match(scene('memory').scope, /размер.*лини/u);
  assert.match(scene('cas').scope, /только добавлени/u);
  assert.match(scene('cas').scope, /освобождени.*памяти/u);
  assert.match(scene('cas').scope, /ABA/);
  assert.match(scene('deadlock').scope, /два потока/u);
  assert.match(scene('deadlock').scope, /одна итерация/u);
});

test('GPU and measurement modules do not conflate browser results with native OpenMP', () => {
  assert.match(scene('gpu').scope, /WebGPU/);
  assert.match(scene('gpu').scope, /поддержк/u);
  assert.match(scene('gpu').lesson, /размер.*подгрупп/u);
  assert.match(scene('benchmark').scope, /OpenMP/);
  assert.match(scene('benchmark').scope, /не.*(равн|эквивалент|замен)/u);
  assert.match(scene('benchmark').lesson, /интервал/iu);
  assert.match(scene('benchmark').lesson, /холодн/iu);
});

test('data origin remains a three-way distinction, including imported results', () => {
  assert.deepEqual(DATA_KINDS.map(({ id }) => id), ['model', 'measured', 'imported']);
  for (const kind of DATA_KINDS) {
    meaningful(kind.label, kind.id);
    meaningful(kind.description, kind.id);
  }
  assert.match(DATA_KINDS.find(({ id }) => id === 'imported').description, /не.*(измерен|проверен|повторен)/u);
});

test('the source catalogue records an audit date, primary references and original authorship', () => {
  assert.equal(new Set(SOURCES.map(({ id }) => id)).size, SOURCES.length);
  for (const source of SOURCES) {
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.asOf <= AS_OF);
    meaningful(source.label, source.id);
    meaningful(source.note, source.id);
    if (source.kind === 'archive') assert.ok(source.url.startsWith(ARCHIVE));
  }
  assert.equal(PROVENANCE.commit, PIN);
  assert.equal(PROVENANCE.archiveDate, '2020-02-19');
  assert.equal(PROVENANCE.auditDate, AS_OF);
  assert.deepEqual(PROVENANCE.authors, ['Соснин В. В.', 'Балакшин П. В.', 'Шилко Д. С.']);
  assert.match(PROVENANCE.institution, /ИТМО/u);
  assert.match(PROVENANCE.adaptation, /адаптаци/u);
});

test('capability notes distinguish stable requirements from optional or experimental behavior', () => {
  assert.ok(CAPABILITY_NOTES.length >= 4);
  assert.equal(new Set(CAPABILITY_NOTES.map(({ id }) => id)).size, CAPABILITY_NOTES.length);
  for (const note of CAPABILITY_NOTES) {
    assert.ok(['baseline', 'optional', 'experimental', 'unavailable'].includes(note.status));
    meaningful(note.title, note.id);
    meaningful(note.detail, note.id);
    note.sourceIds.forEach((id) => assert.ok(SOURCES.some((source) => source.id === id), id));
  }
  assert.equal(CAPABILITY_NOTES.find(({ id }) => id === 'subgroups').status, 'optional');
  assert.equal(CAPABILITY_NOTES.find(({ id }) => id === 'dom-in-canvas').status, 'experimental');
});

test('teacher, errata, architecture and reference guides are shipped with the audited revision', () => {
  for (const file of ['TEACHER_GUIDE.md', 'ERRATA.md', 'ARCHITECTURE.md', 'SOURCES.md']) {
    const text = readFileSync(new URL(`docs/${file}`, repo), 'utf8');
    assert.match(text, new RegExp(PIN));
    assert.match(text, /2026-10-24/);
    assert.ok(text.length >= 1200, `${file} must contain usable guidance`);
  }
});

test('the textbook identifies the dated standard and includes the new companion chapter', () => {
  const main = readFileSync(new URL('main.tex', repo), 'utf8');
  const openmp = readFileSync(new URL('section3_3.tex', repo), 'utf8');
  const companion = readFileSync(new URL('concurrencyTheatre.tex', repo), 'utf8');
  const description = readFileSync(new URL('description.tex', repo), 'utf8');
  assert.match(main, /\\include\{concurrencyTheatre\}/);
  assert.doesNotMatch(main, /\\externaldocument\{main\}/, 'the book must not import its own changing aux file');
  assert.match(openmp, /OpenMP 6\.0/);
  assert.match(openmp, /6\.1.*draft/i);
  assert.match(openmp, /24 October 2026/);
  assert.doesNotMatch(openmp, /current version of the OpenMP 4\.5/);
  assert.match(companion, /\\label\{concurrencyTheatre:section\}/);
  assert.match(companion, /undefined behavior/);
  assert.doesNotMatch(description, /\\textbf\{НЕТ!!!!\}/u);
  assert.match(description, /2020/);
  assert.doesNotMatch(description, /\\(?:par|space)(?=[А-Яа-яЁё])/u, 'Unicode text must not become part of a TeX command name');
});

test('dated textbook corrections qualify the archived detector, snapshot and performance claims', () => {
  const pitfalls = readFileSync(new URL('section3_5.tex', repo), 'utf8');
  const lockfree = readFileSync(new URL('section1_8.tex', repo), 'utf8');
  const timing = readFileSync(new URL('section2_5.tex', repo), 'utf8');
  assert.match(pitfalls, /2026 editorial note/);
  assert.match(pitfalls, /undefined behavior/);
  assert.match(pitfalls, /changes the contract/);
  assert.match(lockfree, /2026 editorial note/);
  assert.doesNotMatch(lockfree, /exceed blocking ones by 1\.5/);
  assert.match(timing, /2026 editorial note/);
  assert.doesNotMatch(timing, /exclude from the experiment all the background influences/);
});
