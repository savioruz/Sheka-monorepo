import type { PageMeta } from '$lib/metadata';

/** Per-page SEO for the home (markets) page. Picked up by <SEO> in the root layout. */
export const load = (): { meta: PageMeta } => ({
	meta: {
		title: 'Markets',
		description:
			'Browse live and upcoming sports markets on Sui and stake on home, draw, or away — ' +
			'with optional Seal-encrypted AI match analysis.'
	}
});
