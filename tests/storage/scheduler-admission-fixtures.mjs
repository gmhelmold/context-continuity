import {WorkspaceCoordinator} from '../../packages/storage/src/index.ts';
import {fixture as jobFixture,amount,binding,id,proposal,response,sql,exec,workspace} from './job-fixtures.mjs';

export {amount,binding,id,proposal,response,sql,exec,workspace};
export function fixture(fn,settings={}) {
 return jobFixture(f=>{
  WorkspaceCoordinator.initialize(f.directory,workspace);const coordinator=WorkspaceCoordinator.open(f.directory,workspace);
  const result=fn({...f,coordinator});
  if(result?.then)return result.finally(()=>coordinator.close());
  coordinator.close();return result;
 },settings);
}
