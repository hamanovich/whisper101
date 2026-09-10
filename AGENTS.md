# Repository Guidelines

## Project Structure & Module Organization

`whisper101` is a Bun/TypeScript CLI for multilingual audio transcription and text tasks.

- `src/cli.ts`, `src/wizard.ts`, `src/options.ts`: entry point, interactive choices, and shared types.
- `src/pipeline.ts`: transcription, task dispatch, output files, and run metadata.
- `src/transcribe.ts`, `src/recognition.ts`, `src/record.ts`: ffmpeg, whisper.cpp, microphone capture, and diagnostics.
- `src/tasks/`: coach, meeting, and note handlers.
- `src/history.ts`, `src/library.ts`, `src/review.ts`: saved runs and transcript review.
- `src/report.ts`, `src/progress.ts`, `src/open.ts`, `src/text.ts`: sanitized offline HTML, the cross-run summary, system file opening, and dash normalization.
- `tests/*.test.ts`: Bun tests with mocked API and prompt interactions.

Generated files belong in ignored `output/`; wizard preferences live in ignored `.local/settings.json`. Native binaries and models normally live in sibling `../whisper.cpp/`.

## Build, Test, and Development Commands

Run commands from the repository root so Bun loads `.env`:

- `bun install`: install locked dependencies.
- `bun start record`: record from the microphone, then run the wizard flow.
- `bun start progress`: rebuild `output/progress.html` from saved runs.
- `bun start settings`: choose the OpenAI model without editing `.env`.
- `bun start recording.m4a`: run the interactive wizard.
- `bun start recording.m4a --task coach --language en`: run directly.
- `bun start transcript.txt --task note`: process existing text.
- `bun run doctor`: validate local tools and configuration without API calls.
- `bun test`: run the test suite.
- `bun run typecheck`: check TypeScript without output files.
- `bun run format`: format code and Markdown with Prettier.

Bun executes TypeScript directly; there is no build step.

## Coding Style & Naming Conventions

- Never write comments in code.
- **No em dashes:** Never use the em dash character (U+2014) in any file, including `.js`, `.ts`, `.html`, `.css`, and `.md`, or in data, markup, or commit messages. Use a hyphen (`-`), comma, colon, or parentheses instead. Model output is held to the same rule by `plainDashes` in `src/text.ts`, applied both when saving results and when rendering pages.

Use two-space indentation, double quotes, semicolons, ES modules, camelCase functions, and lowercase filenames. Keep strict TypeScript enabled. Prefer Bun APIs and subprocess argument arrays. Terminal messages are Russian; reports follow the selected result language. No linter is configured.

## Testing Guidelines

Use `bun:test` and behavior-based test names. Mock OpenAI, file opening, and prompts. Cover cancellation, option precedence, missing TTY, task dispatch, failures, and file preservation. Run tests and typechecking before submission; manually check keyboard interaction after wizard changes. No coverage threshold is configured.

## Commit & Pull Request Guidelines

Git history currently provides no established convention. Use concise imperative subjects. PRs should explain behavior, show relevant CLI examples, list validation, and link issues when available.

## Documentation, Security & Outputs

Update the Russian `README.md` with every user-facing change. Never log keys or raw API errors. Keep audio local and send only transcript text to OpenAI. Never overwrite prior runs. Transcript review must preserve `transcript.txt`, reuse `transcript.reviewed.txt`, and require readiness confirmation. HTML reports must escape transcripts, sanitize Markdown, and contain no external assets or scripts.
