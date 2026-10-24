const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('corrected POSIX example compiles strictly and handles uneven/empty partitions', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theatre-posix-'));
  try {
    const binary=path.join(dir,'pthreads-add');
    const compile=spawnSync(process.env.CC||'cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-pedantic','-pthread',path.join(root,'native/pthreads_add.c'),'-o',binary],{encoding:'utf8'});
    assert.equal(compile.status,0,compile.stderr || String(compile.error));
    for (const [size,threads] of [[0,1],[1,8],[10,2],[11,3],[100003,7],[7,64]]) {
      const result=spawnSync(binary,[String(size),String(threads)],{encoding:'utf8',timeout:10000});
      assert.equal(result.status,0,result.stderr);
      const data=JSON.parse(result.stdout);
      assert.equal(data.verified,true);
      assert.equal(data.size,size);
      assert.equal(data.threads,threads);
      assert.equal(data.sum,size*(size-1)/2+10*size);
    }
    for (const args of [['-1','2'],['10','0'],['abc','2'],['1.5','2'],['10','999999'],['+1','2'],['','2'],['10','2','extra']]) {
      const result=spawnSync(binary,args,{encoding:'utf8',timeout:10000});
      assert.notEqual(result.status,0,JSON.stringify(args));
      assert.equal(result.stdout,'');
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
