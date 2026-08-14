import { createServer } from "node:http";
import { config } from "./config.js";
import { createHttpApp } from "./http.js";
import { createSocketServer } from "./socket.js";

const app = createHttpApp();
const httpServer = createServer(app);
createSocketServer(httpServer);

httpServer.listen(config.port, () => {
  console.log(`Chat backend listening on :${config.port} (env=${config.nodeEnv})`);
});
