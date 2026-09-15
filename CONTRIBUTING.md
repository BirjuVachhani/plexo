# Contributing to Plexo

Thanks for taking a look at Plexo. It's a small project, so the process is intentionally lightweight.

## Setup

```bash
git clone https://github.com/anmolkapil/plexo.git
cd plexo
npm install
npm run dev
```

Requires macOS — interface detection relies on macOS's `networksetup` command, so the app won't run correctly on other platforms yet (see [README.md](README.md#running-it)).

## Before opening a PR

```bash
npm run lint
npm run typecheck
npm run format
```

There's no test suite yet, so please describe how you tested your change manually (which URL/file size/interfaces you tried) in the PR description.

## Making changes

- Keep PRs focused — one fix or feature per PR is easier to review than a bundle of unrelated changes.
- Match the existing code style (enforced by `eslint`/`prettier`, run `npm run format` before committing).
- If you're changing download/networking behavior (`src/main/download/`, `src/main/network/`), explain the reasoning in the PR — a lot of the logic there (resume/retry/stall handling) exists to avoid subtle data-corruption bugs, so tradeoffs matter more than usual.
- UI changes: a screenshot or short screen recording in the PR description is very helpful.

## Reporting bugs

Open a GitHub issue with:
- macOS version
- What you were downloading (URL if it's public, or roughly: file size, server type)
- Which network interfaces were involved
- Console/error output if there was a crash

## Ideas / feature requests

Open an issue to discuss before writing a lot of code — happy to talk through approach first, especially for anything touching the chunking/resume logic.
