/** Tests of the tests: only disposable copies contain deliberately incorrect code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
  ['control',null,null,null,null],
  ['source-unchecked','manifest.ts','if (excerptDigest !== e.excerpt_digest) throw new ManifestError();','void end;','T06.contract Manifest: excerpt ranges are exact UTF-8 bytes, including CRLF/BOM'],
  ['navigation-as-evidence','proposal.ts',"if (manifest.entries[index - 1]?.presented_as === 'reference_only')",'if (false)', 'T37.contract Proposal: citations require actual presented entries and nonempty unique indices'],
  ['finish-ignored','proposal.ts',"if (terminal !== 'complete') throw new ProposalError('E_PROTOCOL');",'void terminal;', 'T06.contract Proposal: transport finisher overrides valid-looking JSON'],
  ['payload-unchecked','frame.ts',"if (unit.payload_digest !== hashPayload(history.slice(at, at + count))) throw new FrameError('E_STALE');",'void count;', 'T06.contract Frame: changed final payload is rejected without mutating root registry'],
  ['metadata-unbound','frame.ts','fields: nonhistory, history_prefix: prefix','fields: null, history_prefix: prefix','T06.contract Frame messages: every nonhistorical field is bound even if no special key names it'],
  ['protocol-group-unchecked','frame.ts',"if (!profileAcceptsGroups(profile,Object.freeze(protocolGroups))) throw new FrameError('E_PROTOCOL');",'void protocolGroups;', 'D04: unsafe split agreeing with registry and payload is still refused by the codec'],
  ['model-identity-unchecked','frame.ts',"if (!profileMatches(profile,body,{route_id:route,model_id:model,variant,history_key:historyKey})) throw new FrameError('E_PROTOCOL');",'void profile;', 'D05: changed wire model cannot be sealed against an old resolved identity'],
];
test('WP-01/C: control plus seven incorrect context implementations are distinguished', {timeout:60000},()=>{
  for(const [name,file,from,to,expected] of cases){
    const dir=mkdtempSync(join(tmpdir(),'cc-context-mutation-'));
    try{
      mkdirSync(join(dir,'packages/core'),{recursive:true});mkdirSync(join(dir,'tests/core'),{recursive:true});
      writeFileSync(join(dir,'package.json'),'{"type":"module"}');
      cpSync(join(root,'packages/core/src'),join(dir,'packages/core/src'),{recursive:true});
      for(const t of ['context-fixtures.mjs','manifest.test.mjs','proposal.test.mjs','frame.test.mjs','terminal-profile.test.mjs']) cpSync(join(root,'tests/core',t),join(dir,'tests/core',t));
      if(file){const path=join(dir,'packages/core/src',file),s=readFileSync(path,'utf8');assert.equal(s.split(from).length,2,name+': mutation must be unique');writeFileSync(path,s.replace(from,to));}
      const env={...process.env};delete env.NODE_TEST_CONTEXT;
      const run=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','tests/core/manifest.test.mjs','tests/core/proposal.test.mjs','tests/core/frame.test.mjs','tests/core/terminal-profile.test.mjs'],{cwd:dir,env,encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
      assert.equal(run.error,undefined,name+': runner error is not detection');assert.equal(run.signal,null);
      assert.match(run.stdout,/^# tests 45$/m,name+': all selected tests must execute');
      if(name==='control')assert.equal(run.status,0,run.stdout+run.stderr);
      else{
        assert.equal(run.status,1,name+': incorrect implementation survived');
        assert.ok(run.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.endsWith(' - '+expected)),name+': unrelated failure is not detection');
      }
    } finally {rmSync(dir,{recursive:true,force:true});}
  }
});
