import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repository = process.env.GITHUB_REPOSITORY ?? 'Astur-mobile/Astur';
const repositoryName = repository.split('/')[1] ?? '';
const repositoryUrl = process.env.DOCS_REPOSITORY_URL ?? `https://github.com/${repository}`;
const isOrgPagesRepository = repositoryName.toLowerCase() === 'astur-mobile.github.io';
const base = process.env.DOCS_BASE ?? (process.env.GITHUB_ACTIONS && !isOrgPagesRepository
  ? `/${repositoryName}`
  : '/');
const site = process.env.DOCS_SITE ?? 'https://astur-mobile.github.io';

export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: {
        en: 'Astur',
        ar: 'Astur'
      },
      description: 'Device-native mobile automation with Playwright ergonomics.',
      // English stays at the site root so every existing URL keeps working;
      // Arabic is added underneath at /ar/. Starlight falls back to the root
      // locale for any page not translated yet, so a partial translation ships
      // as a working site rather than a set of dead links.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        ar: { label: 'العربية', lang: 'ar', dir: 'rtl' }
      },
      logo: {
        dark: '../packages/cli/assets/brand/astur-logo-dark.png',
        light: '../packages/cli/assets/brand/astur-logo-light.png',
        alt: 'Astur',
        replacesTitle: true
      },
      favicon: '/favicon.svg',
      editLink: {
        baseUrl: `${repositoryUrl}/edit/main/docs`
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Astur-mobile'
        }
      ],
      head: [
        {
          // Google Search Console site verification (URL-prefix property:
          // https://astur-mobile.github.io/Astur/).
          tag: 'meta',
          attrs: {
            name: 'google-site-verification',
            content: 'xDL9eh0Yh1N4JPlASZFae51ssZwswCoXpx5MqOeVgSE'
          }
        },
        {
          tag: 'script',
          content: "try{if(!localStorage.getItem('starlight-theme'))localStorage.setItem('starlight-theme','light')}catch{}"
        },
        {
          // On the homepage the site title links to itself, which is a no-op.
          // Repoint it to Getting Started so the header "Docs" enters the docs.
          tag: 'script',
          content: "addEventListener('DOMContentLoaded',function(){var a=document.querySelector('a.site-title');if(!a)return;var home=a.getAttribute('href')||'/';if(home.slice(-1)!=='/')home+='/';var here=location.pathname;if(here.slice(-1)!=='/')here+='/';if(here===home){a.setAttribute('href',home+'getting-started/');a.removeAttribute('aria-current');}});"
        }
      ],
      customCss: ['./src/styles/astur.css'],
      components: {
        Footer: './src/components/Footer.astro',
        SocialIcons: './src/components/SocialIcons.astro'
      },
      sidebar: [
        {
          label: 'Start',
          translations: { ar: 'البداية' },
          items: [
            { label: 'Overview', translations: { ar: 'نظرة عامة' }, slug: 'index' },
            { label: 'Why Astur', translations: { ar: 'لماذا Astur' }, slug: 'why-astur' },
            { label: 'Getting Started', translations: { ar: 'البدء السريع' }, slug: 'getting-started' },
            { label: 'Inspector And Codegen', translations: { ar: 'الـ Inspector وتوليد الكود' }, slug: 'inspector' },
            { label: 'Demo App', translations: { ar: 'التطبيق التجريبي' }, slug: 'demo-app' }
          ]
        },
        {
          label: 'Guides',
          translations: { ar: 'الأدلة' },
          items: [
            { label: 'Prerequisites', translations: { ar: 'المتطلبات' }, slug: 'prerequisites' },
            { label: 'Android', translations: { ar: 'Android' }, slug: 'android' },
            { label: 'iOS', translations: { ar: 'iOS' }, slug: 'ios' },
            { label: 'Flutter & React Native', translations: { ar: 'Flutter و React Native' }, slug: 'frameworks' },
            { label: 'Network Observation', translations: { ar: 'مراقبة الشبكة' }, slug: 'network' },
            { label: 'Visual Comparison', translations: { ar: 'المقارنة البصرية' }, slug: 'visual-comparison' },
            { label: 'Configuration', translations: { ar: 'الإعدادات' }, slug: 'configuration' },
            { label: 'Troubleshooting', translations: { ar: 'حل المشكلات' }, slug: 'troubleshooting' }
          ]
        },
        {
          label: 'Reference',
          translations: { ar: 'المرجع' },
          items: [
            { label: 'CLI', translations: { ar: 'واجهة الأوامر CLI' }, slug: 'cli' },
            { label: 'Architecture', translations: { ar: 'البنية' }, slug: 'architecture' },
            { label: 'Platform Limits', translations: { ar: 'قيود المنصات' }, slug: 'platform-limits' },
            { label: 'Release Notes', translations: { ar: 'ملاحظات الإصدار' }, slug: 'release-notes' },
            { label: 'Roadmap', translations: { ar: 'خارطة الطريق' }, slug: 'roadmap' }
          ]
        }
      ]
    })
  ]
});
