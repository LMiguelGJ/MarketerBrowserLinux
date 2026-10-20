import http from 'node:http';

/**
 * Controlled test site used by the e2e suite.
 *
 * It exposes one page with an input and a button so a test can prove that
 * input typed through the viewer reached the page and that the page state
 * survived a restart.
 */
export function startTestSite() {
  const state = { value: '' };

  const server = http.createServer(async (req, res) => {
    if (req.url === '/value') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ value: state.value }));
      return;
    }
    if (req.url === '/set' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        state.value = String(body.value ?? '');
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid body' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ value: state.value }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>MBL test site</title></head>
  <body>
    <h1 id="title">MBL test site</h1>
    <input id="field" type="text" />
    <button id="save" type="button">Save</button>
    <p id="stored"></p>
    <script>
      const field = document.getElementById('field');
      const stored = document.getElementById('stored');
      document.getElementById('save').addEventListener('click', async () => {
        const response = await fetch('/set', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: field.value }),
        });
        const body = await response.json();
        stored.textContent = body.value;
      });
      fetch('/value').then((r) => r.json()).then((body) => {
        field.value = body.value;
        stored.textContent = body.value;
      });
    </script>
  </body>
</html>`);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/`,
        state,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
