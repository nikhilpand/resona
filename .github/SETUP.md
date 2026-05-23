# Resona — GitHub Actions Setup Guide

This document explains how to configure secrets and get the CI/CD pipelines running.

---

## 🔐 Required GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret Name | Description | How to get it |
|-------------|-------------|---------------|
| `EXPO_TOKEN` | EAS authentication token | `npx eas-cli whoami` then `eas login` → Dashboard → Account Settings → Access Tokens |
| `GITHUB_TOKEN` | Auto-provided by GitHub | Already available — no setup needed |

### Optional Secrets (for future features)

| Secret Name | Description |
|-------------|-------------|
| `SLACK_WEBHOOK_URL` | Slack notifications on release |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | Auto-submit to Play Store |

---

## 🛠️ One-Time EAS Setup

Before the workflows run for the first time:

```bash
# 1. Install EAS CLI
npm install -g eas-cli

# 2. Login to Expo
eas login

# 3. Link your project to EAS
eas init

# 4. Set up Android credentials (for signing the APK)
eas credentials
```

This generates a `.easignore` and updates `eas.json` with your project ID.

---

## 🔄 Workflow Summary

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **CI** | PR / push to main | TypeScript check, secret scan, version validation |
| **OTA** | Push to main | Auto patch bump → EAS Update → JS bundle pushed OTA |
| **Release** | Tag `v*.*.*` or manual | Version bump → EAS Build APK → GitHub Release |
| **Nightly** | 2:00 AM UTC daily | Preview APK if commits in last 24h |

---

## 🚀 Triggering a Release Manually

### Option A — Push a version tag
```bash
npm run version:minor          # bumps 0.1.0 → 0.2.0
git add -A
git commit -m "chore: bump version"
git tag v0.2.0
git push origin main --tags    # triggers release.yml
```

### Option B — GitHub UI
1. Go to **Actions** → **Build APK & Release**
2. Click **Run workflow**
3. Choose `profile: production`, `bump_type: minor`
4. Click **Run workflow**

### Option C — NPM script (local)
```bash
npm run build:preview    # builds preview APK via EAS
npm run build:prod       # builds production APK via EAS
npm run ota "v0.2.0 — new features"   # push OTA update
```

---

## 📡 OTA Update Flow

```
Push to main
    │
    ▼
CI checks pass
    │
    ▼
OTA workflow triggers
    │
    ├── Bumps patch version (0.1.0 → 0.1.1)
    ├── Commits version.json + app.json + package.json
    └── Runs: eas update --channel production
                    │
                    ▼
            EAS CDN → User devices
            (received on next app open)
```

---

## 📱 Installing the APK

1. Go to [Releases](../../releases)
2. Download `Resona-v*.*.*.apk`
3. On Android: Settings → Security → Unknown Sources → Enable
4. Open the downloaded APK and install

> **Tip:** Share the GitHub Releases page URL with testers — they can always download the latest APK from there.

---

## 🔢 Version Strategy

| Bump | When | Example |
|------|------|---------|
| **patch** | Every push to main (auto OTA) | `0.1.0 → 0.1.1` |
| **minor** | New feature release | `0.1.0 → 0.2.0` |
| **major** | Breaking changes / redesign | `0.x.x → 1.0.0` |

versionCode formula: `major * 10000 + minor * 100 + patch`
- `v0.1.0` → `100`
- `v1.2.3` → `10203`
- `v2.0.0` → `20000`
