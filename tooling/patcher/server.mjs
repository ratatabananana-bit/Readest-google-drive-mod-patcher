// Local web "patcher" for the Readest Drive-sync mod.
//
// A tiny zero-dependency server (Node built-ins only) that drives the
// self-contained pipeline (pipeline.mjs) behind a browser UI with a live,
// streaming log. The whole product is the readest-gdrive-sync-mod folder: this
// clones Readest into work/, overlays the mod, and builds — no bash, no
// pre-existing checkout. Binds to localhost only.
//
// Run via start-patcher.cmd (double-click) or: node server.mjs

import { createServer } from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  runCheck,
  runUpdate,
  runBuild,
  state,
  listVersions,
  effectiveClientId,
} from './pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8787;
// Per-builder override of the bundled default Google client, entered in the UI.
// Gitignored — never shipped. The pipeline derives the build's .env.local + the
// reverse-DNS deep-link scheme from whichever client id is effective.
const CREDS_FILE = join(HERE, '..', 'mod', 'credentials.env');

// One build at a time — concurrent builds fight over the cargo / Next.js build
// locks and hang. Stays true until the pipeline actually finishes (even if the
// browser tab closes mid-build), so a second run can't start on top of it.
let buildRunning = false;

/** Collect a request body into a string (for the small POST endpoints). */
const readBody = (request) =>
  new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => resolve(data));
  });

// Each action maps to a pipeline function with the shape (ref, onLine) -> code.
const ACTIONS = {
  check: runCheck,
  update: runUpdate,
  build: (_ref, onLine) => runBuild(onLine),
};

const sendJson = (response, body) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === '/') {
      const html = await readFile(join(HERE, 'index.html'));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (url.pathname === '/api/state') return sendJson(response, await state());
    if (url.pathname === '/api/tags') return sendJson(response, await listVersions());

    if (url.pathname === '/api/creds') {
      if (request.method === 'POST') {
        const body = JSON.parse((await readBody(request)) || '{}');
        const clientId = String(body.clientId ?? '').trim();
        // A client id writes the override; an empty value clears it and reverts
        // to the bundled default. No secret — the iOS client type has none.
        if (clientId) {
          await writeFile(CREDS_FILE, `NEXT_PUBLIC_GOOGLE_CLIENT_ID=${clientId}\n`);
        } else {
          await rm(CREDS_FILE, { force: true });
        }
        return sendJson(response, { ok: true });
      }
      // GET: the effective client id + whether it is the bundled default.
      const { clientId, isDefault } = await effectiveClientId();
      return sendJson(response, { clientId, isDefault, configured: clientId.length > 0 });
    }

    if (url.pathname === '/api/run') {
      const action = url.searchParams.get('action') ?? '';
      const ref = url.searchParams.get('ref') ?? '';
      const fn = ACTIONS[action];
      if (!fn) {
        response.writeHead(400);
        response.end('unknown action');
        return;
      }
      // Validate the version against the real tag list — never trust raw input
      // (build ignores ref, so it is exempt).
      if (action !== 'build') {
        const versions = await listVersions();
        if (!versions.includes(ref)) {
          response.writeHead(400);
          response.end('unknown version');
          return;
        }
      }

      if (buildRunning) {
        response.writeHead(409);
        response.end('a build is already running — wait for it to finish');
        return;
      }
      buildRunning = true;

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const onLine = (line) => response.write(`data: ${String(line).replace(/[\r\n]+/g, ' ')}\n\n`);
      let responseEnded = false;
      const endResponse = (code) => {
        if (responseEnded) return;
        responseEnded = true;
        if (code !== null) response.write(`event: done\ndata: ${code}\n\n`);
        response.end();
      };
      // Closing the browser ends the SSE response but does NOT cancel the build —
      // buildRunning stays set (cleared in `finally`) so nothing starts on top of it.
      request.on('close', () => endResponse(null));
      fn(ref, onLine)
        .then((code) => endResponse(code))
        .catch((err) => {
          onLine(`PIPELINE ERROR: ${err.message}`);
          endResponse(1);
        })
        .finally(() => {
          buildRunning = false;
        });
      return;
    }

    response.writeHead(404);
    response.end('not found');
  } catch (err) {
    response.writeHead(500);
    response.end(`server error: ${err.message}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Readest mod patcher → http://localhost:${PORT}`);
});
