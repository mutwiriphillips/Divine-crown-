#!/usr/bin/env node
/**
 * Low-memory hosting helper. `next build` needs about 1 GB of RAM, more than Render's free (and Starter) plans
 * have, so the build is done beforehand and committed to the repository as ./prebuilt.
 *
 *   npm run pack-build    build the app, then save the result in ./prebuilt   (run after any code change)
 *   npm run use-prebuilt  used by the host: restores ./prebuilt to ./.next, refusing if the code has changed
 *                         since it was packed (so a stale build can never go live)
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const INPUTS = ["src", "public", "next.config.ts", "tailwind.config.ts", "postcss.config.mjs", "tsconfig.json", "package-lock.json"];

function walk(p, out = []) {
  if (!existsSync(p)) return out;
  if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) walk(path.join(p, f), out);
  else out.push(p);
  return out;
}
function sourceHash() {
  const h = createHash("sha256");
  for (const input of INPUTS) for (const f of walk(path.join(root, input))) h.update(path.relative(root, f).split(path.sep).join("/")).update(readFileSync(f).toString("utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex");
}

const cmd = process.argv[2];
if (cmd === "pack") {
  rmSync(".next", { recursive: true, force: true });
  execSync("npx next build", { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
  rmSync("prebuilt", { recursive: true, force: true });
  mkdirSync("prebuilt");
  cpSync(".next", "prebuilt/next", { recursive: true, filter: (s) => !s.split(path.sep).includes("cache") });
  writeFileSync("prebuilt/INFO.json", JSON.stringify({ sourceHash: sourceHash(), builtAt: new Date().toISOString(), node: process.version }, null, 2) + "\n");
  console.log("Saved ./prebuilt. Commit it together with your code changes.");
} else if (cmd === "use") {
  if (existsSync(".next/BUILD_ID")) {
    console.log("A build already exists; using it.");
    process.exit(0);
  }
  if (!existsSync("prebuilt/INFO.json")) {
    console.error("No ./prebuilt folder. Run `npm run pack-build` on your computer and commit the result.");
    process.exit(1);
  }
  const info = JSON.parse(readFileSync("prebuilt/INFO.json", "utf8"));
  if (info.sourceHash !== sourceHash()) {
    console.error("The code has changed since ./prebuilt was made. Run `npm run pack-build` and commit ./prebuilt again.");
    process.exit(1);
  }
  rmSync(".next", { recursive: true, force: true });
  cpSync("prebuilt/next", ".next", { recursive: true });
  console.log(`Restored the build made ${info.builtAt}.`);
} else {
  console.error("Usage: prebuilt.mjs pack|use");
  process.exit(1);
}
