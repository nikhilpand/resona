#!/usr/bin/env node
/**
 * Resona — Semantic Version Bumper
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node scripts/bump-version.js              # auto-detect from commits
 *   node scripts/bump-version.js patch        # force patch bump
 *   node scripts/bump-version.js minor        # force minor bump
 *   node scripts/bump-version.js major        # force major bump
 *
 * Commit convention (Conventional Commits):
 *   feat:        → minor bump
 *   fix/perf:    → patch bump
 *   BREAKING:    → major bump
 *   chore/docs:  → patch bump (no release)
 *
 * Updates:
 *   - package.json  (version)
 *   - app.json      (expo.version + expo.android.versionCode)
 *   - version.json  (version + buildNumber + releaseDate)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf-8'));
}

function writeJson(file, data) {
  fs.writeFileSync(
    path.join(ROOT, file),
    JSON.stringify(data, null, 2) + '\n',
    'utf-8'
  );
}

function exec(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...opts }).trim();
  } catch (e) {
    return '';
  }
}

// ── Parse semantic version ────────────────────────────────────────────────────
function parseVersion(ver) {
  const [major, minor, patch] = ver.replace(/^v/, '').split('.').map(Number);
  return { major, minor, patch };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

// ── Determine bump type from recent commit messages ───────────────────────────
function detectBumpType() {
  // Get commits since last tag
  const lastTag = exec('git describe --tags --abbrev=0 2>/dev/null') || '';
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const commits = exec(`git log ${range} --pretty=format:"%s" 2>/dev/null`);

  if (!commits) return 'patch';

  const lines = commits.split('\n').map((l) => l.toLowerCase());

  // Check for breaking changes first (major)
  if (lines.some((l) => l.includes('breaking') || l.includes('!:'))) {
    return 'major';
  }

  // Check for new features (minor)
  if (lines.some((l) => l.startsWith('feat') || l.startsWith('feature'))) {
    return 'minor';
  }

  // Default to patch
  return 'patch';
}

// ── Bump the version ──────────────────────────────────────────────────────────
function bumpVersion(current, type) {
  const v = parseVersion(current);

  switch (type) {
    case 'major':
      return formatVersion({ major: v.major + 1, minor: 0, patch: 0 });
    case 'minor':
      return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0 });
    case 'patch':
    default:
      return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1 });
  }
}

// ── Android versionCode (must be monotonically increasing integer) ────────────
function calcVersionCode(version) {
  const { major, minor, patch } = parseVersion(version);
  // Formula: major*10000 + minor*100 + patch
  // e.g. 1.2.3 → 10203, 0.1.0 → 100
  return major * 10000 + minor * 100 + patch;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const forcedType = process.argv[2]; // patch | minor | major (optional)
  const bumpType = forcedType || detectBumpType();

  console.log(`\n📦 Resona Version Bumper`);
  console.log(`   Bump type: ${bumpType.toUpperCase()}\n`);

  // Read current version from package.json
  const pkg = readJson('package.json');
  const currentVersion = pkg.version;
  const newVersion = bumpVersion(currentVersion, bumpType);
  const newVersionCode = calcVersionCode(newVersion);

  console.log(`   ${currentVersion}  →  ${newVersion}  (versionCode: ${newVersionCode})`);

  // ── 1. Update package.json ─────────────────────────────────────────────────
  pkg.version = newVersion;
  writeJson('package.json', pkg);
  console.log('   ✅ package.json updated');

  // ── 2. Update app.json ────────────────────────────────────────────────────
  const appJson = readJson('app.json');
  appJson.expo.version = newVersion;
  if (!appJson.expo.android) appJson.expo.android = {};
  appJson.expo.android.versionCode = newVersionCode;
  if (!appJson.expo.ios) appJson.expo.ios = {};
  appJson.expo.ios.buildNumber = String(newVersionCode);
  writeJson('app.json', appJson);
  console.log('   ✅ app.json updated (versionCode: ' + newVersionCode + ')');

  // ── 3. Update / create version.json ──────────────────────────────────────
  const versionJson = {
    version: newVersion,
    versionCode: newVersionCode,
    buildNumber: newVersionCode,
    bumpType,
    releaseDate: new Date().toISOString().split('T')[0],
    gitSha: exec('git rev-parse --short HEAD') || 'unknown',
  };
  writeJson('version.json', versionJson);
  console.log('   ✅ version.json updated');

  // ── 4. Output for GitHub Actions ──────────────────────────────────────────
  // These lines are parsed by the workflow
  console.log(`\n::set-output name=new_version::${newVersion}`);
  console.log(`::set-output name=version_code::${newVersionCode}`);
  console.log(`::set-output name=bump_type::${bumpType}`);

  // Also write to GITHUB_OUTPUT if in CI
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `new_version=${newVersion}\nversion_code=${newVersionCode}\nbump_type=${bumpType}\n`
    );
  }

  console.log(`\n🎉 Version bumped to v${newVersion}\n`);
  return newVersion;
}

main();
