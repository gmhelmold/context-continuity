/** Explicit developer build. No download, install hook, shell or runtime compilation. */
import {readFileSync, realpathSync, mkdirSync, renameSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!['linux','darwin'].includes(process.platform))throw Error('Local POSIX profile required');
const prefix=dirname(dirname(realpathSync(process.execPath)));
const include=process.env.CC_NODE_INCLUDE ? resolve(process.env.CC_NODE_INCLUDE) : join(prefix,'include','node');
const version=readFileSync(join(include,'node_version.h'),'utf8');
const actual=['MAJOR','MINOR','PATCH'].map(k=>version.match(new RegExp('#define NODE_'+k+'_VERSION\\s+(\\d+)'))?.[1]).join('.');
if(actual!==process.versions.node)throw Error('Node headers must match the selected runtime exactly');
const output=join(root,'packages/storage/native/build'); mkdirSync(output,{recursive:true});
const target=join(output,'locks.node'), temporary=target+'.'+process.pid+'.tmp';
const flags=['-std=c11','-Wall','-Wextra','-Werror','-O2','-fPIC','-DNAPI_VERSION=8','-I',include];
if(process.platform==='darwin')flags.push('-bundle','-undefined','dynamic_lookup');
else flags.push('-shared','-D_GNU_SOURCE');
try{
 const result=spawnSync(process.env.CC || 'cc',[...flags,join(root,'packages/storage/native/locks.c'),'-o',temporary],{stdio:'inherit',timeout:60000});
 if(result.error||result.status!==0)throw Error('Native lock build failed');
 renameSync(temporary,target);
 console.log('Built Node-API 8 flock adapter for',process.platform,process.arch,'with Node',actual);
}finally{rmSync(temporary,{force:true});}
