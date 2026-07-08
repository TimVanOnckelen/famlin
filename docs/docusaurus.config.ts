import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Famlin Docs',
  tagline: 'Private, self-hosted family updates app',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://famlin.app',
  baseUrl: '/docs/',

  organizationName: 'famlin',
  projectName: 'famlin',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/TimVanOnckelen/famlin/tree/main/docs/',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'developers',
        path: 'developers',
        routeBasePath: 'developers',
        sidebarPath: './sidebars-developers.ts',
        editUrl: 'https://github.com/TimVanOnckelen/famlin/tree/main/docs/',
        // Renders the generated API-reference pages (openapi/famlin.yaml →
        // developers/api-reference) with the OpenAPI theme's layout.
        docItemComponent: '@theme/ApiItem',
      },
    ],
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'api',
        docsPluginId: 'developers',
        config: {
          famlin: {
            specPath: 'openapi/famlin.yaml',
            outputDir: 'developers/api-reference',
            sidebarOptions: {
              groupPathsBy: 'tag',
              categoryLinkSource: 'tag',
            },
            hideSendButton: false,
            showSchemas: true,
          },
        },
      },
    ],
  ],

  themes: ['docusaurus-theme-openapi-docs'],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Famlin',
      logo: {
        alt: 'Famlin Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          type: 'docSidebar',
          docsPluginId: 'developers',
          sidebarId: 'developersSidebar',
          position: 'left',
          label: 'Developers',
        },
        {
          href: 'https://github.com/TimVanOnckelen/famlin',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Overview',
              to: '/',
            },
            {
              label: 'Server setup',
              to: '/server-setup',
            },
            {
              label: 'Security',
              to: '/security',
            },
          ],
        },
        {
          title: 'Developers',
          items: [
            {
              label: 'Quick start',
              to: '/developers/quick-start',
            },
            {
              label: 'Architecture',
              to: '/developers/architecture',
            },
            {
              label: 'Contributing',
              to: '/developers/contributing',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/TimVanOnckelen/famlin/discussions',
            },
            {
              label: 'Issues',
              href: 'https://github.com/TimVanOnckelen/famlin/issues',
            },
          ],
        },
        {
          title: 'Legal',
          items: [
            {
              label: 'License',
              href: 'https://github.com/TimVanOnckelen/famlin/blob/main/LICENSE',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Tim Van Onckelen. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
