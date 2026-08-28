import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputDir = resolve(root, 'docs-site/src/content/docs');
const arabicOutputDir = resolve(root, 'docs-site/src/content/docs/ar');
const imagesSourceDir = resolve(root, 'docs/images');
const imagesTargetDir = resolve(root, 'docs-site/src/content/docs/images');

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
    source: 'docs/frameworks.md',
    target: 'frameworks.md',
    title: 'Flutter & React Native',
    description: 'Automate Flutter and React Native apps with Astur — setup, what works, and the limits to plan around.',
    order: 9
  },
  {
    source: 'docs/network.md',
    target: 'network.md',
    title: 'Network Observation',
    description: "See the HTTP traffic your app makes while a test drives it — what it called, what came back, how long it took.",
    order: 10
  },
  {
    source: 'docs/mobile-web.md',
    target: 'mobile-web.md',
    title: 'Mobile Web',
    description: "Drive a web page in the device's browser — Chrome on Android, Safari on iOS — on the same devices your native suite runs on.",
    order: 12
  },
  {
    source: 'docs/visual-comparison.md',
    target: 'visual-comparison.md',
    title: 'Visual Comparison',
    description: 'Compare the screen against a stored baseline image, so a change in appearance fails a test instead of going unnoticed.',
    order: 11
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
    source: 'docs/release-notes.md',
    target: 'release-notes.md',
    title: 'Release Notes',
    description: "What's new in each Astur release.",
    order: 12
  }
];

// Arabic titles and descriptions, keyed by the English page target.
//
// Only the pages listed here are localized; Starlight falls back to the root
// (English) locale for anything missing, so translating a page at a time never
// leaves a dead link behind.
const arabic = {
  'getting-started.md': {
    title: 'البدء السريع',
    description: 'ثبّت Astur، افحص تطبيقًا يعمل، ثم شغّل أول اختبار على جهاز حقيقي.'
  },
  'prerequisites.md': {
    title: 'المتطلبات',
    description: 'متطلبات الجهاز المضيف و Android و iOS لتشغيل Astur محليًا.'
  },
  'network.md': {
    title: 'مراقبة الشبكة',
    description: 'راقب طلبات HTTP التي يرسلها تطبيقك أثناء تشغيل الاختبار — ما الذي طلبه، وما الذي عاد، وكم استغرق.'
  },
  'visual-comparison.md': {
    title: 'المقارنة البصرية',
    description: 'قارن الشاشة بصورة مرجعية محفوظة، ليفشل الاختبار عند تغيّر المظهر بدلًا من أن يمر دون ملاحظة.'
  },
  'inspector.md': {
    title: 'الـ Inspector وتوليد الكود',
    description: 'استخدم Astur Inspector لبثّ الأجهزة وفحص المحدِّدات وتسجيل التدفّقات وتصدير الاختبارات.'
  },
  'android.md': {
    title: 'Android',
    description: 'إعداد أجهزة Android والمحاكيات والتطبيقات والأذونات والأتمتة عبر الوكيل الأصلي.'
  },
  'ios.md': {
    title: 'iOS',
    description: 'إعداد محاكيات iOS والأتمتة عبر وكيل XCUITest ودورة حياة التطبيق وحدود المنصة.'
  },
  'configuration.md': {
    title: 'الإعدادات',
    description: 'إعدادات Astur في Playwright، والقدرات، وإدارة التطبيق، والمخرجات.'
  },
  'troubleshooting.md': {
    title: 'حل المشكلات',
    description: 'تشخيص مشكلات الأجهزة والتطبيقات والوكيل والـ Inspector وتنفيذ الاختبارات.'
  },
  'cli.md': {
    title: 'مرجع واجهة الأوامر',
    description: 'أوامر doctor و devices و init و codegen و inspect و test.'
  },
  'frameworks.md': {
    title: 'Flutter و React Native',
    description: 'أتمتة تطبيقات Flutter و React Native مع Astur — الإعداد، وما يعمل، والحدود التي يجب التخطيط لها.'
  },
  'roadmap.md': {
    title: 'خارطة الطريق',
    description: 'العمل المخطّط للوكلاء الأصليين والتشخيصات و CI وجاهزية الإصدار.'
  },
  'release-notes.md': {
    title: 'ملاحظات الإصدار',
    description: 'ما الجديد في كل إصدار من Astur.'
  },
  'platform-limits.md': {
    title: 'حدود المنصات',
    description: 'حدود عملية في Android و iOS يوضّحها Astur صراحةً بدل إخفائها.'
  }
};

await mkdir(outputDir, { recursive: true });
await mkdir(arabicOutputDir, { recursive: true });
await rm(resolve(outputDir, 'architecture.md'), { force: true });

for (const page of pages) {
  const sourcePath = resolve(root, page.source);
  const raw = await readFile(sourcePath, 'utf8');
  const body = stripLeadingFrontmatter(stripFirstHeading(raw)).trimStart();

  await writeFile(
    resolve(outputDir, page.target),
    `${buildFrontmatter(page.title, page.description, page.order)}${body}`,
    'utf8'
  );

  // Arabic, when a translated source exists under docs/ar/.
  const arabicSource = resolve(root, 'docs/ar', page.target);
  const meta = arabic[page.target];
  if (meta && await pathExists(arabicSource)) {
    const arabicRaw = await readFile(arabicSource, 'utf8');
    // Arabic pages live one directory deeper, so `./images/x.png` in the
    // source has to climb out to reach the mirrored images directory.
    const arabicBody = stripLeadingFrontmatter(stripFirstHeading(arabicRaw))
      .trimStart()
      .replaceAll('](./images/', '](../images/');
    await writeFile(
      resolve(arabicOutputDir, page.target),
      `${buildFrontmatter(meta.title, meta.description, page.order)}${arabicBody}`,
      'utf8'
    );
  }
}

// Mirror docs/images alongside the synced markdown (in the content dir) so the
// relative `./images/<name>` references resolve and Astro optimizes them with
// the correct base path (works under a project-pages base like /Astur/).
if (await pathExists(imagesSourceDir)) {
  await rm(imagesTargetDir, { recursive: true, force: true });
  await mkdir(imagesTargetDir, { recursive: true });
  await cp(imagesSourceDir, imagesTargetDir, { recursive: true });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function stripFirstHeading(markdown) {
  return markdown.replace(/^# .+\n+/, '');
}

function stripLeadingFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

function buildFrontmatter(title, description, order) {
  return [
    '---',
    `title: ${quoteYaml(title)}`,
    `description: ${quoteYaml(description)}`,
    'sidebar:',
    `  order: ${order}`,
    '---',
    ''
  ].join('\n');
}

function quoteYaml(value) {
  return JSON.stringify(value);
}
