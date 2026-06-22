import { siteConfig } from '$lib/metadata';

export const prerender = true;

// Indexable pages only — /under-construction is noindex, so it's excluded.
const PAGES: { path: string; priority: string; changefreq: string }[] = [
	{ path: '/', priority: '1.0', changefreq: 'weekly' }
];

export function GET() {
	const base = siteConfig.url;
	const urls = PAGES.map(
		(p) =>
			`  <url><loc>${base}${p.path}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
	).join('\n');
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
	return new Response(xml, {
		headers: { 'Content-Type': 'application/xml' }
	});
}
