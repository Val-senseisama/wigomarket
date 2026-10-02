/**
 * Route HTTP upgrade requests to the WebSocket server that owns the path.
 *
 * Every ws server here runs in noServer mode and is reached only through this
 * router: a ws server attached directly with `server` answers 400 to upgrades
 * for paths it does not own, so two of them on one HTTP server would break
 * each other.
 *
 * @param {import("http").Server} server
 * @param {Record<string, { handleUpgrade(req, socket, head): void }>} routes
 *        pathname → WebSocket server
 */
function attachWebSockets(server, routes) {
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    const target = routes[pathname];
    if (!target) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head);
  });
}

module.exports = { attachWebSockets };
