Import("env")
import subprocess
import os
import glob

# Path to the ffi crate relative to this script
ffi_dir = os.path.join(env["PROJECT_DIR"], "..", "rs-engine", "ffi")
# Cargo uses the workspace-level target dir, not ffi/target
workspace_dir = os.path.join(env["PROJECT_DIR"], "..", "rs-engine")
lib_path = os.path.join(workspace_dir, "target", "riscv32imafc-esp-espidf", "release")

# Ensure riscv32-esp-elf-gcc is on PATH (needed by .cargo/config.toml linker setting).
# Locally it's on PATH via espup; in CI, PlatformIO installs it but doesn't add to PATH.
pio_gcc_candidates = glob.glob(os.path.join(
    os.path.expanduser("~"), ".platformio", "packages", "toolchain-riscv32-esp", "bin"
))
for gcc_dir in pio_gcc_candidates:
    if os.path.isdir(gcc_dir):
        os.environ["PATH"] = gcc_dir + os.pathsep + os.environ.get("PATH", "")
        print(f"[link_rust] Added {gcc_dir} to PATH")
        break

# Build the Rust static lib before PlatformIO links
print("Building rs-engine-ffi for riscv32imafc-esp-espidf...")
print(f"[link_rust] cargo = {subprocess.run(['which', 'cargo'], capture_output=True, text=True).stdout.strip()}")
print(f"[link_rust] rustc version = {subprocess.run(['rustc', '--version'], capture_output=True, text=True).stdout.strip()}")
result = subprocess.run(
    ["cargo", "build", "--release"],
    cwd=ffi_dir,
    capture_output=False,
)
if result.returncode != 0:
    raise Exception("rs-engine-ffi build failed")

env.Append(
    LIBS=["rs_engine_ffi"],
    LIBPATH=[lib_path],
)
