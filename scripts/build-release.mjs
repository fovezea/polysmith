import { chmodSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const coreFileName = isWindows ? "cad_core.exe" : "cad_core";
const coreBuildDir = join(root, "native", "cad-core", "build-release");
const builtCorePath = join(coreBuildDir, coreFileName);
const resourceCorePath = join(
  root,
  "apps",
  "desktop-ui",
  "src-tauri",
  "resources",
  coreFileName,
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("cmake", [
  "-S",
  "native/cad-core",
  "-B",
  "native/cad-core/build-release",
  "-DCMAKE_BUILD_TYPE=Release",
]);
run("cmake", ["--build", coreBuildDir, "--config", "Release"]);

copyFileSync(builtCorePath, resourceCorePath);
if (!isWindows) {
  chmodSync(resourceCorePath, 0o755);
}

run("pnpm", ["--filter", "desktop-ui", "exec", "tauri", "build", "--bundles", "app"], {
  env: {
    POLYSMITH_CAD_CORE_PATH_KIND: "resource",
    POLYSMITH_CAD_CORE_RESOURCE_PATH: "resources/cad_core",
  },
});
