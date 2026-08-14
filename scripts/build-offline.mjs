import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '..');
const artifactRoot = resolve(workspaceRoot, 'artifacts/emc-admission');
const distRoot = resolve(artifactRoot, 'dist/public');
const sourcePublic = resolve(artifactRoot, 'public');
// The standalone file is opened from file://, so it cannot use relative /api
// routes. Prefer the current API server for Operating Theatre session handling
// and Cloud Backup. Direct TrakCare remains the fallback for internal-network
// workstations when the API server cannot be reached.
// Keep the standalone download usable without the optional local bridge.
// The launcher adds the bridge URL as a query parameter when it starts it.
// An explicit build-time URL remains available for controlled deployments.
const offlineApiBaseUrl = process.env.OFFLINE_API_BASE_URL || '';
const offlineOperatingTheatreProxyBase = process.env.OFFLINE_OT_PROXY_BASE || '';

const template = await readFile(resolve(distRoot, 'index.html'), 'utf8');
const cssAssets = [...template.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
  .map((match) => match[1]);
const jsAssets = [...template.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)]
  .map((match) => match[1]);
if (cssAssets.length !== 1 || jsAssets.length !== 1) {
  throw new Error(
    `Offline build must have one CSS and one JS asset; found ${cssAssets.length} CSS and ${jsAssets.length} JS`,
  );
}
const css = await readFile(resolve(distRoot, cssAssets[0].replace(/^\//, '')), 'utf8');
const js = await readFile(resolve(distRoot, jsAssets[0].replace(/^\//, '')), 'utf8');

// Vite emits the entry module's exports at the end of the bundle. The normal
// HTML loads the file as `type="module"`, but the standalone file evaluates
// the inlined bundle as a classic script. Remove only that final entry export
// so opening ipaw.html from file:// does not fail with "Unexpected token export".
const offlineJs = js.replace(/export\s*\{[^}]*\}\s*;?\s*$/, '');
if (/\bexport\s*\{/.test(offlineJs)) {
  throw new Error('Offline bundle still contains an export statement.');
}

// Do not insert the generated source directly into <script> or <style>.
// Libraries used by the app contain HTML templates such as "</script>" and
// "</style>" in string literals. The HTML parser would treat those strings as
// real closing tags and display the rest of the bundle as page text. Base64
// keeps the payload opaque to the parser; the small bootstrap decodes CSS,
// appends it, then evaluates the bundled app.
const cssBase64 = Buffer.from(css, 'utf8').toString('base64');
const jsBase64 = Buffer.from(offlineJs, 'utf8').toString('base64');
function buildStandaloneHtml({ localFirst, gasHosted = false, fileName }) {
  const bootstrap = `<script>(function(){globalThis.__IPAW_OFFLINE_API_BASE__=${JSON.stringify(offlineApiBaseUrl)};globalThis.__IPAW_OFFLINE_OT_PROXY_BASE__=${JSON.stringify(offlineOperatingTheatreProxyBase)};globalThis.__IPAW_LOCAL_FIRST__=${JSON.stringify(localFirst)};globalThis.__IPAW_GAS_HOSTED__=${JSON.stringify(gasHosted)};function d(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return new TextDecoder().decode(u)}function run(){var c=document.createElement('style');c.textContent=d('${cssBase64}');document.head.appendChild(c);(0,eval)(d('${jsBase64}'))}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run,{once:true})}else{run()}})();</script>`;
  const offlineHtml = template
    .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, bootstrap)
    .replace(/<link rel="stylesheet"[^>]*href="[^"]+"[^>]*>/, '')
    .replace(/<link rel="icon"[^>]*>/, '')
    .replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex, nofollow" />');
  const output = `<!doctype html>\n${offlineHtml.trim()}\n`;
  const sourceOutput = resolve(sourcePublic, fileName);
  const distOutput = resolve(distRoot, fileName);
  return { output, sourceOutput, distOutput };
}

for (const build of [
  buildStandaloneHtml({ localFirst: false, fileName: 'ipaw.html' }),
  buildStandaloneHtml({ localFirst: true, fileName: 'ipawv2.html' }),
  buildStandaloneHtml({ localFirst: false, gasHosted: true, fileName: 'ipawv3.html' }),
]) {
  await writeFile(build.sourceOutput, build.output, 'utf8');
  // Vite copies public/ before this script runs. Replace the copied file too,
  // otherwise production downloads would contain the previous build's bundle.
  await writeFile(build.distOutput, build.output, 'utf8');
  if (
    build.output.match(/<script[^>]+src=/i) ||
    build.output.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=/i)
  ) {
    throw new Error(`Offline HTML ${build.sourceOutput} masih memiliki asset eksternal.`);
  }
  console.log(`Wrote ${build.sourceOutput}`);
  console.log(`Wrote ${build.distOutput}`);
}

if (/\bexport\s*\{/.test(offlineJs)) {
  throw new Error('Offline bundle masih memiliki export statement.');
}