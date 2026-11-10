# LLM Test Bench — local Docker edition

[Français](README.md) · **English** · [Backup and recovery](docs/OPERATIONS.md)

Give several AI models the same prompt, run generations in parallel, preview their websites side by side, and keep results and available timing/token/cost metrics. Bring your own OpenRouter API key.

Batches default to **Automatique — puissance et reprise**. Select your models and prompts, then launch. OpenRouter settings come from the API: maximum advertised output and `xhigh` reasoning when supported, otherwise `high` or the strongest accepted effort. Models with a fixed reasoning budget use up to 16,384 tokens, capped at one third of output. Other providers keep native settings.

The mode allows **at most three calls per prompt and model**, including initial generation, recoveries and runtime repairs. Exhausted reasoning or incomplete output triggers a lower-reasoning retry; received code is saved and reused. Temporary transport/provider errors wait before retrying, respecting `Retry-After` up to two minutes. Sandbox errors trigger repairs from saved code. Invalid credentials, insufficient credits, rejected parameters, filtering and in-flight duplicates stop explicitly. A failed save or unavailable sandbox never triggers another paid repair.

Calls can run in parallel; a terminal failure stops only that model’s subsequent prompts. **Comparer en direct** displays concurrent code and previews. **Réduire** lets you navigate while the batch runs; keep the tab open. Each model retains its actual costs and settings, including adapted retries. A new explicit launch grants a new allowance. This is a call-count limit, not a dollar cap or a guarantee of success. Local runtime checks do not certify every requested feature or visual quality. Reasoning tokens may be billed without HTML ([OpenRouter documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)).

