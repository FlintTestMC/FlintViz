#!/usr/bin/env node

/**
 * JSON Formatter for FlintBenchmark
 * Uses FracturedJson to produce human-readable, compact JSON output.
 * Small arrays/objects are inlined, larger ones are expanded.
 *
 * Usage:
 *   node scripts/format-json.js          # Format all JSON files in tests/
 *   node scripts/format-json.js --check  # Check if files are formatted (for CI)
 *
 * Formatter configuration lives in `format-json-core.js` and is shared with
 * the in-browser Format button in the visualizer frontend.
 */

const fs = require('fs');
const path = require('path');
const { formatJsonText } = require('./format-json-core');

const TESTS_DIR = path.join(__dirname, '..', 'tests');

function findJsonFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }

  return files;
}

function formatFile(filePath, checkOnly = false) {
  const content = fs.readFileSync(filePath, 'utf8');

  let formatted;
  try {
    formatted = formatJsonText(content);
  } catch (e) {
    console.error(`❌ Invalid JSON: ${filePath}`);
    console.error(`   ${e.message}`);
    return { error: true, changed: false };
  }

  if (content === formatted) {
    return { error: false, changed: false };
  }

  if (checkOnly) {
    return { error: false, changed: true };
  }

  fs.writeFileSync(filePath, formatted, 'utf8');
  return { error: false, changed: true };
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');

console.log(checkOnly ? '🔍 Checking JSON formatting...' : '✨ Formatting JSON files...');
console.log();

const jsonFiles = findJsonFiles(TESTS_DIR);
let hasErrors = false;
let changedCount = 0;

for (const file of jsonFiles) {
  const relativePath = path.relative(path.join(__dirname, '..'), file);
  const result = formatFile(file, checkOnly);

  if (result.error) {
    hasErrors = true;
  } else if (result.changed) {
    changedCount++;
    if (checkOnly) {
      console.log(`❌ ${relativePath} (needs formatting)`);
    } else {
      console.log(`✅ ${relativePath}`);
    }
  }
}

console.log();

if (hasErrors) {
  console.log('❌ Some files contain invalid JSON');
  process.exit(1);
}

if (checkOnly) {
  if (changedCount > 0) {
    console.log(`❌ ${changedCount} file(s) need formatting. Run 'npm run format' to fix.`);
    process.exit(1);
  } else {
    console.log(`✅ All ${jsonFiles.length} JSON files are properly formatted.`);
  }
} else {
  if (changedCount > 0) {
    console.log(`✅ Formatted ${changedCount} file(s).`);
  } else {
    console.log(`✅ All ${jsonFiles.length} JSON files were already formatted.`);
  }
}
