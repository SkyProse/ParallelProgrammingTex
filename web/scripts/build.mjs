import {cp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {SCENES} from '../src/content/curriculum.js';
const root = fileURLToPath(new URL('../',import.meta.url));
const out = path.join(root,'dist');
await rm(out,{recursive:true,force:true});
await mkdir(path.join(out,'vendor','three'),{recursive:true});
for (const name of ['src','public']) await cp(path.join(root,name),path.join(out,name === 'public' ? '' : name),{recursive:true});
await cp(path.join(root,'index.html'),path.join(out,'index.html'));
for(const scene of SCENES){const dest=path.join(out,'sources',scene.source.path);await mkdir(path.dirname(dest),{recursive:true});await cp(path.join(root,'..',scene.source.path),dest);}
for (const name of ['three.webgpu.js','three.core.js','three.tsl.js']) await cp(path.join(root,'node_modules/three/build',name),path.join(out,'vendor/three',name));
await cp(path.join(root,'node_modules/three/examples/jsm/controls/OrbitControls.js'),path.join(out,'vendor/three/OrbitControls.js'));
await cp(path.join(root,'node_modules/three/LICENSE'),path.join(out,'vendor/three/LICENSE.txt'));
const p = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
let implementationCommit=null;
try{implementationCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
await writeFile(path.join(out,'build-info.json'),JSON.stringify({version:p.version,three:p.dependencies.three,sourceCommit:'1c53d6eb08a7d0041a6f54728b6ba90a59507454',implementationCommit,format:2},null,2));
console.log('Built Concurrency Theatre → web/dist (local assets; no runtime CDN).');
