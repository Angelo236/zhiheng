import { spawn } from "node:child_process";

const children = ["dev:api", "dev:web"].map((script) =>
  spawn("npm", ["run", script], { stdio: "inherit" }),
);

function stop() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) stop();
  });
}
