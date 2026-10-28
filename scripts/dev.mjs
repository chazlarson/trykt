import { spawn } from "node:child_process";

const scripts = ["dev:web", "dev:worker"];
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 400);
}

for (const script of scripts) {
  const child = spawn("pnpm", ["run", script], {
    stdio: "inherit",
    env: process.env,
    detached: true,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (signal || code) stop(code && code !== 0 ? code : 1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
