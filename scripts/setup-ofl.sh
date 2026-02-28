#!/bin/bash

# Open Fixture Library repository URL
OFL_REPO_URL="https://github.com/OpenLightingProject/open-fixture-library.git"
OFL_DIR="ofl-data"

# Check if ofl-data directory already exists
if [ -d "$OFL_DIR" ]; then
    echo "Directory $OFL_DIR already exists. Skipping clone."
    # Optional: could do a git pull here if needed, but for Vercel builds
    # starting from scratch is usually better if the directory isn't there.
else
    echo "Cloning Open Fixture Library into $OFL_DIR..."
    git clone --depth 1 "$OFL_REPO_URL" "$OFL_DIR"
    
    if [ $? -eq 0 ]; then
        echo "Successfully cloned OFL data."
    else
        echo "Failed to clone OFL data."
        exit 1
    fi
fi
