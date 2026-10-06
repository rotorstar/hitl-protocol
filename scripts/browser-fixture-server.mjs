/** Serve only the public files required by the two standalone browser fixtures. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PUBLIC_FILES = new Map([
  ['assets/hitl-protocol-flow.html', 'text/html'],
  ['playground/index.html', 'text/html'],
  ['assets/logo.svg', 'image/svg+xml'],
  ['assets/protocol-actors-v0.9.png', 'image/png'],
  ['assets/hitl-typography.css', 'text/css'],
  ...['inter-variable', 'jetbrains-mono-regular', 'jetbrains-mono-medium', 'jetbrains-mono-semibold', 'jetbrains-mono-bold'].map(name => [`assets/fonts/${name}.woff2`, 'font/woff2']),
]);

export async function startBrowserFixtureServer(root) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname.slice(1);
    const mime = PUBLIC_FILES.get(path);
    if (!mime) { response.writeHead(404); response.end(); return; }
    try {
      const body = await readFile(resolve(root, path));
      response.writeHead(200, { 'Content-Type': mime }); response.end(body);
    } catch (error) {
      console.error(`Browser fixture could not read ${path}:`, error.message);
      response.writeHead(500); response.end();
    }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
