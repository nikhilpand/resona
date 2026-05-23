#!/usr/bin/env node
/**
 * Resona — Changelog Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads git commit history since the last tag and generates a formatted
 * markdown changelog for GitHub Releases.
 *
 * Usage:
 *   node scripts/generate-changelog.js [from_tag] [to_ref]
 *   node scripts/generate-changelog.js v0.1.0 v0.2.0
 *   node scripts/generate-changelog.js                    # auto-detect
 *
 * Output: printed to stdout (captured by CI into CHANGELOG.md)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { execSync } = require('child_process');

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

// ── Parse args ────────────────────────────────────────────────────────────────
const fromTag = process.argv[2] || exec('git describe --tags --abbrev=0 HEAD^ 2>/dev/null') || '';
const toRef = process.argv[3] || 'HEAD';

// ── Get commits in range ──────────────────────────────────────────────────────
const range = fromTag ? `${fromTag}..${toRef}` : toRef;
const rawLog = exec(
  `git log ${range} --pretty=format:"%H|||%s|||%an|||%ad" --date=short 2>/dev/null`
);

if (!rawLog) {
  console.log('No commits found in range.');
  process.exit(0);
}

// ── Categorize commits ────────────────────────────────────────────────────────
const CATEGORIES = {
  '🚀 Features':     (msg) => /^feat(\(.+\))?:/i.test(msg),
  '🐛 Bug Fixes':    (msg) => /^fix(\(.+\))?:/i.test(msg),
  '⚡ Performance':  (msg) => /^perf(\(.+\))?:/i.test(msg),
  '🎨 UI/UX':        (msg) => /^ui(\(.+\))?:|^style(\(.+\))?:/i.test(msg),
  '🔧 Improvements': (msg) => /^refactor(\(.+\))?:|^improve/i.test(msg),
  '📦 Dependencies': (msg) => /^(deps|build)(\(.+\))?:/i.test(msg),
  '📝 Docs':         (msg) => /^docs(\(.+\))?:/i.test(msg),
  '🔒 Security':     (msg) => /^security|^sec(\(.+\))?:/i.test(msg),
  '🏗️ Chores':       (msg) => /^(chore|ci|test)(\(.+\))?:/i.test(msg),
};

const OTHER_KEY = '🔨 Other Changes';

const categorized = {};
Object.keys(CATEGORIES).forEach((k) => (categorized[k] = []));
categorized[OTHER_KEY] = [];

const commits = rawLog.split('\n').map((line) => {
  const [hash, subject, author, date] = line.split('|||');
  return { hash: hash?.slice(0, 8), subject, author, date };
});

// Filter out bot/version commits
const filtered = commits.filter(
  (c) =>
    c.subject &&
    !c.subject.startsWith('chore(release)') &&
    !c.subject.match(/^(Bump version|Version bump|Merge pull request)/i)
);

for (const commit of filtered) {
  let placed = false;
  for (const [category, matcher] of Object.entries(CATEGORIES)) {
    if (matcher(commit.subject)) {
      categorized[category].push(commit);
      placed = true;
      break;
    }
  }
  if (!placed) categorized[OTHER_KEY].push(commit);
}

// ── Build markdown ────────────────────────────────────────────────────────────
const newVersion = exec("node -p \"require('./package.json').version\"") || 'next';
const today = new Date().toISOString().split('T')[0];
const repoUrl = exec('git remote get-url origin 2>/dev/null')
  .replace(/\.git$/, '')
  .replace('git@github.com:', 'https://github.com/');

let md = `## 🎵 Resona v${newVersion} — ${today}\n\n`;

if (fromTag) {
  md += `> Full diff: [${fromTag}...v${newVersion}](${repoUrl}/compare/${fromTag}...v${newVersion})\n\n`;
}

// ── Stats summary ──────────────────────────────────────────────────────────────
const totalCommits = filtered.length;
const contributors = [...new Set(filtered.map((c) => c.author))];
md += `**${totalCommits} commits** by ${contributors.length} contributor${contributors.length > 1 ? 's' : ''}: ${contributors.join(', ')}\n\n`;
md += `---\n\n`;

// ── Category sections ──────────────────────────────────────────────────────────
for (const [category, items] of Object.entries(categorized)) {
  if (items.length === 0) continue;

  md += `### ${category}\n\n`;
  for (const commit of items) {
    // Clean up conventional commit prefix for display
    const cleanMsg = commit.subject
      .replace(/^(feat|fix|perf|ui|style|refactor|docs|chore|ci|test|build|deps|security|sec)(\(.+\))?:\s*/i, '')
      .replace(/^\w/, (c) => c.toUpperCase());

    md += `- ${cleanMsg} [\`${commit.hash}\`](${repoUrl}/commit/${commit.hash})\n`;
  }
  md += '\n';
}

// ── Installation ──────────────────────────────────────────────────────────────
md += `---\n\n`;
md += `### 📲 Installation\n\n`;
md += `Download the APK below and install directly on your Android device.\n\n`;
md += `> **Note:** Enable "Install from unknown sources" in your Android settings.\n\n`;
md += `### 📡 OTA Update\n\n`;
md += `Existing users will receive this update automatically over-the-air within 24h.\n\n`;

process.stdout.write(md);
