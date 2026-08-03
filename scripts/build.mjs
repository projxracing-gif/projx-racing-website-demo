import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repo, 'dist');
const template = fs.readFileSync(path.join(repo, 'template.html'), 'utf8');
const assetVersion = crypto.createHash('sha256')
  .update(['assets/styles.css', 'assets/site-config.js', 'assets/data.js', 'assets/i18n/en.js', 'assets/i18n/ar.js', 'assets/app.js']
    .map(file => fs.readFileSync(path.join(repo, file)))
    .reduce((buffer, part) => Buffer.concat([buffer, part]), Buffer.from('')))
  .update(String(process.env.CLERK_PUBLISHABLE_KEY || ''))
  .digest('hex')
  .slice(0, 12);

function loadProjectData() {
  const context = { window: {} };
  vm.createContext(context);
  for (const file of ['assets/data.js', 'assets/site-config.js', 'assets/i18n/en.js', 'assets/i18n/ar.js']) {
    vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), context, { filename: file });
  }
  return {
    data: context.window.PROJX_DATA,
    config: context.window.PROJX_CONFIG,
    translations: context.window.PROJX_TRANSLATIONS
  };
}

const { data: DATA, config: CONFIG, translations: T } = loadProjectData();
const siteUrl = String(CONFIG.siteUrl || 'https://projxracing.com/').replace(/\/+$/, '') + '/';
const locales = ['en', 'ar'];

const esc = (value = '') => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const trimDescription = value => {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= 160 ? clean : `${clean.slice(0, 157).replace(/\s+\S*$/, '')}…`;
};
const cleanRoute = value => value === '/' ? '/' : `/${String(value).replace(/^\/+|\/+$/g, '')}`;
const media = id => DATA.media.find(item => Number(item.id) === Number(id)) || DATA.media[0];
const localizedService = (locale, service) => ({ ...service, ...(T[locale].services?.[service.slug] || {}) });
const localizedProject = (locale, project) => ({ ...project, ...(T[locale].projects?.[project.slug] || {}) });
const localizedPlatform = (locale, platform) => ({ ...platform, ...(T[locale].tuning?.[platform.slug] || {}) });
const localizedPart = (locale, part, index) => ({ ...part, ...(T[locale].parts?.[index] || {}) });
const localizedStoreProduct = (locale, product) => locale === 'ar' ? {
  ...product,
  title: product.titleAr || product.title,
  summary: product.summaryAr || product.summary,
  category: product.categoryAr || product.category,
  status: product.statusAr || product.status
} : product;
const pathFor = (locale, route = '/') => `${locale}/${cleanRoute(route) === '/' ? '' : `${cleanRoute(route).slice(1)}/`}`;
const canonical = (locale, route = '/') => new URL(pathFor(locale, route), siteUrl).href;
const defaultCanonical = route => canonical('en', route);
const mediaUrl = id => new URL(media(id).full, siteUrl).href;

function localBusinessJson(locale) {
  const ar = locale === 'ar';
  return {
    '@type': ['AutomotiveBusiness', 'LocalBusiness'],
    '@id': `${siteUrl}#business`,
    name: DATA.business.name,
    legalName: DATA.business.legalName,
    url: canonical(locale, '/'),
    image: new URL('assets/media/og/projx-racing-og.jpg', siteUrl).href,
    logo: new URL('assets/brand/projx-racing-logo.png', siteUrl).href,
    telephone: DATA.business.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: `${DATA.business.address1}, ${DATA.business.address2}`,
      addressLocality: DATA.business.city,
      addressCountry: 'KW'
    },
    areaServed: ['Kuwait', 'GCC'],
    sameAs: [DATA.business.instagram, DATA.business.googleProfile],
    inLanguage: locale === 'ar' ? 'ar-KW' : 'en-KW',
    description: ar
      ? 'ورشة Motorsport في الكويت لخدمات برمجة ECU والـ Mainline Dyno وبناء المحركات وMotorsport Wiring والتصنيع وتجهيز الشاصي والحلبة.'
      : 'Motorsport workshop in Kuwait for ECU calibration, Mainline dyno tuning, engine building, motorsport wiring, fabrication, chassis setup and track preparation.'
  };
}

