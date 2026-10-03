// PM2 process file. From the repo root on the VPS:
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
// All apps read the single .env at the repo root.
const path = require("node:path");

const root = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "swellfi-api",
      cwd: path.join(root, "apps/api"),
      script: "dist/index.js",
      node_args: `--env-file=${path.join(root, ".env")} --enable-source-maps`,
      // Rate limits live in Redis and WS fan-out goes through Redis pub/sub, so more API
      // processes can be added later (separate ports behind the Nginx upstream).
      exec_mode: "fork",
      instances: 1,
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",
      kill_timeout: 10000,
      time: true,
    },
    {
      // Hyperliquid fills -> feed events, rankings and profile stats. One instance only.
      name: "swellfi-indexer",
      cwd: path.join(root, "apps/api"),
      script: "dist/indexer-main.js",
      node_args: `--env-file=${path.join(root, ".env")} --enable-source-maps`,
      exec_mode: "fork",
      instances: 1,
      env: { NODE_ENV: "production" },
      max_memory_restart: "384M",
      kill_timeout: 10000,
      time: true,
    },
    {
      name: "swellfi-web",
      cwd: path.join(root, "apps/web"),
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${process.env.WEB_PORT || 3000} -H 127.0.0.1`,
      exec_mode: "fork",
      instances: 1,
      env: { NODE_ENV: "production" },
      max_memory_restart: "768M",
      time: true,
    },
  ],
};
