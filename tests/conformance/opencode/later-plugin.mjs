import {readFileSync} from "node:fs";
export default async function laterPlugin(){return {
 "experimental.chat.system.transform":async (_input,output)=>{
  const c=JSON.parse(readFileSync(process.env.CC_CONTROL,"utf8"));
  output.system.push("CC_POLICY="+(c.policy??0));
 }
};}
