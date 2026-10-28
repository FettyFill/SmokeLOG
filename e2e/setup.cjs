const { once } = require('node:events');
const { startServer } = require('../scripts/serve.cjs');
module.exports = async () => {
  const server = startServer();
  await once(server, 'listening');
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
};
