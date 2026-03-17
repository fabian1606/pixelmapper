import subprocess
import os

with open("dummy_boot.bin", "wb") as f:
    f.write(b"A" * 10)
if not os.path.exists("dummy_app.bin"):
    with open("dummy_app.bin", "wb") as f:
        f.write(b"B" * 10)

subprocess.run(["~/.platformio/penv/bin/esptool.py", "--chip", "esp32p4", "merge_bin", "-o", "merged.bin", "0x2000", "dummy_boot.bin", "0x8000", "dummy_app.bin"], shell=True)
if os.path.exists("merged.bin"):
    print("Merged bin size:", os.path.getsize("merged.bin"))
