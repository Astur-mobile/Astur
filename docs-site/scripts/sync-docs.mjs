import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputDir = resolve(root, 'docs-site/src/content/docs');

const pages = [
  {
    source: 'docs/getting-started.md',
    target: 'getting-started.md',
    title: 'Getting Started',
    description: 'Install Astur, inspect a running app, and run your first mobile test.',
    order: 1
  },
  {
    source: 'docs/inspector.md',
    target: 'inspector.md',
    title: 'Inspector And Codegen',
    description: 'Use Astur Inspector to stream devices, inspect locators, record flows, and export tests.',
    order: 2
  },
  {
    source: 'docs/prerequisites.md',
    target: 'prerequisites.md',
    title: 'Prerequisites',
    description: 'Host, Android, and iOS requirements for running Astur locally.',
    order: 3
  },
  {
    source: 'docs/android.md',
    target: 'android.md',
    title: 'Android',
    description: 'Configure Android devices, emulators, apps, permissions, and native-agent automation.',
    order: 4
  },
  {
    source: 'docs/ios.md',
    target: 'ios.md',
    title: 'iOS',
    description: 'Configure iOS simulators, XCUITest agent automation, app lifecycle, and platform limits.',
    order: 5
  },
  {
    source: 'docs/configuration.md',
    target: 'configuration.md',
    title: 'Configuration',
    description: 'Astur Playwright configuration, capabilities, app management, and artifacts.',
    order: 6
  },
  {
    source: 'docs/troubleshooting.md',
    target: 'troubleshooting.md',
    title: 'Troubleshooting',
    description: 'Diagnose device, app, agent, inspector, and test execution issues.',
    order: 7
  },
  {
    source: 'docs/cli.md',
    target: 'cli.md',
    title: 'CLI Reference',
    description: 'Commands for doctor, devices, init, codegen, inspect, and test.',
    order: 8
  },
  {
    source: 'docs/platform-limits.md',
    target: 'platform-limits.md',
    title: 'Platform Limits',
    description: 'Practical Android and iOS boundaries that Astur makes explicit.',
    order: 10
  },
  {
    source: 'docs/roadmap.md',
    target: 'roadmap.md',
    title: 'Roadmap',
    description: 'Planned work for native agents, diagnostics, CI, and release readiness.',
    order: 11
  },
  {
    source: 'docs/publishing.md',
    target: 'publishing.md',
    title: 'Publishing',
    description: 'Npm package strategy, release workflow, and GitHub Actions plan.',
    order: 12
  }
];

await mkdir(outputDir, { recursive: true });
await rm(resolve(outputDir, 'architecture.md'), { force: true });

for (const page of pages) {
  const sourcePath = resolve(root, page.source);
  const targetPath = resolve(outputDir, page.target);
  const raw = await readFile(sourcePath, 'utf8');
  const body = stripLeadingFrontmatter(stripFirstHeading(raw)).trimStart();
  const frontmatter = [
    '---',
    `title: ${quoteYaml(page.title)}`,
    `description: ${quoteYaml(page.description)}`,
    `sidebar:`,
    `  order: ${page.order}`,
    '---',
    ''
  ].join('\n');

  await writeFile(targetPath, `${frontmatter}${body}`, 'utf8');
}

function stripFirstHeading(markdown) {
  return markdown.replace(/^# .+\n+/, '');
}

function stripLeadingFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

function quoteYaml(value) {
  return JSON.stringify(value);
}
