#!/bin/bash
echo "Testing python esptool flashing at 0x10000..."
~/.platformio/penv/bin/esptool.py --chip esp32p4 \
  --baud 1500000 \
  write_flash 0x10000 pio/.pio/build/waveshare_p4_poe/firmware.bin
