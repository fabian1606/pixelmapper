Import("env")
import subprocess
import os
import glob

# Builds the rs-engine-ffi static lib for xtensa-esp32s3-espidf.
# Prerequisite: user has the esp toolchain installed via espup (`espup install`).
# The cargo workspace's rust-toolchain.toml channel is `nightly`; we override
# per-invocation with `+esp` so the Xtensa target builds correctly.

ffi_dir       = os.path.join(env["PROJECT_DIR"], "..", "rs-engine", "ffi")
workspace_dir = os.path.join(env["PROJECT_DIR"], "..", "rs-engine")
target_triple = "xtensa-esp32s3-espidf"
lib_path      = os.path.join(workspace_dir, "target", target_triple, "release")

# Ensure xtensa-esp32s3-elf-gcc is on PATH (needed by .cargo/config.toml linker setting).
pio_gcc_candidates = glob.glob(os.path.join(
    os.path.expanduser("~"), ".platformio", "packages", "toolchain-xtensa-esp-elf", "bin"
))
for gcc_dir in pio_gcc_candidates:
    if os.path.isdir(gcc_dir):
        os.environ["PATH"] = gcc_dir + os.pathsep + os.environ.get("PATH", "")
        print(f"[link_rust] Added {gcc_dir} to PATH")
        break

print(f"[link_rust] Building rs-engine-ffi for {target_triple}...")
print(f"[link_rust] cargo = {subprocess.run(['which', 'cargo'], capture_output=True, text=True).stdout.strip()}")

# Try with +esp toolchain first (espup install); fall back to default toolchain
def run_cargo(toolchain_arg):
    cmd = ["cargo"]
    if toolchain_arg:
        cmd.append(toolchain_arg)
    cmd += ["build", "--release", "--target", target_triple]
    return subprocess.run(cmd, cwd=ffi_dir, capture_output=False)

result = run_cargo("+esp")
if result.returncode != 0:
    print("[link_rust] '+esp' toolchain failed or missing — retrying with default toolchain")
    result = run_cargo(None)

if result.returncode != 0:
    raise Exception(
        "rs-engine-ffi build failed for xtensa-esp32s3-espidf.\n"
        "Hint: install the Espressif Rust toolchain via `espup install`, then re-run."
    )

env.Append(
    LIBS=["rs_engine_ffi"],
    LIBPATH=[lib_path],
)
