#!/usr/bin/env bun
/**
 * Release script — bumps the version, creates a git tag, and pushes.
 * The GitHub Action picks up the tag and builds + publishes the firmware.
 *
 * Usage: bun run release
 */
import { $ } from 'bun';

await $`bunx @itmr.dev/bump`;
