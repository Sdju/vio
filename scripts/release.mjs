import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Select by a real workspace manifest; never interpolate workflow input into a shell.
const selected = process.env.RELEASE_WORKSPACE ?? "@zede/vio";
const dryRun = process.env.RELEASE_DRY_RUN ?? "true";
if (!["true", "false"].includes(dryRun)) throw new Error("RELEASE_DRY_RUN must be true or false");
const packages = readdirSync("packages", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    path: join("packages", entry.name),
    ...JSON.parse(readFileSync(join("packages", entry.name, "package.json"), "utf8")),
  }));
const pkg = packages.find((item) => item.name === selected && !item.private);
if (!pkg) throw new Error(`Unknown or private workspace: ${selected}`);
if (pkg.repository?.url !== "git+https://github.com/Sdju/vio.git")
  throw new Error("Release repository metadata must match Sdju/vio");
if (pkg.publishConfig?.access !== "public")
  throw new Error("Release packages must declare public access");
if (dryRun === "false") {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "Sdju/vio" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  ) {
    throw new Error("Publish only through the OIDC workflow on Sdju/vio main");
  }
}
const directory = mkdtempSync(join(tmpdir(), "vio-release-"));
try {
  // pnpm resolves workspace: ranges in the archive before npm performs the OIDC publish.
  execFileSync("vp", ["pm", "pack", "--filter", pkg.name, "--pack-destination", directory], {
    stdio: "inherit",
  });
  const archives = readdirSync(directory).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("Expected exactly one package archive");
  const args = ["publish", join(directory, archives[0]), "--access", "public"];
  if (dryRun === "true") args.push("--dry-run");
  console.log(`${dryRun === "true" ? "Validate" : "Publish"} ${pkg.name}@${pkg.version}`);
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: pkg.path,
    stdio: "inherit",
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
