Import("env")
import subprocess
import os

# Path to the ffi crate relative to this script
ffi_dir = os.path.join(env["PROJECT_DIR"], "..", "rs-engine", "ffi")
# Cargo uses the workspace-level target dir, not ffi/target
workspace_dir = os.path.join(env["PROJECT_DIR"], "..", "rs-engine")
lib_path = os.path.join(workspace_dir, "target", "riscv32imafc-esp-espidf", "release")

# On CI, source the espup environment if available
export_esp = os.path.expanduser("~/export-esp.sh")
if os.path.isfile(export_esp):
    import shlex
    with open(export_esp) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export "):
                line = line.removeprefix("export ")
            if "=" in line:
                key, _, val = line.partition("=")
                # Remove surrounding quotes
                val = val.strip().strip('"').strip("'")
                # Expand $PATH etc
                val = os.path.expandvars(val)
                os.environ[key] = val
    print(f"[link_rust] Sourced {export_esp}")

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
