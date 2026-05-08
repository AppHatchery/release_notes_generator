# Release Notes Generator

Generate polished release notes from GitHub PRs and Issues using Claude AI — two formats at once: App Store/Play Store and GitHub Releases.

## Setup

### 1. Clone the repo

```bash
git clone <repo-url>
cd release-notes-generator
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials:

```
GITHUB_TOKEN=ghp_your_github_token_here
ANTHROPIC_API_KEY=sk-ant-your_anthropic_key_here
PORT=3000
```

**GitHub Token** — create one at https://github.com/settings/tokens  
Scopes needed: `repo` (for private repos) or `public_repo` (for public repos only)

**Anthropic API Key** — get one at https://console.anthropic.com

### 3. Install dependencies

```bash
npm install
```

### 4. Start the server

```bash
npm start
```

Open http://localhost:3000 in your browser.

For development with auto-restart on file changes:

```bash
npm run dev
```

## Usage

1. **Select a repository** from the dropdown (populated from your GitHub account)
2. **Check PRs and Issues** you want to include in this release
3. **Enter a version number** (e.g. `1.2.0`) and confirm the release date
4. Click **Generate Release Notes** — Claude will produce two formats:
   - **App Store / Play Store** — user-friendly bullet points
   - **GitHub Release** — structured markdown with feature and bug-fix sections
5. Copy either format to your clipboard with the **Copy** button

## Requirements

- Node.js 18 or later (uses built-in `fetch`)
- A GitHub account with at least one repository
- An Anthropic API key with access to `claude-sonnet-4-6`
