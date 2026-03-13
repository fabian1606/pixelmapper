Import("env")
import subprocess
import os

# Path to the ffi crate relative to this script
ffi_dir = os.path.join(env["PROJECT_DIR"], "..", "rs-engine", "ffi")
# Cargo uses the workspace-level target dir, not ffi/target
workspace_dir = os.path.join(env["PROJECT_DIR"], "..", "rs-engine")
lib_path = os.path.join(workspace_dir, "target", "riscv32imafc-esp-espidf", "release")

# Build the Rust static lib before PlatformIO links
print("Building rs-engine-ffi for riscv32imafc-esp-espidf...")
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
