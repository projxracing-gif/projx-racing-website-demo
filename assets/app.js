(() => {
  "use strict";

  const DATA = window.PROJX_DATA;
  const CONFIG = window.PROJX_CONFIG;
  const TRANSLATIONS = window.PROJX_TRANSLATIONS || {};
  const main = document.getElementById("main-content");
  const header = document.getElementById("site-header");
  const footer = document.getElementById("site-footer");
  const drawer = document.getElementById("quote-drawer");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");
  const PREVIEW_MODE = Boolean(CONFIG.previewMode || document.body.dataset.preview === "true");
  const mediaById = new Map(DATA.media.map(item => [Number(item.id), item]));

  const memoryStore = Object.create(null);
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return memoryStore[key] ?? null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { memoryStore[key] = value; } },
    remove(key) { try { localStorage.removeItem(key); } catch { delete memoryStore[key]; } }
  };

  function safeParse(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }

  const state = {
    locale: document.body.dataset.locale === "ar" ? "ar" : "en",
    route: normalizeRoute(document.body.dataset.route || "/"),
    quote: safeParse(storage.get("projxQuote"), []),
    mobileOpen: false,
    lightbox: null,
    galleries: Object.create(null),
    formContext: null,
    mapLoaded: false
  };

  function parsePreviewLocation() {
    if (!PREVIEW_MODE) return;
    const raw = location.hash.replace(/^#\/?/, "");
    if (!raw) return;
    const [pathOnly] = raw.split("?");
    const segments = pathOnly.split("/").filter(Boolean);
    if (segments[0] === "ar" || segments[0] === "en") state.locale = segments.shift();
    state.route = normalizeRoute(`/${segments.join("/")}` || "/");
  }
  parsePreviewLocation();

  function i18n() { return TRANSLATIONS[state.locale] || TRANSLATIONS.en; }
  function U() { return i18n().ui; }
  function P() { return i18n().pages; }
  function esc(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }
  function cleanText(value = "", limit = 3000) {
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, limit);
  }
  function slugify(value = "") {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }
  function normalizeRoute(value = "/") {
    const path = String(value).split("?")[0].replace(/^#/, "");
    const clean = path.replace(/^\/+|\/+$/g, "");
    return clean ? `/${clean}` : "/";
  }
  function routeUrl(path = "/", locale = state.locale) {
    const route = normalizeRoute(path);
    const query = String(path).includes("?") ? `?${String(path).split("?").slice(1).join("?")}` : "";
    if (PREVIEW_MODE) return `#/${locale}${route === "/" ? "" : route}${query}`;
    return `${locale}/${route === "/" ? "" : `${route.slice(1)}/`}${query}`;
  }
  function navigate(path = "/", locale = state.locale) {
    storage.set("projxLanguage", locale);
    if (PREVIEW_MODE) {
      location.hash = routeUrl(path, locale);
      return;
    }
    location.assign(new URL(routeUrl(path, locale), document.baseURI).href);
  }
  function currentPath() { return state.route; }
  function alternateLocale() { return state.locale === "ar" ? "en" : "ar"; }
  function isRtl() { return state.locale === "ar"; }
  function year() { return new Date().getFullYear(); }
  function compactNumber(number) { return String(number).padStart(2, "0"); }
  function randomRef(prefix = "WEB") {
    return `PRX-${prefix}-${year()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }
  function telUrl() { return `tel:+${CONFIG.phoneE164}`; }
  function waUrl(message = CONFIG.defaultWhatsAppMessage) {
    return `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(message)}`;
  }
  function openExternal(url) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) location.href = url;
  }
  function routeActive(path) {
    const route = normalizeRoute(path);
    return route === "/" ? currentPath() === "/" : currentPath() === route || currentPath().startsWith(`${route}/`);
  }
  function tech(value) { return `<bdi class="technical">${esc(value)}</bdi>`; }
  function mediaItem(id) {
    const base = mediaById.get(Number(id));
    if (!base) return null;
    const local = i18n().media?.[String(base.id)] || i18n().media?.[base.id] || {};
    return { ...base, ...local, category: local.category || i18n().mediaCategories?.[base.category] || base.category };
  }
  function localizedService(service) {
    return { ...service, ...(i18n().services?.[service.slug] || {}) };
  }
  function localizedProject(project) {
    return { ...project, ...(i18n().projects?.[project.slug] || {}) };
  }
  function localizedPart(part, index) {
    return { ...part, ...(i18n().parts?.[index] || {}) };
  }
  function localizedPlatform(platform) {
    return { ...platform, ...(i18n().tuning?.[platform.slug] || {}) };
  }
  function categoryLabel(value) { return i18n().brandCategories?.[value] || value; }
  function relationshipLabel(value) { return i18n().brandRelationships?.[value] || value; }
  function statusLabel(value) {
    const map = state.locale === "ar" ? {
      "Compatibility Check Required": "يتطلب فحص توافق",
      "Built to Order": "يصنع حسب الطلب",
      "Confirm Availability": "تأكيد التوفر",
      "Technical Review Required": "مراجعة فنية مطلوبة",
      "Fitment Check Required": "يتطلب فحص Fitment",
      "Dealer": "موزّع",
      "Reseller": "مورد / بائع",
      "Technical Platform": "منصة فنية",
      "Supported Platform": "منصة مدعومة",
      "Supported Brand": "علامة مدعومة",
      "Supported Supplier": "مورد مدعوم"
    } : {};
    return map[value] || value;
  }

  const icons = {
    arrow: '<svg class="directional-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 3.8 6.5 2.9a2 2 0 0 0-2.4.9l-1 2a3 3 0 0 0-.2 2.3c1.9 6.4 6.6 11.1 13 13a3 3 0 0 0 2.3-.2l2-1a2 2 0 0 0 .9-2.4l-.9-2.2a2 2 0 0 0-2.3-1.2l-2.5.6a2 2 0 0 1-1.9-.5l-3.7-3.7a2 2 0 0 1-.5-1.9l.6-2.5a2 2 0 0 0-1.2-2.3Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.7a8.5 8.5 0 1 1 16.2-4.1Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.1 7.2c.3-.4.6-.4 1-.3l1.1.4c.3.1.5.4.5.7 0 .5-.3 1-.6 1.4-.2.2-.1.5 0 .7.8 1.4 2 2.5 3.5 3.2.3.1.6.1.8-.1.3-.4.7-1 1-1.2.2-.2.5-.2.8-.1l1.5.7c.3.1.5.4.4.8-.2 1.2-1 2.2-2.1 2.5-1.1.3-2.7-.1-4.7-1.2-2.1-1.2-3.8-3-4.7-5.2-.5-1.2-.2-2 .5-2.3Z" fill="currentColor"/></svg>',
    quote: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-12A7 7 0 1 0 5 9c0 6.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15.7 15.7 4.3 4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  const primaryNav = [
    ["services", "/services"], ["tuning", "/tuning"], ["engineBuilding", "/engine-building"],
    ["projects", "/projects"], ["parts", "/parts"], ["brands", "/brands"],
    ["about", "/about"], ["contact", "/contact"]
  ];

  function serviceHref(slug) {
    if (slug === "online-tuning") return "/tuning";
    if (slug === "engine-building") return "/engine-building";
    return `/services/${slug}`;
  }

  function saveQuote() {
    storage.set("projxQuote", JSON.stringify(state.quote));
    renderHeader();
    renderFloatingActions();
  }

  function mediaImage(id, {
    loading = "lazy",
    className = "",
    alt = "",
    sizes = "(max-width: 680px) 100vw, 50vw",
    fetchpriority = "auto"
  } = {}) {
    const media = mediaItem(id);
    if (!media) return "";
    // Use the original WebP for every placement. The former 256 px square
    // sprite tiles became soft and were distorted inside 16:10 and 4:3 cards.
    // Real images retain their intrinsic ratio; the layout crops them safely
    // with object-fit while native lazy loading limits initial bandwidth.
    return `<img class="${esc(className)}" src="${esc(media.full)}" alt="${esc(alt || media.alt)}" loading="${loading}" decoding="async" fetchpriority="${fetchpriority}" sizes="${esc(sizes)}" width="${Number(media.width) || 1600}" height="${Number(media.height) || 1200}">`;
  }

  function button(label, href, { variant = "", external = false, icon = icons.arrow, attrs = "" } = {}) {
    return `<a class="btn ${esc(variant)}" href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""} ${attrs}>${esc(label)}${icon}</a>`;
  }

  function breadcrumbs(items = []) {
    const homeLabel = U().nav.home;
    return `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${routeUrl("/")}">${esc(homeLabel)}</a>${items.map(item => {
      const [label, href] = Array.isArray(item) ? item : [item, null];
      return `<span class="breadcrumb-separator" aria-hidden="true">›</span>${href ? `<a href="${routeUrl(href)}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`}`;
    }).join("")}</nav>`;
  }

  function pageHero({ eyebrow, title, text, media = 15, crumbs = [], actions = "", meta = "" }) {
    return `<section class="page-hero">
      <div class="page-hero-media">${mediaImage(media, { loading: "eager", fetchpriority: "high", className: "cover-img", sizes: "100vw" })}</div>
      <div class="page-hero-overlay"></div>
      <div class="container page-hero-content">
        ${breadcrumbs(crumbs)}
        <span class="eyebrow eyebrow-on-media">${esc(eyebrow)}</span>
        <h1>${esc(title)}</h1>
        <p>${esc(text)}</p>
        ${meta ? `<div class="page-hero-meta">${meta}</div>` : ""}
        ${actions ? `<div class="btn-row">${actions}</div>` : ""}
      </div>
    </section>`;
  }

  function sectionHead(eyebrow, title, text = "", action = "") {
    return `<div class="section-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div>${text || action ? `<div class="section-head-side">${text ? `<p>${esc(text)}</p>` : ""}${action}</div>` : ""}</div>`;
  }

  function featureList(items = []) {
    return `<ul class="feature-list">${items.map(item => `<li>${icons.check}<span>${esc(item)}</span></li>`).join("")}</ul>`;
  }

  function numberSteps(items = []) {
    return `<div class="process-grid">${items.map((item, index) => {
      const [title, text] = Array.isArray(item) ? item : [item, ""];
      return `<article class="process-step"><span>${compactNumber(index + 1)}</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}</article>`;
    }).join("")}</div>`;
  }

  function accordion(items = [], prefix = "faq") {
    return `<div class="accordion">${items.map(([question, answer], index) => {
      const id = `${prefix}-${slugify(question)}-${index}`;
      return `<article class="accordion-item"><h3><button type="button" data-action="toggle-accordion" aria-expanded="${index === 0}" aria-controls="${id}"><span>${esc(question)}</span><strong aria-hidden="true">${index === 0 ? "−" : "+"}</strong></button></h3><div class="accordion-panel" id="${id}" ${index === 0 ? "" : "hidden"}><p>${esc(answer)}</p></div></article>`;
    }).join("")}</div>`;
  }

  function statusBadge(status = "") {
    const lower = status.toLowerCase();
    const className = lower.includes("dealer") || lower.includes("موز") ? "status-green" : lower.includes("review") || lower.includes("confirm") || lower.includes("required") || lower.includes("مراجعة") || lower.includes("تأكيد") || lower.includes("يتطلب") ? "status-amber" : lower.includes("supported") || lower.includes("platform") || lower.includes("مدعوم") || lower.includes("منصة") ? "status-blue" : "";
    return `<span class="status-badge ${className}">${esc(statusLabel(status))}</span>`;
  }

  function tags(items = []) {
    return `<div class="tags">${items.map(item => `<span>${esc(item)}</span>`).join("")}</div>`;
  }

  function ctaBlock(title, text, primaryLabel = U().actions.requestQuote, type = "General Quote") {
    return `<section class="section section-cta"><div class="container"><div class="cta-block"><div><span class="eyebrow eyebrow-on-red">Projx Racing Kuwait</span><h2>${esc(title)}</h2><p>${esc(text)}</p></div><div class="cta-actions"><button class="btn btn-light" type="button" data-action="open-form" data-form-type="${esc(type)}">${esc(primaryLabel)}${icons.arrow}</button><a class="btn btn-outline-light" href="${waUrl(state.locale === "ar" ? "هلا Projx Racing، حاب أستفسر عن مشروع سيارة." : "Hello Projx Racing, I would like to discuss a vehicle project.")}" target="_blank" rel="noopener">${esc(U().actions.whatsapp)}${icons.whatsapp}</a></div></div></div></section>`;
  }

  function gallery(ids, key, title = "Projx Racing media", { hero = false } = {}) {
    const clean = ids.map(Number).filter(id => mediaById.has(id));
    state.galleries[key] = clean;
    if (!clean.length) return "";
    const first = mediaItem(clean[0]);
    return `<div class="media-gallery ${hero ? "media-gallery-hero" : ""}" data-gallery-component="${esc(key)}">
      <button class="gallery-main-photo" type="button" data-action="open-media" data-media-id="${first.id}" data-gallery-key="${esc(key)}" aria-label="${esc(`${U().accessibility.openImage}: ${first.title}`)}">
        ${mediaImage(first.id, { loading: hero ? "eager" : "lazy", fetchpriority: hero ? "high" : "auto", className: "gallery-active-image", sizes: "(max-width: 980px) 100vw, 65vw" })}
        <span class="media-shade"></span><span class="media-expand">${icons.expand}<span>${esc(U().common.verifiedMedia)}</span></span>
        <span class="gallery-photo-caption"><strong>${esc(first.title)}</strong><span>${esc(first.caption)}</span></span>
      </button>
      ${clean.length > 1 ? `<div class="gallery-thumbs" role="list" aria-label="${esc(title)}">${clean.map((id, index) => {
        const item = mediaItem(id);
        return `<button class="gallery-thumb ${index === 0 ? "is-active" : ""}" type="button" data-action="gallery-select" data-gallery-key="${esc(key)}" data-media-id="${id}" aria-label="${esc(item.title)}">${mediaImage(id, { thumb: true, className: "gallery-thumb-img", alt: item.alt, sizes: "160px" })}</button>`;
      }).join("")}</div>` : ""}
    </div>`;
  }

  function mediaCard(id, key = "archive") {
    const item = mediaItem(id);
    if (!item) return "";
    const search = [item.title, item.caption, item.vehicle, item.make, item.category, ...(item.tags || [])].join(" ").toLowerCase();
    return `<article class="media-card filter-item" data-category="${esc(item.category)}" data-make="${esc(item.make)}" data-search="${esc(search)}"><button type="button" class="media-card-button" data-action="open-media" data-media-id="${item.id}" data-gallery-key="${esc(key)}" aria-label="${esc(`${U().accessibility.openImage}: ${item.title}`)}">${mediaImage(id, { thumb: true, className: "media-card-img", sizes: "(max-width:680px) 50vw, 25vw" })}<span class="media-card-overlay"><span>${esc(item.category)}</span><strong>${esc(item.title)}</strong></span></button></article>`;
  }

  function serviceCard(service, index = 0) {
    const local = localizedService(service);
    const media = local.media?.[0] || 15;
    return `<article class="service-card photo-card filter-item" data-search="${esc(`${local.title} ${local.summary} ${(local.features || []).join(" ")}`.toLowerCase())}"><a href="${routeUrl(serviceHref(local.slug))}" class="photo-card-media">${mediaImage(media, { thumb: true, className: "cover-img" })}<span class="photo-overlay"></span><span class="card-index">${compactNumber(index + 1)}</span><span class="card-kicker">${esc(local.kicker)}</span></a><div class="card-body"><h3><a href="${routeUrl(serviceHref(local.slug))}">${esc(local.title)}</a></h3><p>${esc(local.summary)}</p><div class="card-footer"><a class="text-link" href="${routeUrl(serviceHref(local.slug))}">${esc(U().actions.viewService)}${icons.arrow}</a><button class="icon-action" type="button" data-action="add-quote" data-kind="Service" data-title="${esc(local.title)}" data-details="${esc(local.summary)}" aria-label="${esc(`${U().actions.addToQuote}: ${local.title}`)}">${icons.quote}</button></div></div></article>`;
  }

  function projectCard(project, index = 0) {
    const local = localizedProject(project);
    const search = [local.title, local.vehicle, local.category, local.summary, ...(local.work || []), ...(local.tags || [])].join(" ").toLowerCase();
    return `<article class="project-card photo-card filter-item" data-category="${esc(local.category)}" data-make="${esc(local.make)}" data-search="${esc(search)}"><a href="${routeUrl(`/projects/${local.slug}`)}" class="photo-card-media project-card-media">${mediaImage(local.cover, { thumb: true, className: "cover-img" })}<span class="photo-overlay"></span><span class="card-index">${compactNumber(index + 1)}</span><span class="card-kicker">${esc(local.vehicle)}</span></a><div class="card-body"><span class="mini-label">${esc(local.category)}</span><h3><a href="${routeUrl(`/projects/${local.slug}`)}">${esc(local.title)}</a></h3><p>${esc(local.summary)}</p><div class="card-footer"><a class="text-link" href="${routeUrl(`/projects/${local.slug}`)}">${esc(U().actions.viewProject)}${icons.arrow}</a><button class="icon-action" type="button" data-action="add-quote" data-kind="Project Consultation" data-title="${esc(local.title)}" data-details="${esc(local.vehicle)}" aria-label="${esc(`${U().actions.addToQuote}: ${local.title}`)}">${icons.quote}</button></div></div></article>`;
  }

  function partCard(part, index) {
    const local = localizedPart(part, index);
    const search = [local.title, local.category, local.brand, local.vehicle, local.summary].join(" ").toLowerCase();
    return `<article class="part-card filter-item" data-category="${esc(local.category)}" data-search="${esc(search)}"><div class="part-media">${mediaImage(local.media, { thumb: true, className: "cover-img" })}<span>${statusBadge(local.status)}</span></div><div class="part-body"><span class="mini-label">${esc(local.category)}</span><h3>${esc(local.title)}</h3><p>${esc(local.summary)}</p><dl><div><dt>${esc(U().common.brand)}</dt><dd>${esc(local.brand)}</dd></div><div><dt>${esc(U().common.vehicle)}</dt><dd>${esc(local.vehicle)}</dd></div><div><dt>${esc(U().common.quotation)}</dt><dd>${esc(local.price)}</dd></div></dl><div class="card-footer"><button class="btn btn-sm" type="button" data-action="open-form" data-form-type="Parts Enquiry" data-context="${esc(local.title)}">${esc(U().actions.enquire)}${icons.arrow}</button><button class="icon-action" type="button" data-action="add-quote" data-kind="Parts Enquiry" data-title="${esc(local.title)}" data-details="${esc(`${local.brand} • ${local.vehicle}`)}" aria-label="${esc(`${U().actions.addToQuote}: ${local.title}`)}">${icons.quote}</button></div></div></article>`;
  }

  function brandCard(brand) {
    const category = categoryLabel(brand.category);
    const relationship = relationshipLabel(brand.relationship);
    const search = [brand.name, brand.category, category, brand.relationship, relationship].join(" ").toLowerCase();
    return `<article class="brand-card filter-item" data-category="${esc(category)}" data-search="${esc(search)}"><div class="brand-mark" aria-hidden="true">${esc(brand.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase())}</div><div><h3 dir="ltr">${esc(brand.name)}</h3><p>${esc(category)}</p>${statusBadge(relationship)}</div><button class="icon-action" type="button" data-action="open-form" data-form-type="Brand / Parts Enquiry" data-context="${esc(brand.name)}" aria-label="${esc(`${U().actions.enquire}: ${brand.name}`)}">${icons.arrow}</button></article>`;
  }

  function platformCard(platform) {
    const local = localizedPlatform(platform);
    return `<article class="platform-card"><div class="platform-card-media">${mediaImage(local.cover, { thumb: true, className: "cover-img" })}<span class="photo-overlay"></span><span>${esc(local.platform)}</span></div><div class="platform-card-body"><h3>${esc(local.short)}</h3><p>${esc(local.supportedScope)}</p>${statusBadge(local.relationship)}<ul>${(local.requirements || []).slice(0, 4).map(item => `<li>${esc(item)}</li>`).join("")}</ul><div class="card-footer"><a class="btn btn-sm" href="${routeUrl(`/tuning/${local.slug}`)}">${esc(U().actions.checkCompatibility)}${icons.arrow}</a><button class="icon-action" type="button" data-action="add-quote" data-kind="Online Tuning" data-title="${esc(local.short)}" data-details="${esc(local.supportedScope)}" aria-label="${esc(`${U().actions.addToQuote}: ${local.short}`)}">${icons.quote}</button></div></div></article>`;
  }

  function headerHtml() {
    const ui = U();
    const services = DATA.services.filter(item => !["online-tuning", "engine-building"].includes(item.slug)).slice(0, 6).map(service => localizedService(service));
    const tuning = Object.values(DATA.tuningPlatforms).map(localizedPlatform);
    const nav = primaryNav.map(([key, path]) => {
      const label = ui.nav[key];
      const active = routeActive(path);
      if (key === "services") {
        return `<details class="nav-dropdown"><summary class="nav-link ${active ? "is-active" : ""}">${esc(label)}<span aria-hidden="true">⌄</span></summary><div class="nav-dropdown-panel"><a href="${routeUrl("/services")}">${esc(ui.actions.viewAllServices)}</a>${services.map(service => `<a href="${routeUrl(serviceHref(service.slug))}">${esc(service.title)}</a>`).join("")}</div></details>`;
      }
      if (key === "tuning") {
        return `<details class="nav-dropdown"><summary class="nav-link ${active ? "is-active" : ""}">${esc(label)}<span aria-hidden="true">⌄</span></summary><div class="nav-dropdown-panel"><a href="${routeUrl("/tuning")}">${esc(label)}</a>${tuning.map(platform => `<a href="${routeUrl(`/tuning/${platform.slug}`)}">${esc(platform.short)}</a>`).join("")}</div></details>`;
      }
      return `<a class="nav-link ${active ? "is-active" : ""}" href="${routeUrl(path)}" ${active ? 'aria-current="page"' : ""}>${esc(label)}</a>`;
    }).join("");

    const mobileLinks = [
      [ui.nav.home, "/"], [ui.nav.services, "/services"],
      ...services.map(service => [service.title, serviceHref(service.slug), true]),
      [ui.nav.tuning, "/tuning"],
      ...tuning.map(platform => [platform.short, `/tuning/${platform.slug}`, true]),
      [ui.nav.engineBuilding, "/engine-building"], [ui.nav.projects, "/projects"],
      [ui.nav.parts, "/parts"], [ui.nav.brands, "/brands"], [ui.nav.gallery, "/gallery"],
      [ui.nav.about, "/about"], [ui.nav.reviews, "/reviews"], [ui.nav.faq, "/faq"], [ui.nav.contact, "/contact"]
    ].map(([label, path, child]) => `<a class="mobile-nav-link ${child ? "is-child" : ""} ${routeActive(path) ? "is-active" : ""}" href="${routeUrl(path)}" ${routeActive(path) ? 'aria-current="page"' : ""}>${esc(label)}</a>`).join("");

    const alternate = alternateLocale();
    const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    return `<div class="header-shell"><div class="container header-inner"><a class="brand-logo" href="${routeUrl("/")}" aria-label="Projx Racing"><span class="brand-logo-frame"><img src="${esc(CONFIG.logoHeader || "assets/brand/projx-racing-logo-header.png")}" alt="Projx Racing Motorsports" width="354" height="146"></span></a><nav class="desktop-nav" aria-label="${esc(ui.menu)}">${nav}</nav><div class="header-tools"><a class="tool-button language-button" href="${routeUrl(currentPath(), alternate)}" data-language="${alternate}" aria-label="${esc(ui.accessibility.languageButton)}">${icons.globe}<span>${esc(TRANSLATIONS[alternate]?.shortName || alternate.toUpperCase())}</span></a><button class="tool-button theme-button" type="button" data-action="toggle-theme" aria-label="${esc(ui.accessibility.themeButton)}">${theme === "dark" ? icons.sun : icons.moon}<span class="tool-label">${esc(theme === "dark" ? ui.lightTheme : ui.darkTheme)}</span></button><a class="header-contact" href="${waUrl(state.locale === "ar" ? "هلا Projx Racing، حاب أستفسر عن سيارتي." : "Hello Projx Racing, I would like to discuss my vehicle.")}" target="_blank" rel="noopener">${icons.whatsapp}<span>${esc(ui.actions.whatsapp)}</span></a><button class="menu-button" type="button" data-action="toggle-menu" aria-expanded="${state.mobileOpen}" aria-controls="mobile-navigation" aria-label="${esc(state.mobileOpen ? ui.closeMenu : ui.accessibility.openMenu)}">${state.mobileOpen ? icons.close : icons.menu}</button></div></div></div><div class="mobile-menu-backdrop ${state.mobileOpen ? "is-open" : ""}" data-action="close-menu" aria-hidden="true"></div><aside id="mobile-navigation" class="mobile-nav ${state.mobileOpen ? "is-open" : ""}" aria-hidden="${!state.mobileOpen}" ${state.mobileOpen ? "" : "inert"}><div class="mobile-nav-head"><strong>${esc(ui.menu)}</strong><button class="icon-btn" type="button" data-action="close-menu" aria-label="${esc(ui.closeMenu)}">${icons.close}</button></div><nav aria-label="${esc(ui.menu)}">${mobileLinks}</nav><div class="mobile-nav-settings"><a class="setting-row" href="${routeUrl(currentPath(), alternate)}" data-language="${alternate}">${icons.globe}<span>${esc(ui.language)}</span><strong>${esc(TRANSLATIONS[alternate]?.name || alternate)}</strong></a><button class="setting-row" type="button" data-action="toggle-theme">${theme === "dark" ? icons.sun : icons.moon}<span>${esc(ui.theme)}</span><strong>${esc(theme === "dark" ? ui.lightTheme : ui.darkTheme)}</strong></button></div><div class="mobile-nav-actions"><a class="btn" href="${waUrl(state.locale === "ar" ? "هلا Projx Racing، حاب أستفسر عن سيارتي." : "Hello Projx Racing, I would like to discuss my vehicle.")}" target="_blank" rel="noopener">${esc(ui.actions.whatsapp)}${icons.whatsapp}</a><button class="btn btn-outline" type="button" data-action="open-form" data-form-type="General Quote">${esc(ui.actions.requestQuote)}${icons.quote}</button></div></aside>`;
  }

  function footerHtml() {
    const ui = U();
    const services = DATA.services.slice(0, 7).map(localizedService);
    const yearText = new Date().getFullYear();
    return `<div class="footer-main"><div class="container footer-grid"><div class="footer-brand"><span class="brand-logo-frame footer-logo"><img src="${esc(CONFIG.logoHeader || "assets/brand/projx-racing-logo-header.png")}" alt="Projx Racing Motorsports" width="354" height="146"></span><p>${esc(P().about.intro)}</p><div class="footer-social"><a href="${CONFIG.instagramUrl}" target="_blank" rel="noopener" aria-label="Instagram">${icons.instagram}</a><a href="${waUrl()}" target="_blank" rel="noopener" aria-label="WhatsApp">${icons.whatsapp}</a><a href="${CONFIG.mapsUrl}" target="_blank" rel="noopener" aria-label="${esc(ui.actions.directions)}">${icons.map}</a></div></div><div><h2>${esc(ui.nav.services)}</h2>${services.map(service => `<a href="${routeUrl(serviceHref(service.slug))}">${esc(service.title)}</a>`).join("")}</div><div><h2>${esc(ui.nav.tuning)}</h2>${Object.values(DATA.tuningPlatforms).map(localizedPlatform).map(platform => `<a href="${routeUrl(`/tuning/${platform.slug}`)}">${esc(platform.short)}</a>`).join("")}<a href="${routeUrl("/engine-building")}">${esc(ui.nav.engineBuilding)}</a><a href="${routeUrl("/parts")}">${esc(ui.nav.parts)}</a><a href="${routeUrl("/brands")}">${esc(ui.nav.brands)}</a></div><div><h2>${esc(ui.nav.contact)}</h2><p>${esc(CONFIG.addressLine1)}<br>${esc(CONFIG.addressLine2)}<br>${esc(CONFIG.cityCountry)}</p><a href="${telUrl()}"><bdi>${esc(CONFIG.phoneDisplay)}</bdi></a><a href="${waUrl()}" target="_blank" rel="noopener">WhatsApp</a><a href="${CONFIG.mapsUrl}" target="_blank" rel="noopener">${esc(ui.actions.directions)}</a><a href="${CONFIG.instagramUrl}" target="_blank" rel="noopener">Instagram</a></div></div></div><div class="footer-bottom"><div class="container"><p>© ${yearText} Projx Racing Co. ${state.locale === "ar" ? "جميع الحقوق محفوظة." : "All rights reserved."}</p><nav><a href="${routeUrl("/legal/privacy")}">${state.locale === "ar" ? "الخصوصية" : "Privacy"}</a><a href="${routeUrl("/legal/terms")}">${state.locale === "ar" ? "معلومات الورشة" : "Workshop Information"}</a><a href="${routeUrl("/legal/tuning")}">${state.locale === "ar" ? "شروط البرمجة" : "Tuning Information"}</a><a href="${routeUrl("/legal/engine")}">${state.locale === "ar" ? "شروط المحركات" : "Engine Information"}</a></nav></div></div>`;
  }

  function renderHeader() {
    header.innerHTML = headerHtml();
    document.body.classList.toggle("menu-open", state.mobileOpen);
  }
  function renderFooter() {
    footer.innerHTML = footerHtml();
    renderFloatingActions();
  }

  function renderFloatingActions() {
    document.querySelectorAll(".floating-actions,.mobile-action-bar").forEach(node => node.remove());
    const ui = U();
    const desktop = document.createElement("div");
    desktop.className = "floating-actions";
    desktop.innerHTML = `<a class="floating-btn whatsapp" href="${waUrl()}" target="_blank" rel="noopener" aria-label="WhatsApp">${icons.whatsapp}</a><button class="floating-btn" type="button" data-action="open-quote" aria-label="${esc(ui.actions.openQuote)}">${icons.quote}${state.quote.length ? `<span class="floating-count">${state.quote.length}</span>` : ""}</button>`;
    document.body.append(desktop);
    const mobile = document.createElement("nav");
    mobile.className = "mobile-action-bar";
    mobile.setAttribute("aria-label", ui.nav.contact);
    mobile.innerHTML = `<a href="${telUrl()}">${icons.phone}<span>${esc(state.locale === "ar" ? "اتصال" : "Call")}</span></a><a class="wa" href="${waUrl()}" target="_blank" rel="noopener">${icons.whatsapp}<span>WhatsApp</span></a><button type="button" data-action="open-quote">${icons.quote}<span>${esc(state.locale === "ar" ? "سعر" : "Quote")}${state.quote.length ? ` (${state.quote.length})` : ""}</span></button>`;
    document.body.append(mobile);
  }

  function trustBar() {
    const ui = U();
    return `<section class="trust-bar"><div class="container trust-grid"><div><span>${esc(ui.common.location)}</span><strong>${esc(CONFIG.locationShort)}</strong><small>${esc(CONFIG.addressLine1)}</small></div><div><span>${esc(ui.common.dyno)}</span><strong>Mainline</strong><small>${state.locale === "ar" ? "برمجة وقياس مضبوط" : "Controlled calibration and testing"}</small></div><div><span>${esc(ui.common.onlineTuning)}</span><strong>MHD • COBB • HP Tuners</strong><small>S55 • B58 • S58 • Porsche • GM LS/LT</small></div><div><span>${esc(ui.common.engineBuilding)}</span><strong>GM LS • LT</strong><small>${state.locale === "ar" ? "فحص وقياس وتجميع داخل الورشة" : "In-house inspection, measurement and assembly"}</small></div><div><span>${esc(ui.common.officialContact)}</span><strong><bdi>${esc(CONFIG.phoneDisplay)}</bdi></strong><small>${state.locale === "ar" ? "اتصال أو WhatsApp" : "Call or WhatsApp"}</small></div></div></section>`;
  }

  function homePage() {
    const page = P().home;
    const featuredServices = DATA.services.filter(item => !["online-tuning", "engine-building"].includes(item.slug)).slice(0, 8);
    const featuredProjects = ["honda-s2000-kmt", "supra-b58-time-attack", "gr-yaris-kmt-cup", "k20-brz-road-race"].map(slug => DATA.projects.find(item => item.slug === slug)).filter(Boolean);
    const featuredBrands = ["MHD Tuning", "COBB Tuning", "HP Tuners", "MoTeC", "Link ECU", "Haltech", "MaxxECU", "KW Suspension", "Nitron Suspension", "Essex Brakes / AP Racing", "CSF Cooling", "Tegiwa Motorsports"].map(name => DATA.brands.find(item => item.name === name)).filter(Boolean);
    const heroActions = `<a class="btn" href="${routeUrl("/services")}">${esc(U().actions.exploreServices)}${icons.arrow}</a><a class="btn btn-outline-light" href="${routeUrl("/projects")}">${esc(U().actions.viewProjects)}${icons.arrow}</a><button class="btn btn-ghost-light" type="button" data-action="open-form" data-form-type="General Quote">${esc(U().actions.requestQuote)}${icons.quote}</button>`;
    return `<section class="home-hero"><div class="home-hero-media">${mediaImage(35, { loading: "eager", fetchpriority: "high", className: "cover-img", sizes: "100vw" })}</div><div class="home-hero-overlay"></div><div class="container home-hero-grid"><div class="home-hero-copy"><span class="eyebrow eyebrow-on-media">${esc(page.eyebrow)}</span><h1>${esc(page.heading)}</h1><p>${esc(page.intro)}</p><div class="btn-row">${heroActions}</div><div class="hero-links"><a href="${routeUrl("/tuning")}">${esc(U().nav.tuning)}${icons.arrow}</a><a href="${routeUrl("/engine-building")}">${esc(U().nav.engineBuilding)}${icons.arrow}</a><a href="${routeUrl("/gallery")}">${esc(U().nav.gallery)}${icons.arrow}</a></div></div><aside class="hero-side-panel"><div><span>Mainline</span><strong>Chassis Dyno</strong><small>${state.locale === "ar" ? "برمجة، Logging واختبار تحت السيطرة" : "Calibration, logging and controlled testing"}</small></div><div><span>${esc(U().common.engineBuilding)}</span><strong>GM LS / LT</strong><small>${state.locale === "ar" ? "Complete Engines وLong Blocks وإعادة بناء" : "Complete engines, long blocks, rebuilds and upgrades"}</small></div><div><span>Motorsport Electronics</span><strong>ECU • PDM • CAN</strong><small>${state.locale === "ar" ? "Wiring وحساسات وData Systems" : "Wiring, sensors and data systems"}</small></div></aside></div></section>${trustBar()}<section class="section"><div class="container">${sectionHead(page.serviceEyebrow, page.serviceHeading, page.serviceText, `<a class="text-link" href="${routeUrl("/services")}">${esc(U().actions.viewAllServices)}${icons.arrow}</a>`)}<div class="card-grid">${featuredServices.map(serviceCard).join("")}</div><div class="section-inline-actions"><a class="btn btn-outline" href="${routeUrl("/tuning")}">${esc(U().nav.tuning)}${icons.arrow}</a><a class="btn btn-outline" href="${routeUrl("/engine-building")}">${esc(U().nav.engineBuilding)}${icons.arrow}</a></div></div></section><section class="section section-tone"><div class="container">${sectionHead(page.whyEyebrow, page.whyHeading, page.whyText)}<div class="value-grid">${page.whyCards.map(([title, text], index) => `<article><span>${compactNumber(index + 1)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join("")}</div></div></section><section class="section"><div class="container">${sectionHead(page.projectsEyebrow, page.projectsHeading, page.projectsText, `<a class="text-link" href="${routeUrl("/projects")}">${esc(U().actions.viewAllProjects)}${icons.arrow}</a>`)}<div class="project-grid">${featuredProjects.map(projectCard).join("")}</div></div></section><section class="section section-dark-media"><div class="container feature-layout"><div class="feature-copy"><span class="eyebrow eyebrow-on-media">${esc(page.capabilitiesEyebrow)}</span><h2>${esc(page.capabilitiesHeading)}</h2><p>${esc(page.capabilitiesText)}</p><div class="feature-stat-grid"><div><strong>Mainline</strong><span>${state.locale === "ar" ? "Dyno Tuning" : "Dyno calibration"}</span></div><div><strong>LS / LT</strong><span>${state.locale === "ar" ? "بناء محركات" : "Engine building"}</span></div><div><strong>ECU / PDM</strong><span>Motorsport Wiring</span></div><div><strong>KMT</strong><span>${state.locale === "ar" ? "دعم وتطوير حلبة" : "Track support"}</span></div></div><a class="btn btn-light" href="${routeUrl("/gallery")}">${esc(U().actions.viewGallery)}${icons.arrow}</a></div><div class="feature-media-grid"><button type="button" data-action="open-media" data-media-id="20" data-gallery-key="home-capability">${mediaImage(20, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="19" data-gallery-key="home-capability">${mediaImage(19, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="24" data-gallery-key="home-capability">${mediaImage(24, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="23" data-gallery-key="home-capability">${mediaImage(23, { thumb: true, className: "cover-img" })}</button></div></div></section><section class="section"><div class="container">${sectionHead(page.brandsEyebrow, page.brandsHeading, page.brandsText, `<a class="text-link" href="${routeUrl("/brands")}">${esc(U().actions.viewBrands)}${icons.arrow}</a>`)}<div class="brand-strip">${featuredBrands.map(brand => `<div><strong dir="ltr">${esc(brand.name)}</strong><span>${esc(categoryLabel(brand.category))}</span></div>`).join("")}</div></div></section><section class="section section-tone"><div class="container reviews-feature"><div>${mediaImage(15, { thumb: true, className: "cover-img" })}</div><div><span class="eyebrow">${esc(page.reviewsEyebrow)}</span><h2>${esc(page.reviewsHeading)}</h2><p>${esc(page.reviewsText)}</p><div class="btn-row"><a class="btn" href="${CONFIG.googleBusinessUrl}" target="_blank" rel="noopener">${esc(U().actions.openGoogleReviews)}${icons.arrow}</a><a class="btn btn-outline" href="${routeUrl("/reviews")}">${esc(U().actions.learnMore)}${icons.arrow}</a></div></div></div></section>${ctaBlock(page.contactHeading, page.contactText, U().actions.contactWorkshop, "Workshop Consultation")}`;
  }

  function servicesPage() {
    const page = P().services;
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 15, crumbs: [[U().nav.services]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Workshop Consultation">${esc(U().actions.contactWorkshop)}${icons.arrow}</button>` })}<section class="section"><div class="container"><div class="filter-bar"><label class="search-control">${icons.search}<input type="search" data-filter-search="services" placeholder="${esc(U().filters.searchServices)}" aria-label="${esc(U().filters.searchServices)}"></label></div><div class="card-grid" data-filter-grid="services">${DATA.services.map(serviceCard).join("")}</div><div class="empty-state" data-filter-empty="services" hidden>${esc(U().common.noResults)}</div></div></section><section class="section section-tone"><div class="container narrow">${sectionHead(U().common.whatToProvide, page.processHeading, page.processText)}${featureList(state.locale === "ar" ? ["السنة والشركة والموديل", "كود المحرك والقير", "التعديلات الحالية", "الوقود المستخدم", "الأعراض أو الأعطال", "استخدام السيارة والهدف", "الوقت المطلوب"] : ["Year, make and model", "Engine code and transmission", "Current modifications", "Fuel used", "Symptoms or known faults", "Vehicle use and objective", "Required timing"])}</div></section>${ctaBlock(state.locale === "ar" ? "مو متأكد أي خدمة تحتاج؟" : "Not sure which service is correct?", state.locale === "ar" ? "أرسل تفاصيل السيارة والمشكلة أو الهدف، والورشة تحدد المسار المناسب قبل اعتماد العمل." : "Send the vehicle details and the problem or objective. The workshop will confirm the correct route before work is approved.", U().actions.requestQuote, "General Enquiry")}`;
  }

  const relatedProjectMap = {
    "ecu-dyno-tuning": ["corvette-c6-dyno", "supra-b58-time-attack", "bmw-e92-development"],
    "online-tuning": ["supra-b58-time-attack", "corvette-c6-dyno", "porsche-track-preparation"],
    "engine-building": ["ls-lt-engine-building", "foxbody-mustang-race-build", "nissan-350z-drift"],
    "motorsport-wiring": ["k20-brz-road-race", "foxbody-mustang-race-build", "nissan-350z-drift"],
    "fabrication": ["offroad-competition-chassis", "k20-brz-road-race", "corvette-c6-dyno"],
    "race-car-preparation": ["honda-s2000-kmt", "gr-yaris-kmt-cup", "k20-brz-road-race"],
    "suspension-setup": ["honda-s2000-kmt", "supra-b58-time-attack", "bmw-e92-development"],
    "alignment-corner-balance": ["supra-b58-time-attack", "gr-yaris-kmt-cup", "honda-s2000-kmt"],
    "brake-systems": ["gr-yaris-kmt-cup", "honda-s2000-kmt", "bmw-e92-development"],
    "performance-parts": ["k20-brz-road-race", "bmw-e92-development", "honda-s2000-kmt"],
    "complete-vehicle-builds": ["foxbody-mustang-race-build", "k20-brz-road-race", "offroad-competition-chassis"],
    "track-support": ["gr-yaris-kmt-cup", "honda-s2000-kmt", "porsche-track-preparation"],
    "diagnostics-troubleshooting": ["corvette-c6-dyno", "cadillac-cts-v-service", "bmw-e92-development"]
  };

  function serviceDetailPage(slug) {
    const base = DATA.services.find(item => item.slug === slug);
    if (!base) return notFoundPage();
    if (slug === "online-tuning") return tuningLandingPage();
    if (slug === "engine-building") return engineBuildingPage();
    const service = localizedService(base);
    const related = (relatedProjectMap[slug] || []).map(projectSlug => DATA.projects.find(item => item.slug === projectSlug)).filter(Boolean);
    return `${pageHero({ eyebrow: service.kicker, title: service.title, text: service.summary, media: service.media?.[0] || 15, crumbs: [[U().nav.services, "/services"], [service.title]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="${esc(service.title)} Enquiry" data-context="${esc(service.title)}">${esc(U().actions.requestQuote)}${icons.arrow}</button><a class="btn btn-outline-light" href="${waUrl(`${state.locale === "ar" ? "هلا Projx Racing، حاب أستفسر عن خدمة" : "Hello Projx Racing, I would like to enquire about"} ${service.title}.`)}" target="_blank" rel="noopener">${esc(U().actions.whatsapp)}${icons.whatsapp}</a>` })}<section class="section"><div class="container service-intro-grid"><div><span class="eyebrow">${esc(U().common.whatWeDo)}</span><h2>${esc(service.title)}</h2><p class="lead">${esc(service.intro)}</p>${featureList(service.features || [])}</div><aside class="content-panel"><span class="mini-label">${esc(U().common.supportedSystems)}</span>${tags(service.platforms || [])}<div class="divider"></div><p>${esc(service.cta)}</p><button class="btn btn-block" type="button" data-action="open-form" data-form-type="${esc(service.title)} Enquiry" data-context="${esc(service.title)}">${esc(U().actions.contactWorkshop)}${icons.arrow}</button></aside></div></section><section class="section section-tone"><div class="container">${sectionHead(U().common.howItWorks, state.locale === "ar" ? "خطوات واضحة من الفحص إلى التسليم." : "A clear process from inspection to handover.")}${numberSteps((service.process || []).map(item => [item, ""]))}</div></section><section class="section"><div class="container detail-two-column"><div>${gallery(service.media || [], `service-${slug}`, service.title)}</div><div class="content-panel"><span class="eyebrow">${esc(U().common.whatYouReceive)}</span><h2>${state.locale === "ar" ? "نطاق وتسليم موثق." : "Defined scope and documented handover."}</h2>${featureList(service.deliverables || [])}</div></div></section><section class="section section-tone"><div class="container">${sectionHead(U().common.relatedProjects, state.locale === "ar" ? "شغل مرتبط بالخدمة من داخل الورشة." : "Related work from the Projx Racing workshop.")}<div class="project-grid">${related.map(projectCard).join("")}</div></div></section>${ctaBlock(state.locale === "ar" ? `ناقش خدمة ${service.title}.` : `Discuss ${service.title}.`, service.cta, U().actions.requestQuote, `${service.title} Enquiry`)}`;
  }

  function tuningLandingPage() {
    const page = P().tuning;
    const platforms = Object.values(DATA.tuningPlatforms).map(localizedPlatform);
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 36, crumbs: [[U().nav.tuning]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Online Tuning Compatibility Review">${esc(U().actions.startTuning)}${icons.arrow}</button>` })}<section class="section"><div class="container">${sectionHead(U().common.platform, page.platformsHeading, page.platformsText)}<div class="platform-grid">${platforms.map(platformCard).join("")}</div></div></section><section class="section section-tone"><div class="container">${sectionHead(U().common.howItWorks, page.processHeading)}${numberSteps(page.process)}</div></section><section class="section"><div class="container safety-panel"><div>${mediaImage(7, { thumb: true, className: "cover-img" })}</div><div><span class="eyebrow">${esc(state.locale === "ar" ? "السلامة والتوافق" : "Safety & Compatibility")}</span><h2>${esc(page.safetyHeading)}</h2><p>${esc(page.safetyText)}</p>${featureList(state.locale === "ar" ? ["تأكيد الوقود المتوفر", "فحص الأعطال قبل البدء", "التأكد من نظام الوقود والتبريد", "الالتزام بتعليمات الـ Logging", "استخدام Dyno أو حلبة مناسبة عند الحاجة"] : ["Confirm the available fuel", "Resolve faults before development", "Verify fuel and cooling systems", "Follow the supplied logging instructions", "Use a dyno or suitable closed course when required"])}</div></div></section><section class="section section-tone"><div class="container narrow">${sectionHead(U().nav.faq, state.locale === "ar" ? "أسئلة مهمة قبل البرمجة." : "Important questions before tuning.")}${accordion(i18n().faq.tuning, "tuning-faq")}</div></section>${ctaBlock(state.locale === "ar" ? "ابدأ بتأكيد التوافق." : "Start with compatibility confirmation.", state.locale === "ar" ? "أرسل السيارة والـ ECU والهاردوير والوقود والتعديلات والأعطال الحالية قبل شراء أي خدمة أو جهاز." : "Submit the vehicle, controller, hardware, fuel, modifications and current faults before purchasing a service or device.", U().actions.checkCompatibility, "Online Tuning Compatibility Review")}`;
  }

  function optionList(items = [], selected = "") {
    return items.map(item => `<option value="${esc(item)}" ${item === selected ? "selected" : ""}>${esc(item)}</option>`).join("");
  }

  function tuningForm(platform) {
    const ui = U();
    const engines = platform.engines || [];
    const firstEngine = engines[0] || "";
    const models = platform.models?.[firstEngine] || [];
    return `<form class="enquiry-form embedded-form" data-enquiry-form data-form-type="${esc(platform.formType)}" data-platform-form="${esc(platform.slug)}" novalidate><input type="text" name="website" class="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="startedAt" value="${Date.now()}"><div class="form-grid"><div class="form-group"><label class="required" for="tune-name">${esc(ui.forms.name)}</label><input id="tune-name" class="input" name="name" required autocomplete="name" placeholder="${esc(ui.forms.placeholders.name)}"></div><div class="form-group"><label class="required" for="tune-phone">${esc(ui.forms.phone)}</label><input id="tune-phone" class="input ltr-input" name="phone" required inputmode="tel" autocomplete="tel" placeholder="${esc(ui.forms.placeholders.phone)}"></div><div class="form-group"><label for="tune-email">${esc(ui.forms.email)} <small>${esc(ui.forms.optional)}</small></label><input id="tune-email" class="input ltr-input" name="email" type="email" autocomplete="email" placeholder="${esc(ui.forms.placeholders.email)}"></div><div class="form-group"><label for="tune-country">${esc(ui.forms.country)}</label><input id="tune-country" class="input" name="country" autocomplete="country-name" placeholder="${esc(ui.forms.placeholders.country)}"></div><div class="form-group"><label class="required" for="tune-engine">${esc(ui.forms.engine)}</label><select id="tune-engine" class="select" name="engine" required data-role="platform-engine">${optionList(engines)}</select></div><div class="form-group"><label class="required" for="tune-model">${esc(ui.forms.vehicleModel)}</label><select id="tune-model" class="select" name="model" required data-role="platform-model">${optionList(models)}</select></div><div class="form-group"><label class="required" for="tune-year">${esc(ui.forms.vehicleYear)}</label><input id="tune-year" class="input ltr-input" name="year" required inputmode="numeric" pattern="[0-9]{4}" placeholder="${esc(ui.forms.placeholders.year)}"></div><div class="form-group"><label for="tune-transmission">${esc(ui.forms.transmission)}</label><input id="tune-transmission" class="input" name="transmission" placeholder="${esc(ui.forms.placeholders.transmission)}"></div><div class="form-group"><label class="required" for="tune-type">${esc(ui.forms.service)}</label><select id="tune-type" class="select" name="tuneType" required>${optionList(platform.tuneTypes || [])}</select></div><div class="form-group"><label class="required" for="tune-fuel">${esc(ui.forms.fuel)}</label><select id="tune-fuel" class="select" name="fuel" required>${optionList(platform.fuels || [])}</select></div><div class="form-group full"><label for="tune-device">${esc(ui.forms.device)}</label><input id="tune-device" class="input" name="device" placeholder="${esc(platform.slug === "mhd" ? "MHD licence, adapter and app status" : platform.slug === "cobb" ? "Accessport part number, serial and married status" : "MPVI / RTD, credits and licence status")}"></div><div class="form-group full"><label for="tune-unlock">${esc(ui.forms.unlock)}</label><input id="tune-unlock" class="input" name="unlock" placeholder="${esc(state.locale === "ar" ? "غير مفحوص، Unlocked، Bench، FEMTO، Controller Service..." : "Not checked, unlocked, bench, FEMTO, controller service...")}"></div><div class="form-group full"><label class="required" for="tune-mods">${esc(ui.forms.modifications)}</label><textarea id="tune-mods" class="textarea" name="modifications" required placeholder="${esc(ui.forms.placeholders.modifications)}"></textarea></div><div class="form-group full"><label for="tune-faults">${esc(ui.forms.faults)}</label><textarea id="tune-faults" class="textarea" name="faults" placeholder="${esc(ui.forms.placeholders.faults)}"></textarea></div><div class="form-group full"><label class="required" for="tune-target">${esc(ui.forms.target)}</label><textarea id="tune-target" class="textarea" name="message" required placeholder="${esc(ui.forms.placeholders.target)}"></textarea></div><div class="form-group full"><label for="tune-files">${esc(ui.forms.files)} <small>${esc(ui.forms.optional)}</small></label><input id="tune-files" class="input file-input" name="files" type="file" multiple accept=".csv,.log,.txt,.pdf,.jpg,.jpeg,.png,.bin,.ori,.hpt,.m1pkg"><small class="form-help">${esc(ui.forms.fileNote)}</small></div><label class="checkbox form-group full"><input type="checkbox" name="consent" required><span>${esc(ui.forms.consent)}</span></label></div><button class="btn btn-block" type="submit">${esc(ui.actions.checkCompatibility)}${icons.arrow}</button><p class="form-status" role="status" aria-live="polite"></p></form>`;
  }

  function tuningPlatformPage(slug) {
    const base = DATA.tuningPlatforms[slug];
    if (!base) return notFoundPage();
    const platform = localizedPlatform(base);
    return `${pageHero({ eyebrow: platform.platform, title: platform.title, text: platform.supportedScope, media: platform.cover, crumbs: [[U().nav.tuning, "/tuning"], [platform.short]], meta: `${statusBadge(platform.relationship)}`, actions: `<a class="btn" href="#compatibility-form">${esc(U().actions.checkCompatibility)}${icons.arrow}</a>` })}<section class="section"><div class="container tuning-layout"><div class="content-stack"><div>${gallery(platform.media || [], `tuning-${slug}`, platform.title, { hero: true })}</div><article class="content-panel"><span class="eyebrow">${esc(U().common.requirements)}</span><h2>${state.locale === "ar" ? "تأكد من المتطلبات قبل البدء." : "Confirm the requirements before starting."}</h2>${featureList(platform.requirements || [])}</article><article class="content-panel"><span class="eyebrow">${esc(U().common.included)}</span><h2>${state.locale === "ar" ? "نطاق واضح للتسليم والمراجعة." : "A defined review and delivery scope."}</h2>${featureList(platform.inclusions || [])}</article><article class="notice notice-warning"><strong>${state.locale === "ar" ? "مراجعة التوافق مطلوبة:" : "Compatibility review required:"}</strong> ${esc(platform.notice)}</article><article class="content-panel"><span class="eyebrow">${esc(U().actions.checkCompatibility)}</span><h2>${state.locale === "ar" ? "شنو نراجع؟" : "What is reviewed?"}</h2>${featureList(platform.compatibilityChecks || [])}</article></div><aside id="compatibility-form" class="form-panel sticky-panel"><span class="mini-label">${esc(platform.short)}</span><h2>${esc(U().forms.title)}</h2><p>${esc(U().forms.intro)}</p>${tuningForm(platform)}</aside></div></section><section class="section section-tone"><div class="container narrow">${sectionHead(U().nav.faq, state.locale === "ar" ? "أسئلة عن التوافق والـ Logging." : "Questions about compatibility and logging.")}${accordion(i18n().faq.tuning, `${slug}-faq`)}</div></section>${ctaBlock(state.locale === "ar" ? `تحتاج مساعدة مع ${platform.short}؟` : `Need help with ${platform.short}?`, platform.notice, U().actions.contactWorkshop, platform.formType)}`;
  }

  function engineConsultationForm() {
    const ui = U();
    return `<form class="enquiry-form embedded-form" data-enquiry-form data-form-type="Engine Build Enquiry" novalidate><input type="text" name="website" class="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="startedAt" value="${Date.now()}"><div class="form-grid"><div class="form-group"><label class="required" for="engine-name">${esc(ui.forms.name)}</label><input id="engine-name" class="input" name="name" required autocomplete="name" placeholder="${esc(ui.forms.placeholders.name)}"></div><div class="form-group"><label class="required" for="engine-phone">${esc(ui.forms.phone)}</label><input id="engine-phone" class="input ltr-input" name="phone" required inputmode="tel" autocomplete="tel" placeholder="${esc(ui.forms.placeholders.phone)}"></div><div class="form-group"><label for="engine-email">${esc(ui.forms.email)} <small>${esc(ui.forms.optional)}</small></label><input id="engine-email" class="input ltr-input" name="email" type="email" autocomplete="email" placeholder="${esc(ui.forms.placeholders.email)}"></div><div class="form-group"><label for="engine-country">${esc(ui.forms.country)}</label><input id="engine-country" class="input" name="country" placeholder="${esc(ui.forms.placeholders.country)}"></div><div class="form-group full"><label class="required" for="engine-vehicle">${esc(ui.forms.vehicle)}</label><input id="engine-vehicle" class="input" name="vehicle" required placeholder="${esc(ui.forms.placeholders.vehicle)}"></div><div class="form-group"><label class="required" for="engine-code">${esc(ui.forms.engine)}</label><input id="engine-code" class="input" name="engine" required placeholder="${esc(ui.forms.placeholders.engine)}"></div><div class="form-group"><label for="engine-transmission">${esc(ui.forms.transmission)}</label><input id="engine-transmission" class="input" name="transmission" placeholder="${esc(ui.forms.placeholders.transmission)}"></div><div class="form-group"><label for="engine-service">${esc(ui.forms.service)}</label><select id="engine-service" class="select" name="service"><option>${state.locale === "ar" ? "Complete Engine" : "Complete Engine"}</option><option>Long Block</option><option>${state.locale === "ar" ? "إعادة بناء محرك حالي" : "Existing Engine Rebuild"}</option><option>${state.locale === "ar" ? "تطوير محرك حالي" : "Existing Engine Upgrade"}</option><option>${state.locale === "ar" ? "فحص عطل بالمحرك" : "Engine Failure Assessment"}</option></select></div><div class="form-group"><label for="engine-fuel">${esc(ui.forms.fuel)}</label><input id="engine-fuel" class="input" name="fuel" placeholder="98 RON, E85, Race Fuel..."></div><div class="form-group full"><label class="required" for="engine-mods">${state.locale === "ar" ? "حالة المحرك والقطع الحالية" : "Current engine condition and existing parts"}</label><textarea id="engine-mods" class="textarea" name="modifications" required placeholder="${state.locale === "ar" ? "العطل إن وجد، البلوك، Crank، Rods، Pistons، Heads، Cam، Oiling والقطع المطلوب إعادة استخدامها" : "Failure history, block, crank, rods, pistons, heads, cam, oiling and any parts intended for reuse"}"></textarea></div><div class="form-group full"><label class="required" for="engine-target">${esc(ui.forms.target)}</label><textarea id="engine-target" class="textarea" name="message" required placeholder="${state.locale === "ar" ? "استخدام السيارة، نظام الشحن، هدف القوة، RPM المطلوب، الاعتمادية والوقت" : "Vehicle use, induction, power objective, requested RPM, reliability priority and timing"}"></textarea></div><div class="form-group full"><label for="engine-files">${esc(ui.forms.files)} <small>${esc(ui.forms.optional)}</small></label><input id="engine-files" class="input file-input" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.txt"><small class="form-help">${esc(ui.forms.fileNote)}</small></div><label class="checkbox form-group full"><input type="checkbox" name="consent" required><span>${esc(ui.forms.consent)}</span></label></div><button class="btn btn-block" type="submit">${esc(ui.actions.engineConsultation)}${icons.arrow}</button><p class="form-status" role="status" aria-live="polite"></p></form>`;
  }

  function engineBuildingPage() {
    const page = P().engineBuilding;
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 19, crumbs: [[U().nav.engineBuilding]], actions: `<a class="btn" href="#engine-consultation">${esc(U().actions.engineConsultation)}${icons.arrow}</a><a class="btn btn-outline-light" href="${waUrl(state.locale === "ar" ? "هلا Projx Racing، حاب أستفسر عن بناء محرك GM LS/LT." : "Hello Projx Racing, I would like to discuss a GM LS/LT engine project.")}" target="_blank" rel="noopener">${esc(U().actions.whatsapp)}${icons.whatsapp}</a>` })}<section class="section"><div class="container">${sectionHead(U().common.serviceScope, page.optionsHeading, page.optionsText)}<div class="engine-option-grid">${page.options.map(([title, text], index) => `<article><span>${compactNumber(index + 1)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p><button class="text-link" type="button" data-action="open-form" data-form-type="Engine Build Enquiry" data-context="${esc(title)}">${esc(U().actions.engineConsultation)}${icons.arrow}</button></article>`).join("")}</div></div></section><section class="section section-tone"><div class="container">${sectionHead(U().common.howItWorks, page.processHeading)}${numberSteps(page.process)}</div></section><section class="section"><div class="container detail-two-column"><div>${gallery([19, 5, 8, 27], "engine-building", page.heading, { hero: true })}</div><div class="content-panel"><span class="eyebrow">${esc(U().common.whatToProvide)}</span><h2>${esc(page.provideHeading)}</h2>${featureList(page.provide)}<div class="notice notice-warning">${esc(page.note)}</div></div></div></section><section id="engine-consultation" class="section section-tone"><div class="container form-feature"><div><span class="eyebrow">${esc(U().actions.engineConsultation)}</span><h2>${state.locale === "ar" ? "أرسل معلومات كافية للمراجعة الفنية." : "Send enough information for a technical review."}</h2><p>${state.locale === "ar" ? "هذا طلب استشارة مباشر، وما يحسب قوة أو سعر أو مواصفات تلقائياً. الفريق يراجع المحرك والسيارة قبل إصدار عرض السعر." : "This is a direct consultation request. It does not calculate power, price or specifications automatically. The team reviews the engine and vehicle before issuing a quotation."}</p>${featureList(page.provide.slice(0, 6))}</div><div class="form-panel">${engineConsultationForm()}</div></div></section><section class="section"><div class="container narrow">${sectionHead(U().nav.faq, state.locale === "ar" ? "أسئلة مهمة عن بناء المحرك." : "Important engine-building questions.")}${accordion(i18n().faq.engines, "engine-faq")}</div></section>${ctaBlock(state.locale === "ar" ? "ناقش مشروع المحرك مع الورشة." : "Discuss the engine project with the workshop.", page.note, U().actions.engineConsultation, "Engine Build Enquiry")}`;
  }

  function projectsPage() {
    const page = P().projects;
    const projects = DATA.projects.map(localizedProject);
    const categories = [...new Set(projects.map(project => project.category))];
    const makes = [...new Set(projects.map(project => project.make))];
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 35, crumbs: [[U().nav.projects]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Project Consultation">${esc(U().actions.discussBuild)}${icons.arrow}</button>` })}<section class="section"><div class="container"><div class="filter-bar"><label class="search-control">${icons.search}<input type="search" data-filter-search="projects" placeholder="${esc(U().filters.searchProjects)}" aria-label="${esc(U().filters.searchProjects)}"></label><label class="select-control">${icons.filter}<span class="sr-only">${esc(U().filters.filterByCategory)}</span><select data-filter-select="projects" data-filter-attribute="category"><option value="">${esc(U().common.allCategories)}</option>${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label><label class="select-control">${icons.filter}<span class="sr-only">${esc(U().filters.filterByMake)}</span><select data-filter-select="projects" data-filter-attribute="make"><option value="">${esc(U().common.allMakes)}</option>${makes.map(make => `<option value="${esc(make)}">${esc(make)}</option>`).join("")}</select></label></div><div class="project-grid" data-filter-grid="projects">${DATA.projects.map(projectCard).join("")}</div><div class="empty-state" data-filter-empty="projects" hidden>${esc(U().common.noResults)}</div></div></section>${ctaBlock(state.locale === "ar" ? "عندك مشروع مشابه؟" : "Planning a similar project?", state.locale === "ar" ? "أرسل السيارة والمواصفات الحالية والهدف والاستخدام والوقت حتى نراجع نطاق المشروع." : "Send the vehicle, current specification, objective, intended use and timing so the workshop can review the project scope.", U().actions.discussBuild, "Project Consultation")}`;
  }

  function projectPage(slug) {
    const base = DATA.projects.find(item => item.slug === slug);
    if (!base) return notFoundPage();
    const project = localizedProject(base);
    const related = DATA.projects.filter(item => item.slug !== slug && (item.make === base.make || item.category === base.category)).slice(0, 3);
    return `${pageHero({ eyebrow: project.category, title: project.title, text: project.summary, media: project.cover, crumbs: [[U().nav.projects, "/projects"], [project.title]], meta: `${statusBadge(project.vehicle)}`, actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Project Consultation" data-context="${esc(project.title)}">${esc(U().actions.discussBuild)}${icons.arrow}</button>` })}<section class="section"><div class="container project-detail-layout"><div>${gallery(project.media || [], `project-${slug}`, project.title, { hero: true })}</div><aside class="project-summary"><div><span>${esc(U().common.vehicle)}</span><strong>${esc(project.vehicle)}</strong></div><div><span>${esc(U().common.category)}</span><strong>${esc(project.category)}</strong></div><div><span>${esc(U().common.projectObjective)}</span><p>${esc(project.objective)}</p></div>${tags(project.tags || [])}</aside></div></section><section class="section section-tone"><div class="container detail-two-column"><article class="content-panel"><span class="eyebrow">${esc(U().common.projectWork)}</span><h2>${state.locale === "ar" ? "الأعمال المؤكدة ضمن المشروع." : "Confirmed work within the project."}</h2>${featureList(project.work || [])}</article><article class="content-panel"><span class="eyebrow">${esc(U().common.recordedResults)}</span><h2>${state.locale === "ar" ? "نتائج وملاحظات موثقة." : "Documented results and observations."}</h2>${featureList(project.results || [])}<div class="notice">${esc(project.note)}</div></article></div></section><section class="section"><div class="container">${sectionHead(U().common.relatedProjects, state.locale === "ar" ? "مشاريع أخرى مرتبطة." : "Other related projects.")}<div class="project-grid">${related.map(projectCard).join("")}</div></div></section>${ctaBlock(state.locale === "ar" ? `ناقش مشروع مشابه لـ ${project.vehicle}.` : `Discuss a project similar to the ${project.vehicle}.`, state.locale === "ar" ? "أرسل مواصفات سيارتك الحالية والهدف المطلوب. ما يتم افتراض أن نفس القطع أو النتيجة تناسب سيارة ثانية." : "Submit your current vehicle specification and objective. The same parts or result are not assumed to suit another vehicle.", U().actions.discussBuild, "Project Consultation")}`;
  }

  function partsPage() {
    const page = P().parts;
    const parts = DATA.parts.map(localizedPart);
    const categories = [...new Set(parts.map(part => part.category))];
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 27, crumbs: [[U().nav.parts]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Parts Enquiry">${esc(U().actions.enquire)}${icons.arrow}</button>` })}<section class="section"><div class="container"><div class="notice notice-info"><strong>${esc(page.noticeHeading)}</strong> ${esc(page.noticeText)}</div><div class="filter-bar"><label class="search-control">${icons.search}<input type="search" data-filter-search="parts" placeholder="${esc(U().filters.searchParts)}" aria-label="${esc(U().filters.searchParts)}"></label><label class="select-control">${icons.filter}<select data-filter-select="parts" data-filter-attribute="category"><option value="">${esc(U().common.allCategories)}</option>${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label></div><div class="parts-grid" data-filter-grid="parts">${DATA.parts.map(partCard).join("")}</div><div class="empty-state" data-filter-empty="parts" hidden>${esc(U().common.noResults)}</div></div></section>${ctaBlock(state.locale === "ar" ? "عندك رقم قطعة محدد؟" : "Have an exact part number?", state.locale === "ar" ? "أرسل رقم القطعة والسيارة وVIN عند الحاجة ومكان التسليم وخيار التركيب." : "Send the part number, vehicle, VIN where required, delivery location and whether installation is needed.", U().actions.enquire, "Parts Enquiry")}`;
  }

  function brandsPage() {
    const page = P().brands;
    const categories = [...new Set(DATA.brands.map(brand => categoryLabel(brand.category)))];
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 30, crumbs: [[U().nav.brands]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Brand / Parts Enquiry">${esc(U().actions.enquire)}${icons.arrow}</button>` })}<section class="section"><div class="container"><div class="filter-bar"><label class="search-control">${icons.search}<input type="search" data-filter-search="brands" placeholder="${esc(U().filters.searchBrands)}" aria-label="${esc(U().filters.searchBrands)}"></label><label class="select-control">${icons.filter}<select data-filter-select="brands" data-filter-attribute="category"><option value="">${esc(U().common.allCategories)}</option>${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label></div><div class="brands-grid" data-filter-grid="brands">${DATA.brands.map(brandCard).join("")}</div><div class="empty-state" data-filter-empty="brands" hidden>${esc(U().common.noResults)}</div></div></section><section class="section section-tone"><div class="container narrow"><div class="notice notice-info"><strong>${state.locale === "ar" ? "ملاحظة عن تصنيف العلامات:" : "Brand-label note:"}</strong> ${state.locale === "ar" ? "تصنيف Dealer أوReseller أوSupported Platform يعتمد على المعلومات الموردة. لا يتم عرض وكالة حصرية أو علاقة معتمدة بدون تأكيد." : "Dealer, reseller and supported-platform labels follow supplied information. Exclusive or authorised status is not implied without confirmation."}</div></div></section>${ctaBlock(state.locale === "ar" ? "تحتاج قطعة من علامة معينة؟" : "Need a part from a specific brand?", state.locale === "ar" ? "أرسل اسم العلامة ورقم القطعة والسيارة حتى نتحقق من التوافق والتوفر." : "Send the brand, part number and vehicle so compatibility and availability can be checked.", U().actions.enquire, "Brand / Parts Enquiry")}`;
  }

  function galleryPage() {
    const page = P().gallery;
    const localized = DATA.media.map(item => mediaItem(item.id));
    const categories = [...new Set(localized.map(item => item.category))];
    const makes = [...new Set(localized.map(item => item.make))];
    state.galleries.archive = DATA.media.map(item => item.id);
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 20, crumbs: [[U().nav.gallery]], actions: `<a class="btn" href="${CONFIG.instagramUrl}" target="_blank" rel="noopener">${esc(U().actions.openInstagram)}${icons.instagram}</a>` })}<section class="section"><div class="container"><div class="filter-bar"><label class="search-control">${icons.search}<input type="search" data-filter-search="media" placeholder="${esc(U().filters.searchMedia)}" aria-label="${esc(U().filters.searchMedia)}"></label><label class="select-control">${icons.filter}<select data-filter-select="media" data-filter-attribute="category"><option value="">${esc(U().common.allCategories)}</option>${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label><label class="select-control">${icons.filter}<select data-filter-select="media" data-filter-attribute="make"><option value="">${esc(U().common.allMakes)}</option>${makes.map(make => `<option value="${esc(make)}">${esc(make)}</option>`).join("")}</select></label></div><div class="media-grid" data-filter-grid="media">${DATA.media.map(item => mediaCard(item.id)).join("")}</div><div class="empty-state" data-filter-empty="media" hidden>${esc(U().common.noResults)}</div></div></section>${ctaBlock(state.locale === "ar" ? "حاب تناقش سيارة من الصور؟" : "Want to discuss a vehicle shown here?", state.locale === "ar" ? "اذكر اسم السيارة أو المشروع وأرسل تفاصيل سيارتك الحالية حتى نحدد الخدمة المناسبة." : "Reference the vehicle or project and submit your current vehicle details so the correct service can be identified.", U().actions.contactWorkshop, "Project Consultation")}`;
  }

  function reviewsPage() {
    const page = P().reviews;
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 20, crumbs: [[U().nav.reviews]], actions: `<a class="btn" href="${CONFIG.googleBusinessUrl}" target="_blank" rel="noopener">${esc(U().actions.openGoogleReviews)}${icons.arrow}</a>` })}<section class="section"><div class="container review-source-grid">${page.cards.map(([title, text], index) => `<article><span>${compactNumber(index + 1)}</span><h2>${esc(title)}</h2><p>${esc(text)}</p></article>`).join("")}</div></section><section class="section section-tone"><div class="container narrow review-action"><span class="eyebrow">Google Business</span><h2>${state.locale === "ar" ? "استخدم المصدر المباشر لأحدث المعلومات." : "Use the live source for the latest information."}</h2><p>${esc(page.intro)}</p><div class="btn-row"><a class="btn" href="${CONFIG.googleBusinessUrl}" target="_blank" rel="noopener">${esc(U().actions.openGoogleReviews)}${icons.arrow}</a><a class="btn btn-outline" href="${CONFIG.mapsUrl}" target="_blank" rel="noopener">${esc(U().actions.directions)}${icons.map}</a></div></div></section>${ctaBlock(state.locale === "ar" ? "عندك استفسار قبل زيارة الورشة؟" : "Have a question before visiting?", state.locale === "ar" ? "راسلنا على WhatsApp مع بيانات السيارة والخدمة المطلوبة." : "Message the workshop on WhatsApp with the vehicle details and required service.", U().actions.whatsapp, "General Enquiry")}`;
  }

  function aboutPage() {
    const page = P().about;
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 15, crumbs: [[U().nav.about]], actions: `<a class="btn" href="${routeUrl("/services")}">${esc(U().actions.exploreServices)}${icons.arrow}</a><a class="btn btn-outline-light" href="${routeUrl("/projects")}">${esc(U().actions.viewProjects)}${icons.arrow}</a>` })}<section class="section"><div class="container about-intro"><div><span class="eyebrow">${state.locale === "ar" ? "منهج متكامل" : "Integrated approach"}</span><h2>${esc(page.approachHeading)}</h2><p class="lead">${esc(page.approachText)}</p><p>${state.locale === "ar" ? "المشروع ممكن يكون خدمة واحدة أو تطوير كامل للسيارة. الهدف نتيجة قابلة للصيانة والقياس وتناسب الاستخدام، مو مجرد قائمة قطع مركبة." : "A project may be one service or a complete vehicle programme. The objective is a serviceable, measurable result that suits the use—not a disconnected list of installed parts."}</p></div><div class="about-facts"><div><span>${esc(U().common.location)}</span><strong>${esc(CONFIG.locationShort)}</strong></div><div><span>${esc(U().common.officialContact)}</span><strong><bdi>${esc(CONFIG.phoneDisplay)}</bdi></strong></div><div><span>${esc(U().common.dyno)}</span><strong>Mainline Chassis Dyno</strong></div><div><span>${esc(U().common.engineBuilding)}</span><strong>GM LS / LT</strong></div><div><span>${esc(U().common.onlineTuning)}</span><strong>MHD • COBB • HP Tuners</strong></div><div><span>${state.locale === "ar" ? "السوق الرئيسي" : "Primary market"}</span><strong>${state.locale === "ar" ? "الكويت والخليج" : "Kuwait & GCC"}</strong></div></div></div></section><section class="section section-dark-media"><div class="container">${sectionHead(state.locale === "ar" ? "المنشأة" : "Facility", page.capabilityHeading, page.capabilityText, `<a class="text-link on-dark" href="${routeUrl("/gallery")}">${esc(U().actions.viewGallery)}${icons.arrow}</a>`)}<div class="facility-grid"><button class="wide" type="button" data-action="open-media" data-media-id="20" data-gallery-key="about-facility">${mediaImage(20, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="19" data-gallery-key="about-facility">${mediaImage(19, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="24" data-gallery-key="about-facility">${mediaImage(24, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="23" data-gallery-key="about-facility">${mediaImage(23, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="17" data-gallery-key="about-facility">${mediaImage(17, { thumb: true, className: "cover-img" })}</button></div></div></section><section class="section"><div class="container">${sectionHead(state.locale === "ar" ? "القدرات" : "Capability", state.locale === "ar" ? "من أول فحص إلى تطوير الحلبة." : "From first inspection to track development.", state.locale === "ar" ? "نفس الورشة تقدر تربط الشغل الميكانيكي والإلكتروني وضبط الشاصي للمشاريع المعقدة." : "The same workshop can connect the mechanical, electronic and chassis work required by a complex vehicle.")}<div class="capability-grid">${DATA.services.map(service => {
      const local = localizedService(service);
      return `<a href="${routeUrl(serviceHref(local.slug))}"><span>${esc(local.kicker)}</span><strong>${esc(local.title)}</strong><small>${esc(local.summary)}</small></a>`;
    }).join("")}</div></div></section>${ctaBlock(state.locale === "ar" ? "ابدأ بالهدف الكامل، مو بقائمة قطع." : "Bring the complete objective—not just a parts list.", state.locale === "ar" ? "اشرح استخدام السيارة والمشكلة والهدف والحدود، وبعدها Projx Racing يحدد المسار المتكامل المناسب." : "Explain how the vehicle is used, the problem, the objective and the constraints. Projx Racing can then define the correct integrated route.", U().actions.contactWorkshop, "Workshop Consultation")}`;
  }

  function genericForm(type = "General Enquiry", context = "") {
    const ui = U();
    const id = `form-${slugify(type)}-${Math.random().toString(36).slice(2, 6)}`;
    return `<form class="enquiry-form" data-enquiry-form data-form-type="${esc(type)}" data-context="${esc(context)}" novalidate><input type="text" name="website" class="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="startedAt" value="${Date.now()}"><div class="form-grid"><div class="form-group"><label class="required" for="${id}-name">${esc(ui.forms.name)}</label><input id="${id}-name" class="input" name="name" required autocomplete="name" placeholder="${esc(ui.forms.placeholders.name)}"></div><div class="form-group"><label class="required" for="${id}-phone">${esc(ui.forms.phone)}</label><input id="${id}-phone" class="input ltr-input" name="phone" required inputmode="tel" autocomplete="tel" placeholder="${esc(ui.forms.placeholders.phone)}"></div><div class="form-group"><label for="${id}-email">${esc(ui.forms.email)} <small>${esc(ui.forms.optional)}</small></label><input id="${id}-email" class="input ltr-input" name="email" type="email" autocomplete="email" placeholder="${esc(ui.forms.placeholders.email)}"></div><div class="form-group"><label for="${id}-contact">${esc(ui.forms.preferredContact)}</label><select id="${id}-contact" class="select" name="preferredContact">${ui.forms.contactMethods.map(item => `<option>${esc(item)}</option>`).join("")}</select></div><div class="form-group full"><label class="required" for="${id}-vehicle">${esc(ui.forms.vehicle)}</label><input id="${id}-vehicle" class="input" name="vehicle" required placeholder="${esc(ui.forms.placeholders.vehicle)}"></div><div class="form-group"><label for="${id}-engine">${esc(ui.forms.engine)}</label><input id="${id}-engine" class="input" name="engine" placeholder="${esc(ui.forms.placeholders.engine)}"></div><div class="form-group"><label for="${id}-service">${esc(ui.forms.service)}</label><input id="${id}-service" class="input" name="service" value="${esc(context || type)}"></div><div class="form-group full"><label for="${id}-mods">${esc(ui.forms.modifications)} <small>${esc(ui.forms.optional)}</small></label><textarea id="${id}-mods" class="textarea" name="modifications" placeholder="${esc(ui.forms.placeholders.modifications)}"></textarea></div><div class="form-group full"><label class="required" for="${id}-message">${esc(ui.forms.message)}</label><textarea id="${id}-message" class="textarea" name="message" required placeholder="${esc(ui.forms.placeholders.message)}"></textarea></div><div class="form-group full"><label for="${id}-files">${esc(ui.forms.files)} <small>${esc(ui.forms.optional)}</small></label><input id="${id}-files" class="input file-input" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.log,.txt"><small class="form-help">${esc(ui.forms.fileNote)}</small></div><label class="checkbox form-group full"><input type="checkbox" name="consent" required><span>${esc(ui.forms.consent)}</span></label></div><button class="btn btn-block" type="submit">${esc(ui.actions.submit)}${icons.arrow}</button><p class="form-status" role="status" aria-live="polite"></p></form>`;
  }

  function contactPage() {
    const page = P().contact;
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 20, crumbs: [[U().nav.contact]], actions: `<a class="btn" href="${waUrl()}" target="_blank" rel="noopener">${esc(U().actions.whatsapp)}${icons.whatsapp}</a><a class="btn btn-outline-light" href="${telUrl()}">${esc(U().actions.call)}${icons.phone}</a>` })}<section class="section"><div class="container contact-grid"><div class="contact-info-stack"><article class="contact-card"><span>${esc(page.visitHeading)}</span><h2>${esc(CONFIG.addressLine1)}</h2><p>${esc(CONFIG.addressLine2)}<br>${esc(CONFIG.cityCountry)}</p><div class="btn-row"><a class="btn btn-sm" href="${CONFIG.mapsUrl}" target="_blank" rel="noopener">${esc(U().actions.directions)}${icons.map}</a><button class="btn btn-sm btn-outline" type="button" data-action="load-map">${esc(U().actions.loadMap)}${icons.map}</button></div></article><article class="contact-card"><span>${esc(page.availabilityHeading)}</span><h2><bdi>${esc(CONFIG.phoneDisplay)}</bdi></h2><p>${esc(page.availabilityText)}</p><div class="btn-row"><a class="btn btn-sm" href="${telUrl()}">${esc(U().actions.call)}${icons.phone}</a><a class="btn btn-sm btn-outline" href="${waUrl()}" target="_blank" rel="noopener">WhatsApp${icons.whatsapp}</a></div></article><article class="contact-card"><span>${esc(page.socialHeading)}</span><p>${esc(page.socialText)}</p><div class="btn-row"><a class="btn btn-sm btn-outline" href="${CONFIG.instagramUrl}" target="_blank" rel="noopener">Instagram${icons.instagram}</a><a class="btn btn-sm btn-outline" href="${CONFIG.googleBusinessUrl}" target="_blank" rel="noopener">Google${icons.arrow}</a></div></article></div><div class="contact-form-panel"><span class="eyebrow">${esc(U().actions.contactWorkshop)}</span><h2>${esc(U().forms.title)}</h2><p>${esc(U().forms.intro)}</p>${genericForm("Website Enquiry")}</div></div></section><section class="map-section"><div class="container"><div id="map-container" class="map-placeholder"><div>${icons.map}<h2>${esc(U().actions.loadMap)}</h2><p>${esc(page.visitText)}</p><button class="btn" type="button" data-action="load-map">${esc(U().actions.loadMap)}${icons.map}</button></div></div></div></section>`;
  }

  function faqPage() {
    const page = P().faq;
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 36, crumbs: [[U().nav.faq]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="General Enquiry">${esc(U().actions.contactWorkshop)}${icons.arrow}</button>` })}<section class="section"><div class="container faq-sections"><section><h2>${esc(page.tuningHeading)}</h2>${accordion(i18n().faq.tuning, "faq-tuning")}</section><section><h2>${esc(page.enginesHeading)}</h2>${accordion(i18n().faq.engines, "faq-engine")}</section><section><h2>${esc(page.generalHeading)}</h2>${accordion(i18n().faq.general, "faq-general")}</section></div></section>${ctaBlock(state.locale === "ar" ? "ما لقيت إجابة عن سيارتك؟" : "Could not find the answer for your vehicle?", state.locale === "ar" ? "أرسل السيارة ووحدة التحكم أو القطعة والسؤال بالتفصيل حتى نراجع الحالة المحددة." : "Submit the vehicle, controller or part and the exact question so the specific case can be reviewed.", U().actions.contactWorkshop, "Technical Enquiry")}`;
  }

  function legalPage(slug) {
    const page = i18n().legal?.[slug];
    if (!page) return notFoundPage();
    return `${pageHero({ eyebrow: state.locale === "ar" ? "معلومات الخدمة" : "Service Information", title: page.heading, text: page.description, media: 15, crumbs: [[page.heading]], actions: `<a class="btn" href="${routeUrl("/contact")}">${esc(U().actions.contactWorkshop)}${icons.arrow}</a>` })}<section class="section"><div class="container narrow legal-content">${page.sections.map(([title, text], index) => `<article><span>${compactNumber(index + 1)}</span><h2>${esc(title)}</h2><p>${esc(text)}</p></article>`).join("")}</div></section>`;
  }

  function notFoundPage() {
    const page = P().notFound;
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 15, crumbs: [[page.heading]], actions: `<a class="btn" href="${routeUrl("/")}">${esc(U().actions.backHome)}${icons.arrow}</a><a class="btn btn-outline-light" href="${routeUrl("/contact")}">${esc(U().actions.contactWorkshop)}${icons.arrow}</a>` })}`;
  }

  function renderPage() {
    parsePreviewLocation();
    document.documentElement.lang = i18n().lang;
    document.documentElement.dir = i18n().dir;
    document.body.dataset.locale = state.locale;
    storage.set("projxLanguage", state.locale);
    state.galleries = Object.create(null);
    const path = currentPath();
    let html;
    if (path === "/") html = homePage();
    else if (path === "/services") html = servicesPage();
    else if (path.startsWith("/services/")) html = serviceDetailPage(path.split("/")[2]);
    else if (path === "/tuning") html = tuningLandingPage();
    else if (path.startsWith("/tuning/")) html = tuningPlatformPage(path.split("/")[2]);
    else if (path === "/engine-building") html = engineBuildingPage();
    else if (path === "/projects") html = projectsPage();
    else if (path.startsWith("/projects/")) html = projectPage(path.split("/")[2]);
    else if (path === "/parts") html = partsPage();
    else if (path === "/brands") html = brandsPage();
    else if (path === "/gallery") html = galleryPage();
    else if (path === "/reviews") html = reviewsPage();
    else if (path === "/about") html = aboutPage();
    else if (path === "/contact") html = contactPage();
    else if (path === "/faq") html = faqPage();
    else if (path.startsWith("/legal/")) html = legalPage(path.split("/")[2]);
    else html = notFoundPage();
    main.innerHTML = html;
    renderHeader();
    renderFooter();
    updateThemeControls();
    setupFilters();
    state.galleries["home-capability"] = [20, 19, 24, 23];
    state.galleries["about-facility"] = [20, 19, 24, 23, 17];
    if (PREVIEW_MODE) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      requestAnimationFrame(() => main.focus({ preventScroll: true }));
    }
  }

  function setupFilters() {
    document.querySelectorAll("[data-filter-search]").forEach(input => input.addEventListener("input", applyFilter));
    document.querySelectorAll("[data-filter-select]").forEach(select => select.addEventListener("change", applyFilter));
  }

  function applyFilter(event) {
    const control = event.currentTarget;
    const group = control.dataset.filterSearch || control.dataset.filterSelect;
    const grid = document.querySelector(`[data-filter-grid="${CSS.escape(group)}"]`);
    if (!grid) return;
    const search = document.querySelector(`[data-filter-search="${CSS.escape(group)}"]`)?.value.trim().toLowerCase() || "";
    const selects = [...document.querySelectorAll(`[data-filter-select="${CSS.escape(group)}"]`)];
    let visible = 0;
    grid.querySelectorAll(".filter-item").forEach(item => {
      const searchMatch = !search || (item.dataset.search || "").includes(search);
      const selectMatch = selects.every(select => {
        if (!select.value) return true;
        const attribute = select.dataset.filterAttribute;
        return (item.dataset[attribute] || "") === select.value;
      });
      const show = searchMatch && selectMatch;
      item.hidden = !show;
      if (show) visible += 1;
    });
    const empty = document.querySelector(`[data-filter-empty="${CSS.escape(group)}"]`);
    if (empty) empty.hidden = visible > 0;
  }

  function currentTheme() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }
  function applyTheme(theme, persist = true) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", value === "light" ? "#f5f6f8" : "#08090d");
    if (persist) storage.set("projxTheme", value);
    document.documentElement.classList.add("theme-ready");
    updateThemeControls();
  }
  function updateThemeControls() {
    const theme = currentTheme();
    document.querySelectorAll('[data-action="toggle-theme"]').forEach(button => {
      button.setAttribute("aria-label", theme === "dark" ? U().useLightTheme : U().useDarkTheme);
    });
  }

  function setMobileOpen(open) {
    state.mobileOpen = Boolean(open);
    renderHeader();
    const nav = document.getElementById("mobile-navigation");
    if (state.mobileOpen) {
      document.body.classList.add("menu-open");
      requestAnimationFrame(() => nav?.querySelector("a,button")?.focus());
    } else {
      document.body.classList.remove("menu-open");
    }
  }

  function trapFocus(event, container) {
    if (event.key !== "Tab") return;
    const focusable = [...container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function showToast(message, detail = "") {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<strong>${esc(message)}</strong>${detail ? `<span>${esc(detail)}</span>` : ""}`;
    toastRoot.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => { toast.classList.remove("is-visible"); setTimeout(() => toast.remove(), 250); }, 4200);
  }

  function openForm(type = "General Enquiry", context = "") {
    state.formContext = { type, context, opener: document.activeElement };
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div><section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-form-title"><header><div><span class="eyebrow">${esc(type)}</span><h2 id="modal-form-title">${esc(U().forms.title)}</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="${esc(U().actions.close)}">${icons.close}</button></header><p>${esc(U().forms.intro)}</p>${genericForm(type, context)}</section>`;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => modalRoot.querySelector("input:not(.honeypot)")?.focus());
  }

  function closeModal() {
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
    state.formContext?.opener?.focus?.();
    state.formContext = null;
  }

  function renderQuoteDrawer() {
    const ui = U();
    drawer.innerHTML = `<div class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="quote-title"><header class="drawer-head"><div><span class="eyebrow">${esc(ui.actions.requestQuote)}</span><h2 id="quote-title">${esc(ui.common.selectedItems)}</h2></div><button class="icon-btn" type="button" data-action="close-quote" aria-label="${esc(ui.actions.close)}">${icons.close}</button></header>${state.quote.length ? `<div class="quote-items">${state.quote.map((item, index) => `<article class="quote-item"><span>${compactNumber(index + 1)}</span><div><small>${esc(item.kind)}</small><strong>${esc(item.title)}</strong><p>${esc(item.details)}</p></div><button type="button" data-action="remove-quote" data-id="${esc(item.id)}" aria-label="${esc(`${ui.actions.remove}: ${item.title}`)}">${icons.close}</button></article>`).join("")}</div><div class="quote-form-wrap">${genericForm("General Quote", state.quote.map(item => item.title).join(", "))}</div>` : `<div class="empty-state"><strong>${esc(ui.common.emptyQuote)}</strong><p>${state.locale === "ar" ? "أضف خدمة أو مشروع أو قطعة أو منصة برمجة حتى تجهز طلب واحد مرتب." : "Add a service, project, part or tuning platform to prepare one structured request."}</p><a class="btn" href="${routeUrl("/services")}" data-action="close-quote">${esc(ui.actions.viewAllServices)}${icons.arrow}</a></div>`}</div>`;
  }

  function openQuote() {
    renderQuoteDrawer();
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => drawer.querySelector("button,a,input")?.focus());
  }
  function closeQuote() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    setTimeout(() => { drawer.innerHTML = ""; }, 250);
  }

  function addQuote(item) {
    if (!state.quote.some(existing => existing.id === item.id)) state.quote.push(item);
    saveQuote();
    showToast(state.locale === "ar" ? "تمت الإضافة لطلب السعر" : "Added to quote request", item.title);
  }

  function openLightbox(id, key = "archive") {
    const item = mediaItem(id);
    if (!item) return;
    const ids = state.galleries[key] || DATA.media.map(media => media.id);
    state.lightbox = { id: Number(id), key, ids, opener: document.activeElement };
    renderLightbox();
  }

  function renderLightbox() {
    const current = mediaItem(state.lightbox.id);
    const index = state.lightbox.ids.indexOf(state.lightbox.id);
    modalRoot.innerHTML = `<div class="lightbox" role="dialog" aria-modal="true" aria-label="${esc(current.title)}"><button class="lightbox-close" type="button" data-action="close-lightbox" aria-label="${esc(U().accessibility.closeImage)}">${icons.close}</button><button class="lightbox-nav previous" type="button" data-action="lightbox-prev" aria-label="${esc(U().accessibility.previousImage)}">${icons.arrow}</button><figure>${mediaImage(current.id, { loading: "eager", className: "lightbox-image", sizes: "100vw" })}<figcaption><span>${esc(current.category)}</span><strong>${esc(current.title)}</strong><p>${esc(current.caption)}</p><small>${index + 1} / ${state.lightbox.ids.length}</small></figcaption></figure><button class="lightbox-nav next" type="button" data-action="lightbox-next" aria-label="${esc(U().accessibility.nextImage)}">${icons.arrow}</button></div>`;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => modalRoot.querySelector(".lightbox-close")?.focus());
  }
  function closeLightbox() {
    const opener = state.lightbox?.opener;
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
    state.lightbox = null;
    opener?.focus?.();
  }
  function moveLightbox(offset) {
    if (!state.lightbox) return;
    const index = state.lightbox.ids.indexOf(state.lightbox.id);
    const next = (index + offset + state.lightbox.ids.length) % state.lightbox.ids.length;
    state.lightbox.id = state.lightbox.ids[next];
    renderLightbox();
  }

  function gallerySelect(button) {
    const key = button.dataset.galleryKey;
    const id = Number(button.dataset.mediaId);
    const component = button.closest("[data-gallery-component]");
    const item = mediaItem(id);
    if (!component || !item) return;
    const mainButton = component.querySelector(".gallery-main-photo");
    mainButton.dataset.mediaId = String(id);
    mainButton.setAttribute("aria-label", `${U().accessibility.openImage}: ${item.title}`);
    const image = component.querySelector(".gallery-active-image");
    image.src = item.full;
    image.alt = item.alt;
    component.querySelector(".gallery-photo-caption strong").textContent = item.title;
    component.querySelector(".gallery-photo-caption span").textContent = item.caption;
    component.querySelectorAll(".gallery-thumb").forEach(node => node.classList.toggle("is-active", node === button));
    state.galleries[key] = state.galleries[key] || [];
  }

  function loadMap() {
    const container = document.getElementById("map-container");
    if (!container || state.mapLoaded) return;
    container.innerHTML = `<iframe title="${esc(P().contact.visitHeading)}" src="${esc(CONFIG.mapsEmbedUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
    state.mapLoaded = true;
  }

  async function postEnquiry(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const endpoint = new URL(CONFIG.formEndpoint, document.baseURI).href;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal, credentials: "same-origin" });
      const result = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, result };
    } finally { clearTimeout(timer); }
  }

  function formFields(form) {
    const result = {};
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      if (key === "files" || key === "website" || key === "startedAt") continue;
      if (result[key]) result[key] = Array.isArray(result[key]) ? [...result[key], cleanText(value)] : [result[key], cleanText(value)];
      else result[key] = cleanText(value);
    }
    const files = form.querySelector('input[type="file"]')?.files;
    if (files?.length) result.files = [...files].map(file => file.name).slice(0, 15);
    const context = form.dataset.context;
    if (context) result.context = context;
    if (form.dataset.platformForm) result.platform = form.dataset.platformForm;
    if (form.dataset.formType === "General Quote" && state.quote.length) result.selectedItems = state.quote.map(item => `${item.kind}: ${item.title} — ${item.details}`);
    return result;
  }

  function validateForm(form) {
    const ui = U().forms;
    const status = form.querySelector(".form-status");
    status.textContent = "";
    if (!form.reportValidity()) {
      status.textContent = ui.validation.required;
      status.className = "form-status is-error";
      return false;
    }
    const email = form.querySelector('input[type="email"]');
    if (email?.value && !/^\S+@\S+\.\S+$/.test(email.value)) {
      status.textContent = ui.validation.invalidEmail;
      status.className = "form-status is-error";
      email.focus();
      return false;
    }
    return true;
  }

  function whatsappMessage(type, ref, fields) {
    const labelsEn = { name: "Name", phone: "Phone / WhatsApp", email: "Email", country: "Country", vehicle: "Vehicle", engine: "Engine", transmission: "Transmission", service: "Service", fuel: "Fuel", modifications: "Current modifications", intendedUse: "Intended use", target: "Target", faults: "Known faults", device: "Device / software", unlock: "Unlock status", message: "Project details", preferredContact: "Preferred contact", year: "Model year", model: "Model", tuneType: "Tune type", files: "Files to attach", context: "Context", platform: "Platform", selectedItems: "Selected items" };
    const labelsAr = { name: "الاسم", phone: "الهاتف / WhatsApp", email: "البريد", country: "الدولة", vehicle: "السيارة", engine: "المحرك", transmission: "القير", service: "الخدمة", fuel: "الوقود", modifications: "التعديلات الحالية", intendedUse: "الاستخدام", target: "الهدف", faults: "الأعطال", device: "الجهاز / البرنامج", unlock: "حالة Unlock", message: "تفاصيل المشروع", preferredContact: "طريقة التواصل", year: "سنة الموديل", model: "الموديل", tuneType: "نوع البرمجة", files: "ملفات للإرفاق", context: "المرجع", platform: "المنصة", selectedItems: "العناصر المختارة" };
    const labels = state.locale === "ar" ? labelsAr : labelsEn;
    const lines = [state.locale === "ar" ? "*طلب من موقع Projx Racing*" : "*Projx Racing Website Enquiry*", `${U().forms.success.reference}: ${ref}`, `${state.locale === "ar" ? "نوع الطلب" : "Request type"}: ${type}`];
    for (const [key, value] of Object.entries(fields)) {
      if (!value || key === "consent") continue;
      const formatted = Array.isArray(value) ? value.join(" | ") : value;
      lines.push(`${labels[key] || key}: ${formatted}`);
    }
    lines.push("", state.locale === "ar" ? "يرجى مراجعة المعلومات وتأكيد نطاق العمل والسعر والخطوة التالية." : "Please review the information and confirm the scope, quotation and next step.");
    return lines.join("\n");
  }

  async function submitEnquiry(form) {
    if (!validateForm(form)) return;
    const type = form.dataset.formType || "Website Enquiry";
    const ref = randomRef(type.includes("Tuning") ? "TUNE" : type.includes("Engine") ? "ENG" : type.includes("Parts") ? "PART" : "WEB");
    const fields = formFields(form);
    const startedAt = Number(form.querySelector('[name="startedAt"]')?.value || Date.now());
    const payload = { ref, type, fields, page: location.href, locale: i18n().locale, startedAt, website: form.querySelector('[name="website"]')?.value || "" };
    const status = form.querySelector(".form-status");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.classList.add("is-loading");
    status.className = "form-status";
    status.textContent = state.locale === "ar" ? "جاري تجهيز الطلب..." : "Preparing the enquiry...";

    let delivered = false;
    if (["api", "auto"].includes(CONFIG.formMode)) {
      try {
        const response = await postEnquiry(payload);
        if (response.ok) delivered = true;
        else if (CONFIG.formMode === "api") throw new Error(response.result?.error || "delivery_failed");
      } catch (error) {
        if (CONFIG.formMode === "api") {
          status.textContent = U().forms.validation.error;
          status.className = "form-status is-error";
          submit.disabled = false;
          submit.classList.remove("is-loading");
          return;
        }
      }
    }

    if (delivered) {
      status.textContent = `${U().forms.success.sent} ${U().forms.success.reference}: ${ref}`;
      status.className = "form-status is-success";
      form.reset();
      showToast(U().forms.success.sent, ref);
    } else {
      openExternal(waUrl(whatsappMessage(type, ref, fields)));
      status.textContent = `${U().forms.success.prepared} ${U().forms.success.reference}: ${ref}`;
      status.className = "form-status is-success";
      showToast(U().forms.success.prepared, ref);
    }
    submit.disabled = false;
    submit.classList.remove("is-loading");
  }

  function updatePlatformModels(select) {
    const form = select.closest("[data-platform-form]");
    if (!form) return;
    const slug = form.dataset.platformForm;
    const platform = DATA.tuningPlatforms[slug];
    const modelSelect = form.querySelector('[data-role="platform-model"]');
    if (!platform || !modelSelect) return;
    const models = platform.models?.[select.value] || [];
    modelSelect.innerHTML = optionList(models);
  }

  document.addEventListener("click", event => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle-menu") { setMobileOpen(!state.mobileOpen); return; }
    if (action === "close-menu") { setMobileOpen(false); return; }
    if (action === "toggle-theme") { applyTheme(currentTheme() === "dark" ? "light" : "dark"); renderHeader(); return; }
    if (action === "open-form") { openForm(target.dataset.formType || "General Enquiry", target.dataset.context || ""); return; }
    if (action === "close-modal") { if (event.target === target || target.closest("button")) closeModal(); return; }
    if (action === "open-quote") { openQuote(); return; }
    if (action === "close-quote") { closeQuote(); return; }
    if (action === "add-quote") {
      addQuote({ id: `${target.dataset.kind}-${target.dataset.title}`.toLowerCase().replace(/\s+/g, "-"), kind: target.dataset.kind || "Enquiry", title: target.dataset.title || "Projx Racing", details: target.dataset.details || "" });
      return;
    }
    if (action === "remove-quote") { state.quote = state.quote.filter(item => item.id !== target.dataset.id); saveQuote(); renderQuoteDrawer(); return; }
    if (action === "toggle-accordion") {
      const expanded = target.getAttribute("aria-expanded") === "true";
      target.setAttribute("aria-expanded", String(!expanded));
      target.querySelector("strong").textContent = expanded ? "+" : "−";
      const panel = document.getElementById(target.getAttribute("aria-controls"));
      if (panel) panel.hidden = expanded;
      return;
    }
    if (action === "gallery-select") { gallerySelect(target); return; }
    if (action === "open-media") { openLightbox(Number(target.dataset.mediaId), target.dataset.galleryKey || "archive"); return; }
    if (action === "close-lightbox") { closeLightbox(); return; }
    if (action === "lightbox-prev") { moveLightbox(-1); return; }
    if (action === "lightbox-next") { moveLightbox(1); return; }
    if (action === "load-map") { loadMap(); return; }
  });

  document.addEventListener("submit", event => {
    const form = event.target.closest("[data-enquiry-form]");
    if (!form) return;
    event.preventDefault();
    submitEnquiry(form);
  });

  document.addEventListener("change", event => {
    const engineSelect = event.target.closest('[data-role="platform-engine"]');
    if (engineSelect) updatePlatformModels(engineSelect);
  });

  document.addEventListener("click", event => {
    const language = event.target.closest("[data-language]");
    if (language) storage.set("projxLanguage", language.dataset.language);
    if (event.target.closest(".mobile-nav-link")) state.mobileOpen = false;
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (state.lightbox) closeLightbox();
      else if (modalRoot.innerHTML) closeModal();
      else if (drawer.classList.contains("is-open")) closeQuote();
      else if (state.mobileOpen) setMobileOpen(false);
    }
    const activeDialog = modalRoot.querySelector('[role="dialog"]') || drawer.querySelector('[role="dialog"]') || (state.mobileOpen ? document.getElementById("mobile-navigation") : null);
    if (activeDialog) trapFocus(event, activeDialog);
    if (state.lightbox && event.key === "ArrowLeft") moveLightbox(isRtl() ? 1 : -1);
    if (state.lightbox && event.key === "ArrowRight") moveLightbox(isRtl() ? -1 : 1);
  });

  window.addEventListener("hashchange", () => {
    if (!PREVIEW_MODE) return;
    parsePreviewLocation();
    renderPage();
  });

  window.addEventListener("pageshow", () => {
    const stored = storage.get("projxTheme");
    if (stored) applyTheme(stored, false);
  });

  document.documentElement.classList.add("js");
  applyTheme(currentTheme(), false);
  renderPage();

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !PREVIEW_MODE) {
    window.addEventListener("load", () => navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => {}), { once: true });
  }
})();
