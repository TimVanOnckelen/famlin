import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'choose-installation',
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
      ],
    },
    {
      type: 'category',
      label: 'Self-hosting',
      collapsible: true,
      collapsed: false,
      items: [
        'server-setup',
        'install-umbrel-casaos',
        'install-home-assistant',
        'storage',
        'admin-configuration',
        'inviting-family',
        'managing-users-and-content',
        'maintenance',
        'security',
      ],
    },
  ],
};

export default sidebars;