function breadcrumbJson(locale, route, title) {
  if (route === '/') return null;
  const labels = T[locale].ui.nav;
  const known = {
    services: labels.services,
    tuning: labels.tuning,
    'engine-building': labels.engineBuilding,
    projects: labels.projects,
    parts: labels.parts,
    brands: labels.brands,
    gallery: labels.gallery,
    reviews: labels.reviews,
    about: labels.about,
    contact: labels.contact,
    faq: labels.faq,
    legal: locale === 'ar' ? 'معلومات وسياسات' : 'Information & Policies'
  };
  const segments = route.split('/').filter(Boolean);
  const items = [{ '@type': 'ListItem', position: 1, name: labels.home, item: canonical(locale, '/') }];
  let cumulative = '';
  segments.forEach((segment, index) => {
    cumulative += `/${segment}`;
    items.push({
      '@type': 'ListItem',
      position: index + 2,
      name: index === segments.length - 1 ? title.replace(/ \|.*$/, '') : (known[segment] || segment.replace(/-/g, ' ')),
      item: canonical(locale, cumulative)
    });
  });
  return { '@type': 'BreadcrumbList', itemListElement: items };
}

function list(items = []) {
  return items.length ? `<ul>${items.slice(0, 10).map(item => `<li>${esc(Array.isArray(item) ? item.join(' — ') : item)}</li>`).join('')}</ul>` : '';
}

function fallback(locale, page) {
  const ui = T[locale].ui;
  const eyebrow = page.eyebrow || (locale === 'ar' ? 'Projx Racing الكويت' : 'Projx Racing Kuwait');
  const links = page.links || [];
  return `<section class="static-fallback"><div class="container narrow"><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(page.h1)}</h1><p>${esc(page.description)}</p>${list(page.details || [])}${links.length ? `<nav aria-label="${esc(locale === 'ar' ? 'صفحات مرتبطة' : 'Related pages')}">${links.map(([label, route]) => `<a href="${esc(pathFor(locale, route))}">${esc(label)}</a>`).join('')}</nav>` : ''}<a class="btn" href="${esc(pathFor(locale, '/contact'))}">${esc(ui.actions.contactWorkshop)}</a></div></section>`;
}

const routes = [];
function add(route, buildPage) {
  routes.push({ route: cleanRoute(route), buildPage });
}

add('/', locale => {
  const page = T[locale].pages.home;
  return {
    title: page.title, h1: page.heading, description: page.description, eyebrow: page.eyebrow, hero: 35,
    details: DATA.services.slice(0, 8).map(service => localizedService(locale, service).title),
    links: [[T[locale].ui.actions.exploreServices, '/services'], [T[locale].ui.nav.tuning, '/tuning'], [T[locale].ui.nav.engineBuilding, '/engine-building'], [T[locale].ui.actions.contactWorkshop, '/contact']],
    schema: [localBusinessJson(locale), { '@type': 'WebSite', '@id': `${siteUrl}#website`, url: canonical(locale, '/'), name: DATA.business.name, inLanguage: T[locale].locale, publisher: { '@id': `${siteUrl}#business` } }]
  };
});

add('/services', locale => {
  const page = T[locale].pages.services;
  return {
    title: page.title, h1: page.heading, description: page.description, eyebrow: page.eyebrow, hero: 15,
    details: DATA.services.map(service => localizedService(locale, service).title),
    links: DATA.services.map(service => [localizedService(locale, service).title, service.slug === 'online-tuning' ? '/tuning' : service.slug === 'engine-building' ? '/engine-building' : `/services/${service.slug}`])
  };
});
for (const service of DATA.services.filter(item => !['online-tuning', 'engine-building'].includes(item.slug))) {
  add(`/services/${service.slug}`, locale => {
    const local = localizedService(locale, service);
    const title = locale === 'ar' ? `${local.title} في الكويت | Projx Racing` : `${local.title} in Kuwait | Projx Racing`;
    return {
      title, h1: local.title, description: local.summary || local.intro, eyebrow: local.kicker, hero: local.media?.[0] || 15,
      details: [...(local.features || []), ...(local.platforms || [])],
      links: [[T[locale].ui.actions.viewAllServices, '/services'], [T[locale].ui.actions.requestQuote, '/contact']],
      schema: [{ '@type': 'Service', name: local.title, description: local.summary || local.intro, provider: { '@id': `${siteUrl}#business` }, areaServed: 'Kuwait', inLanguage: T[locale].locale, url: canonical(locale, `/services/${service.slug}`) }]
    };
  });
}

