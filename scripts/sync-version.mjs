#!/usr/bin/env node
// Propagate the repo-root VERSION file into the three tooling files that
// actually consume a version string: package.json, src-tauri/tauri.conf.json,
// and src-tauri/Cargo.toml. VERSION is the source of truth; this script
// keeps the others in sync.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

const versionFile = path.join(projectRoot, 'VERSION');
const packageJsonFile = path.join(projectRoot, 'package.json');
const tauriConfFile = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
const cargoTomlFile = path.join(projectRoot, 'src-tauri', 'Cargo.toml');

const semverRe = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function readVersion() {
  let raw;
  try {
    raw = fs.readFileSync(versionFile, 'utf8');
  } catch (err) {
    throw new Error(`failed to read ${path.relative(projectRoot, versionFile)}: ${err.message}`);
  }
  const version = raw.trim();
  if (!semverRe.test(version)) {
    throw new Error(
      `invalid version "${version}" in ${path.relative(projectRoot, versionFile)} — expected MAJOR.MINOR.PATCH[-prerelease]`,
    );
  }
  return version;
}

function readJsonVersion(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

function writeJsonVersion(file, version) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const previous = data.version;
  if (previous === version) return { file, changed: false, current: previous };
  data.version = version;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return { file, changed: true, previous, current: version };
}

// Read the version from the [package] table of a Cargo.toml.
function readCargoVersion(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inPackage = false;
  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inPackage = sectionMatch[1].trim() === 'package';
      continue;
    }
    if (!inPackage) continue;
    const m = line.match(/^\s*version\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  return null;
}

// Replace the first `version = "..."` line inside the [package] table of a
// Cargo.toml without touching dependency version specifiers.
function writeCargoVersion(file, version) {
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.split('\n');
  const versionLineRe = /^(\s*version\s*=\s*")([^"]*)(".*)$/;
  let inPackage = false;
  let replaced = false;
  let previous = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inPackage = sectionMatch[1].trim() === 'package';
      continue;
    }
    if (!inPackage) continue;
    const m = line.match(versionLineRe);
    if (m) {
      previous = m[2];
      if (previous === version) {
        return { file, changed: false, current: previous };
      }
      lines[i] = `${m[1]}${version}${m[3]}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    throw new Error(
      `could not find a [package] version line in ${path.relative(projectRoot, file)}`,
    );
  }

  fs.writeFileSync(file, lines.join('\n'));
  return { file, changed: true, previous, current: version };
}

function describe(result) {
  const rel = path.relative(projectRoot, result.file);
  return `  ${rel}: ${result.previous} -> ${result.current}`;
}

export function syncVersion({ check = false } = {}) {
  const version = readVersion();

  if (check) {
    const current = [
      { file: packageJsonFile, current: readJsonVersion(packageJsonFile) },
      { file: tauriConfFile, current: readJsonVersion(tauriConfFile) },
      { file: cargoTomlFile, current: readCargoVersion(cargoTomlFile) },
    ];
    const mismatched = current.filter((c) => c.current !== version);
    if (mismatched.length > 0) {
      const lines = mismatched.map(
        (c) => `  ${path.relative(projectRoot, c.file)}: ${c.current} (expected ${version})`,
      );
      throw new Error(`version mismatch — VERSION says ${version}:\n${lines.join('\n')}`);
    }
    return { version, results: current };
  }

  const results = [
    writeJsonVersion(packageJsonFile, version),
    writeJsonVersion(tauriConfFile, version),
    writeCargoVersion(cargoTomlFile, version),
  ];

  const changed = results.filter((r) => r.changed);
  if (changed.length > 0) {
    console.log(`Synced VERSION ${version} into:`);
    for (const r of changed) console.log(describe(r));
  }
  return { version, results };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  try {
    syncVersion({ check });
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
