# LLM Test Bench — local Docker edition

[Français](README.md) · **English** · [Backup and recovery](docs/OPERATIONS.md)

Give several AI models the same prompt, run generations in parallel, preview their websites side by side, and keep results and available timing/token/cost metrics. Bring your own OpenRouter API key.

During a batch, each row shows its model's live phase, including reasoning before HTML arrives. Select a row to switch the single preview and HTML stream; other models continue in parallel. After saving, use **Comparer** to view two to four generations side by side.

OpenRouter HTML requests default to **32768 total output tokens per response**, with a **4096-token reasoning budget for Claude**. Both limits can be changed in the batch execution options. Reasoning and code share the total token budget; these limits are not a monetary cap for the batch. Models may impose additional constraints. Single-page generation uses the same defaults.

Automatic retries default to zero. Optional connection retries never repeat an empty answer, an exhausted output budget or incomplete HTML. Check the error and usage before manually launching another attempt. Reasoning tokens may be billed even when no page is produced ([OpenRouter documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)).

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

The library now contains 164 prompts: 92 core, 40 advanced, 8 flagship simulations and 24 original French website briefs in **Prompts → Sites web** (also available in **Lots**). The original 140 entries have French titles, descriptions and summaries of evaluation points. Expanding a card reveals the exact original model instruction. Original instructions, evaluation notes, identifiers and generation folders are preserved for historical comparisons. Personal descriptions can be edited.

The new website set covers storefronts, portfolios, reservations, dashboards, forms, CSV handling and accessible interactions. Every brief requests a standalone HTML document with fictional data and no external network calls. Checkpoints and sample numeric results support manual verification; they are not a new automated scoring suite.

Coverage was informed by [FrontendBench](https://arxiv.org/abs/2506.13832) and [Vision2Web](https://vision2web-bench.github.io/). These are original briefs, not copied dataset tasks or an official implementation of either benchmark. References are recorded in `prompt-gallery/data/library-web.json`.

## Live generation log

The batch dialog opens its **Journal de génération** view by default. It shows timestamped request phases, provider reasoning signals (without reasoning text), first HTML, errors, attempts and reported final usage. Select a model row to filter the journal, or choose all models. **Aperçu et code** restores the preview and code view.

Last-signal timing distinguishes current traffic from silence. After 60 seconds without a signal the log reports an unconfirmed wait, without declaring a failure or retrying. It never copies full prompts, response bodies, private reasoning or request headers; error messages redact common credential formats. Up to 400 local entries remain in the dialog after completion and can be exported as JSON. The journal cannot reconstruct activity from an older, already-running browser page.

Batch prompt selection includes a search field for French titles, original titles, descriptions and tags. Empty results offer links to matching prompt sets. Only visible, checked results are launched; Select all/None apply to that filtered list. GTA remains available in Core and Advanced as **GTA VI — jeu urbain en monde ouvert**; its original instruction and generation folder are unchanged.
