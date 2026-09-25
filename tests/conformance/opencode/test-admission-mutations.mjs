/** P13 mutation control for existing synthetic gateway admission assertions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const gateway='tests/conformance/opencode/gateway-plugin.mjs';
const title='P13 synthetic component admission guard matrix';
const mutants=[
  {name:'local-secret-check',anchor:'if(!safeEqual(req.headers["x-cc-local"],secret))throw error("E_LOCAL_AUTH");',replacement:'if(false)throw error("E_LOCAL_AUTH");',assertion:'P13_ASSERT_rejected:wrong-local'},
  {name:'capture-activity-check',anchor:'captures.assertActive(token,capture);',replacement:'void 0;',assertion:'P13_ASSERT_rejected:revoked-during-read'},
  {name:'model-messages-profile-check',anchor:'if(body.model!=="probe"||!Array.isArray(body.messages))throw error("E_PROFILE");',replacement:'if(false)throw error("E_PROFILE");',assertion:'P13_ASSERT_rejected:wrong-model'},
  {name:'one-mib-body-limit',anchor:'if(size>1024*1024)throw error("E_BODY_LIMIT");',replacement:'if(false)throw error("E_BODY_LIMIT");',assertion:'P13_ASSERT_rejected:oversized-body'},
  {name:'in-memory-session-state',anchor:'if(body.model!=="probe"||!Array.isArray(body.messages))throw error("E_PROFILE");',replacement:'state(capture.session).epoch++;state(capture.session).view=[{config:"in-memory-mutation"}];if(body.model!=="probe"||!Array.isArray(body.messages))throw error("E_PROFILE");',assertion:'P13_ASSERT_behavior:wrong-model'}
];
function copyRequired(directory) {
  mkdirSync(join(directory,'tests/conformance/opencode'),{recursive:true});mkdirSync(join(directory,'scripts'),{recursive:true});mkdirSync(join(directory,'packages/core/src'),{recursive:true});
  for(const file of ['test-components.mjs','gateway-plugin.mjs','probe-captures.mjs','probe-protocol.mjs','probe-transport.mjs'])cpSync(join(root,'tests/conformance/opencode',file),join(directory,'tests/conformance/opencode',file));
  cpSync(join(root,'scripts/canonical-json.mjs'),join(directory,'scripts/canonical-json.mjs'));
  cpSync(join(root,'packages/core/src/canonical.mjs'),join(directory,'packages/core/src/canonical.mjs'));
}
function run(directory) {
  const env={...process.env,HOME:join(directory,'home'),XDG_CONFIG_HOME:join(directory,'xdg-config'),XDG_CACHE_HOME:join(directory,'xdg-cache'),XDG_DATA_HOME:join(directory,'xdg-data')};
  for(const key of Object.keys(env))if(/^(CC_|.*(?:API|AUTH|CREDENTIAL|KEY|SECRET|TOKEN).*)$/i.test(key))delete env[key];
  delete env.NODE_TEST_CONTEXT;
  for(const path of [env.HOME,env.XDG_CONFIG_HOME,env.XDG_CACHE_HOME,env.XDG_DATA_HOME])mkdirSync(path,{recursive:true});
  return spawnSync(process.execPath,['--test','--test-reporter=tap',`--test-name-pattern=^${title}$`,'tests/conformance/opencode/test-components.mjs'],{cwd:directory,env,encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024});
}
test('P13 admission mutations: control passes; named assertions reject four defective guards',()=>{
  for(const mutant of [{name:'control'},...mutants]) {
    const directory=mkdtempSync(join(tmpdir(),'cc-p13-mutation-'));
    try {
      copyRequired(directory);
      if(mutant.anchor) {
        const source=readFileSync(join(directory,gateway),'utf8');
        assert.equal(source.split(mutant.anchor).length-1,1,`P13_MUTATION_ASSERT_anchor:${mutant.name}`);
        writeFileSync(join(directory,gateway),source.replace(mutant.anchor,mutant.replacement));
      }
      const result=run(directory),output=result.stdout+result.stderr;
      assert.equal(result.error,undefined,`P13_MUTATION_ASSERT_setup:${mutant.name}`);
      assert.equal(result.signal,null,`P13_MUTATION_ASSERT_signal:${mutant.name}`);
      if(mutant.name==='control') {
        assert.equal(result.status,0,`P13_MUTATION_ASSERT_control:${output}`);
        assert.match(output,new RegExp(`ok \\d+ - ${title}`));
        console.log('P13_MUTATION control pass');
      } else {
        assert.notEqual(result.status,0,`P13_MUTATION_ASSERT_survived:${mutant.name}`);
        assert.match(output,new RegExp(mutant.assertion),`P13_MUTATION_ASSERT_wrong_failure:${mutant.name}`);
        assert.doesNotMatch(output,/TEST_DEADLINE|P13_MUTATION_ASSERT_(?:setup|signal)/,`P13_MUTATION_ASSERT_nondeterministic:${mutant.name}`);
        console.log(`P13_MUTATION ${mutant.name} rejected by ${mutant.assertion}`);
      }
    } finally {rmSync(directory,{recursive:true,force:true});}
  }
});
