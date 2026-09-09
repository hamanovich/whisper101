# Repository Guidelines

## Project Structure & Module Organization

`whisper101` is a Bun/TypeScript CLI for multilingual audio transcription and text tasks.

- `src/cli.ts`: arguments, legacy shortcuts, and entry point.
- `src/wizard.ts`: interactive prompts and remembered choices.
- `src/options.ts`: task names, languages, and shared options.
- `src/pipeline.ts`: transcription, task dispatch, output files, and run metadata.
- `src/tasks/`: coach, meeting, and note handlers; `src/coach.ts` is a compatibility export.
- `src/transcribe.ts`, `src/recognition.ts`: native audio processing and diagnostics.
- `src/config.ts`, `src/output.ts`, `src/timing.ts`: configuration and shared utilities.
- `tests/*.test.ts`: Bun tests with mocked API calls and wizard interactions.

Generated files live in ignored `output/`; wizard preferences live in ignored `.local/settings.json`. Native binaries and models normally live in sibling `../whisper.cpp/`.

## Build, Test, and Development Commands

Run from the project root so Bun loads `.env`:

- `bun install`: install locked dependencies.
- `bun start recording.m4a`: open the interactive wizard.
- `bun start recording.m4a --task coach --language en`: run directly.
- `bun start transcript.txt --task note`: reuse text without Whisper.
- `bun run transcribe recording.m4a`: local transcription only.
- `bun run doctor`: check tools and configuration without API calls.
- `bun test`: run automated checks.
- `bun run format`: format source and documentation with Prettier.
- `bun run typecheck`: check TypeScript without emitting files.

Bun executes TypeScript directly; no application build step is required.

## Coding Style & Naming Conventions

Use two-space indentation, double quotes, semicolons, ES modules, camelCase functions, and lowercase module filenames. Keep strict TypeScript checks enabled. Prefer Bun tooling and subprocess argument arrays. Terminal messages are Russian; generated reports follow the selected feedback language. Use Prettier via `bun run format`; configuration is in `.prettierrc.json`. No linter is configured.

## Testing Guidelines

Use `bun:test` with descriptive behavior-based names. Mock OpenAI and prompt interactions. Cover cancellation, skipped questions, explicit-option precedence, missing TTY, task dispatch, API failures, and output preservation. Run tests and typechecking before submission; manually check keyboard interaction for wizard changes. No coverage threshold is configured.

## Commit & Pull Request Guidelines

No Git metadata was present when this guide was written. Use concise imperative commit subjects. PRs should describe behavior changes, show relevant CLI examples, list validation, and link related issues where available.

## Security & Configuration

Never log keys or raw API errors. Keep audio local and send only transcript text to OpenAI. Create results only after wizard completion; never overwrite prior runs. Preserve transcripts after failures. Store only task/language preferences, never credentials, in settings. Keep task-specific prompts out of the shared audio pipeline.
