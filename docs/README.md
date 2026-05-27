# Astur Documentation

This documentation is organized as a learning path from first install to advanced architecture and reliability work.

The public docs website is generated from these Markdown files by the Astro Starlight app in `docs-site/`.

```bash
npm run docs:dev
npm run docs:build
```

## Stage 1: First Success

1. [Prerequisites](prerequisites.md)
2. [Getting Started](getting-started.md)
3. [CLI Reference](cli.md)
4. [Inspector And Codegen](inspector.md)

Outcome:

- run `doctor`
- see devices
- run your first test
- inspect a running app and export starter test code

## Stage 2: Platform Mastery

5. [Android Setup](android.md)
6. [iOS Setup](ios.md)
7. [Configuration and Capabilities](configuration.md)
8. [Troubleshooting](troubleshooting.md)

Outcome:

- configure deterministic device selection
- tune timeout, artifacts, and keyboard behavior
- choose the native-agent engine or explicit migration fallback

## Stage 3: Advanced System Understanding

- [Architecture](architecture.md)
- [Platform Limits](platform-limits.md)
- [Roadmap](roadmap.md)
- [Publishing](publishing.md)

Outcome:

- understand command flow and fallback rules
- contribute safely to driver and agent layers
- plan CI migration from fallback to required native-agent paths

## Recommended Learning Sequence

1. Complete Getting Started with Android emulator mode.
2. Read Configuration and apply project-based device selection.
3. Add artifacts and assertions for reliability diagnostics.
4. Keep the default native-agent engine for new projects.
5. Use `automation.engine: 'auto'` only when migrating older fallback-based suites.
