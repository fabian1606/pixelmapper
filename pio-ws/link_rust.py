Import("env")
import subprocess
import os
import glob

# Builds the rs-engine-ffi static lib for xtensa-esp32s3-espidf.
#
# Prerequisite: user has the Espressif Rust toolchain installed via `espup`.
# After `espup install`, a rustup toolchain named `esp` exists. We force it
# here via the RUSTUP_TOOLCHAIN env var so the workspace's `nightly`
# rust-toolchain.toml doesn't interfere — Xtensa support is only in the
# Espressif fork of LLVM, not upstream nightly.

ffi_dir       = os.path.join(env["PROJECT_DIR"], "..", "rs-engine", "ffi")
workspace_dir = os.path.join(env["PROJECT_DIR"], "..", "rs-engine")
target_triple = "xtensa-esp32s3-espidf"
lib_path      = os.path.join(workspace_dir, "target", target_triple, "release")

# Add xtensa-esp32s3-elf-gcc to PATH (needed by .cargo/config.toml linker setting).
pio_gcc_candidates = glob.glob(os.path.join(
    os.path.expanduser("~"), ".platformio", "packages", "toolchain-xtensa-esp-elf", "bin"
))
for gcc_dir in pio_gcc_candidates:
    if os.path.isdir(gcc_dir):
        os.environ["PATH"] = gcc_dir + os.pathsep + os.environ.get("PATH", "")
        print(f"[link_rust] Added {gcc_dir} to PATH")
        break

# Force the espup-installed toolchain. This overrides rust-toolchain.toml.
os.environ["RUSTUP_TOOLCHAIN"] = "esp"

print(f"[link_rust] Building rs-engine-ffi for {target_triple} (RUSTUP_TOOLCHAIN=esp)...")
which_cargo = subprocess.run(['which', 'cargo'], capture_output=True, text=True).stdout.strip()
rustc_ver   = subprocess.run(['rustc', '+esp', '--version'], capture_output=True, text=True).stdout.strip()
print(f"[link_rust] cargo = {which_cargo}")
print(f"[link_rust] rustc +esp = {rustc_ver}")

result = subprocess.run(
    ["cargo", "build", "--release", "--target", target_triple],
    cwd=ffi_dir,
    capture_output=False,
)

if result.returncode != 0:
    raise Exception(
        "rs-engine-ffi build failed for xtensa-esp32s3-espidf.\n"
        "Hint: install the Espressif Rust toolchain via `espup install`."
    )

env.Append(
    LIBS=["rs_engine_ffi"],
    LIBPATH=[lib_path],
)
