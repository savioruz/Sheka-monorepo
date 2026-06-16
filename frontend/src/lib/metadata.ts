/** Site-wide SEO config + per-page metadata resolution. Consumed by `<SEO>`. */

export interface PageMeta {
	title?: string;
	description?: string;
	keywords?: string[];
	image?: string;
	type?: 'website' | 'article';
	noindex?: boolean;
	canonical?: string;
}

export const siteConfig = {
	name: 'Sheka',
	titleTemplate: '%s · Sheka',
	defaultTitle: 'Sheka — On-chain sports prediction markets',
	description:
		'Sheka is an on-chain 3-way (home/draw/away) parimutuel sports prediction market on Sui, ' +
		'with paid, Seal-encrypted AI match analysis.',
	keywords: ['Sheka', 'Sui', 'prediction market', 'on-chain', 'Seal', 'Walrus'],
	author: 'Sheka',
	url: ((import.meta.env.VITE_SITE_URL as string | undefined) ?? '').replace(/\/$/, ''),
	ogImage: '/logo.png',
	locale: 'en_US',
	twitter: '',
	themeColor: '#0b0b0f'
};

export interface ResolvedMeta {
	title: string;
	description: string;
	keywords: string;
	author: string;
	robots: string;
	canonical: string;
	image: string;
	type: string;
	siteName: string;
	locale: string;
	twitter: string;
	themeColor: string;
	jsonLd: Record<string, unknown>;
}

function toAbsolute(path: string, base: string): string {
	if (/^https?:\/\//.test(path)) return path;
	return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Merge per-page overrides with `siteConfig` into fully-resolved, absolute values. */
export function resolveMeta(origin: string, currentUrl: string, o: PageMeta = {}): ResolvedMeta {
	const base = siteConfig.url || origin.replace(/\/$/, '');
	const title = o.title ? siteConfig.titleTemplate.replace('%s', o.title) : siteConfig.defaultTitle;
	const description = o.description ?? siteConfig.description;
	const canonical = o.canonical ?? currentUrl;
	const image = toAbsolute(o.image ?? siteConfig.ogImage, base);

	return {
		title,
		description,
		keywords: (o.keywords ?? siteConfig.keywords).join(', '),
		author: siteConfig.author,
		robots: o.noindex ? 'noindex, nofollow' : 'index, follow',
		canonical,
		image,
		type: o.type ?? 'website',
		siteName: siteConfig.name,
		locale: siteConfig.locale,
		twitter: siteConfig.twitter,
		themeColor: siteConfig.themeColor,
		jsonLd: {
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: siteConfig.name,
			url: base,
			description
		}
	};
}
