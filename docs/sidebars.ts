import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Using Famlin',
      collapsible: true,
      collapsed: false,
      items: [
        'features',
        'sharing-updates',
        'stories',
        'photos-and-albums',
        'chat',
        'search-and-favorites',
        'notifications-and-profile',
        'trips',
        'gift-lists',
        'family-wiki',
      ],
    },
    {
      type: 'category',
      label: 'Self-hosting',
      link: {type: 'doc', id: 'choose-installation'},
      collapsible: true,
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Installation',
          collapsible: true,
          collapsed: false,
          items: [
            'install-vps',
            'server-setup',
            'install-synology',
            'install-umbrel-casaos',
            'install-home-assistant',
            'cloudflare-tunnel',
          ],
        },
        {
          type: 'category',
          label: 'Administration',
          collapsible: true,
          collapsed: true,
          items: [
            'admin-configuration',
            'storage',
            'inviting-family',
            'managing-users-and-content',
          ],
        },
        {
          type: 'category',
          label: 'Operations',
          collapsible: true,
          collapsed: true,
          items: ['maintenance', 'security'],
        },
      ],
    },
  ],
};

export default sidebars;
