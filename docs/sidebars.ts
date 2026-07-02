import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Self-hosting',
      collapsible: true,
      collapsed: false,
      items: [
        'server-setup',
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
