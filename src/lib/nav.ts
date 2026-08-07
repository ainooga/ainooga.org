export interface NavItem {
  label: string;
  path: string;
}

/**
 * Canonical site navigation. Header and footer both render this list so
 * primary and footer navigation never drift out of sync.
 *
 * If you want the footer to carry extra utility links, append them to the
 * FOOTER_EXTRA list below rather than editing this array inline.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Membership', path: '/membership' },
  { label: 'Advertise', path: '/advertise' },
  { label: 'Events', path: '/events' },
  { label: 'Posts', path: '/posts' },
  { label: 'Members', path: '/members' },
  { label: 'Sponsor', path: '/sponsor' },
  { label: 'About', path: '/about' },
];

/**
 * Optional extra links shown only in the footer. Kept as a separate list so
 * the primary header nav stays focused while the footer can be expanded.
 */
export const FOOTER_EXTRA: NavItem[] = [];
