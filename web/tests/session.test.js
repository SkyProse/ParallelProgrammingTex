import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSession, decodeSession, validateMeasuredImport, makeProgress, recordAnswer } from '../src/session.js';

test('trace round trip preserves branch, cursor and configuration without wall clock data', () => {
  const s = { scene: 'deadlock', config: { ordered: false }, actions: [0,1], cursor: 1 };
  assert.deepEqual(decodeSession(encodeSession(s)), { schemaVersion: 1, kind: 'model-trace', ...s });
});
test('untrusted replay cannot execute code or exceed resource bounds', () => {
  assert.throws(() => decodeSession('{"schemaVersion":1,"kind":"model-trace","scene":"evil","actions":[],"cursor":0}'));
  assert.throws(() => encodeSession({scene:'deadlock',actions:[4],cursor:1,config:{}}));
  assert.throws(() => encodeSession({scene:'deadlock',actions:[0],cursor:2,config:{}}));
  assert.throws(() => decodeSession('x'.repeat(500001)));
  assert.throws(() => encodeSession({scene:'deadlock',actions:Array(2001).fill(0),cursor:0,config:{}}));
  assert.throws(() => encodeSession({scene:'memory',actions:[],cursor:0,config:{lineSize:0}}));
});
test('imported measurements retain external provenance, never become locally measured', () => {
  const report = {schemaVersion:1,kind:'measured',createdAt:'2026-10-24T00:00:00Z',environment:{runtime:'native'},rows:[{size:1024,backend:'openmp',samples:[1,2,3],correctness:true,timingScope:'end-to-end',summary:{mean:2,median:2,ci95:[0,4]}}]};
  const imported = validateMeasuredImport(report);
  assert.equal(imported.kind,'imported');
  assert.equal(imported.rows[0].backend,'openmp');
  assert.throws(() => validateMeasuredImport({...report,rows:[{...report.rows[0],samples:[-1]}]}));
  assert.throws(() => validateMeasuredImport({...report,rows:[{...report.rows[0],correctness:false}]}));
  assert.throws(() => validateMeasuredImport({...report,rows:[{...report.rows[0],size:1e20}]}));
});
test('progress requires correct transfer answer, not merely opening a scene', () => {
  const p = makeProgress();
  const wrong = recordAnswer(p,'deadlock','transfer',false);
  assert.equal(wrong.deadlock.mastered,false);
  const challenge = recordAnswer(wrong,'deadlock','challenge',true);
  assert.equal(challenge.deadlock.mastered,false);
  const finished = recordAnswer(challenge,'deadlock','transfer',true);
  assert.equal(finished.deadlock.mastered,true);
  assert.equal(p.deadlock.attempts,0);
});
