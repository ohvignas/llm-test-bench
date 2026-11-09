# Contributing / Contribuer

Contributions are welcome in French or English. This fork adds an authenticated Docker edition to the original static LLM Test Bench.

## Run the project

Follow [README.md](README.md) or [README.en.md](README.en.md). No host Python is required for the Docker path. Use dummy credentials and a separate Compose project/port for development; never use a real key in tests.

## Validate changes

Backend tests inside the running image:

```sh
docker compose exec -T bench python -m unittest discover -s server/tests -v
```

Browser-service tests with Node.js 22 or newer installed locally:

```sh
node --test shared/tests/secure-session.test.mjs shared/tests/openrouter-vault.test.mjs shared/tests/openrouter-streaming.test.mjs shared/tests/batch-live-progress.test.mjs shared/tests/providers-openai-compatible.test.mjs shared/tests/gen-params.test.mjs shared/tests/distribution.test.mjs
```

Validate Compose and rebuild after source changes:

```sh
docker compose config --quiet
docker compose up -d --build --wait
```

Check changed flows in a browser and describe actual verification in the PR. Preserve technical identifiers, system prompts and generated/user-authored content when translating UI text. No paid model calls are required by the tests.

## Pull requests

Target `ohvignas/llm-test-bench`, explain the user-visible change and include relevant tests. Add screenshots for UI changes and mention effects on credentials, storage or request boundaries. Never commit secrets, local databases, Docker data or backups. New code follows the repository's MIT license; preserve upstream attribution and third-party notices.

## Security reports

See [SECURITY.md](SECURITY.md). Do not put real credentials or private data in a public issue.
