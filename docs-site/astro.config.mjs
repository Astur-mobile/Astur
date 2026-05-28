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
      title: 'Astur',
      description: 'Device-native mobile automation with Playwright ergonomics.',
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
          tag: 'script',
          content: "try{if(!localStorage.getItem('starlight-theme'))localStorage.setItem('starlight-theme','light')}catch{}"
        }
      ],
      customCss: ['./src/styles/astur.css'],
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Overview', slug: 'index' },
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Inspector And Codegen', slug: 'inspector' }
          ]
        },
        {
          label: 'Guides',
          items: [
            { label: 'Prerequisites', slug: 'prerequisites' },
            { label: 'Android', slug: 'android' },
            { label: 'iOS', slug: 'ios' },
            { label: 'Configuration', slug: 'configuration' },
            { label: 'Troubleshooting', slug: 'troubleshooting' }
          ]
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'cli' },
            { label: 'Architecture', slug: 'architecture' },
            { label: 'Platform Limits', slug: 'platform-limits' },
            { label: 'Roadmap', slug: 'roadmap' }
          ]
        }
      ]
    })
  ]
});
