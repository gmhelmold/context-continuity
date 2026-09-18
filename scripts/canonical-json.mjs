/** Compatibility CLI and exports. One serializer, owned by the core. */
import { canonical, parseJSON } from '../packages/core/src/canonical.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export { canonical, hash, parseJSON } from '../packages/core/src/canonical.mjs';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(canonical(parseJSON(readFileSync(0, 'utf8')))); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
}