add('/tuning', locale => {
  const page = T[locale].pages.tuning;
  return {
    title: page.title, h1: page.heading, description: page.description, eyebrow: page.eyebrow, hero: 36,
    details: Object.values(DATA.tuningPlatforms).map(platform => {
      const local = localizedPlatform(locale, platform);
      return `${local.short} — ${local.supportedScope}`;
    }),
    links: Object.values(DATA.tuningPlatforms).map(platform => [localizedPlatform(locale, platform).short, `/tuning/${platform.slug}`])
  };
});
for (const platform of Object.values(DATA.tuningPlatforms)) {
  add(`/tuning/${platform.slug}`, locale => {
    const local = localizedPlatform(locale, platform);
    return {
      title: locale === 'ar' ? `${local.short} | برمجة Online من Projx Racing` : `${local.short} | Projx Racing Online Tuning`,
      h1: local.title,
      description: trimDescription(`${local.supportedScope} ${locale === 'ar' ? 'مراجعة توافق وبرمجة وتحليل Data Logs للتطبيقات المدعومة.' : 'Platform-specific compatibility review, calibration and datalog analysis for supported applications.'}`),
      eyebrow: local.platform,
      hero: local.cover,
      details: [...(local.engines || []), ...(local.requirements || []).slice(0, 6)],
      links: [[T[locale].ui.nav.tuning, '/tuning'], [T[locale].ui.actions.checkCompatibility, '/contact']],
      schema: [{ '@type': 'Service', name: local.title, serviceType: local.platform, description: local.supportedScope, provider: { '@id': `${siteUrl}#business` }, inLanguage: T[locale].locale, url: canonical(locale, `/tuning/${platform.slug}`) }]
    };
  });
}

add('/engine-building', locale => {
  const page = T[locale].pages.engineBuilding;
  return {
    title: page.title, h1: page.heading, description: page.description, eyebrow: page.eyebrow, hero: 19,
    details: page.options.map(([title]) => title),
    links: [[T[locale].ui.actions.engineConsultation, '/contact'], [T[locale].ui.nav.projects, '/projects']],
    schema: [{ '@type': 'Service', name: page.heading, serviceType: 'Engine building', description: page.description, provider: { '@id': `${siteUrl}#business` }, areaServed: 'Kuwait', inLanguage: T[locale].locale, url: canonical(locale, '/engine-building') }]
  };
});

add('/projects', locale => {
  const page = T[locale].pages.projects;
  return { title: page.title, h1: page.heading, description: page.description, eyebrow: page.eyebrow, hero: 35, details: DATA.projects.map(project => localizedProject(locale, project).title), links: DATA.projects.map(project => [localizedProject(locale, project).title, `/projects/${project.slug}`]) };
});
for (const project of DATA.projects) {
  add(`/projects/${project.slug}`, locale => {
    const local = localizedProject(locale, project);
    return {
      title: `${local.title} | Projx Racing`, h1: local.title, description: local.summary, eyebrow: local.category, hero: local.cover, ogType: 'article',
      details: [local.objective, ...(local.work || []).slice(0, 8)],
      links: [[T[locale].ui.nav.projects, '/projects'], [T[locale].ui.actions.contactWorkshop, '/contact']],
      schema: [{ '@type': 'Article', headline: local.title, description: local.summary, image: mediaUrl(local.cover), inLanguage: T[locale].locale, author: { '@id': `${siteUrl}#business` }, publisher: { '@id': `${siteUrl}#business` }, mainEntityOfPage: canonical(locale, `/projects/${project.slug}`) }]
    };
  });
}

