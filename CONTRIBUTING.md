# Contribution Guidelines

We appreciate you taking the time to improve Weehawk. Every contribution—whether a fix, a feature, or documentation—helps the whole community. Please read through this page so your pull request can be reviewed smoothly.

## How to Contribute

### 1. Fork the repository

Use the **Fork** button at the top right of this repository to create a copy under your GitHub account.

### 2. Clone your fork

On your fork’s GitHub page, click **Code**, copy the HTTPS URL, and clone it locally:

```bash
git clone https://github.com/<your-username>/weehawk.git
cd weehawk
```

Replace `<your-username>` with your GitHub username, or paste the HTTPS URL you copied from GitHub.

### 3. Create a branch

Work on a dedicated branch rather than `main`:

```bash
git checkout -b feature/short-description
```

Use a prefix that matches the change (`feature/`, `fix/`, `docs/`, etc.).

### 4. Set up your environment

From the repository root:

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
```

Edit the new files and set your values. Use the same `WEEHAWK_API_KEY` in both. Start PostgreSQL and Redis (Docker or local) and match their settings in `apps/api/.env`.

**Requirements:** [Node.js](https://nodejs.org/) (LTS), [pnpm](https://pnpm.io/), and [Docker](https://www.docker.com/) (recommended for databases).

Run the stack:

```bash
pnpm dev
```

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8080](http://localhost:8080)

### 5. Make your changes

Make your changes in the part of the codebase they belong to. Keep each pull request focused on a single topic.

### 6. Test your changes

Verify that your change works and does not break existing behavior. When applicable, run:

```bash
pnpm --filter api lint
pnpm --filter api test
pnpm --filter web lint
```

Add manual test steps in your pull request if automated tests do not cover your case.

### 7. Commit your work

```bash
git add .
git commit -m "feat: add new feature"
```

Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

#### Commit Message Format

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

The **type** must be one of the following:


| Type       | Use for                                                              |
| ---------- | -------------------------------------------------------------------- |
| `feat`     | A new feature                                                        |
| `fix`      | A bug fix                                                            |
| `docs`     | Documentation only                                                   |
| `style`    | Whitespace, formatting, or other changes that do not affect behavior |
| `refactor` | A code change that neither fixes a bug nor adds a feature            |
| `perf`     | A performance improvement                                            |
| `test`     | Adding or correcting tests                                           |
| `build`    | Build system or external dependencies (e.g. pnpm, Docker)            |
| `ci`       | CI configuration or scripts (e.g. GitHub Actions)                    |
| `chore`    | Other changes that do not modify application source or tests         |
| `revert`   | Reverting a previous commit                                          |


**Example:**

```text
feat: add new feature
```

Do not commit secrets (`.env`, API keys, or tokens).

### 8. Push to your fork

```bash
git push origin feature/short-description
```

### 9. Open a pull request

Open a pull request from your branch into `main` on [weehawkio/weehawk](https://github.com/weehawkio/weehawk). Describe the problem, your solution, and how you tested it. Include screenshots for UI changes when helpful.

## Reporting issues

Found a bug or have an idea for a feature? [Open an issue](https://github.com/weehawkio/weehawk/issues) with a clear title, steps to reproduce (for bugs), and your expected vs. actual behavior. The more context you provide, the faster we can help.

## Style guide

- Follow existing patterns, naming, and formatting in the files you touch.
- Use the [Commit Message Format](#commit-message-format); use complete sentences in the PR description.
- Comment only where the logic is not obvious from the code itself.
- Avoid drive-by refactors unrelated to your change.
- Do not modify `ee/` code unless you understand the terms in [LICENSE_EE](LICENSE_EE).

## License

This repository uses a mixed license:

- Files under any `ee/` directory are covered by [LICENSE_EE](LICENSE_EE).
- All other project code is licensed under the [Apache License 2.0](LICENSE).

By contributing, you agree that your submissions will be licensed under the same license as the files you change.