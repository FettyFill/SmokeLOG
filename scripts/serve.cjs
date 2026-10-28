const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = new Set(['index.html', 'app.js', 'insights.js', 'style.css', 'service-worker.js', 'manifest.webmanifest', 'privacy.html', 'terms.html']);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function startServer() { return http.createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (name === 'supabase-config.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end('window.SMOKELOG_SUPABASE_CONFIG = {};');
    return;
  }
  if (!allowed.has(name) && !/^icons\/[a-z0-9-]+\.(svg|png)$/.test(name)) { response.writeHead(404); response.end(); return; }
  fs.readFile(path.join(root, name), (error, data) => {
    response.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(error ? '' : data);
  });
}).listen(49173, '127.0.0.1'); }
module.exports = { startServer };
if (require.main === module) startServer().on('listening', () => console.log('SmokeLOG preview: http://127.0.0.1:49173 (cloud disabled)'));