for (const [index, part] of DATA.parts.entries()) {
  add(`/parts/${part.slug}`, locale => {
    const local = localizedPart(locale, part, index);
    return {
      title: `${local.title} | Projx Racing Parts`,
      h1: local.title,
      description: local.summary,
      eyebrow: locale === 'ar' ? 'باقة يتم تحديدها حسب السيارة' : 'Vehicle-configured parts package',
      hero: local.media,
      details: [local.category, local.brand, local.vehicle, local.status, local.price],
      links: [[T[locale].ui.nav.parts, '/parts'], [T[locale].ui.actions.contactWorkshop, '/contact']],
      schema: [{ '@type': 'Service', name: local.title, description: local.summary, provider: { '@id': `${siteUrl}#business` }, areaServed: ['Kuwait', 'GCC'], inLanguage: T[locale].locale, url: canonical(locale, `/parts/${part.slug}`) }]
    };
  });
}

for (const product of (DATA.storeProducts || [])) {
  add(`/parts/${product.slug}`, locale => {
    const local = localizedStoreProduct(locale, product);
    const productSchema = {
      '@type': 'Product',
      name: local.title,
      description: local.summary,
      image: (product.images || []).map(image => new URL(image.src, siteUrl).href),
      sku: product.sku,
      brand: { '@type': 'Brand', name: product.brand },
      url: canonical(locale, `/parts/${product.slug}`)
    };
    if (product.mpn) productSchema.mpn = product.mpn;
    if (!product.quoteOnly && Number(product.priceAmount) > 0 && /^[A-Z]{3}$/.test(product.priceCurrency || '')) productSchema.offers = { '@type': 'Offer', priceCurrency: product.priceCurrency, price: Number(product.priceAmount).toFixed(2), url: canonical(locale, `/parts/${product.slug}`), availability: 'https://schema.org/LimitedAvailability' };
    return {
      title: `${local.title} | Projx Racing Parts`,
      h1: local.title,
      description: local.summary,
      eyebrow: locale === 'ar' ? 'منتج كتالوج تمت مراجعته' : 'Reviewed catalogue product',
      hero: 27,
      primaryImage: new URL(product.images[0].src, siteUrl).href,
      details: [local.category, local.brand, product.sku || product.mpn, local.status],
      links: [[T[locale].ui.nav.parts, '/parts'], [T[locale].ui.actions.contactWorkshop, '/contact']],
      schema: [productSchema]
    };
  });
}

for (const key of ['parts', 'brands', 'gallery', 'reviews', 'about', 'contact', 'faq']) {
  add(`/${key}`, locale => {
    const page = T[locale].pages[key];
    const heroes = { parts: 27, brands: 30, gallery: 35, reviews: 20, about: 15, contact: 20, faq: 36 };
    let details = [];
    if (key === 'parts') details = [...T[locale].parts.map(part => `${part.brand || ''} — ${part.title}`), ...(DATA.storeProducts || []).map(product => localizedStoreProduct(locale, product).title)];
    if (key === 'brands') details = DATA.brands.slice(0, 20).map(brand => brand.name);
    if (key === 'gallery') details = DATA.media.slice(0, 20).map(item => (T[locale].media?.[item.id]?.title || item.title));
    if (key === 'about') details = DATA.services.slice(0, 10).map(service => localizedService(locale, service).title);
    if (key === 'contact') details = [CONFIG.addressLine1, CONFIG.addressLine2, CONFIG.cityCountry, CONFIG.phoneDisplay];
    if (key === 'faq') details = [...T[locale].faq.tuning, ...T[locale].faq.engines, ...T[locale].faq.general].map(([question]) => question);
    const schema = key === 'faq' ? [{ '@type': 'FAQPage', inLanguage: T[locale].locale, mainEntity: [...T[locale].faq.tuning, ...T[locale].faq.engines, ...T[locale].faq.general].map(([question, answer]) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })) }] : [];
    return { title: page.title, h1: page.heading, description: page.description, eyebrow: page.eyebrow, hero: heroes[key], details, links: [[T[locale].ui.actions.contactWorkshop, '/contact']], schema };
  });
}

add('/account', locale => ({
  title: locale === 'ar' ? 'حساب العميل | Projx Racing' : 'Customer Account | Projx Racing',
  h1: locale === 'ar' ? 'تسجيل الدخول أو إنشاء حساب' : 'Sign in or create an account',
  description: locale === 'ar' ? 'دخول آمن لعملاء Projx Racing وإنشاء حساب جديد.' : 'Secure customer sign-in and account registration for Projx Racing.',
  eyebrow: locale === 'ar' ? 'حساب العميل' : 'Customer account',
  hero: 20,
  details: locale === 'ar' ? ['تسجيل دخول آمن', 'إنشاء حساب جديد', 'إدارة بيانات الحساب'] : ['Secure sign-in', 'New account registration', 'Account profile management'],
  links: [[T[locale].ui.actions.contactWorkshop, '/contact']]
}));