This MIT-licensed fork of [Techdread/llm-test-bench](https://github.com/Techdread/llm-test-bench) adds local sign-in, an encrypted server-side OpenRouter vault, persistent Docker storage and a French main interface. Everyone can install their own copy with their own credentials and key. Each installation has **one administrator account**; this is not an isolated multi-user hosted service.

## Requirements

- [Docker Desktop](https://docs.docker.com/desktop/) on macOS/Windows, or [Docker Engine](https://docs.docker.com/engine/install/) with the [Compose plugin](https://docs.docker.com/compose/install/) on Linux. Start Docker and use Linux containers on Windows.
- [Git](https://git-scm.com/downloads), or download and extract the ZIP using GitHub's **Code → Download ZIP**.
- A current browser; Chrome or Edge is recommended for folder access and screen recording.
- Internet access for initial downloads and remote model calls. OpenRouter inference does not require a local GPU.

Docker handles Python, dependencies and SQLite; you do not need host Python, Node.js or a separate database server. No credentials belong in an environment file. The code is MIT-licensed; Docker Desktop has its own licensing terms. OpenRouter model calls may cost money.

## Quick start

```sh
git clone https://github.com/ohvignas/llm-test-bench.git
cd llm-test-bench
docker compose up -d --build --wait
```

Open **[http://127.0.0.1:8085](http://127.0.0.1:8085)**. The first build may take a few minutes. With a ZIP, enter the extracted folder before running Compose.

1. Choose a username and password of at least 12 characters. There is no default password. Registration closes after this account is created.
2. Open **Mon compte et ma clé API** and save your [OpenRouter API key](https://openrouter.ai/settings/keys). It is encrypted on the local server and is not returned to the browser.
3. In **Lots**, select a prompt, add two or more models, select **Tous en même temps**, and start. Saved outputs can be compared in **Comparer**.

The account, key, projects and saved metrics survive container restarts and image rebuilds. The image contains no account or API key, and installation does not create a default account.

## Optional port configuration

Defaults work without `.env`. If port 8085 is occupied, copy `.env.example` to `.env` and set `BENCH_PORT=8090`.

macOS/Linux: `cp .env.example .env`. Windows PowerShell: `Copy-Item .env.example .env`.

Run `docker compose up -d --build --wait` again, then open `http://127.0.0.1:8090`. Compose changes the published port and accepted request origin together. Keep the same project directory to reuse the volumes. Do not put a password or API key in `.env`.

## Day-to-day commands

| Task | Command |
|---|---|
| Start again | `docker compose up -d --wait` |
| Stop without deleting data | `docker compose stop` |
| Show health and ports | `docker compose ps` |
| View recent logs | `docker compose logs --tail=100 bench` |
| Update a cloned installation | `git pull --ff-only`, then `docker compose up -d --build --wait` |
| Recover a forgotten password | `docker compose exec bench python -m server.manage reset-password` |
| Run server tests without host Python | `docker compose exec -T bench python -m unittest discover -s server/tests -v` |

Local server logs help diagnose installation problems; model outputs and run metrics are in the app. Before updating a ZIP installation, back up its volumes and follow the [migration instructions](docs/OPERATIONS.md). A differently named folder may use a different Compose project and different volumes.

### Local diagnostic CLI

Run `./benchctl status --json`, `./benchctl doctor`, `./benchctl history --limit 10`, or `./benchctl journal "/path/to/export.json"` from the project directory (Python 3 and Docker required). `./benchctl cancel EXACT_CALL_ID` requests cancellation of one call on its next upstream chunk; it does not retry or erase outputs. Already processed tokens may still be billed. The UI may display a failed item with the explicit CLI cancellation message. Windows: `python benchctl ...`. Without host Python: `docker compose exec -T bench python -m server.diagnostics status --json` (also supports doctor, history and cancel).

These commands never start paid generations or read the vault key. Local Docker permissions provide access; no public admin endpoint is added. Server tracking covers calls started after this update and retains numeric progress, effective settings and reported costs, without prompt, output or reasoning text. Completed tracking records expire after 30 days. Missing costs remain unknown; browser telemetry supplies older history. Counters cannot prove the absence of internal reasoning loops or guarantee success. The floating generation-status button now opens a local panel listing all active models instead of navigating to a missing page.

## Storage and backups

`bench-data` holds SQLite (password hash, sessions, encrypted credential) and project/settings/metrics files. `bench-secrets` holds the separately generated encryption key. These Docker named volumes are scoped by the Compose project name.

Back up **both together**. Follow the tested [backup, restore and recovery procedure](docs/OPERATIONS.md). Removing a volume deletes its contents; updating and password recovery do not require deletion.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Docker daemon unavailable | Start Docker Desktop; on Linux check daemon access. |
| `docker compose` missing | Install the Compose plugin or update Docker Desktop. |
| Port already allocated | Set another `BENCH_PORT` in `.env`, then run `up`. |
| Cannot reach the page | Check `docker compose ps` and logs; use `127.0.0.1` with the configured port. |
| Key rejected or generation fails | Check key validity, credit, model availability and token limits. |
| Data appears missing | Check the project/folder name and both volumes; do not delete them. |
| Forgotten credentials | Use `reset-password`; it also displays the username. |

## Scope and security

Access is bound to `127.0.0.1`. Sessions use HttpOnly/SameSite cookies, writes are checked for Origin and CSRF, and the app container runs without root. The saved OpenRouter key is encrypted and injected only into the server's fixed OpenRouter relay. Cloudflare analytics is removed from served app pages.

Someone controlling Docker or both storage volumes can decrypt the key. Notebook Lab and Algorithm Visualizer still execute JavaScript with the page's privileges: use trusted code there. Prompt Gallery's generated HTML previews are sandboxed. Other providers retain their upstream credential configuration; the server vault is for OpenRouter.

This configuration targets local installations, not an Internet-facing shared service. The upstream private CLI-agent bridge is not included. The main site-comparison interface is French; some other apps, help text and prompts remain English. See [SECURITY.md](SECURITY.md) and [historical upstream documentation](README.upstream.md).

## Contributing and credits

[Contributing](CONTRIBUTING.md) · [Issues](https://github.com/ohvignas/llm-test-bench/issues) · [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Original project by Techdread/Peter Edwards. Original notices and vendored-library licenses are retained; this fork adds Docker, authentication, the vault and French-interface changes.

## French prompt library

The library contains 163 prompts: 92 core, 39 advanced, 8 flagship simulations and 24 original French website briefs in **Prompts → Sites web** (also available in **Lots**). Cards have French titles, descriptions and evaluation notes; expanding a card reveals the actual model instruction. The three former GTA variants are consolidated into **GTA VI — monde ouvert hyperréaliste**, under **Base → Jeux et graphismes**. It requests native JavaScript with direct WebGL 2 rendering, without Three.js or an external engine. TypeScript may be used during design, but the delivered standalone HTML must include executable, compiled JavaScript. Historical generated results, original prompts and costs are retained. Personal descriptions can be edited.

The new website set covers storefronts, portfolios, reservations, dashboards, forms, CSV handling and accessible interactions. Every brief requests a standalone HTML document with fictional data and no external network calls. Checkpoints and sample numeric results support manual verification; they are not a new automated scoring suite.

Coverage was informed by [FrontendBench](https://arxiv.org/abs/2506.13832) and [Vision2Web](https://vision2web-bench.github.io/). These are original briefs, not copied dataset tasks or an official implementation of either benchmark. References are recorded in `prompt-gallery/data/library-web.json`.

## Live generation log

The batch dialog opens its **Journal de génération** view by default. It shows timestamped request phases, provider reasoning signals (without reasoning text), first HTML, errors, attempts and reported final usage. Select a model row to filter the journal, or choose all models. **Aperçu et code** restores the preview and code view.

Last-signal timing distinguishes current traffic from silence. After 60 seconds without a signal the log reports an unconfirmed wait, without declaring a failure or retrying. It never copies full prompts, response bodies, private reasoning or request headers; error messages redact common credential formats. Up to 400 local entries remain in the dialog after completion and can be exported as JSON. The journal cannot reconstruct activity from an older, already-running browser page.

Batch prompt selection searches French titles, original names, descriptions and tags. Selections persist across sets; Select all/None applies to the visible filtered list. The launch summary includes every selected prompt. The single GTA VI prompt is under **Base → Jeux et graphismes**; historical generated results remain available.

### Spending protection

Automatic recovery is capped at three calls per prompt/model, including repairs. Manual modes retain explicit failed-request protection and do not automatically repeat empty or exhausted completions. Failures are fingerprinted locally (up to 100 SHA-256 records, no prompt or key). In-flight duplicates and filtered prompts remain blocked even in Automatic mode; changing a token budget does not bypass filtering. The manual options offer an explicit reset for intentional, potentially billable retries. This is not an account-wide monetary limit.

Reasoning and visible output share the completion budget. Empty, cancelled and filtered responses may still be billed. Only API-reported costs are displayed. [OpenRouter zero completion insurance](https://openrouter.ai/docs/guides/features/zero-completion-insurance) applies automatically to qualifying responses and does not guarantee free reasoning-only filtered or token-limited completions. On [Claude Opus 5.5](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/claude-5-5), fixed thinking budgets are not forwarded; select a supported reasoning effort instead.

The Docker edition reserves each model/message fingerprint in SQLite before contacting OpenRouter. An automatic allowance stores an identifier, hashed model, counter and pending request; it rejects a fourth call, concurrent calls within an allowance and model changes, including when repair messages change. Failed non-filtered requests can be retried within this allowance. Concurrent duplicates and filtered requests remain blocked. The authenticated CSRF-protected manual reset clears failures and stale worker reservations, keeping active requests protected. These tables contain no prompts, responses or keys.

**Reprendre / corriger** in the result summary or gallery resumes saved code with its original prompt and model. Automatic mode checks complete HTML locally before requesting repairs; incomplete HTML is completed first. Each version and its actual billing remain linked to the previous result. The optional Verified mode adds a model audit of the requirements.

### Build GTA VI in stages

In **Lots → Rapide**, **Construire le prompt GTA VI par étapes** is enabled by default. The single GTA VI brief has six native JavaScript/WebGL 2 stages: playable city, visuals and weather, vehicles, action and police, missions, then saving and final checks. The first produces a limited playable version; later stages build on the preceding HTML. Each stage is a separate potentially billable call for each selected model. The launch button and plan show the expected number of calls, excluding skipped prompts; stopping or failing can reduce that count. The plan lists each stage’s objective and token ceiling.

On OpenRouter, stages respect the selected comparison, maximum or custom settings. Only the economy profile applies the 12,288-token stage ceiling, further capped by lower user settings or API limits. Other providers keep their native settings. Every completed HTML document is saved before the next call. Construction stops at its first failure, keeping earlier versions in the gallery and actual reported costs in the journal. Completion of the whole plan is not guaranteed. Uncheck the option to send the original prompt in one call. Personally edited prompts, other prompts and the runtime-heal/verified modes keep their existing behavior.

Claude Fable 5.2 and Opus 5.5 require adaptive reasoning. **`low` is soft guidance, not a reserved HTML output budget**: reasoning can still use every available token before visible text. Staged construction bounds the requested work and saves progress; it does not override provider behavior. [Anthropic reasoning and cost guidance](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost).
