# PolySmith

PolySmith is a local-first desktop CAD application for hobbyists who want a clean, modern workflow for designing 3D-printable parts.

---

## 🚀 Local Development

> **Heads-up:** PolySmith bundles a vendored OpenCascade source tree as a git submodule. Always clone with submodules and bootstrap before running the app, otherwise the native CAD core will fail to build.

### 1. Clone with submodules

```bash
git clone --recurse-submodules https://github.com/stefan-ovezea/polysmith.git
cd polysmith
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

### 2. Install prerequisites

PolySmith needs a JavaScript toolchain, a Rust toolchain (for Tauri), a C++ toolchain, and CMake.

| Tool   | Minimum version          |
| ------ | ------------------------ |
| `pnpm` | 9.x                      |
| `node` | 20.x                     |
| Rust   | stable (`rustup` latest) |
| CMake  | 3.20 or newer            |
| C++    | C++20-capable compiler   |

Install them on your platform:

#### macOS

```bash
# Xcode command-line tools (clang + make)
xcode-select --install

# Homebrew dependencies
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
nvm install 24
corepack enable pnpm

# Rust toolchain (for Tauri)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

#### Linux (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install -y \
  build-essential cmake git pkg-config \
  libfreetype6-dev libfontconfig1-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  libssl-dev curl libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
sudo apt install -y tcl-dev tk-dev libfreetype-dev libx11-dev

# Node + pnpm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
nvm install 24
corepack enable pnpm

# Rust toolchain (for Tauri)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

For other distributions, follow the [Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/) and make sure CMake, a C++20 compiler, and FreeType development headers are present.

#### Windows

1. Install **Visual Studio 2022** with the _Desktop development with C++_ workload (provides MSVC + Windows SDK + CMake).
2. Install **Rust** via [rustup-init.exe](https://rustup.rs/) and select the `stable-x86_64-pc-windows-msvc` toolchain.
3. Install **Node.js 20** and enable Corepack:
   ```powershell
   powershell -c "irm https://community.chocolatey.org/install.ps1|iex"
   choco install nodejs --version="24.15.0"
   corepack enable pnpm
   corepack prepare pnpm@latest --activate
   ```
4. Install **WebView2 Runtime** (Tauri requirement) — pre-installed on Windows 11.

Run all PolySmith commands from the **x64 Native Tools Command Prompt for VS 2022** so MSVC is on `PATH`.

### 3. Bootstrap (first-time only)

The first build compiles OpenCascade locally, so it can take 10–30 minutes depending on your machine. You only need to do this once.

```bash
pnpm bootstrap
```

This single command runs:

```bash
pnpm deps:sync         # sync git submodules
pnpm install           # install JS deps
pnpm occt:configure    # configure OpenCascade
pnpm occt:build        # build OpenCascade
pnpm occt:install      # install OpenCascade to third_party/occt-install
pnpm core:configure    # configure native CAD core
pnpm core:build        # build native CAD core (native/cad-core/build/cad_core)
```

You can run those steps individually if a single phase fails and you want to retry from there.

### 4. Run the desktop app

```bash
pnpm dev
```

This starts the Vite frontend and the Tauri desktop shell. `pnpm dev` expects `native/cad-core/build/cad_core` to already exist — make sure step 3 completed.

### 5. Iterate

| Task                                   | Command                                      |
| -------------------------------------- | -------------------------------------------- |
| Run UI only (no Tauri, no CAD core)    | `pnpm ui:dev`                                |
| Rebuild the C++ CAD core after changes | `pnpm core:rebuild`                          |
| Rebuild OpenCascade (rare)             | `pnpm occt:rebuild`                          |
| Type-check the UI                      | `pnpm --filter desktop-ui exec tsc --noEmit` |

---

## Release Build

After completing the bootstrap step, build a release executable with:

```bash
pnpm build:release
```

Which runs this command:

```bash
cmake -S native/cad-core -B native/cad-core/build-release -DCMAKE_BUILD_TYPE=Release
cmake --build native/cad-core/build-release --config Release
pnpm --filter desktop-ui exec tauri build --bundles app
```

The script copies the release `cad_core` binary into the Tauri resources folder before packaging, so the built app uses the bundled CAD core instead of the workspace development path.

On macOS, the main outputs are:

```text
apps/desktop-ui/src-tauri/target/release/polysmith
apps/desktop-ui/src-tauri/target/release/bundle/macos/polysmith.app
```

---

## V1 Focus

PolySmith v1 is intentionally narrow:

- Single-part parametric modeling
- Desktop-first, offline-first workflows
- A familiar, modern parametric CAD experience
- A strong architecture boundary between UI and native CAD logic

## Non-Goals

PolySmith does not currently aim to support:

- CAM / CNC workflows
- Simulation / FEA
- Cloud collaboration
- Enterprise features
- Complex assemblies

## Architecture Snapshot

PolySmith is built as a desktop application with three main layers:

- UI: React + TypeScript
- Desktop shell: Tauri
- CAD core: C++ + OpenCascade

Communication between the UI and CAD core happens over a JSON IPC protocol.

Architecture rule:

- React owns presentation and user intent only
- The native CAD core owns CAD state, document state, geometry, feature history, and modeling behavior

## Repository Layout

```text
apps/
  desktop-ui/      React + Tauri application

native/
  cad-core/        C++ CAD core built with CMake

protocol/
  schema/          IPC message schemas

wiki/
  polysmith.wiki/  GitHub wiki submodule — all documentation

third_party/
  occt/            Vendored OpenCascade source
```

## Current Status

PolySmith is in early development.

The current focus is:

- hardening the IPC boundary between UI and CAD core
- establishing document lifecycle and core-owned state flow
- building the smallest useful modeling foundation for a narrow v1

At the moment, the repository contains:

- a React + Tauri desktop shell
- a native CAD core bootstrap
- an OpenCascade smoke test
- a minimal IPC handshake and ping flow

## Wiki

All project documentation has moved to the [GitHub wiki](wiki/polysmith.wiki/Home.md).

Key pages:

- [Architecture Overview](wiki/polysmith.wiki/Architecture-Overview.md)
- [IPC Protocol](wiki/polysmith.wiki/IPC-Protocol.md)
- [Repository Map](wiki/polysmith.wiki/Repository-Map.md)
- [V1 Roadmap](wiki/polysmith.wiki/V1-Roadmap.md)
- [ADR 0001: Initial Tech Stack](wiki/polysmith.wiki/ADR-0001-Tech-Stack.md)

## License

PolySmith is licensed under the GNU Affero General Public License v3.0 or later.
See [LICENSE](LICENSE) for the full license text.