for (const slug of Object.keys(T.en.legal)) {
  add(`/legal/${slug}`, locale => {
    const page = T[locale].legal[slug];
    return { title: page.title, h1: page.heading, description: page.description, eyebrow: locale === 'ar' ? 'معلومات الخدمة' : 'Service Information', hero: 15, details: page.sections.map(([heading]) => heading), links: [[T[locale].ui.actions.contactWorkshop, '/contact']] };
  });
}

function structuredData(locale, route, page) {
  const graph = [{
    '@type': 'WebPage', '@id': `${canonical(locale, route)}#webpage`, url: canonical(locale, route), name: page.title,
    description: page.description, inLanguage: T[locale].locale, isPartOf: { '@id': `${siteUrl}#website` },
    about: { '@id': `${siteUrl}#business` }, primaryImageOfPage: { '@type': 'ImageObject', url: page.primaryImage || mediaUrl(page.hero) }
  }];
  const breadcrumb = breadcrumbJson(locale, route, page.title);
  if (breadcrumb) graph.push(breadcrumb);
  if (page.schema?.length) graph.push(...page.schema);
  if (route !== '/') graph.push(localBusinessJson(locale));
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

function render(locale, route, page) {
  const segmentDepth = route === '/' ? 0 : route.split('/').filter(Boolean).length;
  const base = '../'.repeat(segmentDepth + 1);
  const canonicalUrl = canonical(locale, route);
  const replacements = {
    LANG: T[locale].lang,
    DIR: T[locale].dir,
    LOCALE: locale,
    BASE: base,
    ASSET_VERSION: assetVersion,
    ROUTE: route,
    TITLE: page.title,
    DESCRIPTION: trimDescription(page.description),
    CANONICAL: canonicalUrl,
    HREFLANG_EN: canonical('en', route),
    HREFLANG_AR: canonical('ar', route),
    HREFLANG_DEFAULT: defaultCanonical(route),
    OG_LOCALE: locale === 'ar' ? 'ar_KW' : 'en_KW',
    OG_ALT_LOCALE: locale === 'ar' ? 'en_KW' : 'ar_KW',
    OG_TYPE: page.ogType || 'website',
    OG_IMAGE: new URL('assets/media/og/projx-racing-og.jpg', siteUrl).href,
    OG_ALT: locale === 'ar' ? `${page.h1} — Projx Racing الكويت` : `${page.h1} — Projx Racing Kuwait`,
    HERO_IMAGE: media(page.hero || 35).full,
    STRUCTURED_DATA: structuredData(locale, route, page),
    FALLBACK_CONTENT: fallback(locale, page),
    SKIP_TEXT: T[locale].ui.skipToContent,
    NOSCRIPT_TEXT: locale === 'ar' ? 'يجب تفعيل JavaScript لاستخدام النماذج والقوائم التفاعلية.' : 'JavaScript is required for the enquiry forms and interactive navigation.',
    NOSCRIPT_CALL: locale === 'ar' ? `اتصل على ${CONFIG.phoneDisplay}` : `Call ${CONFIG.phoneDisplay}`,
    NOSCRIPT_WHATSAPP: locale === 'ar' ? 'افتح WhatsApp' : 'Open WhatsApp'
  };
  return Object.entries(replacements).reduce((html, [key, value]) => html.replaceAll(`{{${key}}}`, String(value)), template);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(path.join(repo, 'assets'), path.join(dist, 'assets'), { recursive: true });
const clerkPublishableKey = String(process.env.CLERK_PUBLISHABLE_KEY || '').trim();
if (clerkPublishableKey && !/^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(clerkPublishableKey)) throw new Error('CLERK_PUBLISHABLE_KEY has an invalid format.');
const builtConfigPath = path.join(dist, 'assets', 'site-config.js');
const builtConfig = fs.readFileSync(builtConfigPath, 'utf8').replace('__CLERK_PUBLISHABLE_KEY__', clerkPublishableKey);
fs.writeFileSync(builtConfigPath, builtConfig);
for (const file of ['manifest.webmanifest', 'sw.js']) fs.copyFileSync(path.join(repo, file), path.join(dist, file));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

const manifest = [];
for (const route of routes) {
  for (const locale of locales) {
    const page = { ...route.buildPage(locale) };
    page.description = trimDescription(page.description);
    page.hero ||= 35;
    const output = path.join(dist, locale, ...(route.route === '/' ? [] : route.route.slice(1).split('/')), 'index.html');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, render(locale, route.route, page));
    manifest.push({ locale, route: route.route, title: page.title, description: page.description, hero: page.hero, output: path.relative(dist, output).replaceAll(path.sep, '/') });
  }
}

const rootHtml = `<!doctype html><html lang="en" dir="ltr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><link rel="canonical" href="${canonical('en', '/')}"><link rel="alternate" hreflang="en-KW" href="${canonical('en', '/')}"><link rel="alternate" hreflang="ar-KW" href="${canonical('ar', '/')}"><link rel="alternate" hreflang="x-default" href="${canonical('en', '/')}"><meta name="description" content="Projx Racing motorsport workshop in Kuwait. Choose English or Arabic."><title>Projx Racing Kuwait</title><link rel="stylesheet" href="assets/styles.css?v=${assetVersion}"><script>try{const l=localStorage.getItem('projxLanguage');location.replace(l==='ar'?'./ar/':'./en/')}catch{location.replace('./en/')}</script></head><body><main class="language-entry"><img src="assets/brand/projx-racing-logo-header.png" width="354" height="146" alt="Projx Racing Motorsports"><h1>Projx Racing Kuwait</h1><p>Choose a language · اختر اللغة</p><div class="btn-row"><a class="btn" href="en/">English</a><a class="btn btn-outline" href="ar/" lang="ar" dir="rtl">العربية</a></div></main></body></html>`;
fs.writeFileSync(path.join(dist, 'index.html'), rootHtml);

const xhtml = 'http://www.w3.org/1999/xhtml';
const sitemapRows = routes.map(({ route }) => {
  const en = canonical('en', route);
  const ar = canonical('ar', route);
  const priority = route === '/' ? '1.0' : route.split('/').filter(Boolean).length === 1 ? '0.8' : '0.7';
  return [
    `  <url><loc>${esc(en)}</loc><xhtml:link rel="alternate" hreflang="en-KW" href="${esc(en)}"/><xhtml:link rel="alternate" hreflang="ar-KW" href="${esc(ar)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${esc(en)}"/><changefreq>${route === '/' ? 'weekly' : 'monthly'}</changefreq><priority>${priority}</priority></url>`,
    `  <url><loc>${esc(ar)}</loc><xhtml:link rel="alternate" hreflang="en-KW" href="${esc(en)}"/><xhtml:link rel="alternate" hreflang="ar-KW" href="${esc(ar)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${esc(en)}"/><changefreq>${route === '/' ? 'weekly' : 'monthly'}</changefreq><priority>${priority}</priority></url>`
  ].join('\n');
}).join('\n');
fs.writeFileSync(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="${xhtml}">\n${sitemapRows}\n</urlset>\n`);
fs.writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', siteUrl).href}\n`);

const notFound = `<!doctype html><html lang="en" dir="ltr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="description" content="The requested Projx Racing page could not be found. Choose English or Arabic to continue."><link rel="stylesheet" href="assets/styles.css?v=${assetVersion}"><title>Page Not Found | Projx Racing</title></head><body><main class="language-entry"><img src="assets/brand/projx-racing-logo-header.png" width="354" height="146" alt="Projx Racing Motorsports"><span class="eyebrow">404</span><h1>Page not found · الصفحة غير موجودة</h1><div class="btn-row"><a class="btn" href="en/">English</a><a class="btn btn-outline" href="ar/" lang="ar" dir="rtl">العربية</a></div></main></body></html>`;
fs.writeFileSync(path.join(dist, '404.html'), notFound);
fs.writeFileSync(path.join(dist, 'route-manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Built ${routes.length} routes in two languages (${manifest.length} localized pages).`);
