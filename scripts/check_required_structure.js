#!/usr/bin/env node
"use strict";

/**
 * Validate that the repository ships every file HACS and the documentation
 * promise. Fails (exit 1) with a clear list of anything missing.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const REQUIRED_PATHS = [
  "garden-dashboard.js",
  "hacs.json",
  "package.json",
  "README.md",
  "LICENSE",
  "ARCHITECTURE.md",
  ".gitignore",
  "docs/configuration.md",
  "docs/home-assistant-testing.md",
  "docs/troubleshooting.md",
  ".github/workflows/ci.yaml",
  "test/helpers.test.js",
];

const missing = REQUIRED_PATHS.filter(
  (rel) => !fs.existsSync(path.join(root, rel)),
);

// hacs.json must reference the shipped card file.
const errors = [];
try {
  const hacs = JSON.parse(
    fs.readFileSync(path.join(root, "hacs.json"), "utf8"),
  );
  if (hacs.filename !== "garden-dashboard.js") {
    errors.push(
      `hacs.json "filename" must be "garden-dashboard.js" (found: ${JSON.stringify(hacs.filename)})`,
    );
  }
} catch (error) {
  errors.push(`hacs.json is missing or invalid JSON: ${error.message}`);
}

if (missing.length || errors.length) {
  if (missing.length) {
    console.error("Missing required project files:");
    missing.forEach((rel) => console.error(`  - ${rel}`));
  }
  errors.forEach((message) => console.error(`  ! ${message}`));
  process.exit(1);
}

console.log(
  `Required structure OK (${REQUIRED_PATHS.length} paths present, hacs.json valid).`,
);
