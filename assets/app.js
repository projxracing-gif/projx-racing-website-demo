(() => {
  "use strict";

  const DATA = window.PROJX_DATA;
  const CONFIG = window.PROJX_CONFIG;
  const TRANSLATIONS = window.PROJX_TRANSLATIONS || {};
  const TEGIWA_VEHICLE_DIRECTORY = window.PROJX_TEGIWA_VEHICLE_DIRECTORY || { makes: [], counts: { makes: 0, models: 0 } };
  const SUPPLIER_DIRECTORY_GENERATION = "supplier-directory";
  const SUPPLIER_CONFIRM_ENGINE = "confirm-engine";
  const ECS_BMW_F8X_VEHICLE_SELECTIONS = Object.freeze([
    Object.freeze({
      directoryModel: "M3 (14-20)", model: "M3", generation: "F80", engine: "S55",
      labelEn: "F80 M3 Saloon · S55", labelAr: "F80 M3 سيدان · S55"
    }),
    Object.freeze({
      directoryModel: "M4 (14-20)", model: "M4", generation: "F82", engine: "S55",
      labelEn: "F82 M4 Coupé · S55", labelAr: "F82 M4 كوبيه · S55"
    }),
    Object.freeze({
      directoryModel: "M4 (14-20)", model: "M4", generation: "F83", engine: "S55",
      labelEn: "F83 M4 Convertible · S55", labelAr: "F83 M4 مكشوفة · S55"
    })
  ]);
  const PARTS_CATALOG_ENDPOINT = "/api/parts-catalog/";
  const PARTS_CATALOG_FALLBACK_ENDPOINT = "/api/tegiwa-catalog/";
  const STAGING_ORDER_ENDPOINT = "/api/staging-order/";
  const SHIPPING_ESTIMATE_ENDPOINT = "/api/shipping-estimate/";
  const SHIPPING_REVALIDATE_ENDPOINT = "/api/shipping-revalidate/";
  const TEGIWA_PRODUCT_QUERY = "product";
  const TEGIWA_PRODUCT_HISTORY_KEY = "projxSupplierProduct";
  const TEGIWA_PRODUCT_HANDLE_LIMIT = 255;
  const CART_STORAGE_KEY = "projxStagingCartV1";
  const CHECKOUT_TOKEN_STORAGE_KEY = "projxStagingCheckoutTokenV1";
  const LAST_ORDER_STORAGE_KEY = "projxLastStagingOrderV1";
  const MAX_CART_LINES = 20;
  const GCC_DESTINATIONS = Object.freeze({
    KW: Object.freeze({ en: "Kuwait", ar: "الكويت", dial: "+965", regions: Object.freeze(["Capital / العاصمة", "Hawalli / حولي", "Farwaniya / الفروانية", "Mubarak Al-Kabeer / مبارك الكبير", "Ahmadi / الأحمدي", "Jahra / الجهراء"]) }),
    SA: Object.freeze({ en: "Saudi Arabia", ar: "المملكة العربية السعودية", dial: "+966", regions: Object.freeze(["Riyadh / الرياض", "Makkah / مكة المكرمة", "Madinah / المدينة المنورة", "Eastern Province / المنطقة الشرقية", "Qassim / القصيم", "Asir / عسير", "Tabuk / تبوك", "Hail / حائل", "Northern Borders / الحدود الشمالية", "Jazan / جازان", "Najran / نجران", "Al Bahah / الباحة", "Al Jawf / الجوف"]) }),
    AE: Object.freeze({ en: "United Arab Emirates", ar: "الإمارات العربية المتحدة", dial: "+971", regions: Object.freeze(["Abu Dhabi / أبوظبي", "Dubai / دبي", "Sharjah / الشارقة", "Ajman / عجمان", "Umm Al Quwain / أم القيوين", "Ras Al Khaimah / رأس الخيمة", "Fujairah / الفجيرة"]) }),
    QA: Object.freeze({ en: "Qatar", ar: "قطر", dial: "+974", regions: Object.freeze(["Doha / الدوحة", "Al Rayyan / الريان", "Al Wakrah / الوكرة", "Umm Salal / أم صلال", "Al Daayen / الظعاين", "Al Khor and Al Thakhira / الخور والذخيرة", "Al Shamal / الشمال", "Al Shahaniya / الشحانية"]) }),
    BH: Object.freeze({ en: "Bahrain", ar: "البحرين", dial: "+973", regions: Object.freeze(["Capital / العاصمة", "Muharraq / المحرق", "Northern / الشمالية", "Southern / الجنوبية"]) }),
    OM: Object.freeze({ en: "Oman", ar: "عُمان", dial: "+968", regions: Object.freeze(["Muscat / مسقط", "Dhofar / ظفار", "Musandam / مسندم", "Al Buraimi / البريمي", "Ad Dakhiliyah / الداخلية", "North Al Batinah / شمال الباطنة", "South Al Batinah / جنوب الباطنة", "North Ash Sharqiyah / شمال الشرقية", "South Ash Sharqiyah / جنوب الشرقية", "Ad Dhahirah / الظاهرة", "Al Wusta / الوسطى"]) })
  });
  const TEGIWA_GB_SUPPLIER = Object.freeze({
    slug: "tegiwa",
    name: "Tegiwa",
    originCountryCode: "GB",
    originCountryName: "Great Britain"
  });
  const ECS_US_SUPPLIER = Object.freeze({
    slug: "ecs",
    name: "ECS Tuning",
    originId: "ecs-us",
    originCountryCode: "US",
    originCountryName: "United States"
  });
  const TEGIWA_TSUKI_TSHIRT_IMAGE = Object.freeze({
    src: "https://cdn.shopify.com/s/files/1/0715/5767/7352/files/Tsuki_Teamwear-2026-2.jpg?v=1769175846",
    width: 825,
    height: 825,
    alt: "2026 Tegiwa Racing Tsuki Team T-Shirt",
    altAr: "قميص فريق تيجيوا ريسنغ تسوكي 2026"
  });
  function tsukiTshirtPolicy(sizeSlug, sizeTitle, sizeTitleAr, sku, supplierAvailable) {
    return Object.freeze({
      productId: `tegiwa-2026-team-tegiwa-tsuki-t-shirt-${sizeSlug}`,
      sourceHandle: "2026-team-tegiwa-tsuki-t-shirt",
      title: `2026 Tegiwa Racing Tsuki Team T-Shirt — ${sizeTitle}`,
      titleAr: `قميص فريق تيجيوا ريسنغ تسوكي 2026 — ${sizeTitleAr}`,
      variantTitle: sizeTitle,
      variantId: sku,
      sku,
      currency: "GBP",
      unitAmount: 27.49,
      priceVerifiedAt: "2026-09-06",
      maxPriceAgeDays: 7,
      availabilityVerifiedAt: "2026-09-06",
      maxAvailabilityAgeDays: 7,
      supplierAvailable,
      fitmentConfirmationRequired: false,
      purchaseMode: "direct",
      image: TEGIWA_TSUKI_TSHIRT_IMAGE,
      supplier: TEGIWA_GB_SUPPLIER
    });
  }
  const DIRECT_CART_POLICY = Object.freeze({
    "tegiwa-magnust-gr-yaris-gopro-headrest-mount-lhd": Object.freeze({
      sku: "T-GOPRO-MOUNT-YARISGR-LHD",
      currency: "GBP",
      unitAmount: 25.99,
      priceVerifiedAt: "2026-09-06",
      maxPriceAgeDays: 7,
      availabilityVerifiedAt: "2026-09-06",
      maxAvailabilityAgeDays: 7,
      supplierAvailable: true,
      fitmentConfirmationRequired: true,
      notice: "Left-hand-drive GR Yaris and seat/headrest compatibility must be confirmed before fulfilment.",
      noticeAr: "يجب تأكيد توافق سيارة GR Yaris ذات المقود اليسار والمقعد ومسند الرأس قبل التجهيز.",
      supplier: TEGIWA_GB_SUPPLIER
    }),
    "tegiwa-2026-team-tegiwa-tsuki-t-shirt-s": tsukiTshirtPolicy("s", "Small", "صغير", "T-TSUKITEAM-TSHIRT-S", true),
    "tegiwa-2026-team-tegiwa-tsuki-t-shirt-m": tsukiTshirtPolicy("m", "Medium", "متوسط", "T-TSUKITEAM-TSHIRT-M", true),
    "tegiwa-2026-team-tegiwa-tsuki-t-shirt-l": tsukiTshirtPolicy("l", "Large", "كبير", "T-TSUKITEAM-TSHIRT-L", true),
    "tegiwa-2026-team-tegiwa-tsuki-t-shirt-xl": tsukiTshirtPolicy("xl", "X-Large", "كبير جداً", "T-TSUKITEAM-TSHIRT-XL", true),
    "tegiwa-2026-team-tegiwa-tsuki-t-shirt-xxl": tsukiTshirtPolicy("xxl", "XX-Large", "كبير جداً جداً", "T-TSUKITEAM-TSHIRT-XXL", true)
  });
  const main = document.getElementById("main-content");
  const header = document.getElementById("site-header");
  const footer = document.getElementById("site-footer");
  const drawer = document.getElementById("quote-drawer");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");
  const PREVIEW_MODE = Boolean(CONFIG.previewMode || document.body.dataset.preview === "true");
  const mediaById = new Map(DATA.media.map(item => [Number(item.id), item]));
  const BRAND_LOGOS = Object.freeze({
    "KW Suspension": ["assets/brand/partners/kw-suspension.png"],
    "Nitron Suspension": ["assets/brand/partners/nitron-suspension.png"],
    "Essex Brakes / AP Racing": ["assets/brand/partners/essex-brakes.png", "assets/brand/partners/ap-racing.png"],
    "Ferodo Racing": ["assets/brand/partners/ferodo-racing.png"],
    "Pagid Racing": ["assets/brand/partners/pagid-racing.png"],
    "Verkline": ["assets/brand/partners/verkline.png"],
    "CSF Cooling": ["assets/brand/partners/csf-cooling.svg"],
    "Verus Engineering": ["assets/brand/partners/verus-engineering.png"],
    "Tegiwa Motorsports": ["assets/brand/partners/tegiwa-motorsports.webp"],
    "Titan Motorsports": ["assets/brand/partners/titan-motorsports.png"],
    "Brian Tooley Racing": ["assets/brand/partners/brian-tooley-racing.svg"],
    "Summit Racing": ["assets/brand/partners/summit-racing.png"],
    "Tick Performance": ["assets/brand/partners/tick-performance.png"],
    "ST Track Parts": ["assets/brand/partners/st-track-parts.png"],
    "Urge Designs / Urge Products": ["assets/brand/partners/urge-products.ico"],
    "GKTech USA": ["assets/brand/partners/gktech.png"],
    "DriftHQ": ["assets/brand/partners/drifthq.png"],
    "AMS Performance": ["assets/brand/partners/ams-performance.png"],
    "MHD Tuning": ["assets/brand/partners/mhd-tuning.png"],
    "xHP Flashtool": ["assets/brand/partners/xhp-flashtool.png"],
    "Motion Raceworks": ["assets/brand/partners/motion-raceworks.png"],
    "ECS Tuning": ["assets/brand/partners/ecs-tuning.png"],
    "FCP Euro": ["assets/brand/partners/fcp-euro.png"],
    "Vivid Racing": ["assets/brand/partners/vivid-racing.png"],
    "Hardrace": ["assets/brand/partners/hardrace.png"],
    "EcuTek": ["assets/brand/partners/ecutek.png"],
    "COBB Tuning": ["assets/brand/partners/cobb-tuning.png"],
    "Brian Crower": ["assets/brand/partners/brian-crower.png"],
    "Custom Cages": ["assets/brand/partners/custom-cages.png"],
    "Low Dollar Motorsports": ["assets/brand/partners/low-dollar-motorsports.png"],
    "do88 Performance": ["assets/brand/partners/do88-performance.png"],
    "TooHighPsi": ["assets/brand/partners/toohighpsi.png"],
    "Z1 Motorsports": ["assets/brand/partners/z1-motorsports.png"],
    "TTH Turbolader": ["assets/brand/partners/tth-turbolader.png"],
    "KPower Industries": ["assets/brand/partners/kpower-industries.png"],
    "Apex Wheels": ["assets/brand/partners/apex-wheels.png"],
    "Pure Turbos": ["assets/brand/partners/pure-turbos.png"],
    "KLM Race": ["assets/brand/partners/klm-race.png"],
    "HP Tuners": ["assets/brand/partners/hp-tuners.png"],
    "MoTeC": ["assets/brand/partners/motec.png"],
    "Link ECU": ["assets/brand/partners/link-ecu.png"],
    "Haltech": ["assets/brand/partners/haltech.png"],
    "MaxxECU": ["assets/brand/partners/maxxecu.png"],
    "Holley EFI": ["assets/brand/partners/holley-efi.png"],
    "\u00d6hlins": ["assets/brand/partners/ohlins.png"],
    "BimmerWorld": ["assets/brand/partners/bimmerworld.png"]
  });

  const memoryStore = Object.create(null);
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return memoryStore[key] ?? null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { memoryStore[key] = value; } },
    remove(key) { try { localStorage.removeItem(key); } catch { delete memoryStore[key]; } }
  };

  function safeParse(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }

  function normalizeQuote(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(item => item && typeof item === "object").map(item => ({
      ...item,
      sku: cleanText(item.sku || "", 120),
      quantity: Math.min(99, Math.max(1, Number.parseInt(item.quantity, 10) || 1))
    }));
  }

  function commerceProduct(slug) {
    const productId = cleanText(slug || "", 180);
    const reviewedProduct = (DATA.storeProducts || []).find(product => product.slug === productId);
    if (reviewedProduct) return reviewedProduct;
    const policy = DIRECT_CART_POLICY[productId];
    if (!policy?.sourceHandle || !policy?.image?.src || !policy?.sku) return null;
    return {
      slug: policy.productId,
      sourceHandle: policy.sourceHandle,
      title: policy.title,
      titleAr: policy.titleAr || policy.title,
      summary: "Official Tegiwa apparel variant selected from the supplier product listing.",
      summaryAr: "خيار ملابس رسمي من تيجـيوا تم اختياره من صفحة المنتج لدى المورد.",
      brand: "Tegiwa",
      category: "T-Shirts",
      categoryAr: "قمصان",
      sku: policy.sku,
      mpn: policy.sku,
      quoteOnly: false,
      priceCurrency: policy.currency,
      priceAmount: policy.unitAmount,
      priceVerifiedAt: policy.priceVerifiedAt,
      stockPolicy: "manual-confirm",
      checkedAt: policy.availabilityVerifiedAt || policy.priceVerifiedAt,
      staleAfterDays: policy.maxAvailabilityAgeDays || policy.maxPriceAgeDays,
      status: policy.supplierAvailable === false ? "Supplier availability requires confirmation" : "Available from supplier",
      statusAr: policy.supplierAvailable === false ? "يجب تأكيد التوفر لدى المورد" : "متوفر لدى المورد",
      images: [{ ...policy.image }]
    };
  }

  function commercePolicy(product) {
    return product ? DIRECT_CART_POLICY[product.slug] || null : null;
  }

  function commercePriceIsFresh(product, policy = commercePolicy(product), now = Date.now()) {
    if (!product || !policy || product.quoteOnly) return false;
    const verifiedDate = String(product.priceVerifiedAt || "");
    const verifiedDayStarts = /^\d{4}-\d{2}-\d{2}$/.test(verifiedDate)
      ? Date.parse(`${verifiedDate}T00:00:00.000Z`)
      : NaN;
    const verifiedAt = /^\d{4}-\d{2}-\d{2}$/.test(verifiedDate)
      ? Date.parse(`${verifiedDate}T23:59:59.999Z`)
      : NaN;
    const maxAgeDays = Math.min(30, Math.max(1, Number(policy.maxPriceAgeDays) || 7));
    return Number.isFinite(verifiedAt)
      && Number.isFinite(verifiedDayStarts)
      && now >= verifiedDayStarts - 5 * 60_000
      && now - verifiedAt <= maxAgeDays * 86_400_000;
  }

  function commerceAvailabilityIsFresh(policy, now = Date.now()) {
    if (!policy?.availabilityVerifiedAt) return true;
    const verifiedDate = String(policy.availabilityVerifiedAt || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedDate)) return false;
    const verifiedDayStarts = Date.parse(`${verifiedDate}T00:00:00.000Z`);
    const verifiedAt = Date.parse(`${verifiedDate}T23:59:59.999Z`);
    const maxAgeDays = Math.min(30, Math.max(1, Number(policy.maxAvailabilityAgeDays) || 7));
    return Number.isFinite(verifiedAt)
      && Number.isFinite(verifiedDayStarts)
      && now >= verifiedDayStarts - 5 * 60_000
      && now - verifiedAt <= maxAgeDays * 86_400_000;
  }

  function productCanEnterCart(product) {
    const policy = commercePolicy(product);
    return Boolean(
      policy
      && commercePriceIsFresh(product, policy)
      && commerceAvailabilityIsFresh(policy)
      && cleanText(product.sku || "", 120) === policy.sku
      && String(product.priceCurrency || "").toUpperCase() === policy.currency
      && Math.abs(Number(product.priceAmount) - policy.unitAmount) < 0.001
      && product.images?.[0]?.src
    );
  }

  function tegiwaSourceHandle(product) {
    const publicHandle = tegiwaProductHandle(product?.handle);
    if (!publicHandle?.startsWith("tegiwa-")) return "";
    return tegiwaProductHandle(publicHandle.slice("tegiwa-".length));
  }

  function liveTegiwaCommerceObservation(product, now = Date.now()) {
    const observation = product?.commerceObservation;
    if (!observation || observation.source !== "official_tegiwa_product_detail" || observation.paymentEligible !== false) return null;
    const observedAt = Date.parse(String(observation.observedAt || ""));
    const expiresAt = Date.parse(String(observation.expiresAt || ""));
    if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || expiresAt <= observedAt) return null;
    if (now < observedAt - 5 * 60_000 || now >= expiresAt) return null;
    if (String(observation.priceCurrency || "").toUpperCase() !== "GBP") return null;
    return { observedAt: new Date(observedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
  }

  function supplierCartImage(image, fallbackTitle = "") {
    const source = cleanText(image?.src || image?.url || "", 1_000);
    if (!source) return null;
    let safeSource = "";
    if (/^\/?assets\/products\/[a-z0-9/_~.-]+(?:\?[a-z0-9=&._-]+)?$/i.test(source)) safeSource = source.replace(/^\//, "");
    else {
      try {
        const url = new URL(source);
        if (url.protocol === "https:" && !url.username && !url.password
            && ["cdn.shopify.com", "www.tegiwa.com", "tegiwa.com", "assets.ecstuning.com"].includes(url.hostname)) {
          safeSource = url.href;
        }
      } catch { /* Invalid supplier media is rejected. */ }
    }
    if (!safeSource) return null;
    return {
      src: safeSource,
      width: Math.max(1, Math.min(4_000, Number(image?.width) || 900)),
      height: Math.max(1, Math.min(4_000, Number(image?.height) || 900)),
      alt: cleanText(image?.alt || fallbackTitle, 220),
      altAr: cleanText(image?.altAr || "", 220)
    };
  }

  function tegiwaCatalogueCartSelection(product, variant = null, now = Date.now()) {
    const observation = liveTegiwaCommerceObservation(product, now);
    const sourceHandle = tegiwaSourceHandle(product);
    if (!observation || !sourceHandle || cleanText(product?.supplier?.slug || "", 80).toLowerCase() !== "tegiwa") return null;
    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    if (hasVariants && !variant) return null;
    const sku = cleanText(variant?.sku || (!hasVariants ? product.sku : "") || "", 120);
    const currency = String(variant?.price?.currency || product?.price?.currency || "").toUpperCase();
    const minimum = Number(variant ? variant?.price?.amount : product?.price?.min);
    const maximum = Number(variant ? variant?.price?.amount : product?.price?.max);
    const image = supplierCartImage(product?.images?.[0] || product?.image, product?.title);
    if (!sku || currency !== "GBP" || !Number.isFinite(minimum) || minimum <= 0 || minimum > 10_000_000) return null;
    if (!Number.isFinite(maximum) || Math.abs(maximum - minimum) > 0.001 || product?.price?.startingAt === true || !image) return null;
    const optionTitle = cleanText(variant?.title || (!hasVariants ? "" : storeText().tegiwaProductDetails), 200);
    const category = cleanText(product?.category || "", 160);
    const fitmentConfirmationRequired = !/^(?:t-shirts?|clothing|apparel|merchandise)$/i.test(category);
    const productId = cleanText(variant?.cartProductId || "", 100);
    if (!/^tegiwa-live-[A-Za-z0-9_-]{24}$/.test(productId)) return null;
    return {
      kind: "supplier_catalogue",
      id: `catalogue:tegiwa:${sourceHandle}:${sku}`,
      productId,
      sourceHandle,
      supplier: { ...TEGIWA_GB_SUPPLIER },
      sku,
      variantId: sku,
      title: cleanText(product?.title || sku, 300),
      titleAr: cleanText(product?.titleAr || "", 300),
      optionTitle,
      brand: cleanText(product?.vendor || product?.supplier?.name || "Tegiwa", 160),
      category,
      image,
      quantity: 1,
      unitAmount: Math.round(minimum * 100) / 100,
      currency,
      observedAt: observation.observedAt,
      quoteExpiresAt: observation.expiresAt,
      availabilityObserved: variant ? variant.available === true : product?.availability?.code !== "out_of_stock",
      availabilityConfirmationRequired: true,
      fitmentConfirmationRequired,
      purchaseMode: "availability-confirmation-required",
      paymentEligible: false
    };
  }

  function ecsCatalogueCartSelection(product, now = Date.now()) {
    const commerce = product?.commerce;
    const supplier = cleanText(product?.supplier?.slug || "", 80).toLowerCase();
    const productId = cleanText(commerce?.productId || "", 180);
    const sourceHandle = tegiwaProductHandle(product?.handle);
    const sku = cleanText(commerce?.sku || "", 40);
    const expiresAt = Date.parse(String(commerce?.expiresAt || ""));
    const observedAtSource = String(commerce?.availability?.observedAt || "");
    const observedAt = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(observedAtSource)
      ? `${observedAtSource}T00:00:00.000Z` : observedAtSource);
    const amount = Number(commerce?.price?.amount);
    const image = supplierCartImage(commerce?.image || product?.images?.[0] || product?.image, product?.title);
    if (supplier !== "ecs" || commerce?.eligible !== true || commerce?.mode !== "confirmation-cart"
        || commerce?.paymentAllowed !== false || !productId || !sourceHandle || productId !== sourceHandle
        || !/^ES#\d{3,12}$/.test(sku) || String(commerce?.price?.currency || "") !== "USD"
        || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(observedAt)
        || !Number.isFinite(expiresAt) || now < observedAt - 5 * 60_000 || now > expiresAt || !image) return null;
    return {
      kind: "supplier_catalogue",
      id: `catalogue:ecs:${productId}:${sku}`,
      productId,
      sourceHandle,
      supplier: { ...ECS_US_SUPPLIER },
      sku,
      variantId: sku,
      title: cleanText(commerce.title || product?.title || sku, 300),
      titleAr: cleanText(product?.titleAr || "", 300),
      optionTitle: "",
      brand: cleanText(product?.vendor || "ECS Tuning", 160),
      category: cleanText(product?.category || "", 160),
      image,
      quantity: 1,
      unitAmount: Math.round(amount * 100) / 100,
      currency: "USD",
      observedAt: new Date(observedAt).toISOString(),
      quoteExpiresAt: new Date(expiresAt).toISOString(),
      availabilityObserved: true,
      availabilityConfirmationRequired: true,
      fitmentConfirmationRequired: true,
      purchaseMode: "fitment-confirmation-required",
      paymentEligible: false
    };
  }

  function supplierCatalogueCartSelection(product, variant = null, now = Date.now()) {
    const supplier = cleanText(product?.supplier?.slug || "", 80).toLowerCase();
    if (supplier === "tegiwa") return tegiwaCatalogueCartSelection(product, variant, now);
    if (supplier === "ecs" && !variant) return ecsCatalogueCartSelection(product, now);
    return null;
  }

  function catalogueSourceHandle(product) {
    return cleanText(product?.supplier?.slug || "", 80).toLowerCase() === "tegiwa"
      ? tegiwaSourceHandle(product)
      : tegiwaProductHandle(product?.handle);
  }

  function normalizeSupplierCatalogueCartItem(value, quantity = value?.quantity, now = Date.now()) {
    if (!value || value.kind !== "supplier_catalogue") return null;
    const supplierSlug = cleanText(value.supplier?.slug || "", 80).toLowerCase();
    const sourceHandle = tegiwaProductHandle(value.sourceHandle);
    const productId = cleanText(value.productId || "", 280);
    const sku = cleanText(value.sku || "", 120);
    const observedAt = Date.parse(String(value.observedAt || ""));
    const unitAmount = Number(value.unitAmount);
    const image = supplierCartImage(value.image, value.title);
    const tegiwaItem = supplierSlug === "tegiwa" && /^tegiwa-live-[A-Za-z0-9_-]{24}$/.test(productId);
    const ecsItem = supplierSlug === "ecs" && productId === sourceHandle && /^ecs-[a-z0-9_-]+$/.test(productId) && /^ES#\d{3,12}$/.test(sku);
    if ((!tegiwaItem && !ecsItem) || !sourceHandle || !sku || !image) return null;
    if (!Number.isFinite(observedAt) || now < observedAt - 5 * 60_000) return null;
    if (ecsItem) {
      const expiresAt = Date.parse(String(value.quoteExpiresAt || ""));
      if (!Number.isFinite(expiresAt) || expiresAt < observedAt || now > expiresAt) return null;
    } else if (now - observedAt > 7 * 86_400_000) return null;
    const currency = String(value.currency || "").toUpperCase();
    if (currency !== (tegiwaItem ? "GBP" : "USD") || !Number.isFinite(unitAmount) || unitAmount <= 0 || unitAmount > 10_000_000) return null;
    const normalizedQuantity = Math.min(99, Math.max(1, Number.parseInt(quantity, 10) || 1));
    return {
      kind: "supplier_catalogue",
      id: `catalogue:${supplierSlug}:${sourceHandle}:${sku}`,
      productId,
      sourceHandle,
      supplier: { ...(tegiwaItem ? TEGIWA_GB_SUPPLIER : ECS_US_SUPPLIER) },
      sku,
      variantId: cleanText(value.variantId || sku, 120) || sku,
      title: cleanText(value.title || sku, 300),
      titleAr: cleanText(value.titleAr || "", 300),
      optionTitle: cleanText(value.optionTitle || "", 200),
      brand: cleanText(value.brand || "Tegiwa", 160),
      category: cleanText(value.category || "", 160),
      image,
      quantity: normalizedQuantity,
      unitAmount: Math.round(unitAmount * 100) / 100,
      currency,
      observedAt: new Date(observedAt).toISOString(),
      quoteExpiresAt: cleanText(value.quoteExpiresAt || "", 40),
      availabilityObserved: value.availabilityObserved === true,
      availabilityConfirmationRequired: true,
      fitmentConfirmationRequired: value.fitmentConfirmationRequired === true,
      purchaseMode: ecsItem ? "fitment-confirmation-required" : "availability-confirmation-required",
      paymentEligible: false
    };
  }

  function registerCatalogueCartSelection(selection) {
    const normalized = normalizeSupplierCatalogueCartItem(selection);
    if (!normalized) return "";
    state.catalogueCartSelections.delete(normalized.id);
    state.catalogueCartSelections.set(normalized.id, normalized);
    while (state.catalogueCartSelections.size > 100) {
      state.catalogueCartSelections.delete(state.catalogueCartSelections.keys().next().value);
    }
    return normalized.id;
  }

  function canonicalCartItem(product, quantity = 1) {
    const policy = commercePolicy(product);
    if (!productCanEnterCart(product) || !policy) return null;
    return {
      id: `product-${product.slug}`,
      productId: product.slug,
      sourceHandle: policy.sourceHandle || product.slug,
      sku: policy.sku,
      variantId: policy.variantId || policy.sku,
      quantity: Math.min(99, Math.max(1, Number.parseInt(quantity, 10) || 1)),
      unitAmount: policy.unitAmount,
      currency: policy.currency,
      priceVerifiedAt: policy.priceVerifiedAt,
      fitmentConfirmationRequired: Boolean(policy.fitmentConfirmationRequired),
      supplier: policy.supplier ? { ...policy.supplier } : null
    };
  }

  function cartLineIdentity(item) {
    const supplier = cleanText(item?.supplier?.slug || "", 80).toLowerCase();
    const handle = tegiwaProductHandle(item?.sourceHandle || item?.productId);
    const sku = cleanText(item?.sku || "", 120).toUpperCase();
    return supplier && handle && sku ? `${supplier}\u0000${handle}\u0000${sku}` : cleanText(item?.id || "", 600);
  }

  function normalizeCart(items) {
    if (!Array.isArray(items)) return [];
    const normalized = new Map();
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const supplierCatalogueItem = normalizeSupplierCatalogueCartItem(item);
      if (supplierCatalogueItem) {
        const identity = cartLineIdentity(supplierCatalogueItem);
        const previous = normalized.get(identity);
        if (previous) normalized.set(identity, {
          ...supplierCatalogueItem,
          quantity: Math.min(99, previous.quantity + supplierCatalogueItem.quantity)
        });
        else if (normalized.size < MAX_CART_LINES) normalized.set(identity, supplierCatalogueItem);
        continue;
      }
      const product = commerceProduct(cleanText(item.productId || "", 180));
      const canonical = canonicalCartItem(product, item.quantity);
      if (!canonical) continue;
      const identity = cartLineIdentity(canonical);
      const previous = normalized.get(identity);
      if (previous) previous.quantity = Math.min(99, previous.quantity + canonical.quantity);
      else if (normalized.size < MAX_CART_LINES) normalized.set(identity, canonical);
    }
    return [...normalized.values()];
  }

  function normalizePartsVehicle(vehicle) {
    if (!vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)) return null;
    const year = cleanText(vehicle.year || "", 4);
    return { ...vehicle, year: partsModelYears().includes(year) ? year : "" };
  }

  const state = {
    locale: document.body.dataset.locale === "ar" ? "ar" : "en",
    route: normalizeRoute(document.body.dataset.route || "/"),
    quote: normalizeQuote(safeParse(storage.get("projxQuote"), [])),
    cart: normalizeCart(safeParse(storage.get(CART_STORAGE_KEY), [])),
    partsVehicle: normalizePartsVehicle(safeParse(storage.get("projxPartsVehicle"), null)),
    checkoutSubmitting: false,
    shippingEstimate: null,
    shippingEstimateStatus: "idle",
    shippingEstimateError: "",
    shippingEstimateController: null,
    shippingEstimateTimer: null,
    shippingEstimateRequestId: 0,
    shippingSelections: Object.create(null),
    shippingRevalidationStatus: "idle",
    shippingRevalidationError: "",
    shippingAdminStatus: "idle",
    catalogueCartSelections: new Map(),
    mobileOpen: false,
    lightbox: null,
    galleries: Object.create(null),
    formContext: null,
    mapLoaded: false,
    tegiwaCatalog: {
      currentPage: 1,
      totalPages: 1,
      pageSize: 100,
      query: "",
      canonicalQuery: "",
      sort: "relevance",
      availability: "all",
      pricing: "all",
      match: "any",
      supplier: "",
      brand: "",
      partType: "",
      currency: "",
      fitment: "all",
      backend: "unified",
      partialCatalogue: false,
      catalogueSource: "",
      fallbackReason: "",
      sortScope: "",
      catalogProductCount: null,
      availableProductCount: null,
      controller: null,
      detailController: null,
      detailHandle: "",
      suggestionController: null,
      suggestionTimer: null,
      suggestionCache: new Map(),
      suggestionComposing: false,
      activeSuggestion: -1,
      lastRequest: {}
    },
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
  function storeText() {
    return state.locale === "ar" ? {
      configuredPackage: "باقة يتم تحديدها حسب السيارة",
      verifiedProducts: "منتجات كتالوج تمت مراجعتها",
      verifiedProductsText: "ما ننشر المنتج إلا بعد مراجعة هويته وصورته المصرح بها ونطاق التوافق والسعر. يظهر السعر بعملة المورد الأصلية بشكل واضح، وإلا يكون السعر حسب الطلب.",
      cataloguePending: "كتالوج المنتجات قيد المراجعة",
      cataloguePendingText: "حالياً تعرض الصفحة باقات Projx Racing المؤكدة. ما راح ننشر منتج أو سعر أو صورة من مورد قبل التحقق من حقوق الاستخدام وبيانات القطعة.",
      requestPrice: "اطلب السعر",
      startingAt: "ابتداءً من",
      supplierImageUnavailable: "لم يوفّر المورد صورة خاصة بهذا المنتج",
      viewDetails: "شوف التفاصيل",
      contextImage: "صورة من أعمال الورشة للتوضيح — القطع النهائية تعتمد على عرض السعر",
      fitment: "التوافق",
      confirmFitment: "يتطلب تأكيد التوافق",
      universalConfirm: "عام — يتطلب تأكيد التطبيق",
      generation: "الجيل / الشاصي",
      chooseModel: "اختر الموديل",
      chooseGeneration: "اختر الجيل / الشاصي",
      chooseEngine: "اختر المحرك",
      supplierDirectoryGeneration: "مدرج في دليل المورد",
      supplierConfirmEngine: "تأكيد المحرك",
      selectedVehicleMatch: "تطابق محتمل مع السيارة المحفوظة",
      allFitment: "كل حالات التوافق",
      possibleMatches: "تطبيقات محتملة لسيارتي",
      exactMatch: "تطابق دقيق",
      possibleMatch: "تطابق محتمل — يتطلب التأكيد",
      filterFitment: "دقة التوافق",
      exactMatches: "تطابق دقيق فقط",
      possibleMatchesOnly: "تطابق محتمل فقط",
      availability: "التوفر / الحالة",
      allAvailability: "كل حالات التوفر",
      pricing: "التسعير",
      price: "السعر",
      startingAt: "ابتداءً من",
      supplier: "المورد",
      allSuppliers: "كل الموردين",
      filterBrand: "العلامة",
      allBrands: "كل العلامات",
      filterPartType: "نوع القطعة",
      allPartTypes: "كل أنواع القطع",
      currency: "العملة",
      allCurrencies: "كل العملات",
      skuMpn: "رقم القطعة / MPN",
      ecsPartNumber: "رقم قطعة ECS",
      supplierListing: "حالة المورد عند المراجعة",
      originalListing: "صفحة المنتج الأصلية",
      lastChecked: "آخر مراجعة يدوية",
      manualStockNotice: "لا يوفر المورد Stockfeed مباشر. يتم تأكيد التوفر والمدة والسعر مرة ثانية قبل اعتماد الطلب.",
      manualStockStale: "انتهت صلاحية المراجعة اليدوية — يلزم إعادة التأكيد",
      allPricing: "كل حالات التسعير",
      usdPrice: "سعر منشور",
      quoteOnly: "السعر حسب الطلب",
      sort: "الترتيب",
      featured: "المميز أولاً",
      nameAsc: "الاسم: أ–ي",
      categoryAsc: "الفئة",
      brandAsc: "العلامة",
      productType: "النوع",
      noSku: "لا يوجد SKU ثابت — يتم تحديد القطع في عرض السعر",
      quantity: "الكمية",
      addToQuote: "أضف لطلب السعر",
      shippingQuote: "اطلب سعر الشحن",
      shippingHeading: "الشحن بعد مراجعة الوجهة والقطعة",
      shippingText: "يتم تأكيد شركة الشحن والمدة والرسوم بعد مراجعة الوزن والأبعاد والوجهة والجمارك. الموقع ما يعرض أسعار شحن تقديرية غير مؤكدة.",
      destinationCountry: "دولة التسليم",
      destinationCity: "المدينة",
      postcode: "الرمز البريدي",
      fulfilment: "طريقة الاستلام",
      courier: "شحن إلى العنوان",
      workshop: "استلام أو تركيب في الورشة",
      vin: "VIN عند الحاجة",
      decrease: "تقليل الكمية",
      increase: "زيادة الكمية",
      items: "قطع",
      packageDetails: "تفاصيل الباقة",
      includedReview: "ما تتم الموافقة عليه بعد المراجعة",
      fitmentDirectoryNote: "القائمة تشمل 37 علامة و418 خيار موديل/جيل من دليل المورد. اختيار السيارة يساعد بالمراجعة ولا يعتبر تأكيد تركيب، ويجب تأكيد المحرك والتوافق النهائي.",
      exactProductRule: "كل منتج يحتاج صورة مطابقة ومصرح بها ورقم قطعة ونطاق توافق، مع سعر موثق بعملة المورد الأصلية أو حالة سعر حسب الطلب.",
      shopByPart: "تصفح حسب نوع القطعة",
      shopByPartText: "اختر نوع القطعة للبحث مباشرة في كتالوج المورد",
      partDirectoryEyebrow: "دليل أنواع القطع",
      partDirectoryHeading: "دور القطعة حسب نوعها.",
      partDirectoryText: "اختر الفئة أو نوع القطعة علشان نبحث مباشرة في كتالوج المورد. النتائج تساعدك بالتصفح، والتوفر والتوافق والسعر النهائي يحتاجون تأكيد من Projx Racing.",
      partDirectoryNote: "هذا دليل بحث، وليس قائمة تأكيد بأن كل فئة متوفرة حالياً.",
      partDirectoryLabel: "دليل البحث حسب نوع القطعة",
      partDirectorySearch: "ابحث في الكتالوج عن {term}",
      partDirectoryExpand: "افتح قسم {term}",
      partDirectoryCollapse: "أغلق قسم {term}",
      partDirectoryViewAll: "عرض الكل",
      reviewedItemsEyebrow: "قطع مختارة ومراجعة",
      reviewedItemsHeading: "منتجات مراجعة وباقات مجهزة.",
      reviewedItemsText: "تصفح منتجات الموردين التي راجعها فريق Projx Racing وباقات الأداء المجهزة. استخدم الفلاتر للوصول للقطعة المطلوبة بسرعة.",
      tegiwaEyebrow: "كتالوج القطع المباشر",
      tegiwaHeading: "تصفح كتالوج القطع.",
      tegiwaText: "ابحث باسم القطعة أو العلامة أو السيارة أو المحرك أو رقم القطعة، أو تصفح المنتجات بالتدريج. يجمع هذا القسم الكتالوج المباشر مع منتجات الموردين المراجعة وباقات Projx Racing في مكان واحد.",
      tegiwaSearchLabel: "ابحث في المنتجات",
      tegiwaSearchPlaceholder: "اسم القطعة، العلامة، السيارة، المحرك أو رقم القطعة",
      tegiwaSearchAction: "بحث",
      tegiwaBrowseAction: "عرض الكتالوج",
      tegiwaSourceNote: "تعرض الأسعار بعملة المورد الأصلية من دون تحويل تلقائي أو إضافة ضريبة. حالة المخزون تعكس آخر بيانات متاحة من المورد؛ يؤكد Projx Racing الخيار والسعر النهائي والتوافق والشحن ورسوم الكويت قبل الطلب.",
      catalogueFallback: "الكتالوج الكامل متعدد الموردين غير متاح مؤقتاً. المعروض حالياً هو كتالوج المورد الاحتياطي، ويمكن طلب أي قطعة أخرى من خلال نموذج الاستفسار.",
      cataloguePartial: "نعرض حالياً القطع المحلية المراجعة مع بيانات المورد المتاحة. الكتالوج الكامل غير متاح مؤقتاً؛ يؤكد Projx Racing السعر والتوفر والتوافق قبل الطلب.",
      tegiwaVehicleActive: "الكتالوج المباشر مفلتر لسيارتك",
      tegiwaVehicleText: "نعرض المطابقات المحتملة فقط. Projx Racing يؤكد التوافق الدقيق قبل الطلب.",
      tegiwaLoading: "جاري تحميل منتجات الكتالوج…",
      tegiwaLoadError: "تعذر تحميل كتالوج القطع حالياً.",
      tegiwaRetry: "حاول مرة ثانية",
      tegiwaNext: "المنتجات التالية",
      tegiwaPrevious: "المنتجات السابقة",
      tegiwaReset: "الرجوع لبداية الكتالوج",
      tegiwaNoResults: "ما لقينا منتجات مطابقة. جرّب اسم قطعة أو علامة أو سيارة بشكل أدق.",
      tegiwaResults: "منتجات ظاهرة",
      tegiwaSearchResults: "نتيجة مطابقة",
      tegiwaSearchRange: "عرض {start}–{end} من {total} نتيجة لـ «{query}»",
      tegiwaSortFilter: "ترتيب وتصفية",
      tegiwaFilterPanelLabel: "خيارات ترتيب وتصفية نتائج البحث",
      tegiwaActiveFilters: "{count} مفعّلة",
      tegiwaSort: "الترتيب",
      tegiwaSortRelevance: "الأكثر صلة",
      tegiwaSortNameAsc: "الاسم: أ–ي",
      tegiwaSortNameDesc: "الاسم: ي–أ",
      tegiwaSortPriceAsc: "السعر: من الأقل إلى الأعلى",
      tegiwaSortPriceDesc: "السعر: من الأعلى إلى الأقل",
      tegiwaSortSupplierOrder: "ترتيب كتالوج كل مورد",
      tegiwaSortNameAscSupplier: "الاسم أ–ي داخل كل مورد",
      tegiwaSortNameDescSupplier: "الاسم ي–أ داخل كل مورد",
      tegiwaSortPriceAscSupplier: "السعر تصاعدياً داخل عملة كل مورد",
      tegiwaSortPriceDescSupplier: "السعر تنازلياً داخل عملة كل مورد",
      tegiwaMixedSortNote: "تُجمع نتائج الموردين حسب المورد، ويُطبق الترتيب داخل كل مجموعة. لا تتم مقارنة أو تحويل أسعار USD وGBP.",
      tegiwaFilterAvailability: "التوفر",
      tegiwaAvailabilityAll: "كل حالات المخزون",
      tegiwaAvailabilityAvailable: "أي منتج متوفر",
      tegiwaAvailabilityInStock: "متوفر في المخزون",
      tegiwaAvailabilitySupplierStock: "متوفر عند المورد",
      tegiwaAvailabilityCheck: "يتطلب التأكيد",
      tegiwaAvailabilityUnavailable: "غير متوفر",
      tegiwaFilterPricing: "السعر",
      tegiwaPricingAll: "كل الأسعار",
      tegiwaPricingPriced: "بسعر معلن",
      tegiwaPricingRequest: "اطلب السعر",
      tegiwaClearFilters: "مسح الفلاتر",
      tegiwaSearchSuggestions: "اقتراحات البحث",
      tegiwaDidYouMean: "هل تقصد «{query}»؟",
      tegiwaSearchAll: "ابحث في جميع المنتجات عن «{query}»",
      tegiwaCorrectedSearch: "تم تصحيح البحث من «{from}» إلى «{to}».",
      tegiwaSearchEquivalent: "ابحث في كتالوج المورد عن «{query}»",
      tegiwaTranslatedSearch: "تمت مطابقة «{from}» مع مصطلح الكتالوج «{to}».",
      tegiwaPaginationLabel: "صفحات كتالوج القطع",
      tegiwaPageOf: "الصفحة {page} من {total}",
      tegiwaGoToPage: "انتقل إلى الصفحة {page}",
      tegiwaShowingRange: "عرض {start}–{end} من {total} منتج",
      tegiwaCatalogCount: "منتج موثّق في الكتالوج",
      tegiwaAvailableCount: "منتج عليه توفر مؤكد أو من المورد",
      tegiwaViewProduct: "شوف المنتج",
      tegiwaSupplierListing: "صفحة المنتج الأصلية",
      tegiwaProductDetails: "تفاصيل المنتج",
      tegiwaDescription: "الوصف",
      tegiwaVariants: "الخيارات",
      tegiwaSelectedOption: "الخيار المحدد",
      tegiwaChooseVariant: "اختر خياراً لتحديث السعر والتوفر قبل الإضافة لطلب السعر.",
      tegiwaChooseVariantForCart: "اختر الخيار أولاً لتأكيد رقم المنتج والسعر والتوفر قبل الإضافة إلى السلة.",
      tegiwaOnlinePrice: "سعر المورد بالعملة الأصلية",
      tegiwaChecked: "تم فحص المخزون",
      tegiwaPriceNote: "السعر معروض بعملة المورد الأصلية من دون تحويل تلقائي أو إضافة ضريبة. يؤكد Projx Racing السعر النهائي والشحن ورسوم الكويت قبل الطلب.",
      tegiwaInStock: "بعض الخيارات متوفرة في مخزون المورد",
      tegiwaSupplierStock: "بعض الخيارات متوفرة عند المورد",
      tegiwaCheckAvailability: "يتطلب تأكيد التوفر",
      tegiwaStockStale: "تحديث المخزون قديم — يرجى تأكيد التوفر",
      tegiwaOutOfStock: "غير متوفر حالياً",
      tegiwaVariantAvailable: "متاح للطلب",
      tegiwaVariantUnavailable: "يحتاج تأكيد",
      tegiwaNoImage: "لا توجد صورة للمنتج",
      originalSupplierListing: "صفحة المورد الأصلية"
    } : {
      configuredPackage: "Vehicle-configured package",
      verifiedProducts: "Reviewed catalogue products",
      verifiedProductsText: "Products are published only after identity, authorised imagery, fitment scope and price are reviewed. Prices remain in the supplier's verified original currency; otherwise the item remains Request price.",
      cataloguePending: "Verified product catalogue under review",
      cataloguePendingText: "The current store shows confirmed Projx Racing quote packages. Supplier products, prices and images will not be published until use rights and item records are verified.",
      requestPrice: "Request price",
      startingAt: "From",
      supplierImageUnavailable: "Supplier-specific product image unavailable",
      viewDetails: "View details",
      contextImage: "Workshop context image — final components are confirmed in the quotation",
      fitment: "Fitment",
      confirmFitment: "Fitment confirmation required",
      universalConfirm: "Universal — application confirmation required",
      generation: "Generation / chassis",
      chooseModel: "Choose model",
      chooseGeneration: "Choose generation / chassis",
      chooseEngine: "Choose engine",
      supplierDirectoryGeneration: "Supplier-listed model / year",
      supplierConfirmEngine: "Confirm engine",
      selectedVehicleMatch: "Possible match for saved vehicle",
      allFitment: "All fitment states",
      possibleMatches: "Possible matches for my vehicle",
      exactMatch: "Exact match",
      possibleMatch: "Possible match — confirm before order",
      filterFitment: "Fitment confidence",
      exactMatches: "Exact matches only",
      possibleMatchesOnly: "Possible matches only",
      availability: "Availability / status",
      allAvailability: "All availability states",
      pricing: "Pricing",
      price: "Price",
      startingAt: "From",
      supplier: "Supplier",
      allSuppliers: "All suppliers",
      filterBrand: "Brand",
      allBrands: "All brands",
      filterPartType: "Part type",
      allPartTypes: "All part types",
      currency: "Currency",
      allCurrencies: "All currencies",
      skuMpn: "SKU / MPN",
      ecsPartNumber: "ECS Part #",
      supplierListing: "Supplier listing when checked",
      originalListing: "Original product listing",
      lastChecked: "Last manually checked",
      manualStockNotice: "This supplier does not provide a live stockfeed. Availability, lead time and price are reconfirmed before an order is accepted.",
      manualStockStale: "Manual review expired — reconfirmation required",
      allPricing: "All pricing states",
      usdPrice: "Published price",
      quoteOnly: "Request price",
      sort: "Sort",
      featured: "Featured",
      nameAsc: "Name: A–Z",
      categoryAsc: "Category",
      brandAsc: "Brand",
      productType: "Type",
      noSku: "No fixed SKU — components are specified in the quotation",
      quantity: "Quantity",
      addToQuote: "Add to quote",
      shippingQuote: "Request shipping quote",
      shippingHeading: "Shipping is quoted after destination and item review",
      shippingText: "Carrier, transit time, duties and charges are confirmed after weight, dimensions, destination and customs requirements are reviewed. The site does not show invented shipping rates.",
      destinationCountry: "Destination country",
      destinationCity: "City",
      postcode: "Postcode",
      fulfilment: "Fulfilment",
      courier: "Courier delivery",
      workshop: "Workshop collection or installation",
      vin: "VIN when required",
      decrease: "Decrease quantity",
      increase: "Increase quantity",
      items: "items",
      packageDetails: "Package details",
      includedReview: "Confirmed after review",
      fitmentDirectoryNote: "The selector includes 37 makes and 418 supplier-listed model/generation entries. Saving a vehicle supports review; it is not automatic fitment confirmation, and the engine and final fitment must still be confirmed.",
      exactProductRule: "Every product needs an exact authorised image, part identity and fitment scope, plus either a verified price in the supplier's original currency or an explicit Request price state.",
      shopByPart: "Shop by part type",
      shopByPartText: "Choose a part type to search the supplier catalogue directly",
      partDirectoryEyebrow: "Part type directory",
      partDirectoryHeading: "Start with the part you need.",
      partDirectoryText: "Choose a group or part type to search the supplier catalogue directly. Results support browsing; Projx Racing still confirms live availability, exact fitment and the final price.",
      partDirectoryNote: "This is a catalogue search directory, not a claim that every category is currently stocked.",
      partDirectoryLabel: "Shop by part catalogue search directory",
      partDirectorySearch: "Search the catalogue for {term}",
      partDirectoryExpand: "Open {term} part types",
      partDirectoryCollapse: "Close {term} part types",
      partDirectoryViewAll: "View all",
      reviewedItemsEyebrow: "Reviewed selection",
      reviewedItemsHeading: "Reviewed products and configured packages.",
      reviewedItemsText: "Browse supplier products reviewed by Projx Racing and configured performance packages. Use the filters to reach the right item quickly.",
      tegiwaEyebrow: "Live Parts Catalogue",
      tegiwaHeading: "Browse the parts catalogue.",
      tegiwaText: "Search by product, brand, vehicle, engine or part number, or browse in manageable pages. The live supplier catalogue, reviewed products and Projx Racing packages are presented together in one place.",
      tegiwaSearchLabel: "Search products",
      tegiwaSearchPlaceholder: "Product, brand, vehicle, engine or part number",
      tegiwaSearchAction: "Search",
      tegiwaBrowseAction: "Browse catalogue",
      tegiwaSourceNote: "Prices remain in each supplier's listed original currency with no automatic conversion or tax addition. Stock reflects the latest available supplier data; Projx Racing confirms the final option, price, fitment, shipping and Kuwait duties before an order.",
      catalogueFallback: "The complete multi-supplier catalogue is temporarily unavailable. The supplier fallback catalogue is shown for now; use the enquiry form for any other part.",
      cataloguePartial: "Reviewed local products are currently combined with the available supplier data. The complete catalogue is temporarily unavailable; Projx Racing confirms price, availability and fitment before an order.",
      tegiwaVehicleActive: "Live catalogue filtered for your vehicle",
      tegiwaVehicleText: "These are likely catalogue matches only. Projx Racing confirms exact fitment before an order.",
      tegiwaLoading: "Loading catalogue products…",
      tegiwaLoadError: "The parts catalogue could not be loaded right now.",
      tegiwaRetry: "Try again",
      tegiwaNext: "Next products",
      tegiwaPrevious: "Previous products",
      tegiwaReset: "Back to catalogue start",
      tegiwaNoResults: "No matching products were found. Try a more specific product, brand, vehicle or engine.",
      tegiwaResults: "products shown",
      tegiwaSearchResults: "matching products",
      tegiwaSearchRange: "Showing {start}–{end} of {total} matches for “{query}”",
      tegiwaSortFilter: "Sort & filter",
      tegiwaFilterPanelLabel: "Search result sort and filter options",
      tegiwaActiveFilters: "{count} active",
      tegiwaSort: "Sort by",
      tegiwaSortRelevance: "Most relevant",
      tegiwaSortNameAsc: "Name: A–Z",
      tegiwaSortNameDesc: "Name: Z–A",
      tegiwaSortPriceAsc: "Price: low to high",
      tegiwaSortPriceDesc: "Price: high to low",
      tegiwaSortSupplierOrder: "Supplier catalogue order",
      tegiwaSortNameAscSupplier: "Name: A–Z within supplier",
      tegiwaSortNameDescSupplier: "Name: Z–A within supplier",
      tegiwaSortPriceAscSupplier: "Price: low to high within currency",
      tegiwaSortPriceDescSupplier: "Price: high to low within currency",
      tegiwaMixedSortNote: "Supplier results are grouped by supplier and sorted within each group. USD and GBP prices are not converted or compared.",
      tegiwaFilterAvailability: "Availability",
      tegiwaAvailabilityAll: "All stock statuses",
      tegiwaAvailabilityAvailable: "Any available",
      tegiwaAvailabilityInStock: "In stock",
      tegiwaAvailabilitySupplierStock: "Supplier stock",
      tegiwaAvailabilityCheck: "Confirmation required",
      tegiwaAvailabilityUnavailable: "Unavailable",
      tegiwaFilterPricing: "Pricing",
      tegiwaPricingAll: "All pricing",
      tegiwaPricingPriced: "Listed price",
      tegiwaPricingRequest: "Request price",
      tegiwaClearFilters: "Clear filters",
      tegiwaSearchSuggestions: "Search suggestions",
      tegiwaDidYouMean: "Did you mean “{query}”?",
      tegiwaSearchAll: "Search all products for “{query}”",
      tegiwaCorrectedSearch: "Search corrected from “{from}” to “{to}”.",
      tegiwaSearchEquivalent: "Search supplier catalogue for “{query}”",
      tegiwaTranslatedSearch: "Matched “{from}” to supplier catalogue term “{to}”.",
      tegiwaPaginationLabel: "Parts catalogue pages",
      tegiwaPageOf: "Page {page} of {total}",
      tegiwaGoToPage: "Go to page {page}",
      tegiwaShowingRange: "Showing {start}–{end} of {total} products",
      tegiwaCatalogCount: "verified products in the catalogue",
      tegiwaAvailableCount: "products with direct or supplier availability",
      tegiwaViewProduct: "View product",
      tegiwaSupplierListing: "Original product listing",
      tegiwaProductDetails: "Product details",
      tegiwaDescription: "Description",
      tegiwaVariants: "Options",
      tegiwaSelectedOption: "Selected option",
      tegiwaChooseVariant: "Select an option to update its price and availability before adding it to your quote.",
      tegiwaChooseVariantForCart: "Select an option first so its SKU, price and availability are checked before adding it to the cart.",
      tegiwaOnlinePrice: "Supplier price in original currency",
      tegiwaChecked: "Stock checked",
      tegiwaPriceNote: "The price is shown in the supplier's original currency with no automatic conversion or tax addition. Projx Racing confirms the final price, shipping and Kuwait duties before an order.",
      tegiwaInStock: "Selected variants in stock at supplier",
      tegiwaSupplierStock: "Selected variants in supplier stock",
      tegiwaCheckAvailability: "Confirm availability",
      tegiwaStockStale: "Stock snapshot expired — confirm availability",
      tegiwaOutOfStock: "Currently out of stock",
      tegiwaVariantAvailable: "Available to order",
      tegiwaVariantUnavailable: "Confirm availability",
      tegiwaNoImage: "No product image available",
      originalSupplierListing: "Original supplier listing"
    };
  }

  function commerceText() {
    return state.locale === "ar" ? {
      cart: "السلة",
      cartTitle: "سلة الاختبار",
      cartIntro: "احفظ القطع المؤهلة وراجع الكمية قبل إرسال طلب شراء تجريبي إلى Projx Racing.",
      checkout: "إتمام الطلب",
      checkoutTitle: "إتمام طلب تجريبي آمن",
      checkoutIntro: "هذه بيئة اختبار. لن يتم تحصيل أي مبلغ أو حجز أي مخزون.",
      stagingBadge: "اختبار فقط — لا توجد دفعة",
      addToCart: "أضف إلى السلة",
      selectSizeAndAddToCart: "اختر الخيارات ثم أضف إلى السلة",
      addedToCart: "تمت الإضافة إلى سلة الاختبار",
      cartLimitReached: "يمكن أن تحتوي سلة الاختبار على 20 قطعة مختلفة كحد أقصى. أزل قطعة قبل إضافة قطعة أخرى.",
      fitmentRequired: "يتطلب تأكيد التوافق",
      availabilityRequired: "يتم تأكيد توفر المورد قبل اعتماد الطلب.",
      supplierReferencePrice: "سعر مرجعي من المورد",
      finalPriceNotice: "المبلغ الظاهر مرجعي بعملة المورد. يؤكد Projx Racing سعر البيع النهائي والتوفر والتوافق والشحن وأي رسوم قبل اعتماد الطلب.",
      subtotal: "المجموع المرجعي",
      shippingPending: "الشحن غير محسوب",
      dutiesPending: "الضرائب والجمارك والتوصيل المحلي غير محسوبة",
      shippingPlannerTitle: "خطة الشحن حسب المورد",
      shippingPlannerIntro: "يتم فصل الشحن حسب بلد المورد حتى تكون التكاليف واضحة.",
      shippingFrom: "يشحن من",
      shippingSupplier: "المورد",
      shippingUnit: "وحدة",
      shippingUnits: "وحدات",
      originGB: "بريطانيا",
      originUS: "الولايات المتحدة",
      originKW: "الكويت",
      singleSupplierShipment: "شحنة مورد واحدة",
      splitSupplierShipment: "سيتم تقسيم الطلب إلى {count} شحنات",
      splitSupplierNotice: "تُشحن منتجات ECS Tuning من الولايات المتحدة ومنتجات Tegiwa من بريطانيا. تظهر كل شحنة بشكل منفصل.",
      shippingEnterDestination: "أكمل بيانات التوصيل المطلوبة لفحص مسار الشحن.",
      shippingEstimating: "جارٍ فحص مسار الشحن…",
      shippingConfirmationRequired: "سعر الشحن يحتاج تأكيد",
      shippingAuthorisedAccessRequired: "لا تتوفر أسعار مباشرة معتمدة من المورد حالياً، لذلك لم يتم تخمين أي رسوم.",
      shippingEstimateError: "تعذر فحص الشحن الآن. سيؤكد Projx Racing الرسوم قبل أي طلب حقيقي.",
      shippingDestination: "الوجهة",
      shippingRate: "تكلفة الشحن",
      shippingDutiesExcluded: "لا تشمل الضرائب أو الجمارك أو التوصيل المحلي.",
      shippingNotCharged: "لن تتم إضافة أو تحصيل رسوم شحن غير مؤكدة.",
      shippingRateConfirmed: "تم تأكيد سعر الشحن المباشر",
      shippingRatesConfirmed: "تم تأكيد سعر مباشر لكل شحنة.",
      shippingHowCalculated: "كيف تُحسب هذه الشحنة",
      shippingHowCalculatedHint: "الطريقة المعروفة والبيانات المطلوبة والقيود",
      shippingMethod: "طريقة التسعير",
      shippingRateSource: "مصدر السعر المُلاحظ",
      shippingFulfilmentSystem: "نظام تنفيذ الطلب",
      shippingObservedCarriers: "شركات النقل المُلاحظة أو المذكورة في سياسة المورد",
      shippingCalculationFactors: "عوامل الحساب",
      shippingRequiredInputs: "البيانات المستخدمة أو المطلوبة للسعر المباشر",
      shippingRestrictions: "قيود مهمة",
      shippingReadiness: "جاهزية السعر المباشر",
      shippingNoConfirmedRate: "لا يوجد سعر شحن مباشر مؤكد لهذه الشحنة.",
      shippingConsolidationPolicy: "سياسة تجميع الشحنة",
      shippingDutiesMode: "الضرائب والجمارك",
      shippingEvidenceAsOf: "تاريخ مراجعة الدليل",
      shippingTegiwaEvidence: "إعداد Tegiwa المُلاحظ: أعادت صفحة مورد Shopify سعراً من Calcurates لخدمة DHL Express Worldwide في اختبار محدود واحد إلى الكويت. هذا لا يثبت تعرفة قابلة لإعادة الاستخدام أو خدمة مضمونة.",
      shippingDespatchCloudClarification: "تم تعريف Despatch Cloud كنظام لتنفيذ الطلب ومعالجة البيانات، وليس كمحرك مؤكد لحساب سعر Tegiwa.",
      shippingEcsEvidence: "تعرض ECS خيارات شحن خاصة بالوجهة ومحتويات السلة. محرك التسعير الأساسي غير معلن للعامة.",
      shippingDestinationSpecific: "تعتمد الخدمات والتكلفة النهائية على الوجهة والسلة والطرد وموقع تنفيذ الطلب الفعلي.",
      shippingPlannerReceipt: "خطة الشحن المسجلة",
      continueShopping: "متابعة التسوق",
      proceedCheckout: "المتابعة للطلب التجريبي",
      savedOnDevice: "تُحفظ هذه السلة تلقائياً على هذا الجهاز.",
      emptyCart: "سلة الاختبار فارغة.",
      emptyCartText: "المنتجات ذات السعر والهوية المؤكدة فقط تعرض خيار الإضافة إلى السلة. بقية القطع تبقى ضمن طلب السعر.",
      browseParts: "تصفح القطع",
      quantity: "الكمية",
      remove: "إزالة",
      each: "للقطعة",
      orderSummary: "ملخص الطلب التجريبي",
      editCart: "تعديل السلة",
      guestCheckout: "متابعة كزائر",
      guestNote: "يمكنك تشغيل محاكاة الطلب كزائر. لن يتم حفظ بيانات دفع أو إرسال إشعار من المعاينة الافتراضية.",
      signInCreate: "تسجيل الدخول أو إنشاء حساب",
      accountOptional: "الحساب اختياري. سجّل الدخول لتعبئة بيانات Clerk المعروفة، أو أكمل كزائر.",
      customerDetails: "بيانات التواصل",
      deliveryDetails: "وجهة الطلب",
      vehicleDetails: "بيانات السيارة والتوافق",
      name: "الاسم الكامل",
      email: "البريد الإلكتروني",
      phone: "الهاتف / WhatsApp",
      country: "الدولة",
      city: "المدينة",
      address: "العنوان",
      postcode: "الرمز البريدي",
      fulfilment: "طريقة الاستلام المفضلة",
      courier: "شحن إلى العنوان — السعر لاحقاً",
      workshop: "استلام أو تركيب في الورشة — بعد التأكيد",
      vehicle: "السيارة: السنة، الصانع، الموديل، المحرك",
      vin: "VIN",
      notes: "ملاحظات الطلب",
      optional: "اختياري",
      acknowledgement: "أفهم أن هذا طلب اختبار بدون دفع، وأن السعر والتوفر والتوافق والشحن يجب تأكيدها من Projx Racing قبل إنشاء طلب حقيقي.",
      consent: "أوافق على استخدام هذه البيانات للرد على طلب الاختبار.",
      submit: "إكمال محاكاة الطلب",
      submitting: "جاري إكمال محاكاة الطلب…",
      successTitle: "تم استلام طلب الاختبار",
      successText: "لم يتم تحصيل أي دفعة. احتفظ بالرقم المرجعي عند التواصل مع Projx Racing.",
      simulationTitle: "اكتملت محاكاة الطلب",
      simulationText: "هذه نتيجة محاكاة فقط. لم يتم إرسال بريد أو إنشاء طلب حقيقي أو تحصيل دفعة أو حجز مخزون.",
      notificationNone: "حالة الإشعار: لم يتم الإرسال — محاكاة فقط",
      reference: "الرقم المرجعي",
      duplicate: "تم التعرف على إعادة الإرسال وإرجاع نفس الطلب بدون إنشاء طلب مكرر.",
      startAnother: "بدء طلب اختبار جديد",
      submitError: "تعذر إرسال طلب الاختبار. لم يتم تحصيل أي مبلغ وبقيت السلة محفوظة.",
      deliveryUnavailable: "خدمة إشعارات الطلب غير مفعلة بعد. تواصل مع الورشة أو حاول لاحقاً.",
      invalidCart: "تغيرت بيانات المنتج أو انتهت صلاحية السعر المرجعي. راجع السلة أو اطلب السعر.",
      priceExpired: "انتهت صلاحية مراجعة السعر — اطلب السعر",
      noPayment: "حالة الدفع: لم يتم التحصيل",
      paymentNone: "لا توجد بوابة دفع أو بيانات بطاقة في هذا المسار التجريبي.",
      item: "قطعة",
      items: "قطع"
    } : {
      cart: "Cart",
      cartTitle: "Staging cart",
      cartIntro: "Save eligible products and review quantities before sending a test purchase request to Projx Racing.",
      checkout: "Checkout",
      checkoutTitle: "Safe staging checkout",
      checkoutIntro: "This is a test environment. No payment is collected and no stock is reserved.",
      stagingBadge: "TEST ONLY — NO PAYMENT",
      addToCart: "Add to cart",
      selectSizeAndAddToCart: "Choose options and add to cart",
      addedToCart: "Added to staging cart",
      cartLimitReached: "The staging cart can contain up to 20 different items. Remove one before adding another.",
      fitmentRequired: "Fitment confirmation required",
      availabilityRequired: "Supplier availability is confirmed before any order is approved.",
      supplierReferencePrice: "Supplier reference price",
      finalPriceNotice: "Displayed amounts are supplier-reference prices in their original currency. Projx Racing confirms the final selling price, availability, fitment, shipping and any charges before approving an order.",
      subtotal: "Reference subtotal",
      shippingPending: "Shipping not calculated",
      dutiesPending: "Tax, customs and local delivery are not calculated",
      shippingPlannerTitle: "Supplier shipping plan",
      shippingPlannerIntro: "Shipments are separated by supplier origin so every route and pending charge stays clear.",
      shippingFrom: "Ships from",
      shippingSupplier: "Supplier",
      shippingUnit: "unit",
      shippingUnits: "units",
      originGB: "Great Britain",
      originUS: "United States",
      originKW: "Kuwait",
      singleSupplierShipment: "One supplier shipment",
      splitSupplierShipment: "This order will be split into {count} supplier shipments",
      splitSupplierNotice: "ECS Tuning items ship from the United States and Tegiwa items ship from Great Britain. Each shipment is shown separately.",
      shippingEnterDestination: "Complete the required delivery details to check the shipping route.",
      shippingEstimating: "Checking the shipping route…",
      shippingConfirmationRequired: "Shipping charge requires confirmation",
      shippingAuthorisedAccessRequired: "Authorised live supplier rates are not available yet, so no delivery charge has been guessed.",
      shippingEstimateError: "Shipping could not be checked now. Projx Racing will confirm the charge before any real order.",
      shippingDestination: "Destination",
      shippingRate: "Shipping charge",
      shippingDutiesExcluded: "Tax, customs and local delivery are not included.",
      shippingNotCharged: "No unconfirmed shipping charge is added or collected.",
      shippingRateConfirmed: "Live shipping rate confirmed",
      shippingRatesConfirmed: "A live rate is confirmed for every shipment.",
      shippingHowCalculated: "How this shipment is calculated",
      shippingHowCalculatedHint: "Known method, required data and restrictions",
      shippingMethod: "Quote method",
      shippingRateSource: "Observed rate source",
      shippingFulfilmentSystem: "Fulfilment system",
      shippingObservedCarriers: "Observed or supplier-disclosed carrier families",
      shippingCalculationFactors: "Calculation factors",
      shippingRequiredInputs: "Inputs used or required for a live quote",
      shippingRestrictions: "Important restrictions",
      shippingReadiness: "Live-rate readiness",
      shippingNoConfirmedRate: "No confirmed live shipping rate exists for this shipment.",
      shippingConsolidationPolicy: "Shipment consolidation",
      shippingDutiesMode: "Duties and taxes",
      shippingEvidenceAsOf: "Evidence reviewed",
      shippingTegiwaEvidence: "Observed Tegiwa configuration: its Shopify supplier checkout returned a Calcurates rate for DHL Express Worldwide in one bounded Kuwait test. This does not establish a reusable tariff or guaranteed service.",
      shippingDespatchCloudClarification: "Despatch Cloud is identified as a fulfilment and data-processing system, not as a proven Tegiwa rate engine.",
      shippingEcsEvidence: "ECS returns shipping options specific to the destination and cart. Its underlying rating engine is not publicly disclosed.",
      shippingDestinationSpecific: "Final services and charges depend on the exact destination, cart, package and fulfilment location.",
      shippingPlannerReceipt: "Recorded shipping plan",
      continueShopping: "Continue shopping",
      proceedCheckout: "Continue to test checkout",
      savedOnDevice: "This cart is saved automatically on this device.",
      emptyCart: "Your staging cart is empty.",
      emptyCartText: "Only products with a verified identity and reference price show Add to cart. All other parts stay in the quotation flow.",
      browseParts: "Browse parts",
      quantity: "Quantity",
      remove: "Remove",
      each: "each",
      orderSummary: "Test order summary",
      editCart: "Edit cart",
      guestCheckout: "Continue as guest",
      guestNote: "You can run this checkout simulation as a guest. No payment details are stored and the default preview sends no notification.",
      signInCreate: "Sign in or create account",
      accountOptional: "An account is optional. Sign in to prefill known Clerk details, or continue as a guest.",
      customerDetails: "Contact details",
      deliveryDetails: "Request destination",
      vehicleDetails: "Vehicle and fitment details",
      name: "Full name",
      email: "Email",
      phone: "Phone / WhatsApp",
      country: "Country",
      city: "City",
      address: "Address",
      postcode: "Postcode",
      fulfilment: "Preferred fulfilment",
      courier: "Courier to address — price pending",
      workshop: "Workshop collection or installation — confirmation pending",
      vehicle: "Vehicle: year, make, model and engine",
      vin: "VIN",
      notes: "Order notes",
      optional: "Optional",
      acknowledgement: "I understand this is a no-payment test request and that Projx Racing must confirm final price, availability, fitment and shipping before a real order exists.",
      consent: "I agree that these details may be used to respond to this staging request.",
      submit: "Complete checkout simulation",
      submitting: "Completing checkout simulation…",
      successTitle: "Test request received",
      successText: "No payment was collected. Keep the reference when contacting Projx Racing.",
      simulationTitle: "Checkout simulation complete",
      simulationText: "This is a simulated result only. No email was sent, no real order was created, no payment was collected and no stock was reserved.",
      notificationNone: "Notification status: not sent — simulation only",
      reference: "Reference",
      duplicate: "A repeat submission was recognised and the same request was returned without creating a duplicate.",
      startAnother: "Start another test request",
      submitError: "The test request could not be sent. Nothing was charged and your cart remains saved.",
      deliveryUnavailable: "Order notifications are not active yet. Contact the workshop or try again later.",
      invalidCart: "Product data changed or the reference price expired. Review the cart or request a quotation.",
      priceExpired: "Price review expired — request a quote",
      noPayment: "Payment status: not collected",
      paymentNone: "No payment gateway or card-data field exists in this staging flow.",
      item: "item",
      items: "items"
    };
  }

  function shippingMetadataText() {
    return state.locale === "ar" ? {
      values: {
        dynamic_supplier_checkout: "تسعير ديناميكي في صفحة المورد",
        shopify_dynamic_checkout: "تسعير ديناميكي عبر صفحة Shopify للمورد",
        shopify_carrier_calculated: "سعر ناقل محسوب عبر صفحة Shopify للمورد",
        dynamic_destination_aware_supplier_cart: "سعر ديناميكي حسب الوجهة وسلة المورد",
        supplier_cart_dynamic: "سعر ديناميكي حسب سلة المورد",
        supplier_confirmation: "تأكيد مباشر من المورد",
        undisclosed_supplier_backend: "محرك المورد غير معلن للعامة",
        undisclosed: "غير معلن للعامة",
        destination: "الوجهة",
        cart_contents: "محتويات السلة والكميات",
        verified_package_weight_and_dimensions: "وزن الطرد وأبعاده بعد التحقق",
        eligible_carrier_service: "خدمة النقل المؤهلة للمسار",
        supplier_shipping_rules: "قواعد الشحن لدى المورد",
        fulfilment_location: "موقع تنفيذ الطلب الفعلي",
        destination_country: "دولة الوجهة",
        destination_city: "مدينة / محافظة الوجهة",
        destination_postcode: "الرمز البريدي للوجهة",
        live_rate_requires_supplier_checkout_or_authorised_rate_access: "يتطلب السعر المباشر صفحة المورد أو وصولاً معتمداً للأسعار.",
        dhl_express_observation_is_limited_to_one_bounded_kuwait_test: "ملاحظة DHL Express مبنية على اختبار محدود واحد إلى الكويت وليست ضماناً لخدمة كل طلب.",
        despatch_cloud_is_a_fulfilment_and_data_processor_not_a_verified_rating_engine: "Despatch Cloud نظام تنفيذ ومعالجة بيانات، وليس محرك تسعير تم التحقق منه.",
        backend_rating_vendor_is_not_publicly_disclosed: "مزود محرك التسعير لدى ECS غير معلن للعامة.",
        live_rate_requires_supplier_cart_and_complete_package_data: "يتطلب السعر المباشر سلة المورد وبيانات الطرد المكتملة.",
        direct_ship_freight_and_partial_shipments_may_price_separately: "قد تُسعّر الشحنات المباشرة أو الكبيرة أو الجزئية بشكل منفصل.",
        carrier_availability_varies_by_destination_and_package: "تختلف شركات وخدمات النقل حسب الوجهة والطرد.",
        live_rate_requires_authorised_supplier_or_carrier_access: "يتطلب السعر المباشر وصولاً معتمداً من المورد أو شركة النقل.",
        supplier_checkout_confirmation_required: "يجب تأكيد التجميع في صفحة المورد.",
        not_proven_included_confirm_exact_quote: "لم يثبت شمول الرسوم والضرائب؛ يجب تأكيد السعر المحدد.",
        hold_until_all_items_are_in_stock_unless_partial_shipment_is_requested: "تنتظر ECS عادةً توفر كامل الطلب ما لم يُطلب شحن جزئي، وقد تترتب تكلفة إضافية.",
        supplier_confirmation_required: "يحتاج إلى تأكيد المورد.",
        recipient_responsible_unless_supplier_explicitly_states_otherwise: "يتحمل المستلم الرسوم ما لم يذكر المورد خلاف ذلك بوضوح للسعر المحدد.",
        verified_package_data_required: "بيانات وزن وأبعاد الطرد المؤكدة غير متوفرة.",
        authorised_dynamic_rate_access_required: "الوصول المعتمد إلى سعر ديناميكي غير متصل.",
        not_available: "بيانات الطرد المؤكدة غير متوفرة",
        not_connected: "الوصول المعتمد للأسعار غير متصل"
      }
    } : {
      values: {
        dynamic_supplier_checkout: "Dynamic supplier-checkout quote",
        shopify_dynamic_checkout: "Dynamic supplier Shopify-checkout quote",
        shopify_carrier_calculated: "Carrier-calculated supplier Shopify checkout",
        dynamic_destination_aware_supplier_cart: "Dynamic destination-aware supplier-cart quote",
        supplier_cart_dynamic: "Dynamic supplier-cart quote",
        supplier_confirmation: "Direct supplier confirmation",
        undisclosed_supplier_backend: "Supplier backend not publicly disclosed",
        undisclosed: "Not publicly disclosed",
        destination: "Destination",
        cart_contents: "Cart contents and quantities",
        verified_package_weight_and_dimensions: "Verified packaged weight and dimensions",
        eligible_carrier_service: "Carrier service eligible for the route",
        supplier_shipping_rules: "Supplier shipping rules",
        fulfilment_location: "Actual fulfilment location",
        destination_country: "Destination country",
        destination_city: "Destination city / governorate",
        destination_postcode: "Destination postcode",
        live_rate_requires_supplier_checkout_or_authorised_rate_access: "A live rate requires the supplier checkout or authorised rate access.",
        dhl_express_observation_is_limited_to_one_bounded_kuwait_test: "The DHL Express observation comes from one bounded Kuwait test and does not guarantee service for every order.",
        despatch_cloud_is_a_fulfilment_and_data_processor_not_a_verified_rating_engine: "Despatch Cloud is a fulfilment/data processor, not a verified rating engine.",
        backend_rating_vendor_is_not_publicly_disclosed: "ECS's rate-engine provider is not publicly disclosed.",
        live_rate_requires_supplier_cart_and_complete_package_data: "A live rate requires the supplier cart and complete package data.",
        direct_ship_freight_and_partial_shipments_may_price_separately: "Direct-ship, freight and partial shipments may be priced separately.",
        carrier_availability_varies_by_destination_and_package: "Carrier and service availability varies by destination and package.",
        live_rate_requires_authorised_supplier_or_carrier_access: "A live rate requires authorised supplier or carrier access.",
        supplier_checkout_confirmation_required: "Consolidation must be confirmed in the supplier checkout.",
        not_proven_included_confirm_exact_quote: "Duties and taxes are not proven included; confirm the exact quote.",
        hold_until_all_items_are_in_stock_unless_partial_shipment_is_requested: "ECS normally holds the order until all items are in stock unless a partial shipment is requested; extra shipping may apply.",
        supplier_confirmation_required: "Supplier confirmation is required.",
        recipient_responsible_unless_supplier_explicitly_states_otherwise: "The recipient is responsible unless the supplier explicitly states otherwise for the exact quote.",
        verified_package_data_required: "Verified packaged weight and dimensions are unavailable.",
        authorised_dynamic_rate_access_required: "Authorised dynamic-rate access is not connected.",
        not_available: "Verified package data unavailable",
        not_connected: "Authorised rate access not connected"
      }
    };
  }

  function shippingCheckoutText() {
    return state.locale === "ar" ? {
      countryCode: "دولة التسليم",
      governorate: "المحافظة / المنطقة",
      area: "المنطقة / الحي",
      addressLine1: "الشارع، القطعة، المبنى ورقم الوحدة",
      addressLine2: "علامة مميزة أو تفاصيل إضافية",
      postcodeHelp: "مطلوب للشحن إلى العنوان. يظل الاستلام أو التركيب في الورشة خاضعاً للتأكيد اليدوي.",
      addressHelp: "أدخل عنوان التسليم الفعلي. تؤدي أي تغييرات إلى إلغاء سعر الشحن حتى تتم إعادة التحقق.",
      phoneHelp: "استخدم رقم هاتف يمكن لشركة النقل التواصل معه، مع مفتاح الدولة.",
      selectCountry: "اختر دولة من دول الخليج",
      selectShippingService: "اختر خدمة الشحن",
      shippingServiceRequired: "اختر خدمة مؤكدة لكل شحنة قبل إعادة التحقق.",
      confirmedShipment: "سعر مباشر مؤكد",
      manualShipment: "تأكيد يدوي مطلوب",
      partialPlan: "تم تأكيد بعض الشحنات فقط",
      noAutomaticOptions: "لا توجد خدمة تلقائية معتمدة لهذه الشحنة حالياً. ستبقى ضمن طلب سعر الشحن.",
      dispatchEstimate: "التجهيز المتوقع",
      transitEstimate: "النقل المتوقع",
      workingDays: "أيام عمل",
      quoteExpires: "ينتهي السعر",
      incoterm: "شروط الرسوم",
      ddp: "DDP — الرسوم والضرائب مشمولة حسب السعر المؤكد",
      dap: "DAP / DDU — قد تُدفع الرسوم والتخليص عند الوصول",
      dutiesUnverified: "غير مؤكد — لا تعتبر الرسوم أو الجمارك مشمولة",
      pricingAudit: "تفاصيل العملة والرسوم",
      originalSupplierRate: "السعر الأصلي للشحن",
      exchangeRate: "سعر الصرف المستخدم",
      exchangeRateAsOf: "وقت سعر الصرف",
      convertedShipping: "الشحن المحول إلى الدينار الكويتي",
      baseShipping: "الشحن الأساسي بعد التحويل",
      handlingFee: "رسوم المناولة المعلنة",
      protectionMargin: "هامش حماية سعر الصرف",
      insuranceFee: "التأمين",
      fragileFee: "رسوم مناولة المواد القابلة للكسر",
      oversizeFee: "رسوم الشحنة كبيرة الحجم",
      forwarderFee: "رسوم وكيل الشحن",
      localDeliveryFee: "التوصيل المحلي",
      roundingAdjustment: "تعديل التقريب",
      otherFees: "رسوم أخرى معلنة",
      totalPricingAudit: "تدقيق مكونات إجمالي الشحن",
      commercialRulesStatus: "حالة قواعد التسعير",
      commercialRulesEnabled: "مفعلة لهذا السعر من الخادم",
      commercialRulesDisabled: "معطلة لهذا السعر من الخادم",
      commercialRulesVersion: "مرجع إصدار القواعد",
      manualReviewStatus: "حالة المراجعة اليدوية",
      manualReviewRequired: "مطلوبة قبل اعتماد الطلب",
      manualReviewNotRequired: "غير مطلوبة حسب هذا السعر",
      manualReviewNotice: "هذا السعر يتطلب مراجعة يدوية قبل اعتماد الطلب. لا يفعّل ذلك الدفع.",
      breakdownStatus: "مطابقة المكونات للإجمالي",
      breakdownReconciled: "مطابقة للإجمالي المؤكد",
      breakdownMismatch: "لا تتطابق مكونات السعر مع الإجمالي؛ تم حجب الإجمالي النهائي ويلزم تأكيد الشحن.",
      totalShipping: "إجمالي الشحن المؤكد",
      confirmedShippingPortion: "جزء الشحن المؤكد فقط",
      shippingTotalPending: "لا يمكن عرض إجمالي نهائي حتى يتم تأكيد جميع الشحنات.",
      revalidateShipping: "إعادة التحقق من الشحن",
      revalidatingShipping: "جارٍ إعادة التحقق…",
      revalidationReady: "تمت إعادة التحقق من السعر المحدد لهذه المحاكاة.",
      revalidationPending: "يجب إعادة التحقق مباشرة قبل أي دفع حقيقي.",
      revalidationFailed: "تعذر إعادة التحقق. لم تتم إضافة سعر مجاني ولم يتم تفعيل الدفع.",
      submitQuoteRequest: "إرسال طلب تأكيد الشحن",
      noPaymentWithRates: "حتى الأسعار المؤكدة هنا للاختبار فقط. لا توجد بوابة دفع في هذا المسار.",
      separateDeliveries: "قد يصل هذا الطلب في شحنات منفصلة.",
      selected: "محدد"
    } : {
      countryCode: "Delivery country",
      governorate: "Governorate / region",
      area: "Area / district",
      addressLine1: "Street, block, building and unit",
      addressLine2: "Landmark or additional address details",
      postcodeHelp: "Required for courier delivery. Workshop collection or installation remains subject to manual confirmation.",
      addressHelp: "Enter the actual delivery address. Any change invalidates shipping until it is checked again.",
      phoneHelp: "Use a carrier-contactable number including the country code.",
      selectCountry: "Select a GCC country",
      selectShippingService: "Select a shipping service",
      shippingServiceRequired: "Select one confirmed service for every shipment before revalidation.",
      confirmedShipment: "Confirmed live rate",
      manualShipment: "Manual confirmation required",
      partialPlan: "Only some shipments are confirmed",
      noAutomaticOptions: "No authorised automatic service is available for this shipment yet. It remains in the shipping-quotation flow.",
      dispatchEstimate: "Estimated dispatch",
      transitEstimate: "Estimated transit",
      workingDays: "working days",
      quoteExpires: "Rate expires",
      incoterm: "Duties terms",
      ddp: "DDP — duties and taxes included only as stated by the confirmed quote",
      dap: "DAP / DDU — duties or clearance may be payable on arrival",
      dutiesUnverified: "Unverified — do not treat duties or customs as included",
      pricingAudit: "Currency and fee audit",
      originalSupplierRate: "Original shipping quote",
      exchangeRate: "Exchange rate used",
      exchangeRateAsOf: "Exchange-rate timestamp",
      convertedShipping: "Shipping converted to KWD",
      baseShipping: "Base converted shipping",
      handlingFee: "Disclosed handling charge",
      protectionMargin: "Exchange-rate protection",
      insuranceFee: "Insurance",
      fragileFee: "Fragile-item handling",
      oversizeFee: "Oversize shipment charge",
      forwarderFee: "Freight-forwarder charge",
      localDeliveryFee: "Local delivery",
      roundingAdjustment: "Rounding adjustment",
      otherFees: "Other disclosed fees",
      totalPricingAudit: "Shipping-total component audit",
      commercialRulesStatus: "Pricing-rule status",
      commercialRulesEnabled: "Enabled for this server quote",
      commercialRulesDisabled: "Disabled for this server quote",
      commercialRulesVersion: "Ruleset version reference",
      manualReviewStatus: "Manual-review status",
      manualReviewRequired: "Required before order approval",
      manualReviewNotRequired: "Not required by this quote",
      manualReviewNotice: "This quote requires manual review before the order can be approved. It does not enable payment.",
      breakdownStatus: "Component-to-total check",
      breakdownReconciled: "Matches the confirmed total",
      breakdownMismatch: "The quoted components do not match the total; the final total is withheld pending shipping confirmation.",
      totalShipping: "Confirmed total shipping",
      confirmedShippingPortion: "Confirmed shipping portion only",
      shippingTotalPending: "A final total cannot be shown until every shipment is confirmed.",
      revalidateShipping: "Revalidate shipping",
      revalidatingShipping: "Revalidating shipping…",
      revalidationReady: "The selected rate was revalidated for this simulation.",
      revalidationPending: "Shipping must be revalidated immediately before any real payment.",
      revalidationFailed: "Revalidation failed. No free rate was inserted and payment remains disabled.",
      submitQuoteRequest: "Submit shipping-confirmation request",
      noPaymentWithRates: "Even confirmed rates here are staging-only. No payment gateway exists in this flow.",
      separateDeliveries: "This order may arrive in separate shipments.",
      selected: "Selected"
    };
  }

  function shippingAdminText() {
    return state.locale === "ar" ? {
      eyebrow: "إدارة الشحن — وصول محمي",
      title: "لوحة عمليات الشحن",
      intro: "واجهة إدارية للقراءة فقط إلى أن يتوفر تحقق صلاحية الموظف وواجهات إدارة محمية على الخادم.",
      loading: "جارٍ فحص جلسة الدخول الآمنة…",
      signInRequired: "يلزم تسجيل الدخول",
      signInText: "سجّل الدخول أولاً. لن تُعرض أي بيانات تشغيلية قبل تحقق صلاحية الإدارة على الخادم.",
      openAccount: "فتح تسجيل الدخول",
      notConfigured: "واجهة الإدارة المحمية غير مفعلة",
      notConfiguredText: "تسجيل الدخول وحده لا يمنح صلاحية الإدارة. يلزم تحقق دور الموظف على الخادم وسجل تدقيق دائم قبل تفعيل أي تحكم.",
      readOnly: "قراءة فقط",
      supplierAdapters: "اتصالات الموردين",
      rateLogs: "سجلات الأسعار",
      routingRules: "قواعد مسار التنفيذ",
      commercialRules: "الرسوم والقواعد التجارية",
      auditLog: "سجل التدقيق",
      unavailable: "غير متوفر حتى ربط API محمي",
      noLiveCredentials: "لا توجد بيانات اعتماد مباشرة في المتصفح",
      countryCoverage: "دول التسليم المدعومة",
      recalculation: "إعادة حساب طلب",
      manualApproval: "اعتماد سعر يدوي",
      paymentLink: "إرسال رابط دفع",
      supplierOrder: "حالة طلب المورد والتتبع",
      disabledSecurity: "معطل حتى يتوفر تحقق صلاحية الموظف وAPI محمي ومسجل",
      refresh: "تحديث الحالة",
      backToAccount: "العودة إلى الحساب",
      securityNote: "لا تعرض هذه الصفحة بيانات المورد السرية أو أسعار الجملة أو مفاتيح API أو أرقام الحسابات."
    } : {
      eyebrow: "Shipping administration — protected access",
      title: "Shipping operations dashboard",
      intro: "A read-only administration shell until server-verified staff roles and protected management APIs are available.",
      loading: "Checking the secure sign-in session…",
      signInRequired: "Sign-in required",
      signInText: "Sign in first. No operational data is displayed before server-side administrator authorisation succeeds.",
      openAccount: "Open sign-in",
      notConfigured: "Protected administration API not configured",
      notConfiguredText: "Signing in alone does not grant administrator access. Server-side staff-role verification and a durable audit log are required before any control can be enabled.",
      readOnly: "Read only",
      supplierAdapters: "Supplier adapters",
      rateLogs: "Rate request logs",
      routingRules: "Fulfilment routing rules",
      commercialRules: "Fees and commercial rules",
      auditLog: "Audit log",
      unavailable: "Unavailable until a protected API is connected",
      noLiveCredentials: "No live credentials are exposed to the browser",
      countryCoverage: "Supported delivery countries",
      recalculation: "Recalculate an order",
      manualApproval: "Manually approve a quote",
      paymentLink: "Send a payment link",
      supplierOrder: "Supplier order and tracking status",
      disabledSecurity: "Disabled until staff authorisation and a protected, audited API exist",
      refresh: "Refresh status",
      backToAccount: "Back to account",
      securityNote: "This page does not expose supplier credentials, wholesale rates, API keys or account numbers."
    };
  }

  const PARTS_CATALOGUE_DIRECTORY = [
    {
      query: "braking", partType: "braking", en: "Brakes", ar: "الفرامل", items: [
        ["", "Brake Tools", "أدوات الفرامل", "braking-tools"],
        ["", "Brake Pads", "فحمات الفرامل", "braking-pads"],
        ["", "Performance Brake Parts", "قطع فرامل الأداء", "braking-performance"],
        ["", "Brake Fluids", "سوائل الفرامل", "braking-fluid"],
        ["", "Brake Rotors", "أقراص الفرامل", "braking-rotors"],
        ["", "Brake Calipers", "كليبرات الفرامل", "braking-calipers"],
        ["", "Brake Compounds & Lubricants", "مركبات وشحوم الفرامل", "braking-compounds"],
        ["", "Brake Lines", "خطوط الفرامل", "braking-lines"],
        ["", "Big Brake Upgrades", "ترقيات الفرامل الكبيرة", "braking-big-brakes"],
        ["", "Brake Service Kits", "أطقم صيانة الفرامل", "braking-service-kits"],
        ["", "Electrical Brake Parts & Components", "قطع ومكونات الفرامل الكهربائية", "braking-electrical"],
        ["", "Brake Sensors", "حساسات الفرامل", "braking-sensors"],
        ["", "ABS Brake Parts", "قطع نظام ABS", "braking-abs"],
        ["", "Brake Master Cylinder Parts", "قطع ماستر الفرامل", "braking-master-cylinder"],
        ["", "Emergency Parking Brake Parts", "قطع فرامل التوقف الطارئة", "braking-parking-brake"]
      ]
    },
    {
      query: "suspension", partType: "suspension", en: "Suspension", ar: "نظام التعليق", items: [
        ["coilovers", "Coilovers", "كويل أوفر"], ["control arms", "Control Arms", "أذرعة تحكم"], ["chassis braces", "Chassis Braces", "دعامات الشاصي"],
        ["suspension bushes", "Bushes", "جلب التعليق"], ["anti roll bars", "Anti-Roll Bars", "قضبان مانعة للانقلاب"], ["drop links", "Drop Links", "وصلات الميزان"],
        ["lowering springs", "Lowering Springs", "يايات تنزيل"], ["steering arms", "Steering Arms", "أذرعة التوجيه"], ["wheel bearings", "Wheel Bearings", "رمانات العجل"],
        ["shock absorbers", "Shock Absorbers", "مساعدات"]
      ]
    },
    {
      query: "intake", en: "Intake", ar: "سحب الهواء", items: [
        ["induction kit", "Induction Kits", "أنظمة سحب الهواء"], ["intake manifolds", "Intake Manifolds", "منافولد السحب"], ["throttle bodies", "Throttle Bodies", "بوابات الهواء"],
        ["intake pipes", "Intake Pipes", "أنابيب السحب"], ["panel filters", "Panel Filters", "فلاتر هواء"]
      ]
    },
    {
      query: "engine", partType: "engine", en: "Engine", ar: "المحرك", items: [
        ["", "Performance Engine Parts", "قطع أداء المحرك", "engine-performance"],
        ["", "Engine Intake Parts", "قطع سحب هواء المحرك", "engine-intake"],
        ["", "Engine Fuel Parts", "قطع وقود المحرك", "engine-fuel"],
        ["", "Engine Tools", "أدوات المحرك", "engine-tools"],
        ["", "Engine Electrical Parts", "قطع كهرباء المحرك", "engine-electrical"],
        ["", "Engine Mechanical Parts", "القطع الميكانيكية للمحرك", "engine-mechanical"],
        ["", "Engine Cooling Parts", "قطع تبريد المحرك", "engine-cooling"],
        ["", "Oil Change Service Kits and Accessories", "أطقم وملحقات تغيير الزيت", "engine-oil-service"],
        ["", "Engine Covers & Accessories", "أغطية المحرك وملحقاته", "engine-covers"],
        ["", "Engine Ignition Parts", "قطع إشعال المحرك", "engine-ignition"],
        ["", "Engine Turbocharger Parts", "قطع الشاحن التوربيني", "engine-turbocharger"],
        ["", "Engine Gaskets & Seals", "حشيات وأختام المحرك", "engine-gaskets-seals"],
        ["", "Engine Filter Parts", "فلاتر المحرك", "engine-filter"],
        ["", "Engine Chips, Tunes & Software", "شرائح وبرمجة وضبط المحرك", "engine-software"],
        ["", "Engine Drive Belt Parts", "قطع سيور المحرك", "engine-drive-belts"],
        ["", "Engine Emission Parts", "قطع انبعاثات المحرك", "engine-emissions"],
        ["", "Engine Pulley Parts", "بكرات المحرك", "engine-pulleys"],
        ["", "Engine Timing Parts", "قطع توقيت المحرك", "engine-timing"],
        ["", "Engine Mount Parts", "قواعد المحرك", "engine-mount"],
        ["", "Engine Vacuum System Parts", "قطع نظام تفريغ المحرك", "engine-vacuum-system"],
        ["", "Engine Skid Plate Parts", "ألواح حماية أسفل المحرك", "engine-skid-plate"],
        ["", "Engine Fastener Kit Parts", "أطقم مثبتات المحرك", "engine-fastener-kit"],
        ["", "Engine Supercharger Parts", "قطع الشاحن الفائق", "engine-supercharger"]
      ]
    },
    {
      query: "performance", partType: "performance", en: "Performance", ar: "الأداء", items: []
    },
    {
      query: "drivetrain", partType: "g-series-drivetrain", en: "Drivetrain", ar: "نظام نقل الحركة", items: [
        ["", "Drivetrain Tools", "أدوات نظام نقل الحركة", "drivetrain-tools"],
        ["", "Differential Parts", "أجزاء الدفرنس", "drivetrain-differential"],
        ["", "Manual Transmission Parts", "أجزاء ناقل الحركة اليدوي", "drivetrain-manual-transmission"],
        ["", "Shifter Parts", "أجزاء عصا ناقل الحركة", "drivetrain-shifter"],
        ["", "Automatic Transmission Parts", "أجزاء ناقل الحركة الأوتوماتيكي", "drivetrain-automatic-transmission"],
        ["", "Axle Parts", "أجزاء المحاور", "drivetrain-axles"],
        ["", "Clutch Parts", "أجزاء القابض", "drivetrain-clutch"],
        ["", "Drivetrain Mounts", "قواعد نظام نقل الحركة", "drivetrain-mounts"],
        ["", "Driveshaft Parts", "أجزاء أعمدة نقل الحركة", "drivetrain-driveshafts"],
        ["", "Wheel Bearing Parts", "أجزاء رمانات العجل", "drivetrain-wheel-bearings"],
        ["", "Skid Plates", "ألواح الحماية السفلية", "drivetrain-skid-plate"],
        ["", "Transfer Case Parts", "أجزاء علبة التحويل", "drivetrain-transfer-case"]
      ]
    },
    {
      query: "cooling", en: "Cooling", ar: "التبريد", items: [
        ["coolant", "Coolant", "سائل تبريد"], ["cooling fans", "Cooling Fans", "مراوح تبريد"], ["cooling fittings", "Fittings", "وصلات تبريد"],
        ["silicone hoses", "Hose Kits", "أطقم ليّات"], ["intercoolers", "Intercoolers", "إنتركولرات"], ["radiators", "Radiators", "رديترات"],
        ["cooling sensors", "Sensors", "حساسات تبريد"], ["thermostats", "Thermostats", "ثرموستات"], ["oil coolers", "Oil Coolers", "مبردات زيت"]
      ]
    },
    {
      query: "fuel", en: "Fueling", ar: "نظام الوقود", items: [
        ["fuel injectors", "Fuel Injectors", "بخاخات وقود"], ["fuel pumps", "Fuel Pumps", "طرمبات وقود"], ["fuel pressure regulator", "Fuel Pressure Regulators", "منظمات ضغط الوقود"],
        ["fuel cells", "Fuel Cells", "خزانات وقود سباق"], ["fuel rails", "Fuel Rails", "قضبان الوقود"], ["fuel lines fittings", "Lines & Fittings", "ليّات ووصلات الوقود"]
      ]
    },
    {
      query: "exhaust", en: "Exhaust", ar: "العادم", items: [
        ["exhaust manifold header", "Manifolds & Headers", "منافولدات وهيدرز"], ["oxygen sensor", "O2 Sensors", "حساسات أوكسجين"], ["heat wrap", "Heat Wrap", "عوازل حرارية"],
        ["exhaust gaskets clamps", "Gaskets & Clamps", "جوانات وكلبسات"], ["exhaust system", "Exhaust Systems", "أنظمة عادم"], ["sports catalytic converter", "Sports Catalysts", "كتلايزر رياضي"]
      ]
    },
    {
      query: "interior", partType: "interior", en: "Interior", ar: "المقصورة", items: [
        ["", "Gauges", "عدادات", "gauges"],
        ["", "Seats", "المقاعد", "seats"],
        ["", "Steering", "عجلة القيادة", "steering"],
        ["", "Vinyl Wrap", "تغليف الفينيل", "vinyl-wrap"],
        ["", "Center Console", "الكونسول الوسطي", "center-console"],
        ["", "Safety", "السلامة", "safety"],
        ["", "Trim", "تطعيمات داخلية", "trim"],
        ["", "Floor Mats", "دواسات أرضية", "floor-mats"],
        ["", "Dashboard", "لوحة العدادات", "dashboard"],
        ["", "Pedal", "الدواسات", "pedal"],
        ["", "Cellular Phone", "الهاتف المحمول", "cellular-phone"],
        ["", "Key Fob", "ريموت المفتاح", "key-fob"],
        ["", "Trunk", "صندوق الأمتعة", "trunk"],
        ["", "Shifter", "ناقل الحركة", "shifter"],
        ["", "Tools", "الأدوات", "tools"],
        ["", "Window", "النوافذ", "window"],
        ["", "Sound System", "النظام الصوتي", "sound-system"],
        ["", "Sun Shade", "حاجب الشمس", "sun-shade"],
        ["", "Electronic", "الإلكترونيات", "electronic"],
        ["", "Door", "الأبواب", "door"],
        ["", "Hood Release", "ذراع فتح غطاء المحرك", "hood-release"],
        ["", "Lighting", "الإضاءة", "lighting"],
        ["", "Storage", "التخزين", "storage"],
        ["", "Convertible", "السقف القابل للطي", "convertible"],
        ["", "Headliner", "بطانة السقف", "headliner"],
        ["", "Mirror", "المرايا", "mirror"],
        ["", "Sunroof", "فتحة السقف", "sunroof"],
        ["", "Airbag", "الوسائد الهوائية", "airbag"],
        ["", "Carpet", "السجاد", "carpet"],
        ["", "Navigation", "الملاحة", "navigation"],
        ["", "Armrest", "مسند الذراع", "armrest"],
        ["", "Hatch", "الباب الخلفي", "hatch"]
      ]
    },
    {
      query: "steering", partType: "steering", en: "Steering", ar: "نظام التوجيه", items: []
    },
    {
      query: "exterior", partType: "exterior", en: "Exterior", ar: "الهيكل الخارجي", items: [
        ["", "Body Parts", "أجزاء الهيكل الخارجي", "exterior-body-parts"],
        ["", "Vinyl Wrap", "تغليف الفينيل الخارجي", "exterior-vinyl-wrap"],
        ["", "Exterior Tools", "أدوات الهيكل الخارجي", "exterior-tools"],
        ["", "Wiper Parts", "أجزاء مساحات الزجاج", "exterior-wiper-parts"],
        ["", "Emblems & Badges", "الشعارات والشارات", "emblems-badges"],
        ["", "Roof Rack Parts", "أجزاء حوامل السقف", "exterior-roof-rack-parts"],
        ["", "Mirror Parts", "أجزاء المرايا الخارجية", "exterior-mirror-parts"],
        ["", "Exterior Electrical", "الأجزاء الكهربائية الخارجية", "exterior-electrical-parts"],
        ["", "Skid Plates", "ألواح حماية أسفل السيارة", "skid-plate-parts"],
        ["", "Antennas", "أجزاء الهوائي وملحقاته", "antenna-parts-accessories"],
        ["", "Window Parts", "أجزاء النوافذ الخارجية", "exterior-window-parts"],
        ["", "Alarm Parts", "أنظمة الإنذار الخارجية وأجزاؤها", "exterior-alarm-systems-parts"],
        ["", "CSL Parts", "أجزاء CSL الخارجية", "exterior-csl-parts"],
        ["", "Electronic Accessories", "ملحقات إلكترونية خارجية", "exterior-electronic-accessories"]
      ]
    },
    {
      query: "oil filter fluid", en: "Fluids & Filters", ar: "سوائل وفلاتر", items: [
        ["coolant", "Coolant", "سائل تبريد"], ["gear oil", "Gear Oil", "زيت قير"], ["engine oil", "Engine Oil", "زيت محرك"],
        ["sump plug", "Sump Plugs", "صواميل حوض الزيت"], ["oil filters", "Oil Filters", "فلاتر زيت"], ["fuel additives", "Additives & Treatments", "إضافات ومعالجات"]
      ]
    },
    {
      query: "electronics", en: "Electronics", ar: "إلكترونيات", items: [
        ["cameras", "Cameras", "كاميرات"], ["engine management ecu", "Engine Management (ECU)", "إدارة المحرك ECU"], ["digital display", "Digital Displays", "شاشات رقمية"],
        ["gauges", "Gauges", "عدادات"], ["wiring harness", "Wiring Harnesses", "ضفائر كهرباء"], ["sensors connectors", "Sensors & Connectors", "حساسات ووصلات"]
      ]
    },
    {
      query: "turbo supercharger", en: "Forced Induction", ar: "الشحن الجبري", items: [
        ["blow off valve", "Blow-Off Valves", "بلف تنفيس"], ["wastegates", "Wastegates", "ويست غيت"], ["turbo heat management", "Thermal Management", "إدارة حرارة التيربو"],
        ["supercharger kit", "Supercharger Kits", "أطقم سوبرتشارجر"], ["turbocharger kit", "Turbocharger Kits", "أطقم تيربو"]
      ]
    },
    {
      query: "dress up", en: "Dress-Up", ar: "تجميل", items: [
        ["dress up washers bolts", "Washers, Bolts & Nuts", "واشرات وبراغي وصواميل"], ["engine bay dress up", "Engine Bay", "تجميل حجرة المحرك"], ["carbon fibre", "Carbon Fibre", "كاربون فايبر"],
        ["engine caps covers", "Caps & Covers", "أغطية وغطاءات"]
      ]
    },
    {
      query: "detailing cleaning", en: "Cleaning & Detailing", ar: "تنظيف وعناية", items: [
        ["exterior cleaning", "Exterior Cleaning", "تنظيف خارجي"], ["polish wax", "Polish, Wax & Finishing", "تلميع وواكس"], ["interior cleaning", "Interior Cleaning", "تنظيف داخلي"],
        ["detailing accessories", "Detailing Accessories", "إكسسوارات عناية"]
      ]
    },
    {
      query: "wheels tyres", en: "Wheels & Tyres", ar: "عجلات وإطارات", items: [
        ["alloy wheels", "Alloy Wheels", "رنقات ألمنيوم"], ["wheel nuts studs", "Wheel Nuts & Studs", "صواميل ومسامير عجل"], ["wheel spacers", "Wheel Spacers", "سبيسرات عجل"],
        ["tyres", "Tyres", "إطارات"], ["centre caps", "Centre Caps", "أغطية وسط الرنق"]
      ]
    },
    {
      query: "motorsport", en: "Motorsport", ar: "رياضة المحركات", items: [
        ["roll cages", "Roll Cages", "رول كيج"], ["fire extinguishers", "Fire Extinguishers", "طفايات حريق"], ["lap timers", "Lap Timers", "مؤقتات لفات"],
        ["racing harness", "Harnesses", "أحزمة سباق"], ["motorsport cameras", "Cameras", "كاميرات سباق"], ["data logger", "Data Loggers", "مسجلات بيانات"],
        ["motorsport tools", "Tools", "أدوات حلبة"]
      ]
    },
    {
      query: "racewear", en: "Racewear", ar: "ملابس السباق", items: [
        ["racing helmets", "Helmets", "خوذ سباق"], ["race suits", "Race Suits", "بدلات سباق"], ["racing boots", "Racing Boots", "أحذية سباق"],
        ["racing gloves", "Racing Gloves", "قفازات سباق"], ["race underwear", "Race Underwear", "ملابس داخلية للسباق"], ["HANS device", "HANS Devices", "أجهزة HANS"]
      ]
    },
    {
      query: "merchandise", en: "Merchandise", ar: "منتجات وإكسسوارات", items: [
        ["t shirts", "T-Shirts", "تي شيرت"], ["hoodies", "Hoodies", "هودي"], ["hats caps", "Hats & Caps", "قبعات"],
        ["decals stickers", "Decals & Stickers", "ملصقات"], ["lanyards keyrings", "Lanyards & Keyrings", "تعليقات مفاتيح"], ["workshop banners", "Workshop Banners", "لافتات ورشة"]
      ]
    },
    {
      query: "service kit", en: "Service Kits", ar: "أطقم الصيانة", items: [
        ["oil service kit", "Oil Service Kits", "أطقم صيانة زيت"], ["brake service kit", "Brake Service Kits", "أطقم صيانة فرامل"], ["timing service kit", "Timing Service Kits", "أطقم تايمنغ"],
        ["filter service kit", "Filter Kits", "أطقم فلاتر"], ["track service kit", "Track Service Kits", "أطقم تجهيز حلبة"]
      ]
    }
  ];
  function esc(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }
  function cleanText(value = "", limit = 3000) {
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, limit);
  }
  function versionedAsset(value = "") {
    const asset = String(value || "");
    const version = String(CONFIG.assetVersion || "").trim();
    if (!/^assets\/(?:brand|media|products)\//.test(asset) || !/^[a-f0-9]{12}$/.test(version) || /(?:\?|&)v=/.test(asset)) return asset;
    return `${asset}${asset.includes("?") ? "&" : "?"}v=${version}`;
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
  function tegiwaProductHandle(value = "") {
    const handle = String(value ?? "").trim();
    if (!handle || handle.length > TEGIWA_PRODUCT_HANDLE_LIMIT) return "";
    return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(String(handle || "")) ? handle : "";
  }
  function currentRouteQueryParams() {
    if (!PREVIEW_MODE) return new URLSearchParams(location.search);
    const hash = location.hash.replace(/^#\/?/, "");
    const queryIndex = hash.indexOf("?");
    return new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
  }
  function routeWithQuery(path, params) {
    const query = params.toString();
    return `${normalizeRoute(path)}${query ? `?${query}` : ""}`;
  }
  function absoluteRouteUrl(path, locale = state.locale) {
    return new URL(routeUrl(path, locale), PREVIEW_MODE ? location.href : document.baseURI).href;
  }
  function localizedCurrentRouteUrl(locale = state.locale) {
    const params = currentRouteQueryParams();
    const product = tegiwaProductHandle(params.get(TEGIWA_PRODUCT_QUERY));
    if (currentPath() !== "/parts" || !product) params.delete(TEGIWA_PRODUCT_QUERY);
    else params.set(TEGIWA_PRODUCT_QUERY, product);
    return routeUrl(routeWithQuery(currentPath(), params), locale);
  }
  function tegiwaProductUrl(value, locale = state.locale) {
    const handle = tegiwaProductHandle(value);
    const params = currentRouteQueryParams();
    if (handle) params.set(TEGIWA_PRODUCT_QUERY, handle);
    else params.delete(TEGIWA_PRODUCT_QUERY);
    return routeUrl(routeWithQuery("/parts", params), locale);
  }
  function tegiwaHistoryState(handle = "") {
    const current = history.state && typeof history.state === "object" ? { ...history.state } : {};
    if (handle) current[TEGIWA_PRODUCT_HISTORY_KEY] = handle;
    else delete current[TEGIWA_PRODUCT_HISTORY_KEY];
    return current;
  }
  function updateLanguageRouteLinks() {
    const href = localizedCurrentRouteUrl(alternateLocale());
    document.querySelectorAll("a[data-language]").forEach(link => link.setAttribute("href", href));
  }
  function updateTegiwaProductUrl(value, { replace = false } = {}) {
    const handle = tegiwaProductHandle(value);
    if (!handle || currentPath() !== "/parts") return false;
    const params = currentRouteQueryParams();
    if (tegiwaProductHandle(params.get(TEGIWA_PRODUCT_QUERY)) === handle) return false;
    params.set(TEGIWA_PRODUCT_QUERY, handle);
    const url = absoluteRouteUrl(routeWithQuery("/parts", params));
    history[replace ? "replaceState" : "pushState"](tegiwaHistoryState(handle), "", url);
    updateLanguageRouteLinks();
    return true;
  }
  function removeTegiwaProductUrl() {
    const params = currentRouteQueryParams();
    if (!params.has(TEGIWA_PRODUCT_QUERY)) return false;
    params.delete(TEGIWA_PRODUCT_QUERY);
    history.replaceState(tegiwaHistoryState(), "", absoluteRouteUrl(routeWithQuery(currentPath(), params)));
    updateLanguageRouteLinks();
    return true;
  }
  function syncTegiwaCatalogueUrl() {
    if (currentPath() !== "/parts") return false;
    const params = currentRouteQueryParams();
    const productHandle = tegiwaProductHandle(params.get(TEGIWA_PRODUCT_QUERY));
    params.delete("q");
    params.delete("page");
    for (const key of Object.keys(TEGIWA_SEARCH_DEFAULTS)) params.delete(key);
    if (state.tegiwaCatalog.query) params.set("q", state.tegiwaCatalog.query);
    for (const [key, defaultValue] of Object.entries(TEGIWA_SEARCH_DEFAULTS)) {
      if (state.tegiwaCatalog[key] !== defaultValue) params.set(key, state.tegiwaCatalog[key]);
    }
    if (state.tegiwaCatalog.currentPage > 1) params.set("page", String(state.tegiwaCatalog.currentPage));
    if (productHandle) params.set(TEGIWA_PRODUCT_QUERY, productHandle);
    const url = absoluteRouteUrl(routeWithQuery("/parts", params));
    if (url === location.href) return false;
    history.replaceState(tegiwaHistoryState(productHandle), "", url);
    updateLanguageRouteLinks();
    return true;
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
  function prefersReducedMotion() { return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches); }
  function motionBehavior() { return prefersReducedMotion() ? "auto" : "smooth"; }
  function motionDelay(milliseconds = 450) { return prefersReducedMotion() ? 0 : milliseconds; }
  function scrollElementIntoView(element, block = "start") {
    element?.scrollIntoView({ behavior: motionBehavior(), block });
  }
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
  function localizedStoreProduct(product) {
    if (!product) return null;
    if (state.locale !== "ar") return product;
    return {
      ...product,
      title: product.titleAr || product.title,
      summary: product.summaryAr || product.summary,
      category: product.categoryAr || product.category,
      subcategory: product.subcategoryAr || product.subcategory,
      status: product.statusAr || product.status,
      observedAvailability: product.observedAvailabilityAr || product.observedAvailability,
      priceNote: product.priceNoteAr || product.priceNote,
      details: product.detailsAr || product.details,
      images: (product.images || []).map(image => ({ ...image, alt: image.altAr || image.alt }))
    };
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
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L21 7H6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="20" r="1.4" fill="currentColor"/><circle cx="18" cy="20" r="1.4" fill="currentColor"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-12A7 7 0 1 0 5 9c0 6.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15.7 15.7 4.3 4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 20a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
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

  function quoteCount() {
    return state.quote.reduce((total, item) => total + (Number(item.quantity) || 1), 0);
  }

  function cartCount() {
    return state.cart.reduce((total, item) => total + (Number(item.quantity) || 1), 0);
  }

  function cartFingerprint() {
    return state.cart
      .map(item => `${item.productId}:${item.sku}:${item.quantity}:${item.currency}:${Number(item.unitAmount).toFixed(2)}`)
      .sort()
      .join("|");
  }

  function saveCart({ resetCheckout = true } = {}) {
    state.cart = normalizeCart(state.cart);
    state.shippingEstimateController?.abort();
    state.shippingEstimateController = null;
    state.shippingEstimate = null;
    state.shippingEstimateStatus = "idle";
    state.shippingEstimateError = "";
    storage.set(CART_STORAGE_KEY, JSON.stringify(state.cart));
    if (resetCheckout) {
      storage.remove(CHECKOUT_TOKEN_STORAGE_KEY);
      storage.remove(LAST_ORDER_STORAGE_KEY);
    }
    renderHeader();
    renderFloatingActions();
  }

  function mediaImage(id, {
    loading = "lazy",
    className = "",
    alt = "",
    sizes = "",
    fetchpriority = "auto",
    thumb = false
  } = {}) {
    const media = mediaItem(id);
    if (!media) return "";
    const position = /^(?:left|center|right|top|bottom|[0-9]{1,3}%)(?:\s+(?:left|center|right|top|bottom|[0-9]{1,3}%))?$/.test(media.position || "") ? media.position : "center";
    const width = Number(media.width) || 1600;
    const height = Number(media.height) || 1200;
    const basename = String(media.full || "").match(/\/([^/]+)\.webp$/i)?.[1] || "";
    const responsive = basename && String(media.full).startsWith("assets/media/");
    const smallWidth = Math.min(480, width);
    const mediumWidth = Math.min(960, width);
    const sources = responsive
      ? [
          `${versionedAsset(`assets/media/responsive/${basename}-480.webp`)} ${smallWidth}w`,
          ...(mediumWidth > smallWidth && mediumWidth < width ? [`${versionedAsset(`assets/media/responsive/${basename}-960.webp`)} ${mediumWidth}w`] : []),
          `${versionedAsset(media.full)} ${width}w`
        ]
      : [];
    const effectiveSizes = sizes || (thumb ? "(max-width:680px) 100vw, (max-width:1100px) 50vw, 390px" : "(max-width:680px) 100vw, 50vw");
    const srcset = sources.length > 1 ? ` srcset="${esc(sources.join(", "))}"` : "";
    return `<img class="${esc(className)}" src="${esc(versionedAsset(media.full))}"${srcset} alt="${esc(alt || media.alt)}" loading="${loading}" decoding="async" fetchpriority="${fetchpriority}" sizes="${esc(effectiveSizes)}" width="${width}" height="${height}" style="object-position:${esc(position)}">`;
  }

  function updateMediaImageSource(image, media, sizes = "(max-width:680px) 100vw, 50vw") {
    if (!image || !media) return;
    const width = Number(media.width) || 1600;
    const basename = String(media.full || "").match(/\/([^/]+)\.webp$/i)?.[1] || "";
    const smallWidth = Math.min(480, width);
    const mediumWidth = Math.min(960, width);
    const sources = basename && String(media.full).startsWith("assets/media/")
      ? [
          `${versionedAsset(`assets/media/responsive/${basename}-480.webp`)} ${smallWidth}w`,
          ...(mediumWidth > smallWidth && mediumWidth < width ? [`${versionedAsset(`assets/media/responsive/${basename}-960.webp`)} ${mediumWidth}w`] : []),
          `${versionedAsset(media.full)} ${width}w`
        ]
      : [];
    image.src = versionedAsset(media.full);
    if (sources.length > 1) image.srcset = sources.join(", ");
    else image.removeAttribute("srcset");
    image.sizes = sizes;
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

  function pageHero({ eyebrow, title, text, media = 15, crumbs = [], actions = "", meta = "", review = null }) {
    const highResolutionHeroByRoute = {
      "/tuning": 60,
      "/parts": 68,
      "/gallery": 52,
      "/reviews": 73,
      "/contact": 60,
      "/faq": 53,
      "/account": 53
    };
    const heroMedia = highResolutionHeroByRoute[currentPath()] || media;
    const heroMediaRecord = mediaItem(heroMedia);
    const portraitHero = Number(heroMediaRecord?.height) > Number(heroMediaRecord?.width);
    const heroMediaClass = portraitHero ? "page-hero-media is-portrait" : "page-hero-media";
    const heroMediaStyle = portraitHero ? ` style="--hero-source-width:${Number(heroMediaRecord.width)}px"` : "";
    const reviewBadge = review ? `<span class="review-badge"><b>${esc(review.number)} · ${esc(review.type)}</b><span>${esc(review.label)}</span></span>` : "";
    return `<section class="page-hero">
      <div class="${heroMediaClass}"${heroMediaStyle}>${mediaImage(heroMedia, { loading: "eager", fetchpriority: "high", className: "cover-img", sizes: "100vw" })}</div>
      <div class="page-hero-overlay"></div>
      <div class="container page-hero-content">
        ${breadcrumbs(crumbs)}
        <span class="eyebrow eyebrow-on-media">${esc(eyebrow)}</span>
        <h1 class="${review ? `review-marked review-marked-${esc(review.kind || "changed")} review-hero-title` : ""}">${reviewBadge}${esc(title)}</h1>
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

  function normalizedBrandWords(value = "") {
    return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  }

  function brandsForPart(partBrand = "") {
    const sourceWords = new Set(normalizedBrandWords(partBrand));
    const generic = new Set(["and", "brands", "brakes", "cooling", "designs", "ecu", "engineering", "flashtool", "motorsport", "motorsports", "performance", "products", "racing", "supported", "suspension", "tuning", "usa", "wheels"]);
    const allowedShort = new Set(["ap", "hp", "kw", "st"]);
    return DATA.brands.filter(brand => normalizedBrandWords(brand.name).some(word => !generic.has(word) && (word.length >= 3 || allowedShort.has(word)) && sourceWords.has(word)));
  }

  function fitmentMakes(item) {
    return [...new Set((item.applications || item.fitments || []).map(application => application.make).filter(Boolean))];
  }

  function fitmentLabel(item) {
    const labels = storeText();
    return item.fitmentStatus === "universal-confirm" ? labels.universalConfirm : labels.confirmFitment;
  }

  function storeProductPrice(product) {
    const amount = Number(product.priceAmount);
    const currency = String(product.priceCurrency || "").toUpperCase();
    if (product.quoteOnly || !storeProductPriceCheckIsFresh(product) || !Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) return storeText().requestPrice;
    const locale = state.locale === "ar" ? "ar-KW" : (currency === "GBP" ? "en-GB" : "en-US");
    const formatted = new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
    return product.priceStartingAt ? `${storeText().startingAt} ${formatted}` : formatted;
  }

  function storeProductManualFieldIsFresh(product, field) {
    if (product.stockPolicy !== "manual-confirm") return true;
    const verifiedDate = String(product[field] || "");
    const verifiedDayStarts = /^\d{4}-\d{2}-\d{2}$/.test(verifiedDate) ? Date.parse(`${verifiedDate}T00:00:00.000Z`) : NaN;
    const verifiedAt = /^\d{4}-\d{2}-\d{2}$/.test(verifiedDate) ? Date.parse(`${verifiedDate}T23:59:59.999Z`) : NaN;
    const staleAfterDays = Math.min(30, Math.max(1, Number.parseInt(product.staleAfterDays, 10) || 7));
    const now = Date.now();
    return Number.isFinite(verifiedAt)
      && Number.isFinite(verifiedDayStarts)
      && now >= verifiedDayStarts - 5 * 60_000
      && now - verifiedAt <= staleAfterDays * 86_400_000;
  }

  function storeProductPriceCheckIsFresh(product) {
    return storeProductManualFieldIsFresh(product, "priceVerifiedAt");
  }

  function storeProductStockCheckIsFresh(product) {
    return storeProductManualFieldIsFresh(product, "checkedAt");
  }

  function storeProductStatus(product, localizedProduct = localizedStoreProduct(product)) {
    if (product.stockPolicy !== "manual-confirm") return localizedProduct.status;
    return storeProductStockCheckIsFresh(product) ? localizedProduct.status : storeText().manualStockStale;
  }

  function productCard(product, index) {
    const local = localizedStoreProduct(product);
    const image = local.images?.[0];
    const provider = cleanText(local.provider || "", 80);
    const partNumber = cleanText(local.ecsPartNumber || local.sku || local.mpn || "", 120);
    const effectiveStatus = storeProductStatus(product, local);
    const observedAvailability = storeProductStockCheckIsFresh(product) ? cleanText(local.observedAvailability || "", 160) : "";
    const search = [
      product.title, product.titleAr, product.category, product.categoryAr, product.subcategory, product.subcategoryAr,
      product.brand, provider, product.ecsPartNumber, product.sku, product.mpn, product.summary, product.summaryAr,
      local.title, local.category, local.subcategory, local.summary
    ].filter(Boolean).join(" ").toLowerCase();
    const fitment = fitmentMakes(product).map(normalizedBrandWords).flat().join("|");
    const pricing = product.quoteOnly || !storeProductPriceCheckIsFresh(product) ? "quote" : "published";
    const details = [provider, local.brand, partNumber].filter(Boolean).join(" • ");
    const actionButton = productCanEnterCart(product)
      ? `<button class="icon-action is-cart-action" type="button" data-action="add-cart" data-product-id="${esc(product.slug)}" aria-label="${esc(`${commerceText().addToCart}: ${local.title}`)}">${icons.cart}</button>`
      : `<button class="icon-action" type="button" data-action="add-quote" data-id="product-${esc(local.slug)}" data-kind="Parts Product" data-title="${esc(local.title)}" data-sku="${esc(partNumber)}" data-details="${esc(details)}" aria-label="${esc(`${storeText().addToQuote}: ${local.title}`)}">${icons.quote}</button>`;
    return `<article class="part-card store-product-card filter-item" data-item-type="product" data-category="${esc(local.category)}" data-brand="${esc(String(local.brand || "").toLowerCase())}" data-supplier="${esc(provider.toLowerCase())}" data-availability="${esc(effectiveStatus)}" data-pricing="${pricing}" data-fitment-mode="${esc(product.fitmentStatus)}" data-fitment-makes="${esc(fitment)}" data-sort-name="${esc(local.title.toLowerCase())}" data-sort-category="${esc(local.category.toLowerCase())}" data-sort-brand="${esc(String(local.brand || "").toLowerCase())}" data-sort-index="${index}" data-search="${esc(search)}"><a class="part-media store-product-media" href="${routeUrl(`/parts/${local.slug}`)}"><img src="${esc(versionedAsset(image?.src || ""))}" width="${Number(image?.width) || 1}" height="${Number(image?.height) || 1}" alt="${esc(image?.alt || local.title)}" loading="lazy" decoding="async"><span>${statusBadge(effectiveStatus)}</span></a><div class="part-body"><span class="mini-label">${provider ? `${esc(U().nav.parts)} · ` : ""}${esc(local.category)}</span><h3><a href="${routeUrl(`/parts/${local.slug}`)}">${esc(local.title)}</a></h3><p>${esc(local.summary)}</p><dl>${provider ? `<div><dt>${esc(storeText().supplier)}</dt><dd><bdi>${esc(provider)}</bdi></dd></div>` : ""}<div><dt>${esc(U().common.brand)}</dt><dd><bdi>${esc(local.brand)}</bdi></dd></div><div><dt>${esc(storeText().skuMpn)}</dt><dd><bdi dir="ltr">${esc(partNumber)}</bdi></dd></div>${observedAvailability ? `<div><dt>${esc(storeText().supplierListing)}</dt><dd>${esc(observedAvailability)}</dd></div>` : ""}<div><dt>${esc(storeText().price)}</dt><dd>${esc(storeProductPrice(product))}</dd></div></dl><div class="card-footer"><a class="btn btn-sm" href="${routeUrl(`/parts/${local.slug}`)}">${esc(storeText().viewDetails)}${icons.arrow}</a>${actionButton}</div></div></article>`;
  }

  function partCard(part, index) {
    const local = localizedPart(part, index);
    const search = [
      part.title, part.category, part.brand, part.vehicle, part.summary,
      local.title, local.category, local.brand, local.vehicle, local.summary
    ].filter(Boolean).join(" ").toLowerCase();
    const brandKeys = brandsForPart(part.brand).map(brand => brand.name.toLowerCase()).join("|");
    const fitment = fitmentMakes(part).map(normalizedBrandWords).flat().join("|");
    return `<article class="part-card quote-package-card filter-item" data-item-type="package" data-category="${esc(local.category)}" data-brand="${esc(brandKeys)}" data-availability="${esc(local.status)}" data-pricing="quote" data-fitment-mode="${esc(part.fitmentStatus)}" data-fitment-makes="${esc(fitment)}" data-sort-name="${esc(local.title.toLowerCase())}" data-sort-category="${esc(local.category.toLowerCase())}" data-sort-brand="${esc(String(local.brand || "").toLowerCase())}" data-sort-index="${1000 + index}" data-search="${esc(search)}"><a class="part-media quote-package-media" href="${routeUrl(`/parts/${part.slug}`)}">${mediaImage(local.media, { thumb: true, className: "contain-img" })}<span>${statusBadge(local.status)}</span><small>${esc(storeText().contextImage)}</small></a><div class="part-body"><span class="mini-label">${esc(storeText().configuredPackage)} · ${esc(local.category)}</span><h3><a href="${routeUrl(`/parts/${part.slug}`)}">${esc(local.title)}</a></h3><p>${esc(local.summary)}</p><dl><div><dt>${esc(U().common.brand)}</dt><dd>${esc(local.brand)}</dd></div><div><dt>${esc(U().common.vehicle)}</dt><dd>${esc(local.vehicle)}</dd></div><div><dt>${esc(storeText().fitment)}</dt><dd>${esc(fitmentLabel(part))}</dd></div><div><dt>${esc(U().common.quotation)}</dt><dd>${esc(storeText().requestPrice)}</dd></div></dl><div class="card-footer"><a class="btn btn-sm" href="${routeUrl(`/parts/${part.slug}`)}">${esc(storeText().viewDetails)}${icons.arrow}</a><button class="icon-action" type="button" data-action="add-quote" data-id="package-${esc(part.slug)}" data-kind="Parts Package" data-title="${esc(local.title)}" data-details="${esc(`${local.brand} • ${local.vehicle}`)}" aria-label="${esc(`${storeText().addToQuote}: ${local.title}`)}">${icons.quote}</button></div></div></article>`;
  }

  function brandCard(brand) {
    const category = categoryLabel(brand.category);
    const relationship = relationshipLabel(brand.relationship);
    const search = [brand.name, brand.category, category, brand.relationship, relationship].join(" ").toLowerCase();
    return `<article class="brand-card filter-item" data-category="${esc(category)}" data-search="${esc(search)}">${brandLogoMarkup(brand)}<div><h3 dir="ltr">${esc(brand.name)}</h3><p>${esc(category)}</p>${statusBadge(relationship)}</div><button class="icon-action" type="button" data-action="open-form" data-form-type="Brand / Parts Enquiry" data-context="${esc(brand.name)}" aria-label="${esc(`${U().actions.enquire}: ${brand.name}`)}">${icons.arrow}</button></article>`;
  }

  function brandLogoMarkup(brand, { compact = false, inline = false } = {}) {
    const logos = BRAND_LOGOS[brand.name] || [];
    const compactClass = compact ? " is-compact" : "";
    const pairClass = logos.length > 1 ? " is-pair" : "";
    const tag = inline ? "span" : "div";
    if (!logos.length) {
      const initials = brand.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
      return `<${tag} class="brand-mark${compactClass}" aria-hidden="true">${esc(initials)}</${tag}>`;
    }
    return `<${tag} class="brand-mark brand-logo-mark${compactClass}${pairClass}" aria-hidden="true">${logos.map(source => `<img src="${esc(versionedAsset(source))}" alt="" loading="lazy" decoding="async">`).join("")}</${tag}>`;
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
        return `<details class="nav-dropdown"><summary class="nav-link ${active ? "is-active" : ""}">${esc(label)}<span aria-hidden="true">⌄</span></summary><div class="nav-dropdown-panel"><a href="${routeUrl("/services")}"${currentPath() === "/services" ? ' aria-current="page"' : ""}>${esc(ui.actions.viewAllServices)}</a>${services.map(service => { const servicePath = serviceHref(service.slug); return `<a href="${routeUrl(servicePath)}"${currentPath() === normalizeRoute(servicePath) ? ' aria-current="page"' : ""}>${esc(service.title)}</a>`; }).join("")}</div></details>`;
      }
      if (key === "tuning") {
        return `<details class="nav-dropdown"><summary class="nav-link ${active ? "is-active" : ""}">${esc(label)}<span aria-hidden="true">⌄</span></summary><div class="nav-dropdown-panel"><a href="${routeUrl("/tuning")}"${currentPath() === "/tuning" ? ' aria-current="page"' : ""}>${esc(label)}</a>${tuning.map(platform => { const platformPath = `/tuning/${platform.slug}`; return `<a href="${routeUrl(platformPath)}"${currentPath() === normalizeRoute(platformPath) ? ' aria-current="page"' : ""}>${esc(platform.short)}</a>`; }).join("")}</div></details>`;
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
      [ui.nav.about, "/about"], [ui.nav.reviews, "/reviews"], [ui.nav.faq, "/faq"], [ui.nav.contact, "/contact"],
      [commerceText().cart, "/cart"],
      [state.locale === "ar" ? "حساب العميل" : "Customer account", "/account"]
    ].map(([label, path, child]) => `<a class="mobile-nav-link ${child ? "is-child" : ""} ${routeActive(path) ? "is-active" : ""}" href="${routeUrl(path)}" ${routeActive(path) ? 'aria-current="page"' : ""}>${esc(label)}</a>`).join("");

    const alternate = alternateLocale();
    const alternateShortName = alternate === "ar" ? "AR" : "EN";
    const alternateName = alternate === "ar" ? "العربية" : "English";
    const alternateRoute = localizedCurrentRouteUrl(alternate);
    const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const logoUrl = versionedAsset(CONFIG.logoHeader || "assets/brand/projx-racing-logo-header.png");
    return `<div class="header-shell"><div class="container header-inner"><a class="brand-logo" href="${routeUrl("/")}" aria-label="Projx Racing"><span class="brand-logo-frame"><img src="${esc(logoUrl)}" alt="Projx Racing Motorsports" width="354" height="146"></span></a><nav class="desktop-nav" aria-label="${esc(ui.menu)}">${nav}</nav><div class="header-tools"><a class="tool-button language-button" href="${esc(alternateRoute)}" data-language="${alternate}" aria-label="${esc(ui.accessibility.languageButton)}">${icons.globe}<span>${esc(alternateShortName)}</span></a><button class="tool-button theme-button" type="button" data-action="toggle-theme" aria-label="${esc(ui.accessibility.themeButton)}">${theme === "dark" ? icons.sun : icons.moon}<span class="tool-label">${esc(theme === "dark" ? ui.lightTheme : ui.darkTheme)}</span></button><a class="header-contact" href="${waUrl(state.locale === "ar" ? "هلا Projx Racing، حاب أستفسر عن سيارتي." : "Hello Projx Racing, I would like to discuss my vehicle.")}" target="_blank" rel="noopener" aria-label="${esc(ui.actions.whatsapp)}">${icons.whatsapp}<span>${esc(ui.actions.whatsapp)}</span></a><button class="menu-button" type="button" data-action="toggle-menu" aria-expanded="${state.mobileOpen}" aria-controls="mobile-navigation" aria-label="${esc(state.mobileOpen ? ui.closeMenu : ui.accessibility.openMenu)}">${state.mobileOpen ? icons.close : icons.menu}</button></div></div></div><div class="mobile-menu-backdrop ${state.mobileOpen ? "is-open" : ""}" data-action="close-menu" aria-hidden="true"></div><aside id="mobile-navigation" class="mobile-nav ${state.mobileOpen ? "is-open" : ""}" aria-hidden="${!state.mobileOpen}" ${state.mobileOpen ? "" : "inert"}><div class="mobile-nav-head"><strong>${esc(ui.menu)}</strong><button class="icon-btn" type="button" data-action="close-menu" aria-label="${esc(ui.closeMenu)}">${icons.close}</button></div><nav aria-label="${esc(ui.menu)}">${mobileLinks}</nav><div class="mobile-nav-settings"><a class="setting-row" href="${esc(alternateRoute)}" data-language="${alternate}">${icons.globe}<span>${esc(ui.language)}</span><strong>${esc(alternateName)}</strong></a><button class="setting-row" type="button" data-action="toggle-theme">${theme === "dark" ? icons.sun : icons.moon}<span>${esc(ui.theme)}</span><strong>${esc(theme === "dark" ? ui.lightTheme : ui.darkTheme)}</strong></button></div><div class="mobile-nav-actions"><a class="btn" href="${waUrl(state.locale === "ar" ? "هلا Projx Racing، حاب أستفسر عن سيارتي." : "Hello Projx Racing, I would like to discuss my vehicle.")}" target="_blank" rel="noopener">${esc(ui.actions.whatsapp)}${icons.whatsapp}</a><button class="btn btn-outline" type="button" data-action="open-form" data-form-type="General Quote">${esc(ui.actions.requestQuote)}${icons.quote}</button></div></aside>`;
  }

  function footerHtml() {
    const ui = U();
    const services = DATA.services.filter(item => ["ecu-dyno-tuning", "online-tuning", "engine-building", "race-car-preparation"].includes(item.slug)).map(localizedService);
    const yearText = new Date().getFullYear();
    const logoUrl = versionedAsset(CONFIG.logoHeader || "assets/brand/projx-racing-logo-header.png");
    return `<div class="footer-main"><div class="container footer-grid footer-grid-simple"><div class="footer-brand"><span class="brand-logo-frame footer-logo"><img src="${esc(logoUrl)}" alt="Projx Racing Motorsports" width="354" height="146"></span><div class="footer-social"><a href="${CONFIG.instagramUrl}" target="_blank" rel="noopener" aria-label="Instagram">${icons.instagram}</a><a href="${waUrl()}" target="_blank" rel="noopener" aria-label="WhatsApp">${icons.whatsapp}</a><a href="${CONFIG.mapsUrl}" target="_blank" rel="noopener" aria-label="${esc(ui.actions.directions)}">${icons.map}</a></div></div><div><h2>${esc(ui.nav.services)}</h2>${services.map(service => `<a href="${routeUrl(serviceHref(service.slug))}">${esc(service.title)}</a>`).join("")}<a href="${routeUrl("/projects")}">${esc(ui.nav.projects)}</a></div><div><h2>${esc(ui.nav.contact)}</h2><p>${esc(CONFIG.addressLine1)}<br>${esc(CONFIG.addressLine2)}<br>${esc(CONFIG.cityCountry)}</p><a href="${telUrl()}"><bdi>${esc(CONFIG.phoneDisplay)}</bdi></a><a href="${waUrl()}" target="_blank" rel="noopener">WhatsApp</a><a href="${CONFIG.mapsUrl}" target="_blank" rel="noopener">${esc(ui.actions.directions)}</a></div></div></div><div class="footer-bottom"><div class="container"><p>© ${yearText} Projx Racing Co.</p></div></div>`;
  }

  function renderHeader() {
    header.innerHTML = headerHtml();
    const languageButton = header.querySelector(".header-tools .language-button");
    const count = cartCount();
    languageButton?.insertAdjacentHTML("beforebegin", `<a class="tool-button cart-button" href="${routeUrl("/cart")}" aria-label="${esc(`${commerceText().cart}${count ? ` (${count})` : ""}`)}">${icons.cart}<span class="tool-label">${esc(commerceText().cart)}</span>${count ? `<span class="tool-count" aria-hidden="true">${count}</span>` : ""}</a><a class="tool-button account-button" href="${routeUrl("/account")}" aria-label="${esc(state.locale === "ar" ? "حساب العميل" : "Customer account")}">${icons.user}<span class="tool-label">${esc(state.locale === "ar" ? "الحساب" : "Account")}</span></a>`);
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
    const count = quoteCount();
    const cartItems = cartCount();
    desktop.innerHTML = `<a class="floating-btn whatsapp" href="${waUrl()}" target="_blank" rel="noopener" aria-label="WhatsApp">${icons.whatsapp}</a><a class="floating-btn cart-floating-btn" href="${routeUrl("/cart")}" aria-label="${esc(`${commerceText().cart}${cartItems ? ` (${cartItems})` : ""}`)}">${icons.cart}${cartItems ? `<span class="floating-count">${cartItems}</span>` : ""}</a><button class="floating-btn" type="button" data-action="open-quote" aria-label="${esc(ui.actions.openQuote)}">${icons.quote}${count ? `<span class="floating-count">${count}</span>` : ""}</button>`;
    document.body.append(desktop);
    const mobile = document.createElement("nav");
    mobile.className = "mobile-action-bar";
    mobile.setAttribute("aria-label", ui.nav.contact);
    mobile.innerHTML = `<a href="${telUrl()}">${icons.phone}<span>${esc(state.locale === "ar" ? "اتصال" : "Call")}</span></a><a class="wa" href="${waUrl()}" target="_blank" rel="noopener">${icons.whatsapp}<span>WhatsApp</span></a><a href="${routeUrl("/cart")}">${icons.cart}<span>${esc(commerceText().cart)}${cartItems ? ` (${cartItems})` : ""}</span></a><button type="button" data-action="open-quote">${icons.quote}<span>${esc(state.locale === "ar" ? "سعر" : "Quote")}${count ? ` (${count})` : ""}</span></button>`;
    document.body.append(mobile);
  }

  function trustBar() {
    const ui = U();
    return `<section class="trust-bar"><div class="container trust-grid"><div><span>${esc(ui.common.location)}</span><strong>${esc(CONFIG.locationShort)}</strong><small>${esc(CONFIG.addressLine1)}</small></div><div><span>${esc(ui.common.dyno)}</span><strong>Mainline</strong><small>${state.locale === "ar" ? "برمجة وقياس مضبوط" : "Controlled calibration and testing"}</small></div><div><span>${esc(ui.common.onlineTuning)}</span><strong>MHD • COBB • HP Tuners</strong><small>S55 • B58 • S58 • Porsche • GM LS/LT</small></div><div><span>${esc(ui.common.engineBuilding)}</span><strong>GM LS/LT • Ford Coyote</strong><small>${state.locale === "ar" ? "LS/LT وCoyote فقط" : "GM LS/LT and Coyote-only routes"}</small></div><div><span>${esc(ui.common.officialContact)}</span><strong><bdi>${esc(CONFIG.phoneDisplay)}</bdi></strong><small>${state.locale === "ar" ? "اتصال أو WhatsApp" : "Call or WhatsApp"}</small></div></div></section>${accomplishmentsSection()}`;
  }

  function accomplishmentsSection() {
    const isAr = state.locale === "ar";
    const copy = isAr ? {
      eyebrow: "إنجازات موثقة",
      heading: "نتائج تم تحقيقها وتسجيلها.",
      text: "نعرض فقط النتائج الموجودة في سجلات Projx Racing. أرقام اللفات تاريخية وليست ادعاءً بأنها أرقام قياسية حالية.",
      action: "شاهد المشاريع الموثقة",
      marker: "كل الإنجازات المؤكدة من البيانات السابقة",
      labels: ["لفة مسجلة على KMT GP", "مراكز أولى في GR Yaris Cup", "KMTC 2K Touring — الجولتان 3 و4", "نتيجة GulfRun"],
      details: ["نتيجة تاريخية من ديسمبر 2024", "نتائج منافسات مقدمة من Projx Racing", "مركز أول في الجولتين", "نتيجة منافسة مقدمة من Projx Racing"]
    } : {
      eyebrow: "Verified accomplishments",
      heading: "Results earned and recorded.",
      text: "Only results held in Projx Racing's supplied records are shown. Historical lap times are not presented as current circuit records.",
      action: "View documented projects",
      marker: "All confirmed accomplishments from the previous data",
      labels: ["KMT GP recorded lap", "GR Yaris Cup finishes", "KMTC 2K Touring — Rounds 3 & 4", "GulfRun result"],
      details: ["Historical result from December 2024", "Competition results supplied by Projx Racing", "First place in both rounds", "Competition result supplied by Projx Racing"]
    };
    const results = (DATA.results || []).map((result, index) => ({
      value: result.value,
      label: copy.labels[index] || result.label,
      detail: copy.details[index] || result.detail
    }));
    return `<section class="section accomplishments-section"><div class="container"><div class="accomplishments-shell review-marked review-marked-new"><span class="review-badge"><b>06 · ${esc(isAr ? "جديد" : "NEW")}</b><span>${esc(copy.marker)}</span></span>${sectionHead(copy.eyebrow, copy.heading, copy.text, `<a class="text-link" href="${routeUrl("/projects")}">${esc(copy.action)}${icons.arrow}</a>`)}<div class="accomplishments-grid">${results.map(result => `<article><strong dir="ltr">${esc(result.value)}</strong><h3>${esc(result.label)}</h3><p>${esc(result.detail)}</p></article>`).join("")}</div></div></div></section>`;
  }

  function homePage() {
    const page = P().home;
    const featuredServices = DATA.services.filter(item => !["online-tuning", "engine-building"].includes(item.slug)).slice(0, 8);
    const featuredProjects = ["honda-s2000-kmt", "supra-b58-time-attack", "gr-yaris-kmt-cup", "k20-brz-road-race"].map(slug => DATA.projects.find(item => item.slug === slug)).filter(Boolean);
    const featuredBrands = ["MHD Tuning", "COBB Tuning", "HP Tuners", "MoTeC", "Link ECU", "Haltech", "MaxxECU", "KW Suspension", "Nitron Suspension", "Essex Brakes / AP Racing", "CSF Cooling", "Tegiwa Motorsports"].map(name => DATA.brands.find(item => item.name === name)).filter(Boolean);
    const heroActions = `<a class="btn" href="${routeUrl("/services")}">${esc(U().actions.exploreServices)}${icons.arrow}</a><a class="btn btn-outline-light" href="${routeUrl("/projects")}">${esc(U().actions.viewProjects)}${icons.arrow}</a><button class="btn btn-ghost-light" type="button" data-action="open-form" data-form-type="General Quote">${esc(U().actions.requestQuote)}${icons.quote}</button>`;
    return `<section class="home-hero"><div class="home-hero-media">${mediaImage(35, { loading: "eager", fetchpriority: "high", className: "cover-img", sizes: "100vw" })}</div><div class="home-hero-overlay"></div><div class="container home-hero-grid"><div class="home-hero-copy"><span class="eyebrow eyebrow-on-media">${esc(page.eyebrow)}</span><h1>${esc(page.heading)}</h1><p>${esc(page.intro)}</p><div class="btn-row">${heroActions}</div><div class="hero-links"><a href="${routeUrl("/tuning")}">${esc(U().nav.tuning)}${icons.arrow}</a><a href="${routeUrl("/engine-building")}">${esc(U().nav.engineBuilding)}${icons.arrow}</a><a href="${routeUrl("/gallery")}">${esc(U().nav.gallery)}${icons.arrow}</a></div></div><aside class="hero-side-panel"><div><span>Mainline</span><strong>Chassis Dyno</strong><small>${state.locale === "ar" ? "برمجة، Logging واختبار تحت السيطرة" : "Calibration, logging and controlled testing"}</small></div><div><span>${esc(U().common.engineBuilding)}</span><strong>GM LS / LT</strong><small>${state.locale === "ar" ? "Complete Engines وLong Blocks وإعادة بناء" : "Complete engines, long blocks, rebuilds and upgrades"}</small></div><div><span>Motorsport Electronics</span><strong>ECU • PDM • CAN</strong><small>${state.locale === "ar" ? "Wiring وحساسات وData Systems" : "Wiring, sensors and data systems"}</small></div></aside></div></section>${trustBar()}<section class="section"><div class="container">${sectionHead(page.serviceEyebrow, page.serviceHeading, page.serviceText, `<a class="text-link" href="${routeUrl("/services")}">${esc(U().actions.viewAllServices)}${icons.arrow}</a>`)}<div class="card-grid">${featuredServices.map(serviceCard).join("")}</div><div class="section-inline-actions"><a class="btn btn-outline" href="${routeUrl("/tuning")}">${esc(U().nav.tuning)}${icons.arrow}</a><a class="btn btn-outline" href="${routeUrl("/engine-building")}">${esc(U().nav.engineBuilding)}${icons.arrow}</a></div></div></section><section class="section section-tone"><div class="container">${sectionHead(page.whyEyebrow, page.whyHeading, page.whyText)}<div class="value-grid">${page.whyCards.map(([title, text], index) => `<article><span>${compactNumber(index + 1)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join("")}</div></div></section><section class="section"><div class="container">${sectionHead(page.projectsEyebrow, page.projectsHeading, page.projectsText, `<a class="text-link" href="${routeUrl("/projects")}">${esc(U().actions.viewAllProjects)}${icons.arrow}</a>`)}<div class="project-grid">${featuredProjects.map(projectCard).join("")}</div></div></section><section class="section section-dark-media"><div class="container feature-layout"><div class="feature-copy"><span class="eyebrow eyebrow-on-media">${esc(page.capabilitiesEyebrow)}</span><h2>${esc(page.capabilitiesHeading)}</h2><p>${esc(page.capabilitiesText)}</p><div class="feature-stat-grid"><div><strong>Mainline</strong><span>${state.locale === "ar" ? "Dyno Tuning" : "Dyno calibration"}</span></div><div><strong>LS / LT</strong><span>${state.locale === "ar" ? "بناء محركات" : "Engine building"}</span></div><div><strong>ECU / PDM</strong><span>Motorsport Wiring</span></div><div><strong>KMT</strong><span>${state.locale === "ar" ? "دعم وتطوير حلبة" : "Track support"}</span></div></div><a class="btn btn-light" href="${routeUrl("/gallery")}">${esc(U().actions.viewGallery)}${icons.arrow}</a></div><div class="feature-media-grid"><button type="button" data-action="open-media" data-media-id="20" data-gallery-key="home-capability">${mediaImage(20, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="19" data-gallery-key="home-capability">${mediaImage(19, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="24" data-gallery-key="home-capability">${mediaImage(24, { thumb: true, className: "cover-img" })}</button><button type="button" data-action="open-media" data-media-id="23" data-gallery-key="home-capability">${mediaImage(23, { thumb: true, className: "cover-img" })}</button></div></div></section><section class="section"><div class="container">${sectionHead(page.brandsEyebrow, page.brandsHeading, page.brandsText, `<a class="text-link" href="${routeUrl("/brands")}">${esc(U().actions.viewBrands)}${icons.arrow}</a>`)}<div class="brand-strip">${featuredBrands.map(brand => `<div class="brand-strip-item">${brandLogoMarkup(brand, { compact: true })}<span class="brand-strip-copy"><strong dir="ltr">${esc(brand.name)}</strong><small>${esc(categoryLabel(brand.category))}</small></span></div>`).join("")}</div></div></section><section class="section section-tone"><div class="container reviews-feature"><div>${mediaImage(15, { thumb: true, className: "cover-img" })}</div><div><span class="eyebrow">${esc(page.reviewsEyebrow)}</span><h2>${esc(page.reviewsHeading)}</h2><p>${esc(page.reviewsText)}</p><div class="btn-row"><a class="btn" href="${CONFIG.googleBusinessUrl}" target="_blank" rel="noopener">${esc(U().actions.openGoogleReviews)}${icons.arrow}</a><a class="btn btn-outline" href="${routeUrl("/reviews")}">${esc(U().actions.learnMore)}${icons.arrow}</a></div></div></div></section>${ctaBlock(page.contactHeading, page.contactText, U().actions.contactWorkshop, "Workshop Consultation")}`;
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
    const raceContact = slug === "race-car-preparation" ? raceProgrammeContact() : "";
    return `${pageHero({ eyebrow: service.kicker, title: service.title, text: service.summary, media: service.media?.[0] || 15, crumbs: [[U().nav.services, "/services"], [service.title]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="${esc(service.title)} Enquiry" data-context="${esc(service.title)}">${esc(U().actions.requestQuote)}${icons.arrow}</button><a class="btn btn-outline-light" href="${waUrl(`${state.locale === "ar" ? "هلا Projx Racing، حاب أستفسر عن خدمة" : "Hello Projx Racing, I would like to enquire about"} ${service.title}.`)}" target="_blank" rel="noopener">${esc(U().actions.whatsapp)}${icons.whatsapp}</a>` })}${raceContact}<section class="section"><div class="container service-intro-grid"><div><span class="eyebrow">${esc(U().common.whatWeDo)}</span><h2>${esc(service.title)}</h2><p class="lead">${esc(service.intro)}</p>${featureList(service.features || [])}</div><aside class="content-panel"><span class="mini-label">${esc(U().common.supportedSystems)}</span>${tags(service.platforms || [])}<div class="divider"></div><p>${esc(service.cta)}</p><button class="btn btn-block" type="button" data-action="open-form" data-form-type="${esc(service.title)} Enquiry" data-context="${esc(service.title)}">${esc(U().actions.contactWorkshop)}${icons.arrow}</button></aside></div></section><section class="section section-tone"><div class="container">${sectionHead(U().common.howItWorks, state.locale === "ar" ? "خطوات واضحة من الفحص إلى التسليم." : "A clear process from inspection to handover.")}${numberSteps((service.process || []).map(item => [item, ""]))}</div></section><section class="section"><div class="container detail-two-column"><div>${gallery(service.media || [], `service-${slug}`, service.title)}</div><div class="content-panel"><span class="eyebrow">${esc(U().common.whatYouReceive)}</span><h2>${state.locale === "ar" ? "نطاق وتسليم موثق." : "Defined scope and documented handover."}</h2>${featureList(service.deliverables || [])}</div></div></section><section class="section section-tone"><div class="container">${sectionHead(U().common.relatedProjects, state.locale === "ar" ? "شغل مرتبط بالخدمة من داخل الورشة." : "Related work from the Projx Racing workshop.")}<div class="project-grid">${related.map(projectCard).join("")}</div></div></section>${ctaBlock(state.locale === "ar" ? `ناقش خدمة ${service.title}.` : `Discuss ${service.title}.`, service.cta, U().actions.requestQuote, `${service.title} Enquiry`)}`;
  }

  function tuningFinder() {
    const isAr = state.locale === "ar";
    const platforms = Object.values(DATA.tuningPlatforms).map(localizedPlatform);
    const makes = [...new Set(platforms.flatMap(platform => platform.makes || []))];
    const initialMake = makes.includes("BMW") ? "BMW" : makes[0];
    const platform = platforms.find(item => (item.makes || []).includes(initialMake)) || platforms[0];
    const engine = platform?.engines?.[0] || "";
    const model = platform?.models?.[engine]?.[0] || "";
    const tuneType = platform?.tuneTypes?.[0] || "";
    const fuel = platform?.fuels?.[0] || "";
    const context = [platform?.short, initialMake, model, engine, tuneType, fuel].filter(Boolean).join(" • ");
    const labels = isAr ? {
      reviewTitle: "وضع مراجعة التغييرات",
      reviewIntro: "الأصفر يوضح الإضافات الجديدة. الأزرق يوضح العنصر الموجود الذي تم تعديله.",
      reviewNew: "جديد",
      reviewChanged: "تم التعديل",
      reviewHide: "إخفاء العلامات",
      reviewShow: "إظهار العلامات",
      reviewHero: "زر البداية يفتح محدد المسار",
      reviewIntroBlock: "شرح جديد يبدأ من السيارة",
      reviewSteps: "مسار واضح من ثلاث خطوات",
      reviewFilters: "اختيارات السيارة والخدمة",
      reviewMatch: "ترشيح مباشر لمنصة البرمجة",
      reviewHandoff: "انتقال لفحص التوافق",
      eyebrow: "تصور مبدئي للتحسين",
      heading: "حدد سيارتك. وخلك على المسار الصحيح من البداية.",
      intro: "اختيارات واضحة تربط السيارة والمحرك والوقود بمنصة البرمجة المناسبة قبل إرسال طلب التوافق.",
      first: "حدد السيارة",
      firstText: "الشركة والمحرك والموديل",
      second: "اختر الخدمة",
      secondText: "نوع البرمجة والوقود",
      third: "راجع التوافق",
      thirdText: "الجهاز والفتح والحالة الميكانيكية",
      details: "بيانات السيارة والخدمة",
      make: "الشركة",
      engine: "المحرك",
      model: "الموديل",
      service: "الخدمة المطلوبة",
      fuel: "الوقود",
      match: "المسار المقترح",
      platform: "منصة البرمجة",
      selected: "اختيارك",
      requirements: "المطلوب قبل البدء",
      view: "شوف تفاصيل المنصة",
      continue: "كمل فحص التوافق",
      note: "لا يتم اعتماد السعر أو بدء البرمجة قبل تأكيد السيارة ووحدة التحكم والجهاز والوقود والحالة الميكانيكية."
    } : {
      reviewTitle: "Change review overlay",
      reviewIntro: "Yellow marks new functionality. Blue marks an existing element that was changed.",
      reviewNew: "NEW",
      reviewChanged: "CHANGED",
      reviewHide: "Hide markers",
      reviewShow: "Show markers",
      reviewHero: "Hero action now opens the finder",
      reviewIntroBlock: "New vehicle-first introduction",
      reviewSteps: "New three-step guidance",
      reviewFilters: "New vehicle and service filters",
      reviewMatch: "New live platform recommendation",
      reviewHandoff: "New compatibility handoff",
      eyebrow: "Optimization concept preview",
      heading: "Choose the vehicle. Start on the right tuning route.",
      intro: "A clearer path connects the vehicle, engine and fuel to the correct tuning platform before a compatibility request is submitted.",
      first: "Identify the vehicle",
      firstText: "Make, engine and model",
      second: "Choose the service",
      secondText: "Tune type and available fuel",
      third: "Confirm compatibility",
      thirdText: "Device, unlock and mechanical condition",
      details: "Vehicle and service details",
      make: "Make",
      engine: "Engine",
      model: "Model",
      service: "Required service",
      fuel: "Available fuel",
      match: "Recommended route",
      platform: "Tuning platform",
      selected: "Your selection",
      requirements: "Required before starting",
      view: "View platform details",
      continue: "Continue compatibility check",
      note: "Price and work are not approved until the vehicle, controller, device, fuel and mechanical condition have been confirmed."
    };

    return `<section id="tuning-finder" class="section tuning-finder-section"><div class="container">
      <div class="review-toolbar" role="note" aria-label="${esc(labels.reviewTitle)}"><div><span class="review-toolbar-title">${esc(labels.reviewTitle)}</span><p>${esc(labels.reviewIntro)}</p></div><div class="review-toolbar-actions"><span class="review-key review-key-new"><i></i>${esc(labels.reviewNew)}</span><span class="review-key review-key-changed"><i></i>${esc(labels.reviewChanged)}</span><button class="review-toggle" type="button" data-action="toggle-review-markers" data-hide-label="${esc(labels.reviewHide)}" data-show-label="${esc(labels.reviewShow)}" aria-pressed="true"><span data-role="review-toggle-label">${esc(labels.reviewHide)}</span></button></div></div>
      <div class="tuning-finder-heading review-marked review-marked-new" data-review-number="02"><span class="review-badge"><b>02 · ${esc(labels.reviewNew)}</b><span>${esc(labels.reviewIntroBlock)}</span></span><div><span class="eyebrow eyebrow-on-media">${esc(labels.eyebrow)}</span><h2>${esc(labels.heading)}</h2></div><p>${esc(labels.intro)}</p></div>
      <div class="finder-steps review-marked review-marked-new" data-review-number="03" aria-label="${esc(labels.heading)}"><span class="review-badge"><b>03 · ${esc(labels.reviewNew)}</b><span>${esc(labels.reviewSteps)}</span></span>
        <div><span>01</span><strong>${esc(labels.first)}</strong><small>${esc(labels.firstText)}</small></div>
        <div><span>02</span><strong>${esc(labels.second)}</strong><small>${esc(labels.secondText)}</small></div>
        <div><span>03</span><strong>${esc(labels.third)}</strong><small>${esc(labels.thirdText)}</small></div>
      </div>
      <div class="tuning-finder-shell" data-tuning-finder>
        <div class="tuning-finder-controls review-marked review-marked-new" data-review-number="04"><span class="review-badge"><b>04 · ${esc(labels.reviewNew)}</b><span>${esc(labels.reviewFilters)}</span></span><span class="mini-label">${esc(labels.details)}</span><div class="finder-control-grid">
          <label><span>${esc(labels.make)}</span><select class="select" data-role="finder-make">${optionList(makes, initialMake)}</select></label>
          <label><span>${esc(labels.engine)}</span><select class="select" data-role="finder-engine">${optionList(platform?.engines || [], engine)}</select></label>
          <label class="full"><span>${esc(labels.model)}</span><select class="select" data-role="finder-model">${optionList(platform?.models?.[engine] || [], model)}</select></label>
          <label class="full"><span>${esc(labels.service)}</span><select class="select" data-role="finder-service">${optionList(platform?.tuneTypes || [], tuneType)}</select></label>
          <label class="full"><span>${esc(labels.fuel)}</span><select class="select" data-role="finder-fuel">${optionList(platform?.fuels || [], fuel)}</select></label>
        </div></div>
        <aside class="tuning-finder-result review-marked review-marked-new" data-review-number="05" aria-live="polite"><span class="review-badge"><b>05 · ${esc(labels.reviewNew)}</b><span>${esc(labels.reviewMatch)}</span></span>
          <div class="finder-result-top"><span class="mini-label">${esc(labels.match)}</span>${statusBadge("Compatibility Check Required")}</div>
          <span class="finder-platform-label">${esc(labels.platform)}</span><h3 data-role="finder-title">${esc(platform?.short || "")}</h3><p data-role="finder-scope">${esc(platform?.supportedScope || "")}</p>
          <div class="finder-result-facts"><div><span>${esc(labels.selected)}</span><strong data-role="finder-selection">${esc([model, engine].filter(Boolean).join(" • "))}</strong></div><div><span>${esc(labels.service)}</span><strong data-role="finder-service-summary">${esc(tuneType)}</strong></div></div>
          <div class="finder-requirements"><strong>${esc(labels.requirements)}</strong><ul data-role="finder-requirements">${(platform?.requirements || []).slice(0, 3).map(item => `<li>${icons.check}<span>${esc(item)}</span></li>`).join("")}</ul></div>
          <div class="finder-actions review-marked review-marked-new" data-review-number="06"><span class="review-badge"><b>06 · ${esc(labels.reviewNew)}</b><span>${esc(labels.reviewHandoff)}</span></span><a class="btn btn-outline-light" data-role="finder-detail" href="${routeUrl(`/tuning/${platform?.slug || "mhd"}`)}">${esc(labels.view)}${icons.arrow}</a><button class="btn btn-light" type="button" data-action="open-form" data-role="finder-review" data-form-type="Online Tuning Compatibility Review" data-context="${esc(context)}">${esc(labels.continue)}${icons.arrow}</button></div>
        </aside>
      </div>
      <p class="finder-note">${icons.check}<span>${esc(labels.note)}</span></p>
    </div></section>`;
  }

  function updateTuningFinder(component) {
    if (!component) return;
    const platforms = Object.values(DATA.tuningPlatforms).map(localizedPlatform);
    const makeSelect = component.querySelector('[data-role="finder-make"]');
    const engineSelect = component.querySelector('[data-role="finder-engine"]');
    const modelSelect = component.querySelector('[data-role="finder-model"]');
    const serviceSelect = component.querySelector('[data-role="finder-service"]');
    const fuelSelect = component.querySelector('[data-role="finder-fuel"]');
    const platform = platforms.find(item => (item.makes || []).includes(makeSelect?.value)) || platforms[0];
    if (!platform || !makeSelect || !engineSelect || !modelSelect || !serviceSelect || !fuelSelect) return;

    const previousEngine = engineSelect.value;
    const engine = (platform.engines || []).includes(previousEngine) ? previousEngine : platform.engines?.[0] || "";
    engineSelect.innerHTML = optionList(platform.engines || [], engine);
    const models = platform.models?.[engine] || [];
    const model = models.includes(modelSelect.value) ? modelSelect.value : models[0] || "";
    modelSelect.innerHTML = optionList(models, model);
    const tuneType = (platform.tuneTypes || []).includes(serviceSelect.value) ? serviceSelect.value : platform.tuneTypes?.[0] || "";
    serviceSelect.innerHTML = optionList(platform.tuneTypes || [], tuneType);
    const fuel = (platform.fuels || []).includes(fuelSelect.value) ? fuelSelect.value : platform.fuels?.[0] || "";
    fuelSelect.innerHTML = optionList(platform.fuels || [], fuel);

    component.querySelector('[data-role="finder-title"]').textContent = platform.short;
    component.querySelector('[data-role="finder-scope"]').textContent = platform.supportedScope;
    component.querySelector('[data-role="finder-selection"]').textContent = [model, engine].filter(Boolean).join(" • ");
    component.querySelector('[data-role="finder-service-summary"]').textContent = tuneType;
    component.querySelector('[data-role="finder-requirements"]').innerHTML = (platform.requirements || []).slice(0, 3).map(item => `<li>${icons.check}<span>${esc(item)}</span></li>`).join("");
    component.querySelector('[data-role="finder-detail"]').href = routeUrl(`/tuning/${platform.slug}`);
    component.querySelector('[data-role="finder-review"]').dataset.context = [platform.short, makeSelect.value, model, engine, tuneType, fuel].filter(Boolean).join(" • ");
  }

  function setupTuningFinder() {
    document.querySelectorAll("[data-tuning-finder]").forEach(updateTuningFinder);
  }

  function tuningLandingPage() {
    const page = P().tuning;
    const platforms = Object.values(DATA.tuningPlatforms).map(localizedPlatform);
    const heroReview = state.locale === "ar" ? "زر البداية يفتح محدد المسار" : "Hero action now opens the finder";
    const reviewChanged = state.locale === "ar" ? "تم التعديل" : "CHANGED";
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 36, crumbs: [[U().nav.tuning]], actions: `<a class="btn review-marked review-marked-changed review-hero-action" data-review-number="01" href="${routeUrl('/tuning')}#tuning-finder"><span class="review-badge"><b>01 · ${esc(reviewChanged)}</b><span>${esc(heroReview)}</span></span>${esc(state.locale === "ar" ? "حدد مسار البرمجة" : "Find Your Tuning Route")}${icons.arrow}</a>` })}${tuningFinder()}<section class="section"><div class="container">${sectionHead(U().common.platform, page.platformsHeading, page.platformsText)}<div class="platform-grid">${platforms.map(platformCard).join("")}</div></div></section><section class="section section-tone"><div class="container">${sectionHead(U().common.howItWorks, page.processHeading)}${numberSteps(page.process)}</div></section><section class="section"><div class="container safety-panel"><div>${mediaImage(7, { thumb: true, className: "cover-img" })}</div><div><span class="eyebrow">${esc(state.locale === "ar" ? "السلامة والتوافق" : "Safety & Compatibility")}</span><h2>${esc(page.safetyHeading)}</h2><p>${esc(page.safetyText)}</p>${featureList(state.locale === "ar" ? ["تأكيد الوقود المتوفر", "فحص الأعطال قبل البدء", "التأكد من نظام الوقود والتبريد", "الالتزام بتعليمات الـ Logging", "استخدام Dyno أو حلبة مناسبة عند الحاجة"] : ["Confirm the available fuel", "Resolve faults before development", "Verify fuel and cooling systems", "Follow the supplied logging instructions", "Use a dyno or suitable closed course when required"])}</div></div></section><section class="section section-tone"><div class="container narrow">${sectionHead(U().nav.faq, state.locale === "ar" ? "أسئلة مهمة قبل البرمجة." : "Important questions before tuning.")}${accordion(i18n().faq.tuning, "tuning-faq")}</div></section>${ctaBlock(state.locale === "ar" ? "ابدأ بتأكيد التوافق." : "Start with compatibility confirmation.", state.locale === "ar" ? "أرسل السيارة والـ ECU والهاردوير والوقود والتعديلات والأعطال الحالية قبل شراء أي خدمة أو جهاز." : "Submit the vehicle, controller, hardware, fuel, modifications and current faults before purchasing any service or device.", U().actions.checkCompatibility, "Online Tuning Compatibility Review")}`;
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
    return `${pageHero({ eyebrow: platform.platform, title: platform.title, text: platform.supportedScope, media: platform.cover, crumbs: [[U().nav.tuning, "/tuning"], [platform.short]], meta: `${statusBadge(platform.relationship)}`, actions: `<a class="btn" href="${routeUrl(`/tuning/${slug}`)}#compatibility-form">${esc(U().actions.checkCompatibility)}${icons.arrow}</a>` })}<section class="section"><div class="container tuning-layout"><div class="content-stack"><div>${gallery(platform.media || [], `tuning-${slug}`, platform.title, { hero: true })}</div><article class="content-panel"><span class="eyebrow">${esc(U().common.requirements)}</span><h2>${state.locale === "ar" ? "تأكد من المتطلبات قبل البدء." : "Confirm the requirements before starting."}</h2>${featureList(platform.requirements || [])}</article><article class="content-panel"><span class="eyebrow">${esc(U().common.included)}</span><h2>${state.locale === "ar" ? "نطاق واضح للتسليم والمراجعة." : "A defined review and delivery scope."}</h2>${featureList(platform.inclusions || [])}</article><article class="notice notice-warning"><strong>${state.locale === "ar" ? "مراجعة التوافق مطلوبة:" : "Compatibility review required:"}</strong> ${esc(platform.notice)}</article><article class="content-panel"><span class="eyebrow">${esc(U().actions.checkCompatibility)}</span><h2>${state.locale === "ar" ? "شنو نراجع؟" : "What is reviewed?"}</h2>${featureList(platform.compatibilityChecks || [])}</article></div><aside id="compatibility-form" class="form-panel sticky-panel"><span class="mini-label">${esc(platform.short)}</span><h2>${esc(U().forms.title)}</h2><p>${esc(U().forms.intro)}</p>${tuningForm(platform)}</aside></div></section><section class="section section-tone"><div class="container narrow">${sectionHead(U().nav.faq, state.locale === "ar" ? "أسئلة عن التوافق والـ Logging." : "Questions about compatibility and logging.")}${accordion(i18n().faq.tuning, `${slug}-faq`)}</div></section>${ctaBlock(state.locale === "ar" ? `تحتاج مساعدة مع ${platform.short}؟` : `Need help with ${platform.short}?`, platform.notice, U().actions.contactWorkshop, platform.formType)}`;
  }

  function engineShelfPackages() {
    const isAr = state.locale === "ar";
    const leadTime = isAr ? "حد أدنى أسبوعين للتجهيز بعد اعتماد الطلب" : "Minimum two-week preparation lead time after approval";
    const liveStock = isAr ? "التوفر يحتاج تأكيد مباشر قبل اعتماد الطلب" : "Live availability must be confirmed before approval";
    return [
      {
        title: "Bottom-End Rod & Piston Package",
        service: "Short Block / Bottom End",
        family: "",
        specs: isAr ? ["LS وLT", "High Compression", "مخصص لتطبيقات Drift وTrack"] : ["LS and LT", "High-compression route", "For drift and track applications"],
        availability: leadTime
      },
      {
        title: "Stock Bottom End + Heads & Cam Package",
        service: "Short Block / Bottom End",
        family: "",
        specs: isAr ? ["LS وLT", "Boost أو Naturally Aspirated", "المواصفة النهائية حسب الاستخدام"] : ["LS and LT", "Boost or naturally aspirated", "Final specification follows the application"],
        availability: leadTime
      },
      {
        title: "GM LS 6.0 Aluminum Long Block",
        service: "Long Block",
        family: "GM - LS",
        specs: isAr ? ["AFR 235 cc Heads", "PJX Cam Package", "الهدف المعلن: 450 HP على Pump Fuel", "الهدف المعلن: 500+ HP على E85", "مصمم للاستخدام القاسي"] : ["AFR 235 cc heads", "PJX cam package", "Stated target: 450 HP on pump fuel", "Stated target: 500+ HP on E85", "Built for hard use"],
        availability: leadTime
      },
      {
        title: "Stocker 416 High-Compression Short Block",
        service: "Short Block / Bottom End",
        family: "GM - LS",
        specs: ["Callies Compstar crankshaft", "Callies H-beam rods", "Wiseco 4.070 in · +5 cc dome"],
        availability: isAr ? `مذكور In Stock / On Shelf · ${liveStock}` : `Noted in stock / on shelf · ${liveStock}`
      },
      {
        title: "RHS 427 Boost Short Block",
        service: "Short Block / Bottom End",
        family: "GM - LS",
        specs: ["Callies Apex 4.000 in stroke · 8-counterweight", "Ultra I-beam rods · L19 rod bolts", "Diamond 2K pistons · -14 cc dish"],
        availability: leadTime
      },
      {
        title: "L83 1000 HP+ Boost Long Block",
        service: "Long Block",
        family: "GM - LT",
        specs: isAr ? ["Long Block مخصص للـ Boost", "التصنيف المعلن للباقة: 1,000 HP+"] : ["Boost-specific long-block package", "Stated package rating: 1,000 HP+"],
        availability: leadTime
      },
      {
        title: "LTR 427 Long Block",
        service: "Long Block",
        family: "GM - LS",
        specs: isAr ? ["427 cu in", "PRC Heads", "المواصفة النهائية حسب الاستخدام والوقود"] : ["427 cu in", "PRC heads", "Final specification follows use and fuel"],
        availability: leadTime
      },
      {
        title: "LSR Blocks",
        service: "Short Block / Bottom End",
        family: "GM - LS",
        specs: isAr ? ["عدد 2 مذكور في المخزون", "الخراطة والمواصفة حسب المشروع"] : ["Two units noted in stock", "Machining and specification follow the project"],
        availability: liveStock
      }
    ];
  }

  function enginePhotoKey(family = "GM - LS", service = "Long Block", packageName = "") {
    if (/L83/i.test(packageName)) return "lt-long";
    if (/Short Block|Bottom End/i.test(service)) return "bottom-end";
    if (/Rebuild|Upgrade|إعادة بناء|تطوير/i.test(service)) return "rebuild";
    if (/Ford|Coyote/i.test(family)) return "coyote-long";
    if (/GM - LT/i.test(family)) return "lt-long";
    return "ls-long";
  }

  function enginePhotoMediaId(key) {
    return ({ "ls-long": 54, "lt-long": 55, "coyote-long": 58, "bottom-end": 70, rebuild: 59, components: 68 })[key] || 54;
  }

  function enginePhotoLabel(key) {
    const labels = state.locale === "ar" ? {
      "ls-long": "صورة Long Block LS من ورشة Projx Racing",
      "lt-long": "صورة Long Block LT من ورشة Projx Racing",
      "coyote-long": "صورة Ford Coyote من ورشة Projx Racing",
      "bottom-end": "صورة Bottom End من ورشة Projx Racing",
      "rebuild": "صورة فحص وإعادة بناء من ورشة Projx Racing"
    } : {
      "ls-long": "Projx Racing LS long-block workshop photo",
      "lt-long": "Projx Racing LT long-block workshop photo",
      "coyote-long": "Projx Racing Ford Coyote workshop photo",
      "bottom-end": "Projx Racing bottom-end workshop photo",
      "rebuild": "Projx Racing inspection and rebuild workshop photo"
    };
    return labels[key] || labels["ls-long"];
  }

  function enginePhotoFrame(key, className = "engine-selector-photo") {
    const label = enginePhotoLabel(key);
    return `<div class="${esc(className)}" data-photo-key="${esc(key)}" data-role="engine-selection-photo">${mediaImage(enginePhotoMediaId(key), { className: "engine-workshop-photo", alt: label, sizes: "(max-width: 760px) 100vw, 42vw" })}<span>${esc(label)}</span></div>`;
  }

  function engineBuildOptionPhoto(title) {
    if (/Long Block/i.test(title)) {
      return `<div class="engine-option-photo engine-option-photo-split"><div data-photo-key="ls-long">${mediaImage(enginePhotoMediaId("ls-long"), { className: "engine-workshop-photo", alt: enginePhotoLabel("ls-long"), sizes: "25vw" })}<span>LS</span></div><div data-photo-key="lt-long">${mediaImage(enginePhotoMediaId("lt-long"), { className: "engine-workshop-photo", alt: enginePhotoLabel("lt-long"), sizes: "25vw" })}<span>LT</span></div></div>`;
    }
    const key = /Short Block|Bottom End/i.test(title) ? "bottom-end" : "rebuild";
    return enginePhotoFrame(key, "engine-option-photo");
  }

  function engineShelfSection() {
    const isAr = state.locale === "ar";
    const packages = engineShelfPackages();
    return `<section class="section engine-stock-section"><div class="container engine-stock-review review-marked review-marked-new"><span class="review-badge"><b>07 · ${esc(isAr ? "جديد" : "NEW")}</b><span>${esc(isAr ? "باقات On-Shelf وخيارات جاهزة للطلب" : "On-shelf packages and selectable specifications")}</span></span>${sectionHead(isAr ? "On-Shelf وبرامج التجهيز" : "On-shelf & scheduled builds", isAr ? "اختر الباقة قبل إرسال الطلب." : "Choose a package before sending the enquiry.", isAr ? "المخزون يتغير ويجب تأكيده مباشرة. محركات وباقات On-Shelf تحتاج حد أدنى أسبوعين للتجهيز بعد اعتماد الطلب إلا إذا نص عرض السعر على غير ذلك." : "Stock changes and must be confirmed directly. On-shelf engines and packages require a minimum two-week preparation lead time after approval unless the quotation states otherwise.")}<div class="engine-package-grid">${packages.map((item, index) => {
      const photoKey = enginePhotoKey(item.family || "GM - LS", item.service, item.title);
      return `<article class="engine-package-card">${enginePhotoFrame(photoKey, "engine-package-photo")}<div class="engine-package-top"><span>${compactNumber(index + 1)}</span><small>${esc(item.availability)}</small></div><h3>${esc(item.title)}</h3>${featureList(item.specs)}<button class="btn btn-outline btn-sm" type="button" data-action="select-engine-package" data-engine-package="${esc(item.title)}" data-engine-family="${esc(item.family)}" data-engine-service="${esc(item.service)}">${esc(isAr ? "اختر للطلب" : "Select for enquiry")}${icons.arrow}</button></article>`;
    }).join("")}</div><p class="engine-package-source-note">${esc(isAr ? "اختيار الكود في النموذج يساعد على بدء الطلب، لكن المواصفة النهائية تعتمد على فحص البلوك والـ Casting والـ Reluctor والحساسات والقطع الحالية." : "The selector starts the enquiry; final compatibility still depends on the block casting, reluctor wheel, sensors and the parts presented for inspection.")}</p></div></section>`;
  }

  function engineConsultationForm() {
    const ui = U();
    const page = P().engineBuilding;
    const families = page.families || [];
    const family = families[0] || { value: "GM - LS", variants: ["Gen III · LS1 · 5.7L aluminum"] };
    const services = (page.options || []).map(([title]) => title);
    const packagePrompt = state.locale === "ar" ? "مواصفة خاصة / لم يتم اختيار باقة" : "Custom specification / no package selected";
    const packages = [packagePrompt, ...engineShelfPackages().map(item => item.title)];
    const firstService = services[0] || "Long Block";
    const firstPhotoKey = enginePhotoKey(family.value, firstService);
    const isAr = state.locale === "ar";
    return `<form class="enquiry-form embedded-form engine-enquiry-flow" data-enquiry-form data-engine-consultation data-form-type="Engine Build Enquiry" novalidate><input type="text" name="website" class="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="startedAt" value="${Date.now()}">
      <div class="engine-selector-shell">
        ${enginePhotoFrame(firstPhotoKey)}
        <div class="engine-selector-fields"><span class="engine-form-step">${esc(isAr ? "الخطوة 1 · اختر المحرك والبناء" : "Step 1 · Choose the engine and build")}</span><div class="form-grid">
          <div class="form-group"><label class="required" for="engine-family-select">${esc(isAr ? "عائلة المحرك" : "Engine family")}</label><select id="engine-family-select" class="select${isAr ? " ltr-input" : ""}" name="platform" required data-role="engine-family"${isAr ? ' dir="ltr"' : ""}>${optionList(families.map(item => item.value), family.value)}</select></div>
          <div class="form-group"><label class="required" for="engine-variant">${esc(isAr ? "النوع أو الجيل" : "Variant or generation")}</label><select id="engine-variant" class="select${isAr ? " ltr-input" : ""}" name="engine" required data-role="engine-variant"${isAr ? ' dir="ltr"' : ""}>${optionList(family.variants || [])}</select></div>
          <div class="form-group"><label class="required" for="engine-service">${esc(ui.forms.service)}</label><select id="engine-service" class="select${isAr ? " ltr-input" : ""}" name="service" required data-role="engine-service"${isAr ? ' dir="ltr"' : ""}>${optionList(services, firstService)}</select></div>
          <div class="form-group"><label for="engine-package">${esc(isAr ? "باقة On-Shelf أو المواصفة" : "On-shelf package or specification")}</label><select id="engine-package" class="select${isAr ? " ltr-input" : ""}" name="package" data-role="engine-package"${isAr ? ' dir="ltr"' : ""}>${optionList(packages, packagePrompt)}</select></div>
          <div class="form-group full"><label class="required" for="engine-vehicle">${esc(ui.forms.vehicle)}</label><input id="engine-vehicle" class="input" name="vehicle" required placeholder="${esc(isAr ? "السنة، الشركة، الموديل" : "Year, make and model")}"></div>
          <div class="form-group full"><label for="engine-fuel">${esc(isAr ? "الوقود ونظام الشحن" : "Fuel and induction")}</label><input id="engine-fuel" class="input" name="fuel" placeholder="${esc(isAr ? "98 RON، Naturally Aspirated، Turbo، Supercharger..." : "98 RON, naturally aspirated, turbo, supercharger...")}"></div>
          <div class="form-group full"><label class="required" for="engine-mods">${esc(isAr ? "حالة المحرك الحالية" : "Current engine condition")}</label><textarea id="engine-mods" class="textarea" name="modifications" required placeholder="${esc(isAr ? "حالة التشغيل أو العطل والقطع الحالية والقطع المطلوب إعادة استخدامها" : "Running condition or failure, existing parts and anything intended for reuse")}"></textarea></div>
          <div class="form-group full"><label class="required" for="engine-target">${esc(isAr ? "الاستخدام والهدف" : "Intended use and objective")}</label><textarea id="engine-target" class="textarea" name="message" required placeholder="${esc(isAr ? "شارع أو Drag أو Circuit، الهدف، الاعتمادية والوقت المطلوب" : "Street, drag or circuit use, objective, reliability priority and required timing")}"></textarea></div>
          <div class="form-group full"><label for="engine-files">${esc(ui.forms.files)} <small>${esc(ui.forms.optional)}</small></label><input id="engine-files" class="input file-input" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.txt" aria-describedby="engine-files-help"><small class="form-help" id="engine-files-help">${esc(ui.forms.fileNote)}</small></div>
        </div></div>
      </div>
      <fieldset class="engine-customer-step"><legend><span class="engine-form-step">${esc(isAr ? "الخطوة الأخيرة · بيانات العميل" : "Final step · Customer details")}</span><strong>${esc(isAr ? "كيف نتواصل معك؟" : "How should we contact you?")}</strong></legend><p>${esc(isAr ? "بعد تحديد المحرك والبناء، أرسل بياناتك حتى يراجع الفريق الطلب ويتواصل معك." : "After choosing the engine and build, send your details so the team can review the request and contact you.")}</p><div class="form-grid">
        <div class="form-group"><label class="required" for="engine-name">${esc(ui.forms.name)}</label><input id="engine-name" class="input" name="name" required autocomplete="name" placeholder="${esc(ui.forms.placeholders.name)}"></div>
        <div class="form-group"><label class="required" for="engine-phone">${esc(ui.forms.phone)}</label><input id="engine-phone" class="input ltr-input" name="phone" required inputmode="tel" autocomplete="tel" placeholder="${esc(ui.forms.placeholders.phone)}"></div>
        <div class="form-group full"><label for="engine-email">${esc(ui.forms.email)} <small>${esc(ui.forms.optional)}</small></label><input id="engine-email" class="input ltr-input" name="email" type="email" autocomplete="email" placeholder="${esc(ui.forms.placeholders.email)}"></div>
        <label class="checkbox form-group full"><input type="checkbox" name="consent" required><span>${esc(ui.forms.consent)}</span></label>
      </div></fieldset>
      <button class="btn btn-block" type="submit">${esc(ui.actions.engineConsultation)}${icons.arrow}</button><p class="form-status" role="status" aria-live="polite"></p></form>`;
  }

  function updateEngineFamilyForm(select) {
    const form = select?.closest("[data-engine-consultation]");
    const variantSelect = form?.querySelector('[data-role="engine-variant"]');
    const families = P().engineBuilding.families || [];
    const family = families.find(item => item.value === select?.value) || families[0];
    if (!family || !variantSelect) return;
    variantSelect.innerHTML = optionList(family.variants || []);
    updateEngineSelectionPhoto(form);
  }

  function updateEngineSelectionPhoto(form) {
    if (!form) return;
    const photo = form.querySelector('[data-role="engine-selection-photo"], .engine-selector-photo');
    const family = form.querySelector('[data-role="engine-family"]')?.value || "GM - LS";
    const service = form.querySelector('[data-role="engine-service"]')?.value || "Long Block";
    const packageName = form.querySelector('[data-role="engine-package"]')?.value || "";
    if (!photo) return;
    const key = enginePhotoKey(family, service, packageName);
    const label = enginePhotoLabel(key);
    photo.dataset.photoKey = key;
    const item = mediaItem(enginePhotoMediaId(key));
    const image = photo.querySelector("img");
    if (image && item) {
      updateMediaImageSource(image, item, "(max-width: 760px) 100vw, 42vw");
      image.alt = label;
      image.width = Number(item.width) || 1600;
      image.height = Number(item.height) || 1200;
      image.style.objectPosition = item.position || "center";
    }
    const caption = photo.querySelector("span");
    if (caption) caption.textContent = label;
  }

  function engineReviewToolbar() {
    const isAr = state.locale === "ar";
    return `<div class="review-toolbar engine-review-toolbar" role="note" aria-label="${esc(isAr ? "مراجعة تغييرات صفحة المحركات" : "Engine-page change review")}"><div><span class="review-toolbar-title">${esc(isAr ? "مراجعة تغييرات صفحة المحركات" : "Engine-page change review")}</span><p>${esc(isAr ? "تم تبسيط بطاقات LS وLT إلى ثلاثة مستويات بناء، وإضافة صور حقيقية بجانب خيارات المحرك، ونقل بيانات العميل إلى الخطوة الأخيرة." : "LS and LT cards are simplified to three build levels, real workshop photos now sit beside the engine choices, and customer details are the final step.")}</p></div><div class="review-toolbar-actions"><span class="review-key review-key-new"><i></i>${esc(isAr ? "جديد" : "NEW")}</span><span class="review-key review-key-changed"><i></i>${esc(isAr ? "تم التعديل" : "CHANGED")}</span><button class="review-toggle" type="button" data-action="toggle-review-markers" data-hide-label="${esc(isAr ? "إخفاء العلامات" : "Hide markers")}" data-show-label="${esc(isAr ? "إظهار العلامات" : "Show markers")}" aria-pressed="true"><span data-role="review-toggle-label">${esc(isAr ? "إخفاء العلامات" : "Hide markers")}</span></button></div></div>`;
  }

  function engineBuildingPage() {
    const page = P().engineBuilding;
    const isAr = state.locale === "ar";
    const changed = isAr ? "تم التعديل" : "CHANGED";
    const added = isAr ? "جديد" : "NEW";
    const whatsappText = isAr ? "هلا Projx Racing، حاب أستفسر عن بناء محرك. عائلة المحرك: GM LS/LT أو Ford Coyote. السيارة: " : "Hello Projx Racing, I would like to discuss an engine build. Engine family: GM LS/LT or Ford Coyote. Vehicle: ";
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 53, crumbs: [[U().nav.engineBuilding]], review: { number: "01", type: changed, kind: "changed", label: isAr ? "عنوان GM أقصر وأوضح" : "Shorter GM title" }, actions: `<button class="btn" type="button" data-action="scroll-to" data-target="engine-family">${esc(isAr ? "حدد عائلة المحرك" : "Choose engine family")}${icons.arrow}</button><a class="btn btn-outline-light" href="${waUrl(whatsappText)}" target="_blank" rel="noopener">${esc(U().actions.whatsapp)}${icons.whatsapp}</a>` })}
      <section id="engine-family" class="section"><div class="container">${engineReviewToolbar()}<div class="engine-family-review review-marked review-marked-new"><span class="review-badge"><b>02 · ${esc(added)}</b><span>${esc(isAr ? "مسارات LS وLT وFord Coyote بالصور" : "Photo-led LS, LT and Ford Coyote routes")}</span></span>${sectionHead(page.familyEyebrow, page.familyHeading, page.familyText)}<div class="engine-family-grid">${(page.families || []).map((family, index) => `<article class="engine-family-card">${enginePhotoFrame(["ls-long", "lt-long", "coyote-long"][index] || "ls-long", "engine-family-photo")}<span class="engine-family-index">${compactNumber(index + 1)}</span><div><h3>${esc(family.title)}</h3><p>${esc(family.text)}</p><div class="tags">${(family.highlights || family.variants || []).map(item => `<span>${esc(item)}</span>`).join("")}</div></div><button class="btn btn-outline" type="button" data-action="select-engine-family" data-engine-family="${esc(family.value)}">${esc(isAr ? "اختر هذا المسار" : "Choose this family")}${icons.arrow}</button></article>`).join("")}</div></div></div></section>
      <section class="section section-tone"><div class="container engine-options-review review-marked review-marked-changed"><span class="review-badge"><b>03 · ${esc(changed)}</b><span>${esc(isAr ? "ثلاثة مستويات بناء مع صور" : "Three photographed build levels")}</span></span>${sectionHead(U().common.serviceScope, page.optionsHeading)}<div class="engine-option-grid engine-option-grid-simple">${page.options.map(([title, text], index) => `<article>${engineBuildOptionPhoto(title)}<span>${compactNumber(index + 1)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p><button class="text-link" type="button" data-action="select-engine-service" data-engine-service="${esc(title)}">${esc(isAr ? "اختر وانتقل للطلب" : "Select and continue")}${icons.arrow}</button></article>`).join("")}</div></div></section>
      ${engineShelfSection()}
      <section id="engine-consultation" class="section"><div class="container form-feature engine-fast-form"><div class="engine-form-intro"><span class="eyebrow">${esc(U().actions.engineConsultation)}</span><h2>${esc(page.provideHeading)}</h2><p>${esc(isAr ? "اختر المحرك والبناء أولاً. تظهر الصورة المناسبة بجانب الخيارات، وبعدها تدخل بيانات التواصل في الخطوة الأخيرة." : "Choose the engine and build first. The matching workshop photo stays beside the selectors, then customer contact details appear as the final step.")}</p></div><div class="form-panel review-marked review-marked-changed"><span class="review-badge"><b>04 · ${esc(changed)}</b><span>${esc(isAr ? "بيانات العميل في الخطوة الأخيرة" : "Customer details moved to the final step")}</span></span>${engineConsultationForm()}</div></div></section>`;
  }

  function raceProgrammeContact() {
    const isAr = state.locale === "ar";
    const message = isAr ? "هلا Projx Racing، حاب أستفسر عن برنامج KMTC 2K أو تجهيز سباقات الحلبة. السيارة: " : "Hello Projx Racing, I would like to enquire about the KMTC 2K programme or circuit-racing preparation. Vehicle: ";
    return `<section class="section race-programme-section"><div class="container"><div class="race-programme-card review-marked review-marked-new"><span class="review-badge"><b>05 · ${esc(isAr ? "جديد" : "NEW")}</b><span>${esc(isAr ? "تواصل مباشر لبرنامج 2K والحلبة" : "Direct 2K and circuit contact")}</span></span><div><span class="eyebrow eyebrow-on-media">${esc(isAr ? "برامج السباق" : "Race programmes")}</span><h2>${esc(isAr ? "KMTC 2K وسباقات الحلبة" : "KMTC 2K & circuit racing")}</h2><p>${esc(isAr ? "أرسل السيارة والفئة والخبرة والهدف. الورشة تراجع أهلية البرنامج ونطاق تجهيز السيارة قبل تأكيد العمل." : "Send the vehicle, class, driver experience and objective. The workshop reviews programme eligibility and vehicle-preparation scope before work is confirmed.")}</p></div><div class="race-programme-actions"><a class="btn btn-light" href="${waUrl(message)}" target="_blank" rel="noopener">${esc(isAr ? "أرسل استفسار WhatsApp" : "Send WhatsApp enquiry")}${icons.whatsapp}</a><button class="btn btn-outline-light" type="button" data-action="open-form" data-form-type="2K / Circuit Racing Enquiry" data-context="KMTC 2K / Circuit Racing">${esc(isAr ? "أرسل بيانات المشروع" : "Send project details")}${icons.arrow}</button></div></div></div></section>`;
  }

  function projectsPage() {
    const page = P().projects;
    const projects = DATA.projects.map(localizedProject);
    const categories = [...new Set(projects.map(project => project.category))];
    const makes = [...new Set(projects.map(project => project.make))];
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 35, crumbs: [[U().nav.projects]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Project Consultation">${esc(U().actions.discussBuild)}${icons.arrow}</button>` })}${raceProgrammeContact()}<section class="section"><div class="container"><div class="filter-bar"><label class="search-control">${icons.search}<input type="search" data-filter-search="projects" placeholder="${esc(U().filters.searchProjects)}" aria-label="${esc(U().filters.searchProjects)}"></label><label class="select-control">${icons.filter}<span class="sr-only">${esc(U().filters.filterByCategory)}</span><select data-filter-select="projects" data-filter-attribute="category"><option value="">${esc(U().common.allCategories)}</option>${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label><label class="select-control">${icons.filter}<span class="sr-only">${esc(U().filters.filterByMake)}</span><select data-filter-select="projects" data-filter-attribute="make"><option value="">${esc(U().common.allMakes)}</option>${makes.map(make => `<option value="${esc(make)}">${esc(make)}</option>`).join("")}</select></label></div><div class="project-grid" data-filter-grid="projects">${DATA.projects.map(projectCard).join("")}</div><div class="empty-state" data-filter-empty="projects" hidden>${esc(U().common.noResults)}</div></div></section>${ctaBlock(state.locale === "ar" ? "عندك مشروع مشابه؟" : "Planning a similar project?", state.locale === "ar" ? "أرسل السيارة والمواصفات الحالية والهدف والاستخدام والوقت حتى نراجع نطاق المشروع." : "Send the vehicle, current specification, objective, intended use and timing so the workshop can review the project scope.", U().actions.discussBuild, "Project Consultation")}`;
  }

  function projectPage(slug) {
    const base = DATA.projects.find(item => item.slug === slug);
    if (!base) return notFoundPage();
    const project = localizedProject(base);
    const related = DATA.projects.filter(item => item.slug !== slug && (item.make === base.make || item.category === base.category)).slice(0, 3);
    return `${pageHero({ eyebrow: project.category, title: project.title, text: project.summary, media: project.cover, crumbs: [[U().nav.projects, "/projects"], [project.title]], meta: `${statusBadge(project.vehicle)}`, actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Project Consultation" data-context="${esc(project.title)}">${esc(U().actions.discussBuild)}${icons.arrow}</button>` })}<section class="section"><div class="container project-detail-layout"><div>${gallery(project.media || [], `project-${slug}`, project.title, { hero: true })}</div><aside class="project-summary"><div><span>${esc(U().common.vehicle)}</span><strong>${esc(project.vehicle)}</strong></div><div><span>${esc(U().common.category)}</span><strong>${esc(project.category)}</strong></div><div><span>${esc(U().common.projectObjective)}</span><p>${esc(project.objective)}</p></div>${tags(project.tags || [])}</aside></div></section><section class="section section-tone"><div class="container detail-two-column"><article class="content-panel"><span class="eyebrow">${esc(U().common.projectWork)}</span><h2>${state.locale === "ar" ? "الأعمال المؤكدة ضمن المشروع." : "Confirmed work within the project."}</h2>${featureList(project.work || [])}</article><article class="content-panel"><span class="eyebrow">${esc(U().common.recordedResults)}</span><h2>${state.locale === "ar" ? "نتائج موثقة." : "Documented results."}</h2>${featureList(project.results || [])}</article></div></section><section class="section"><div class="container">${sectionHead(U().common.relatedProjects, state.locale === "ar" ? "مشاريع أخرى مرتبطة." : "Other related projects.")}<div class="project-grid">${related.map(projectCard).join("")}</div></div></section>${ctaBlock(state.locale === "ar" ? `ناقش مشروع مشابه لـ ${project.vehicle}.` : `Discuss a project similar to the ${project.vehicle}.`, state.locale === "ar" ? "أرسل مواصفات سيارتك الحالية والهدف المطلوب. ما يتم افتراض أن نفس القطع أو النتيجة تناسب سيارة ثانية." : "Submit your current vehicle specification and objective. The same parts or result are not assumed to suit another vehicle.", U().actions.discussBuild, "Project Consultation")}`;
  }

  function partsApplicationDirectory() {
    const directory = new Map();
    for (const entry of (TEGIWA_VEHICLE_DIRECTORY.makes || [])) {
      if (!entry?.make || !Array.isArray(entry.models)) continue;
      if (!directory.has(entry.make)) directory.set(entry.make, new Map());
      const models = directory.get(entry.make);
      for (const model of entry.models) {
        if (!model) continue;
        if (!models.has(model)) models.set(model, new Map());
        const generations = models.get(model);
        if (!generations.has(SUPPLIER_DIRECTORY_GENERATION)) generations.set(SUPPLIER_DIRECTORY_GENERATION, new Set());
        generations.get(SUPPLIER_DIRECTORY_GENERATION).add(SUPPLIER_CONFIRM_ENGINE);
      }
    }
    const items = [...DATA.parts, ...(DATA.storeProducts || [])];
    for (const item of items) {
      for (const application of (item.applications || item.fitments || [])) {
        if (!application.make || !application.model) continue;
        if (!directory.has(application.make)) directory.set(application.make, new Map());
        const models = directory.get(application.make);
        if (!models.has(application.model)) models.set(application.model, new Map());
        const generations = models.get(application.model);
        const generation = application.generation || (state.locale === "ar" ? "تأكيد الشاصي" : "Confirm chassis");
        if (!generations.has(generation)) generations.set(generation, new Set());
        for (const engine of (application.engines || [])) generations.get(generation).add(engine);
      }
    }
    for (const selection of ECS_BMW_F8X_VEHICLE_SELECTIONS) {
      if (!directory.has("BMW")) directory.set("BMW", new Map());
      const models = directory.get("BMW");
      if (!models.has(selection.directoryModel)) models.set(selection.directoryModel, new Map());
      const generations = models.get(selection.directoryModel);
      generations.delete(SUPPLIER_DIRECTORY_GENERATION);
      if (!generations.has(selection.generation)) generations.set(selection.generation, new Set());
      generations.get(selection.generation).add(selection.engine);
    }
    return directory;
  }

  function selectOptions(items, placeholder, selected = "") {
    return `<option value="">${esc(placeholder)}</option>${items.map(item => {
      const option = item && typeof item === "object" ? item : { value: item, label: item };
      const value = String(option.value || "");
      const label = String(option.label || value);
      return `<option value="${esc(value)}" ${value === String(selected || "") ? "selected" : ""}>${esc(label)}</option>`;
    }).join("")}`;
  }

  function vehicleDirectoryChoiceLabel(value) {
    if (value === SUPPLIER_DIRECTORY_GENERATION) return storeText().supplierDirectoryGeneration;
    if (value === SUPPLIER_CONFIRM_ENGINE) return storeText().supplierConfirmEngine;
    const f8xSelection = ECS_BMW_F8X_VEHICLE_SELECTIONS.find(selection => selection.generation === value);
    if (f8xSelection) return state.locale === "ar" ? f8xSelection.labelAr : f8xSelection.labelEn;
    return value;
  }

  function vehicleSelectItems(items) {
    return items.map(value => ({ value, label: vehicleDirectoryChoiceLabel(value) }));
  }

  function partsModelYears() {
    const newestModelYear = new Date().getFullYear() + 1;
    const oldestModelYear = 1950;
    return Array.from(
      { length: newestModelYear - oldestModelYear + 1 },
      (_, index) => String(newestModelYear - index)
    );
  }

  function setSelectOptions(select, items, placeholder, preferred = "") {
    const values = items.map(item => String(item && typeof item === "object" ? item.value : item));
    const selected = values.includes(String(preferred || "")) ? String(preferred) : "";
    select.innerHTML = selectOptions(items, placeholder, selected);
    select.value = selected;
    select.disabled = items.length === 0;
    return selected;
  }

  function partsVehicleLabel() {
    const vehicle = state.partsVehicle && typeof state.partsVehicle === "object" ? state.partsVehicle : null;
    if (!vehicle) return "";
    return [vehicle.year, vehicle.make, vehicle.model, vehicle.generation, vehicle.engine]
      .map(value => cleanText(vehicleDirectoryChoiceLabel(value || ""), 80))
      .filter(Boolean)
      .join(" · ");
  }

  function partsVehicleCatalogueQuery() {
    const vehicle = state.partsVehicle && typeof state.partsVehicle === "object" ? state.partsVehicle : null;
    if (!vehicle) return "";
    const make = cleanText(vehicle.make || "", 80);
    const model = cleanText(vehicle.model || "", 80)
      .replace(/\s*\([^)]*\)/g, " ")
      .split(/\s*\/\s*/u)[0]
      .replace(/\s+/g, " ")
      .trim();
    return cleanText([make, model].filter(Boolean).join(" "), 120);
  }

  function partsVehicleApiFields() {
    const vehicle = state.partsVehicle && typeof state.partsVehicle === "object" ? state.partsVehicle : null;
    if (!vehicle) return {};
    const make = cleanText(vehicle.make || "", 80);
    const directoryModel = cleanText(vehicle.model || "", 100);
    const supplierGeneration = cleanText(vehicle.generation || "", 120);
    const bmwMDirectory = new Map([
      ["M2 (22-26)", { model: "M2", generation: "G87" }],
      ["M3 (20-24)", { model: "M3", generation: "G80" }],
      ["M4 (21-24)", { model: "M4", generation: "G82" }]
    ]);
    const exactF8xSelection = make === "BMW"
      ? ECS_BMW_F8X_VEHICLE_SELECTIONS.find(selection => selection.directoryModel === directoryModel
        && selection.generation === supplierGeneration)
      : null;
    const mappedBmwM = make === "BMW" ? (exactF8xSelection || bmwMDirectory.get(directoryModel)) : null;
    const model = mappedBmwM?.model || directoryModel;
    const result = {
      year: cleanText(vehicle.year || "", 4),
      make,
      model
    };
    const generation = mappedBmwM?.generation || supplierGeneration;
    const engine = cleanText(vehicle.engine || "", 120);
    if (generation && generation !== SUPPLIER_DIRECTORY_GENERATION) result.generation = generation;
    if (engine && engine !== SUPPLIER_CONFIRM_ENGINE) result.engine = engine;
    return Object.fromEntries(Object.entries(result).filter(([, value]) => value));
  }

  function partsVehicleCatalogueContextMarkup() {
    const label = partsVehicleLabel();
    if (!label || state.tegiwaCatalog.match !== "vehicle") return "";
    const labels = storeText();
    const finder = P().parts.finder;
    return `${icons.check}<div><strong>${esc(labels.tegiwaVehicleActive)}</strong><bdi>${esc(label)}</bdi><small>${esc(labels.tegiwaVehicleText)}</small></div><button class="text-link" type="button" data-action="clear-parts-vehicle">${esc(finder.clearVehicle)}</button>`;
  }

  function renderTegiwaVehicleContext() {
    const context = document.querySelector("[data-tegiwa-vehicle-context]");
    if (!context) return;
    const markup = partsVehicleCatalogueContextMarkup();
    context.hidden = !markup;
    context.classList.toggle("is-active", Boolean(markup));
    context.innerHTML = markup;
  }

  function partsVehicleSummaryMarkup() {
    const finder = P().parts.finder;
    const label = partsVehicleLabel();
    if (!label) return `<span>${icons.user}</span><div><strong>${esc(finder.noVehicle)}</strong><small>${esc(finder.noVehicleText)}</small></div>`;
    return `<span>${icons.check}</span><div><strong>${esc(finder.selectedVehicle)}</strong><bdi>${esc(label)}</bdi><small>${esc(finder.selectedVehicleText)}</small></div><button class="text-link" type="button" data-action="clear-parts-vehicle">${esc(finder.clearVehicle)}</button>`;
  }

  function renderPartsVehicleSummary() {
    const summary = document.querySelector("[data-parts-vehicle-summary]");
    if (summary) {
      summary.classList.toggle("is-active", Boolean(partsVehicleLabel()));
      summary.innerHTML = partsVehicleSummaryMarkup();
    }
    renderTegiwaVehicleContext();
    syncTegiwaFilterUi();
  }

  function savePartsVehicle(form) {
    if (!form.reportValidity()) return;
    const fields = new FormData(form);
    const year = cleanText(fields.get("year"), 4);
    if (!partsModelYears().includes(year)) return;
    state.partsVehicle = {
      year,
      make: cleanText(fields.get("make"), 80),
      model: cleanText(fields.get("model"), 80),
      generation: cleanText(fields.get("generation"), 80),
      engine: cleanText(fields.get("engine"), 80)
    };
    storage.set("projxPartsVehicle", JSON.stringify(state.partsVehicle));
    renderPartsVehicleSummary();
    const matchFilter = document.querySelector('[data-filter-select="parts"][data-filter-match="vehicle"]');
    if (matchFilter) matchFilter.disabled = false;
    showToast(P().parts.finder.vehicleSaved, partsVehicleLabel());
    const searchInput = document.querySelector('[data-tegiwa-search] input[name="q"]');
    const query = cleanText(searchInput?.value || state.tegiwaCatalog.query || "", 120);
    clearTegiwaDirectorySelection();
    state.tegiwaCatalog.supplier = "";
    syncTegiwaFilterUi();
    loadTegiwaCatalog({ query, match: "vehicle", page: 1, scrollResults: true });
    scrollElementIntoView(document.getElementById("tegiwa-catalog"));
  }

  function updatePartsVehicleCascades(form, changed = "") {
    if (!form) return;
    const directory = partsApplicationDirectory();
    const makeSelect = form.elements.make;
    const modelSelect = form.elements.model;
    const generationSelect = form.elements.generation;
    const engineSelect = form.elements.engine;
    if (!makeSelect || !modelSelect || !generationSelect || !engineSelect) return;
    const preferred = state.partsVehicle || {};
    const modelsMap = directory.get(makeSelect.value) || new Map();
    const model = setSelectOptions(modelSelect, [...modelsMap.keys()], storeText().chooseModel, changed === "make" ? "" : (modelSelect.value || preferred.model));
    const generationsMap = modelsMap.get(model) || new Map();
    const generation = setSelectOptions(generationSelect, vehicleSelectItems([...generationsMap.keys()]), storeText().chooseGeneration, ["make", "model"].includes(changed) ? "" : (generationSelect.value || preferred.generation));
    const engines = [...(generationsMap.get(generation) || [])];
    setSelectOptions(engineSelect, vehicleSelectItems(engines), storeText().chooseEngine, ["make", "model", "generation"].includes(changed) ? "" : (engineSelect.value || preferred.engine));
  }

  function packageDetailPage(slug) {
    const product = (DATA.storeProducts || []).find(item => item.slug === slug);
    if (product) return storeProductDetailPage(product);
    const index = DATA.parts.findIndex(item => item.slug === slug);
    if (index < 0) return notFoundPage();
    const part = DATA.parts[index];
    const local = localizedPart(part, index);
    const labels = storeText();
    const vehicleContext = partsVehicleLabel();
    const context = [local.title, local.brand, local.vehicle, vehicleContext].filter(Boolean).join(" | ");
    const related = DATA.parts.filter(item => item.slug !== slug && item.category === part.category).slice(0, 3);
    return `${pageHero({ eyebrow: labels.configuredPackage, title: local.title, text: local.summary, media: local.media, crumbs: [[U().nav.parts, "/parts"], [local.title]], meta: statusBadge(local.status), actions: `<button class="btn" type="button" data-action="add-quote" data-id="package-${esc(part.slug)}" data-kind="Parts Package" data-title="${esc(local.title)}" data-details="${esc(`${local.brand} • ${local.vehicle}`)}">${esc(labels.addToQuote)}${icons.quote}</button><button class="btn btn-outline-light" type="button" data-action="open-form" data-form-type="Parts Shipping Quote" data-context="${esc(context)}">${esc(labels.shippingQuote)}${icons.arrow}</button>` })}
      <section class="section"><div class="container store-detail-layout">
        <figure class="store-detail-media">${mediaImage(local.media, { loading: "eager", className: "contain-img", sizes: "(max-width: 980px) 100vw, 55vw" })}<figcaption>${esc(labels.contextImage)}</figcaption></figure>
        <aside class="store-detail-buy"><span class="mini-label">${esc(labels.productType)}</span><h2>${esc(labels.configuredPackage)}</h2><p>${esc(local.summary)}</p><dl class="store-facts"><div><dt>${esc(U().common.brand)}</dt><dd>${esc(local.brand)}</dd></div><div><dt>${esc(U().common.vehicle)}</dt><dd>${esc(local.vehicle)}</dd></div><div><dt>${esc(labels.fitment)}</dt><dd>${esc(fitmentLabel(part))}</dd></div><div><dt>${esc(labels.availability)}</dt><dd>${esc(local.status)}</dd></div><div><dt>SKU / MPN</dt><dd>${esc(labels.noSku)}</dd></div></dl><div class="store-price"><small>${esc(U().common.quotation)}</small><strong>${esc(labels.requestPrice)}</strong></div><label class="quantity-field"><span>${esc(labels.quantity)}</span><input class="input" data-item-quantity type="number" min="1" max="99" value="1" inputmode="numeric"></label><div class="store-buy-actions"><button class="btn" type="button" data-action="add-quote" data-id="package-${esc(part.slug)}" data-kind="Parts Package" data-title="${esc(local.title)}" data-details="${esc(`${local.brand} • ${local.vehicle}`)}">${esc(labels.addToQuote)}${icons.quote}</button><button class="btn btn-outline" type="button" data-action="open-form" data-form-type="Parts Shipping Quote" data-context="${esc(context)}">${esc(labels.shippingQuote)}${icons.arrow}</button></div>${vehicleContext ? `<div class="notice notice-info"><strong>${esc(P().parts.finder.selectedVehicle)}:</strong> <bdi>${esc(vehicleContext)}</bdi></div>` : ""}</aside>
      </div></section>
      <section class="section section-tone"><div class="container detail-two-column"><article class="content-panel"><span class="eyebrow">${esc(labels.packageDetails)}</span><h2>${esc(labels.includedReview)}</h2>${featureList([local.summary, `${U().common.brand}: ${local.brand}`, `${U().common.vehicle}: ${local.vehicle}`, `${labels.availability}: ${local.status}`])}</article><article class="content-panel"><span class="eyebrow">${esc(labels.shippingQuote)}</span><h2>${esc(labels.shippingHeading)}</h2><p>${esc(labels.shippingText)}</p><button class="btn btn-sm" type="button" data-action="open-form" data-form-type="Parts Shipping Quote" data-context="${esc(context)}">${esc(labels.shippingQuote)}${icons.arrow}</button></article></div></section>
      ${related.length ? `<section class="section"><div class="container">${sectionHead(P().parts.finder.resultsEyebrow, state.locale === "ar" ? "باقات مرتبطة." : "Related packages.")}<div class="parts-grid">${related.map(item => partCard(item, DATA.parts.indexOf(item))).join("")}</div></div></section>` : ""}`;
  }

  function storeProductDetailPage(product) {
    const local = localizedStoreProduct(product);
    const labels = storeText();
    const image = local.images?.[0];
    const provider = cleanText(local.provider || "", 80);
    const partNumber = cleanText(local.ecsPartNumber || local.sku || local.mpn || "", 120);
    const effectiveStatus = storeProductStatus(product, local);
    const observedAvailability = storeProductStockCheckIsFresh(product) ? cleanText(local.observedAvailability || "", 160) : "";
    const checked = tegiwaCheckedLabel(local.checkedAt);
    const context = [local.title, provider, local.brand, partNumber, partsVehicleLabel()].filter(Boolean).join(" | ");
    const canAddToCart = productCanEnterCart(product);
    const policy = commercePolicy(product);
    const primaryAction = canAddToCart
      ? `<button class="btn" type="button" data-action="add-cart" data-product-id="${esc(product.slug)}">${esc(commerceText().addToCart)}${icons.cart}</button>`
      : `<button class="btn" type="button" data-action="add-quote" data-id="product-${esc(local.slug)}" data-kind="Parts Product" data-title="${esc(local.title)}" data-sku="${esc(partNumber)}" data-details="${esc(context)}">${esc(labels.addToQuote)}${icons.quote}</button>`;
    const commerceNotice = canAddToCart && policy
      ? `<div class="notice notice-warning commerce-fitment-notice">${icons.check}<span><strong>${esc(commerceText().fitmentRequired)}</strong> ${esc(state.locale === "ar" ? policy.noticeAr : policy.notice)}</span></div>`
      : "";
    return `<section class="section store-product-page"><div class="container">
      ${breadcrumbs([[U().nav.parts, "/parts"], [local.title]])}
      <div class="store-detail-layout">
        <figure class="store-detail-media store-product-detail-media"><img src="${esc(versionedAsset(image.src))}" width="${Number(image.width)}" height="${Number(image.height)}" alt="${esc(image.alt)}" loading="eager" fetchpriority="high" decoding="async"></figure>
        <aside class="store-detail-buy"><span class="eyebrow">${esc(labels.verifiedProducts)}</span><span class="mini-label">${provider ? `${esc(U().nav.parts)} · ` : ""}${esc(local.category)}</span><h1>${esc(local.title)}</h1><p>${esc(local.summary)}</p><div>${statusBadge(effectiveStatus)}</div><dl class="store-facts">${provider ? `<div><dt>${esc(labels.supplier)}</dt><dd><bdi>${esc(provider)}</bdi></dd></div>` : ""}<div><dt>${esc(U().common.brand)}</dt><dd><bdi>${esc(local.brand)}</bdi></dd></div>${local.ecsPartNumber ? `<div><dt>${esc(labels.ecsPartNumber)}</dt><dd><bdi dir="ltr">${esc(local.ecsPartNumber)}</bdi></dd></div>` : ""}<div><dt>${esc(labels.skuMpn)}</dt><dd><bdi dir="ltr">${esc(local.mpn || local.sku || partNumber)}</bdi></dd></div><div><dt>${esc(labels.fitment)}</dt><dd>${esc(fitmentLabel(product))}</dd></div><div><dt>${esc(labels.availability)}</dt><dd>${esc(effectiveStatus)}</dd></div>${observedAvailability ? `<div><dt>${esc(labels.supplierListing)}</dt><dd>${esc(observedAvailability)}</dd></div>` : ""}${checked ? `<div><dt>${esc(labels.lastChecked)}</dt><dd><bdi>${esc(checked)}</bdi></dd></div>` : ""}</dl><div class="store-price"><small>${esc(storeProductPriceCheckIsFresh(product) ? (local.priceNote || U().common.quotation) : labels.manualStockStale)}</small><strong>${esc(storeProductPrice(product))}</strong></div>${local.stockPolicy === "manual-confirm" ? `<div class="notice notice-info">${icons.check}<span>${esc(labels.manualStockNotice)}</span></div>` : ""}${commerceNotice}<label class="quantity-field"><span>${esc(labels.quantity)}</span><input class="input" data-item-quantity type="number" min="1" max="99" value="1" inputmode="numeric"></label><div class="store-buy-actions">${primaryAction}<button class="btn btn-outline" type="button" data-action="open-form" data-form-type="Parts Shipping Quote" data-context="${esc(context)}">${esc(labels.shippingQuote)}${icons.arrow}</button>${local.originalUrl ? `<a class="btn btn-outline" href="${esc(local.originalUrl)}" target="_blank" rel="noopener noreferrer">${esc(labels.originalListing)}${icons.arrow}</a>` : ""}</div></aside>
      </div>
    </div></section><section class="section section-tone"><div class="container narrow"><div class="notice notice-info"><strong>${esc(labels.shippingHeading)}</strong> ${esc(labels.shippingText)}</div></div></section>`;
  }

  function tegiwaAvailability(availability = {}) {
    const labels = storeText();
    if (availability.snapshotStale) return { label: labels.tegiwaStockStale, className: "check" };
    const states = {
      in_stock: [labels.tegiwaInStock, "in-stock"],
      supplier_stock: [labels.tegiwaSupplierStock, "supplier-stock"],
      available_to_order: [labels.tegiwaVariantAvailable, "supplier-stock"],
      backorder: [labels.tegiwaCheckAvailability, "check"],
      check_availability: [labels.tegiwaCheckAvailability, "check"],
      unknown: [labels.tegiwaCheckAvailability, "check"],
      out_of_stock: [labels.tegiwaOutOfStock, "out-of-stock"],
      discontinued: [labels.tegiwaOutOfStock, "out-of-stock"]
    };
    const [label, className] = states[availability.code] || states.check_availability;
    return { label, className };
  }

  function selectedVehicleFitmentConfidence(product = {}) {
    if (["exact", "possible"].includes(product.fitmentConfidence)) return product.fitmentConfidence;
    const vehicle = partsVehicleApiFields();
    if (!Object.keys(vehicle).length || !Array.isArray(product.fitments)) return null;
    const same = (left, right) => String(left || "").trim().toLocaleLowerCase("en-US") === String(right || "").trim().toLocaleLowerCase("en-US");
    const matches = product.fitments.filter(item => {
      if (vehicle.make && !same(item.make, vehicle.make)) return false;
      if (vehicle.model && !same(item.model, vehicle.model)) return false;
      if (vehicle.generation && !same(item.generation, vehicle.generation)) return false;
      if (vehicle.engine && !same(item.engine, vehicle.engine)) return false;
      const year = Number(vehicle.year);
      if (Number.isInteger(year) && item.yearFrom && year < Number(item.yearFrom)) return false;
      if (Number.isInteger(year) && item.yearTo && year > Number(item.yearTo)) return false;
      return true;
    });
    if (matches.some(item => item.confidence === "exact")) return "exact";
    if (matches.length) return "possible";
    return null;
  }

  function tegiwaPriceLabel(price = {}) {
    const minimumValue = price.min ?? price.amount;
    const maximumValue = price.max ?? price.amount;
    const minimum = minimumValue === null || minimumValue === undefined ? NaN : Number(minimumValue);
    const maximum = maximumValue === null || maximumValue === undefined ? minimum : Number(maximumValue);
    const currency = cleanText(price.currency || "", 3).toUpperCase();
    if (!Number.isFinite(minimum) || minimum < 0 || !/^[A-Z]{3}$/.test(currency)) return storeText().requestPrice;
    const locale = state.locale === "ar" ? "ar-KW" : (currency === "GBP" ? "en-GB" : currency === "USD" ? "en-US" : "en");
    const formatter = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" });
    if (Number.isFinite(maximum) && maximum > minimum) return `${formatter.format(minimum)} – ${formatter.format(maximum)}`;
    const formatted = formatter.format(minimum);
    return price.startingAt ? `${storeText().startingAt} ${formatted}` : formatted;
  }

  function tegiwaCheckedLabel(value) {
    const source = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(source)) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(source) ? `${source}T00:00:00Z` : source);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(state.locale === "ar" ? "ar-KW" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function tegiwaImageMarkup(image, title, { eager = false } = {}) {
    if (!image?.src) return `<div class="tegiwa-image-empty">${icons.quote}<span>${esc(storeText().tegiwaNoImage)}</span></div>`;
    const source = /^\/?assets\/products\//.test(String(image.src || "")) ? versionedAsset(String(image.src).replace(/^\//, "")) : image.src;
    const markup = `<img src="${esc(source)}" width="${Math.max(1, Number(image.width) || 900)}" height="${Math.max(1, Number(image.height) || 900)}" alt="${esc(image.alt || title)}" loading="${eager ? "eager" : "lazy"}" decoding="async" referrerpolicy="no-referrer">`;
    return image.status === "supplier-media-unavailable"
      ? `<span class="tegiwa-image-placeholder">${markup}<small>${esc(storeText().supplierImageUnavailable)}</small></span>`
      : markup;
  }

  function localizedCatalogueProduct(source) {
    if (!source || state.locale !== "ar") return source;
    const localizeImage = image => image ? { ...image, alt: image.altAr || image.alt } : image;
    return {
      ...source,
      title: source.titleAr || source.title,
      description: source.descriptionAr || source.description,
      category: source.categoryAr || source.category,
      image: localizeImage(source.image),
      images: Array.isArray(source.images) ? source.images.map(localizeImage) : source.images,
      availability: source.availability ? {
        ...source.availability,
        leadTime: source.availability.leadTimeAr || source.availability.leadTime
      } : source.availability,
      specifications: Array.isArray(source.specifications) ? source.specifications.map(specification => ({
        ...specification,
        label: specification.labelAr || specification.label,
        value: specification.valueAr || specification.value
      })) : source.specifications,
      fitments: Array.isArray(source.fitments) ? source.fitments.map(fitment => ({
        ...fitment,
        note: fitment.noteAr || fitment.note
      })) : source.fitments
    };
  }

  function catalogueProductMayEnterCart(item) {
    const supplier = cleanText(item?.supplier?.slug || "", 80).toLowerCase();
    const mode = cleanText(item?.commerce?.mode || "", 80).toLowerCase();
    if (item?.commerce?.eligible === true && ["direct", "confirmation-cart", "availability-confirmation-required"].includes(mode)) return true;
    if (supplier !== "tegiwa" || !tegiwaProductHandle(item?.handle)) return false;
    const minimum = Number(item?.price?.min);
    const maximum = Number(item?.price?.max);
    return String(item?.price?.currency || "").toUpperCase() === "GBP"
      && Number.isFinite(minimum) && minimum > 0
      && Number.isFinite(maximum) && maximum >= minimum
      && Boolean(item?.image?.src);
  }

  function tegiwaProductCard(item) {
    item = localizedCatalogueProduct(item);
    const labels = storeText();
    const handle = tegiwaProductHandle(item.handle);
    const availability = tegiwaAvailability(item.availability);
    const checked = tegiwaCheckedLabel(item.availability?.checkedAt);
    const supplier = cleanText(item.supplier?.name || "Tegiwa", 160);
    const vendor = cleanText(item.vendor || "", 120);
    const category = cleanText(item.category || "", 120);
    const sku = cleanText(item.sku || "", 120);
    const mpn = cleanText(item.mpn || "", 120);
    const matchedSku = cleanText(item.matchedSku || "", 120);
    const displayedSku = matchedSku || sku || mpn;
    const skuCount = Math.max(displayedSku ? 1 : 0, Math.floor(Number(item.skuCount) || 0));
    const skuOptionsLabel = !displayedSku && skuCount > 1 ? tegiwaTemplate(U().common.skuOptions, { count: tegiwaNumber(skuCount) }) : "";
    const skuTotalLabel = matchedSku && skuCount > 1 ? tegiwaTemplate(U().common.skuTotal, { count: tegiwaNumber(skuCount) }) : "";
    const skuState = cleanText(item.skuState || "", 32);
    const skuFallbackLabel = !displayedSku && !skuOptionsLabel
      ? { open_for_exact: U().common.skuOpenExact, not_supplied: U().common.skuNotSupplied }[skuState] || ""
      : "";
    const quoteId = `catalog-${handle || item.publicKey || item.handle}${matchedSku && skuCount > 1 ? `-sku-${matchedSku}` : ""}`;
    const cardLabel = category || labels.tegiwaEyebrow;
    const fitmentLabel = item.fitmentConfidence === "exact" ? labels.exactMatch : item.fitmentConfidence === "possible" ? labels.possibleMatch : "";
    const fitmentBadge = fitmentLabel ? `<span class="tegiwa-fitment-badge is-${esc(item.fitmentConfidence)}">${esc(fitmentLabel)}</span>` : "";
    const detail = [supplier, vendor, category, tegiwaPriceLabel(item.price), availability.label, fitmentLabel].filter(Boolean).join(" • ");
    const productLink = handle
      ? `<a class="btn btn-sm" href="${esc(tegiwaProductUrl(handle))}" data-action="view-tegiwa-product" data-handle="${esc(handle)}">${esc(labels.tegiwaViewProduct)}${icons.arrow}</a>`
      : `<a class="btn btn-sm" href="${esc(routeUrl("/parts"))}">${esc(labels.tegiwaViewProduct)}${icons.arrow}</a>`;
    const cardAction = handle && catalogueProductMayEnterCart(item)
      ? `<button class="icon-action is-cart-action" type="button" data-action="view-tegiwa-product" data-handle="${esc(handle)}" aria-label="${esc(`${commerceText().selectSizeAndAddToCart}: ${item.title}`)}">${icons.cart}</button>`
      : `<button class="icon-action" type="button" data-action="add-quote" data-id="${esc(quoteId)}" data-kind="${esc(`${supplier} Parts Product`)}" data-title="${esc(item.title)}" data-sku="${esc(displayedSku)}" data-details="${esc(detail)}" aria-label="${esc(`${labels.addToQuote}: ${item.title}`)}">${icons.quote}</button>`;
    return `<article class="tegiwa-product-card" data-supplier="${esc(item.supplier?.slug || "tegiwa")}" data-currency="${esc(String(item.price?.currency || "").toUpperCase())}"><div class="tegiwa-product-media">${tegiwaImageMarkup(item.image, item.title)}<span class="tegiwa-stock-badge is-${esc(availability.className)}">${esc(availability.label)}</span>${fitmentBadge}</div><div class="tegiwa-product-body"><span class="mini-label">${esc(cardLabel)}</span><h3 dir="auto">${esc(item.title)}</h3><dl><div><dt>${esc(labels.supplier)}</dt><dd><bdi>${esc(supplier)}</bdi></dd></div>${vendor ? `<div><dt>${esc(U().common.brand)}</dt><dd><bdi>${esc(vendor)}</bdi></dd></div>` : ""}${displayedSku || skuOptionsLabel || skuFallbackLabel ? `<div><dt>${esc(labels.skuMpn)}</dt><dd>${displayedSku ? `<bdi dir="ltr">${esc(displayedSku)}</bdi>${skuTotalLabel ? `<small class="tegiwa-sku-count">${esc(skuTotalLabel)}</small>` : ""}` : `<span class="tegiwa-sku-options">${esc(skuOptionsLabel || skuFallbackLabel)}</span>`}</dd></div>` : ""}<div><dt>${esc(labels.price)}</dt><dd><bdi>${esc(tegiwaPriceLabel(item.price))}</bdi></dd></div>${item.availability?.leadTime ? `<div><dt>${esc(labels.availability)}</dt><dd><bdi>${esc(item.availability.leadTime)}</bdi></dd></div>` : ""}</dl>${checked ? `<small class="tegiwa-checked">${esc(labels.tegiwaChecked)}: <bdi>${esc(checked)}</bdi></small>` : ""}<div class="card-footer">${productLink}${cardAction}</div></div></article>`;
  }

  function tegiwaLoadingCards() {
    return Array.from({ length: 6 }, () => `<article class="tegiwa-product-card is-loading" aria-hidden="true"><div class="tegiwa-product-media"></div><div class="tegiwa-product-body"><span></span><h3></h3><p></p><p></p></div></article>`).join("");
  }

  function tegiwaNumber(value) {
    return new Intl.NumberFormat(state.locale === "ar" ? "ar-KW" : "en-GB").format(Math.max(0, Number(value) || 0));
  }

  function tegiwaTemplate(template, values = {}) {
    return String(template || "").replace(/\{([a-z]+)\}/gi, (match, key) => Object.hasOwn(values, key) ? values[key] : match);
  }

  const TEGIWA_SEARCH_DEFAULTS = Object.freeze({ sort: "relevance", availability: "all", pricing: "all", supplier: "", brand: "", partType: "", currency: "", fitment: "all" });
  const TEGIWA_SEARCH_VALUES = Object.freeze({
    sort: new Set(["relevance", "name_asc", "name_desc", "price_asc", "price_desc"]),
    availability: new Set(["all", "available", "in_stock", "supplier_stock", "check", "unavailable"]),
    pricing: new Set(["all", "priced", "request_price"]),
    fitment: new Set(["all", "exact", "possible"])
  });
  const TEGIWA_MATCH_VALUES = new Set(["any", "vehicle"]);

  function catalogueFilterValue(key, value) {
    const normalized = cleanText(value || "", 100);
    if (TEGIWA_SEARCH_VALUES[key]) return TEGIWA_SEARCH_VALUES[key].has(normalized) ? normalized : TEGIWA_SEARCH_DEFAULTS[key];
    if (key === "supplier" || key === "brand" || key === "partType") return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(normalized) ? normalized : "";
    if (key === "currency") return /^[A-Za-z]{3}$/.test(normalized) ? normalized.toUpperCase() : "";
    return TEGIWA_SEARCH_DEFAULTS[key] ?? "";
  }

  function tegiwaFilterCount() {
    return Object.entries(TEGIWA_SEARCH_DEFAULTS).filter(([key, value]) => state.tegiwaCatalog[key] !== value).length;
  }

  function syncTegiwaFilterUi() {
    const root = document.querySelector("[data-tegiwa-catalog]");
    if (!root) return;
    const labels = storeText();
    root.querySelectorAll("[data-tegiwa-filter]").forEach(control => {
      const key = control.dataset.tegiwaFilter;
      if (Object.hasOwn(TEGIWA_SEARCH_DEFAULTS, key)) control.value = state.tegiwaCatalog[key];
      control.disabled = false;
    });
    const fitment = root.querySelector('[data-tegiwa-filter="fitment"]');
    if (fitment) {
      fitment.disabled = !partsVehicleLabel();
      if (fitment.disabled && state.tegiwaCatalog.fitment !== "all") {
        state.tegiwaCatalog.fitment = "all";
        fitment.value = "all";
      }
    }
    const sort = root.querySelector('[data-tegiwa-filter="sort"]');
    const mixedSupplierSort = state.tegiwaCatalog.sortScope === "supplier-groups"
      || (!state.tegiwaCatalog.sortScope && !state.tegiwaCatalog.supplier && !state.tegiwaCatalog.currency);
    if (sort) {
      const optionLabels = mixedSupplierSort ? {
        relevance: labels.tegiwaSortSupplierOrder,
        name_asc: labels.tegiwaSortNameAscSupplier,
        name_desc: labels.tegiwaSortNameDescSupplier,
        price_asc: labels.tegiwaSortPriceAscSupplier,
        price_desc: labels.tegiwaSortPriceDescSupplier
      } : {
        relevance: labels.tegiwaSortRelevance,
        name_asc: labels.tegiwaSortNameAsc,
        name_desc: labels.tegiwaSortNameDesc,
        price_asc: labels.tegiwaSortPriceAsc,
        price_desc: labels.tegiwaSortPriceDesc
      };
      [...sort.options].forEach(option => { option.textContent = optionLabels[option.value] || option.textContent; });
    }
    const sortNote = root.querySelector("[data-tegiwa-sort-note]");
    if (sortNote) {
      sortNote.hidden = !mixedSupplierSort;
      sortNote.textContent = mixedSupplierSort ? labels.tegiwaMixedSortNote : "";
    }
    const count = tegiwaFilterCount();
    const badge = root.querySelector("[data-tegiwa-filter-count]");
    if (badge) {
      badge.textContent = count ? tegiwaTemplate(storeText().tegiwaActiveFilters, { count: tegiwaNumber(count) }) : "";
      badge.hidden = count === 0;
    }
    const clear = root.querySelector('[data-action="tegiwa-clear-filters"]');
    if (clear) clear.disabled = count === 0;
  }

  function syncCatalogueFacetOptions(meta = {}) {
    const root = document.querySelector("[data-tegiwa-catalog]");
    if (!root) return;
    const labels = storeText();
    const supplierSelect = root.querySelector('[data-tegiwa-filter="supplier"]');
    const suppliers = Array.isArray(meta.suppliers) ? meta.suppliers.filter(item => item?.slug && item?.name) : [];
    if (supplierSelect && suppliers.length) {
      supplierSelect.innerHTML = `<option value="">${esc(labels.allSuppliers)}</option>${suppliers.map(item => `<option value="${esc(item.slug)}">${esc(item.name)}</option>`).join("")}`;
      supplierSelect.value = suppliers.some(item => item.slug === state.tegiwaCatalog.supplier) ? state.tegiwaCatalog.supplier : "";
      state.tegiwaCatalog.supplier = supplierSelect.value;
    }
    const brandSelect = root.querySelector('[data-tegiwa-filter="brand"]');
    const brands = Array.isArray(meta.brands) ? meta.brands.filter(item => item?.slug && item?.name) : [];
    if (brandSelect && brands.length) {
      brandSelect.innerHTML = `<option value="">${esc(labels.allBrands)}</option>${brands.map(item => `<option value="${esc(item.slug)}">${esc(state.locale === "ar" ? item.nameAr || item.name : item.name)}</option>`).join("")}`;
      brandSelect.value = brands.some(item => item.slug === state.tegiwaCatalog.brand) ? state.tegiwaCatalog.brand : "";
      state.tegiwaCatalog.brand = brandSelect.value;
    }
    const partTypeSelect = root.querySelector('[data-tegiwa-filter="partType"]');
    const partTypes = Array.isArray(meta.partTypes) ? meta.partTypes.filter(item => item?.slug && item?.name) : [];
    if (partTypeSelect && partTypes.length) {
      partTypeSelect.innerHTML = `<option value="">${esc(labels.allPartTypes)}</option>${partTypes.map(item => `<option value="${esc(item.slug)}">${esc(state.locale === "ar" ? item.nameAr || item.name : item.name)}</option>`).join("")}`;
      partTypeSelect.value = partTypes.some(item => item.slug === state.tegiwaCatalog.partType) ? state.tegiwaCatalog.partType : "";
      state.tegiwaCatalog.partType = partTypeSelect.value;
    }
    const currencySelect = root.querySelector('[data-tegiwa-filter="currency"]');
    const currencies = Array.isArray(meta.currencies) ? meta.currencies.filter(value => /^[A-Z]{3}$/.test(String(value))) : [];
    if (currencySelect && currencies.length) {
      currencySelect.innerHTML = `<option value="">${esc(labels.allCurrencies)}</option>${currencies.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
      currencySelect.value = currencies.includes(state.tegiwaCatalog.currency) ? state.tegiwaCatalog.currency : "";
      state.tegiwaCatalog.currency = currencySelect.value;
    }
  }

  function resetTegiwaFilters({ reload = true } = {}) {
    Object.assign(state.tegiwaCatalog, TEGIWA_SEARCH_DEFAULTS, {
      backend: "unified",
      partialCatalogue: false,
      catalogueSource: "",
      fallbackReason: "",
      sortScope: ""
    });
    syncTegiwaFilterUi();
    if (reload) loadTegiwaCatalog({ query: state.tegiwaCatalog.query, match: partsVehicleLabel() ? "vehicle" : "any", page: 1, scrollResults: true });
  }

  function clearTegiwaDirectorySelection() {
    document.querySelectorAll("[data-tegiwa-directory-query]").forEach(button => {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
    });
  }

  function updateTegiwaFilter(control) {
    const key = control?.dataset.tegiwaFilter;
    if (!Object.hasOwn(TEGIWA_SEARCH_DEFAULTS, key)) return;
    state.tegiwaCatalog[key] = catalogueFilterValue(key, control.value);
    if (key === "supplier" || key === "currency") state.tegiwaCatalog.sortScope = "";
    clearTegiwaDirectorySelection();
    hideTegiwaSuggestions();
    syncTegiwaFilterUi();
    const match = partsVehicleLabel() ? "vehicle" : "any";
    loadTegiwaCatalog({ query: state.tegiwaCatalog.query, match, page: 1, scrollResults: true });
  }

  function partsCatalogueParams({ query = state.tegiwaCatalog.query, page = 1, suggest = false, handle = "" } = {}) {
    const params = new URLSearchParams();
    const productHandle = tegiwaProductHandle(handle);
    if (productHandle) {
      params.set("handle", productHandle);
      if (state.tegiwaCatalog.currency) params.set("currency", state.tegiwaCatalog.currency);
      return params;
    }
    const normalizedQuery = cleanText(query || "", 120);
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (state.tegiwaCatalog.supplier) params.set("supplier", state.tegiwaCatalog.supplier);
    if (state.tegiwaCatalog.brand) params.set("brand", state.tegiwaCatalog.brand);
    if (state.tegiwaCatalog.partType) params.set("partType", state.tegiwaCatalog.partType);
    if (state.tegiwaCatalog.currency) params.set("currency", state.tegiwaCatalog.currency);
    const vehicleFields = partsVehicleApiFields();
    const vehicleMatch = state.tegiwaCatalog.match === "vehicle" && Object.keys(vehicleFields).length > 0;
    if (vehicleMatch) {
      for (const [key, value] of Object.entries(vehicleFields)) params.set(key, value);
      params.set("fitment", state.tegiwaCatalog.fitment || "all");
    }
    if (suggest) {
      params.set("suggest", "1");
      return params;
    }
    params.set("page", String(Math.max(1, Number.parseInt(page, 10) || 1)));
    params.set("sort", state.tegiwaCatalog.sort);
    params.set("availability", state.tegiwaCatalog.availability);
    params.set("pricing", state.tegiwaCatalog.pricing);
    params.set("match", vehicleMatch ? "vehicle" : "any");
    return params;
  }

  function legacyCatalogueParams(params) {
    const fallback = new URLSearchParams();
    const handle = tegiwaProductHandle(params.get("handle"));
    if (handle) {
      fallback.set("handle", handle.startsWith("tegiwa-") ? handle.slice("tegiwa-".length) : handle);
      return fallback;
    }
    let query = cleanText(params.get("q") || "", 120);
    if (!query && params.get("match") === "vehicle") query = partsVehicleCatalogueQuery();
    if (query) fallback.set("q", query);
    if (params.get("suggest") === "1") fallback.set("suggest", "1");
    for (const key of ["page", "sort", "availability", "pricing", "match"]) {
      if (params.has(key) && (query || key === "page")) fallback.set(key, params.get(key));
    }
    return fallback;
  }

  function normaliseLegacyCataloguePayload(payload = {}) {
    const supplier = { slug: "tegiwa", name: "Tegiwa" };
    const normaliseProduct = item => {
      if (!item || typeof item !== "object") return item;
      const sourceHandle = tegiwaProductHandle(item.handle);
      const publicKey = sourceHandle ? `tegiwa-${sourceHandle}` : item.publicKey;
      return {
        ...item,
        handle: publicKey,
        supplier: item.supplier || supplier,
        publicKey,
        fitmentConfidence: item.fitmentConfidence || null
      };
    };
    const meta = {
      ...(payload.meta || {}),
      suppliers: Array.isArray(payload.meta?.suppliers) && payload.meta.suppliers.length ? payload.meta.suppliers : [supplier],
      currencies: Array.isArray(payload.meta?.currencies) && payload.meta.currencies.length ? payload.meta.currencies : ["GBP"]
    };
    if (Array.isArray(payload.items)) return { ...payload, items: payload.items.map(normaliseProduct), meta };
    if (payload.product) return { ...payload, product: normaliseProduct(payload.product), meta };
    if (Array.isArray(payload.suggestions)) return {
      ...payload,
      suggestions: payload.suggestions.map(item => ({ ...item, supplier: item.supplier || supplier })),
      meta
    };
    return { ...payload, meta };
  }

  function catalogueResponseError(response, payload) {
    const nested = payload?.error;
    const code = cleanText(typeof nested === "object" ? nested?.code : nested || "catalogue_unavailable", 80);
    const message = cleanText(typeof nested === "object" ? nested?.message : nested || "catalogue_unavailable", 300);
    const error = new Error(message || "catalogue_unavailable");
    error.status = response?.status || 0;
    error.code = code || "catalogue_unavailable";
    return error;
  }

  function catalogueFallbackEligible(error) {
    return [404, 501, 503].includes(Number(error?.status))
      || ["service_unconfigured", "catalogue_unpublished"].includes(error?.code);
  }

  async function fetchPartsCatalogue(params, { signal } = {}) {
    let fallbackReason = "";
    try {
      const endpoint = new URL(PARTS_CATALOG_ENDPOINT, location.origin);
      endpoint.search = params.toString();
      const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal });
      const payload = await response.json().catch(() => null);
      if (response.ok) {
        if (!payload || typeof payload !== "object") throw catalogueResponseError(response, { error: { code: "invalid_response", message: "catalogue_invalid_response" } });
        if (Array.isArray(payload.items) && payload.items.some(item => item?.dataStatus === "url_discovered")) {
          throw catalogueResponseError({ status: 503 }, {
            error: { code: "unverified_reference_data", message: "URL-only supplier references are not storefront products." }
          });
        }
        const partialCatalogue = payload.meta?.partialCatalogue === true;
        return {
          payload,
          backend: "unified",
          partialCatalogue,
          catalogueSource: cleanText(payload.meta?.catalogueSource || "", 100),
          fallbackReason: partialCatalogue ? cleanText(payload.meta?.fallbackReason || "partial_catalogue", 120) : ""
        };
      }
      const error = catalogueResponseError(response, payload);
      if (!catalogueFallbackEligible(error)) throw error;
      fallbackReason = error.code;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.status && !catalogueFallbackEligible(error)) throw error;
      if (!error?.status && !(error instanceof TypeError)) throw error;
      fallbackReason = error?.code || "network_unavailable";
    }
    const endpoint = new URL(PARTS_CATALOG_FALLBACK_ENDPOINT, location.origin);
    endpoint.search = legacyCatalogueParams(params).toString();
    const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object") throw catalogueResponseError(response, payload);
    return {
      payload: normaliseLegacyCataloguePayload(payload),
      backend: "tegiwa-fallback",
      partialCatalogue: true,
      catalogueSource: "tegiwa-fallback",
      fallbackReason
    };
  }

  function applyCatalogueSource(result) {
    state.tegiwaCatalog.backend = result.backend;
    state.tegiwaCatalog.partialCatalogue = result.partialCatalogue === true;
    state.tegiwaCatalog.catalogueSource = cleanText(result.catalogueSource || "", 100);
    state.tegiwaCatalog.fallbackReason = cleanText(result.fallbackReason || "", 120);
  }

  function hideTegiwaSuggestions() {
    window.clearTimeout(state.tegiwaCatalog.suggestionTimer);
    state.tegiwaCatalog.suggestionTimer = null;
    state.tegiwaCatalog.suggestionController?.abort();
    state.tegiwaCatalog.suggestionController = null;
    state.tegiwaCatalog.activeSuggestion = -1;
    const input = document.querySelector("[data-tegiwa-search-input]");
    const listbox = document.querySelector("[data-tegiwa-suggestions]");
    if (input) {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-busy");
      input.removeAttribute("aria-activedescendant");
    }
    if (listbox) {
      listbox.hidden = true;
      listbox.replaceChildren();
    }
  }

  function setTegiwaSuggestionActive(index) {
    const input = document.querySelector("[data-tegiwa-search-input]");
    const options = [...document.querySelectorAll("[data-tegiwa-suggestion]")];
    if (!input || !options.length) return;
    const next = ((index % options.length) + options.length) % options.length;
    state.tegiwaCatalog.activeSuggestion = next;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === next;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", String(active));
      if (active) option.scrollIntoView({ block: "nearest" });
    });
    input.setAttribute("aria-activedescendant", options[next].id);
  }

  function renderTegiwaSuggestions(payload, input) {
    const listbox = document.querySelector("[data-tegiwa-suggestions]");
    if (!listbox || !input) return;
    const labels = storeText();
    const entries = [];
    const seen = new Set();
    const correction = payload.correction || {};
    const canonicalQuery = cleanText(correction.canonicalQuery || "", 120);
    if (correction.corrected && canonicalQuery) {
      const correctionLabel = correction.translated ? labels.tegiwaSearchEquivalent : labels.tegiwaDidYouMean;
      entries.push({ query: canonicalQuery, label: tegiwaTemplate(correctionLabel, { query: canonicalQuery }), kind: "correction" });
      seen.add(canonicalQuery.toLocaleLowerCase());
    }
    for (const suggestion of Array.isArray(payload.suggestions) ? payload.suggestions : []) {
      const query = cleanText(suggestion.query || suggestion.label || "", 120);
      const key = query.toLocaleLowerCase();
      if (query.length < 2 || seen.has(key)) continue;
      seen.add(key);
      entries.push({
        query,
        label: cleanText(state.locale === "ar" ? (suggestion.labelAr || suggestion.label || query) : (suggestion.label || query), 180),
        kind: suggestion.kind || "product",
        handle: tegiwaProductHandle(suggestion.handle),
        supplier: cleanText(suggestion.supplier?.name || "", 120),
        brand: cleanText(suggestion.brand || "", 120),
        category: cleanText(state.locale === "ar" ? (suggestion.categoryAr || suggestion.category || "") : (suggestion.category || ""), 160),
        sku: cleanText(suggestion.sku || suggestion.mpn || "", 120),
        image: suggestion.image && typeof suggestion.image === "object" ? suggestion.image : null
      });
      if (entries.length >= 7) break;
    }
    const submittedQuery = cleanText(input.value, 120);
    const submittedKey = submittedQuery.toLocaleLowerCase();
    if (submittedQuery.length >= 2 && !seen.has(submittedKey) && entries.length < 8) {
      entries.push({
        query: submittedQuery,
        label: tegiwaTemplate(labels.tegiwaSearchAll, { query: submittedQuery }),
        kind: "query"
      });
    }
    listbox.innerHTML = entries.map((entry, index) => {
      const labelKey = entry.label.toLocaleLowerCase();
      const queryKey = entry.query.toLocaleLowerCase();
      const secondaryText = [
        entry.kind !== "correction" && labelKey !== queryKey && !labelKey.startsWith(queryKey) ? entry.query : "",
        entry.brand || "", entry.sku || "", entry.category || "", entry.supplier || ""
      ].filter(Boolean).join(" • ");
      const secondary = secondaryText ? `<small>${esc(secondaryText)}</small>` : "";
      const product = entry.kind === "product" && entry.handle;
      const visual = product && entry.image?.src
        ? `<span class="tegiwa-suggestion-thumb" aria-hidden="true">${tegiwaImageMarkup(entry.image, entry.label)}</span>`
        : `<span class="tegiwa-suggestion-icon" aria-hidden="true">${entry.kind === "correction" ? icons.check : icons.search}</span>`;
      return `<button id="tegiwa-suggestion-${index}" class="tegiwa-suggestion${entry.kind === "correction" ? " is-correction" : ""}${product ? " is-product" : ""}" type="button" role="option" aria-selected="false" data-action="tegiwa-suggestion" data-tegiwa-suggestion data-kind="${esc(entry.kind)}" data-query="${esc(entry.query)}"${entry.handle ? ` data-handle="${esc(entry.handle)}"` : ""}>${visual}<strong><bdi dir="auto">${esc(entry.label)}</bdi></strong>${secondary}</button>`;
    }).join("");
    listbox.hidden = false;
    input.removeAttribute("aria-busy");
    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-activedescendant");
    state.tegiwaCatalog.activeSuggestion = -1;
  }

  function scheduleTegiwaSuggestions(input) {
    window.clearTimeout(state.tegiwaCatalog.suggestionTimer);
    state.tegiwaCatalog.suggestionController?.abort();
    const query = cleanText(input?.value || "", 120);
    if (query.length < 2) {
      hideTegiwaSuggestions();
      return;
    }
    if (state.tegiwaCatalog.suggestionComposing) return;
    const cacheKey = JSON.stringify([
      query.toLocaleLowerCase(), state.tegiwaCatalog.supplier, state.tegiwaCatalog.brand,
      state.tegiwaCatalog.partType, state.tegiwaCatalog.currency, state.tegiwaCatalog.fitment,
      state.tegiwaCatalog.match, partsVehicleApiFields()
    ]);
    const cached = state.tegiwaCatalog.suggestionCache.get(cacheKey);
    if (cached) {
      renderTegiwaSuggestions(cached, input);
      return;
    }
    state.tegiwaCatalog.suggestionTimer = window.setTimeout(async () => {
      state.tegiwaCatalog.suggestionTimer = null;
      const controller = new AbortController();
      state.tegiwaCatalog.suggestionController = controller;
      input.setAttribute("aria-busy", "true");
      try {
        const request = partsCatalogueParams({ query, suggest: true });
        const result = await fetchPartsCatalogue(request, { signal: controller.signal });
        const payload = result.payload;
        if (payload.mode !== "suggest" || !Array.isArray(payload.suggestions)) throw new Error("suggestions_unavailable");
        if (cleanText(input.value, 120) !== query || document.activeElement !== input) return;
        applyCatalogueSource(result);
        state.tegiwaCatalog.suggestionCache.set(cacheKey, payload);
        if (state.tegiwaCatalog.suggestionCache.size > 24) {
          state.tegiwaCatalog.suggestionCache.delete(state.tegiwaCatalog.suggestionCache.keys().next().value);
        }
        renderTegiwaSuggestions(payload, input);
      } catch (error) {
        if (error?.name !== "AbortError") hideTegiwaSuggestions();
      } finally {
        input.removeAttribute("aria-busy");
        if (state.tegiwaCatalog.suggestionController === controller) state.tegiwaCatalog.suggestionController = null;
      }
    }, 240);
  }

  function chooseTegiwaSuggestion(option) {
    const input = document.querySelector("[data-tegiwa-search-input]");
    const query = cleanText(option?.dataset.query || "", 120);
    if (!input || query.length < 2) return;
    input.value = query;
    const handle = tegiwaProductHandle(option?.dataset.handle || "");
    hideTegiwaSuggestions();
    clearTegiwaDirectorySelection();
    if (handle && option?.dataset.kind === "product") {
      openTegiwaProduct(handle, input);
      return;
    }
    loadTegiwaCatalog({ query, match: partsVehicleLabel() ? "vehicle" : "any", page: 1, scrollResults: true });
  }

  function handleTegiwaSuggestionKeydown(event, input) {
    const options = [...document.querySelectorAll("[data-tegiwa-suggestion]")];
    if (event.key === "Escape" && input.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      event.stopPropagation();
      hideTegiwaSuggestions();
      return true;
    }
    if (!options.length || input.getAttribute("aria-expanded") !== "true") return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const start = state.tegiwaCatalog.activeSuggestion < 0 ? (delta > 0 ? 0 : options.length - 1) : state.tegiwaCatalog.activeSuggestion + delta;
      setTegiwaSuggestionActive(start);
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (state.tegiwaCatalog.activeSuggestion >= 0) {
        chooseTegiwaSuggestion(options[state.tegiwaCatalog.activeSuggestion]);
      } else {
        hideTegiwaSuggestions();
        const form = input.closest("[data-tegiwa-search]");
        if (form?.reportValidity()) form.requestSubmit();
      }
      return true;
    }
    if (event.key === "Tab") hideTegiwaSuggestions();
    return false;
  }

  function tegiwaPageTokens(currentPage, totalPages) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
    if (currentPage >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
  }

  function tegiwaPaginationMarkup(currentPage, totalPages, labels) {
    return tegiwaPageTokens(currentPage, totalPages).map((token, index) => {
      if (token === "ellipsis") return `<span class="tegiwa-page-ellipsis" aria-hidden="true" data-ellipsis-index="${index}">…</span>`;
      const formattedPage = tegiwaNumber(token);
      const current = token === currentPage;
      const ariaLabel = tegiwaTemplate(labels.tegiwaGoToPage, { page: formattedPage });
      return `<button class="tegiwa-page-button${current ? " is-current" : ""}" type="button" data-action="tegiwa-page" data-page="${token}" data-tegiwa-control aria-label="${esc(ariaLabel)}"${current ? ' aria-current="page"' : ""}>${esc(formattedPage)}</button>`;
    }).join("");
  }

  function renderTegiwaControls(payload = {}) {
    const root = document.querySelector("[data-tegiwa-catalog]");
    if (!root) return;
    const labels = storeText();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const meta = payload.meta || {};
    const count = Number(meta.catalogProductCount);
    const available = Number(meta.availableProductCount);
    const isSearch = payload.mode === "search";
    const pageSize = Math.max(1, Number.parseInt(meta.pageSize, 10) || state.tegiwaCatalog.pageSize || 100);
    const reportedTotal = Number(meta.totalResults);
    const totalResults = Number.isFinite(reportedTotal) ? Math.max(0, reportedTotal) : (isSearch ? 0 : Math.max(0, count || 0));
    const calculatedPages = totalResults > 0 ? Math.ceil(totalResults / pageSize) : 0;
    const reportedPages = Number.parseInt(meta.totalPages ?? meta.pageCount, 10);
    const totalPages = Math.max(0, Number.isInteger(reportedPages) ? reportedPages : calculatedPages);
    const requestedPage = Number.parseInt(meta.page ?? meta.currentPage, 10) || state.tegiwaCatalog.currentPage || 1;
    const currentPage = totalPages ? Math.min(totalPages, Math.max(1, requestedPage)) : 1;
    const grid = root.querySelector("[data-tegiwa-results]");
    const status = root.querySelector("[data-tegiwa-status]");
    if (grid) grid.innerHTML = items.length ? items.map(partsCatalogueCard).join("") : `<div class="empty-state tegiwa-empty"><p>${esc(labels.tegiwaNoResults)}</p></div>`;
    if (status) {
      if (isSearch && totalResults > 0 && items.length) {
        const start = ((currentPage - 1) * pageSize) + 1;
        const end = Math.min(totalResults, start + items.length - 1);
        status.textContent = tegiwaTemplate(labels.tegiwaSearchRange, {
          start: tegiwaNumber(start),
          end: tegiwaNumber(end),
          total: tegiwaNumber(totalResults),
          query: cleanText(meta.canonicalQuery || meta.query || state.tegiwaCatalog.query, 120)
        });
      } else if (isSearch) status.textContent = `${tegiwaNumber(totalResults)} ${labels.tegiwaSearchResults}`;
      else if (totalResults > 0 && items.length) {
        const start = ((currentPage - 1) * pageSize) + 1;
        const end = Math.min(totalResults, start + items.length - 1);
        const range = tegiwaTemplate(labels.tegiwaShowingRange, { start: tegiwaNumber(start), end: tegiwaNumber(end), total: tegiwaNumber(totalResults) });
        const page = tegiwaTemplate(labels.tegiwaPageOf, { page: tegiwaNumber(currentPage), total: tegiwaNumber(totalPages) });
        status.textContent = `${range} • ${page}`;
      } else status.textContent = `${tegiwaNumber(items.length)} ${labels.tegiwaResults}`;
    }
    const catalogueStat = root.querySelector("[data-tegiwa-catalog-count]");
    const availableStat = root.querySelector("[data-tegiwa-available-count]");
    if (Number.isFinite(count) && count >= 0) {
      state.tegiwaCatalog.catalogProductCount = state.tegiwaCatalog.catalogProductCount === null
        ? count
        : Math.max(state.tegiwaCatalog.catalogProductCount, count);
    }
    if (Number.isFinite(available) && available >= 0) {
      state.tegiwaCatalog.availableProductCount = state.tegiwaCatalog.availableProductCount === null
        ? available
        : Math.max(state.tegiwaCatalog.availableProductCount, available);
    }
    if (catalogueStat && state.tegiwaCatalog.catalogProductCount !== null) catalogueStat.textContent = tegiwaNumber(state.tegiwaCatalog.catalogProductCount);
    if (availableStat && state.tegiwaCatalog.availableProductCount !== null) availableStat.textContent = tegiwaNumber(state.tegiwaCatalog.availableProductCount);
    state.tegiwaCatalog.currentPage = currentPage;
    state.tegiwaCatalog.totalPages = totalPages;
    state.tegiwaCatalog.pageSize = pageSize;
    state.tegiwaCatalog.canonicalQuery = isSearch ? cleanText(meta.canonicalQuery || meta.query || state.tegiwaCatalog.query, 120) : "";
    if (TEGIWA_MATCH_VALUES.has(meta.match)) state.tegiwaCatalog.match = meta.match;
    for (const key of Object.keys(TEGIWA_SEARCH_DEFAULTS)) {
      const source = Object.hasOwn(meta, key) ? meta[key] : meta.filters?.[key];
      if (source !== undefined && source !== null) state.tegiwaCatalog[key] = catalogueFilterValue(key, source);
    }
    state.tegiwaCatalog.sortScope = ["supplier-groups", "single-supplier-or-currency"].includes(meta.sortScope)
      ? meta.sortScope
      : "";
    const correction = root.querySelector("[data-tegiwa-correction]");
    if (correction) {
      const from = cleanText(meta.query || state.tegiwaCatalog.query, 120);
      const to = cleanText(meta.canonicalQuery || "", 120);
      const corrected = Boolean(isSearch && meta.corrected && from && to && from.toLocaleLowerCase() !== to.toLocaleLowerCase());
      const correctionLabel = meta.translated ? labels.tegiwaTranslatedSearch : labels.tegiwaCorrectedSearch;
      correction.hidden = !corrected;
      correction.innerHTML = corrected ? `${icons.check}<span>${esc(tegiwaTemplate(correctionLabel, { from, to }))}</span>` : "";
    }
    const pagination = root.querySelector("[data-tegiwa-pagination]");
    const pageList = root.querySelector("[data-tegiwa-pages]");
    if (pagination) pagination.hidden = !items.length || totalPages <= 1;
    if (pageList) pageList.innerHTML = totalPages > 1 ? tegiwaPaginationMarkup(currentPage, totalPages, labels) : "";
    const previous = root.querySelector('[data-action="tegiwa-previous"]');
    const next = root.querySelector('[data-action="tegiwa-next"]');
    if (previous) previous.disabled = currentPage <= 1;
    if (next) next.disabled = totalPages <= 1 || currentPage >= totalPages;
    const fallback = root.querySelector("[data-catalogue-fallback]");
    if (fallback) {
      const active = state.tegiwaCatalog.backend === "tegiwa-fallback" || state.tegiwaCatalog.partialCatalogue;
      fallback.hidden = !active;
      const message = state.tegiwaCatalog.partialCatalogue && state.tegiwaCatalog.backend !== "tegiwa-fallback"
        ? labels.cataloguePartial
        : labels.catalogueFallback;
      fallback.innerHTML = active ? `${icons.check}<span>${esc(message)}</span>` : "";
    }
    syncCatalogueFacetOptions(meta);
    syncTegiwaFilterUi();
    renderTegiwaVehicleContext();
  }

  async function loadTegiwaCatalog(options = {}) {
    const root = document.querySelector("[data-tegiwa-catalog]");
    if (!root) return;
    const labels = storeText();
    state.tegiwaCatalog.controller?.abort();
    const controller = new AbortController();
    state.tegiwaCatalog.controller = controller;
    const normalizedQuery = cleanText(Object.hasOwn(options, "query") ? options.query : state.tegiwaCatalog.query, 120);
    const requestedPage = Math.max(1, Number.parseInt(options.page, 10) || 1);
    const scrollResults = Boolean(options.scrollResults);
    const proposedMatch = Object.hasOwn(options, "match") ? options.match : state.tegiwaCatalog.match;
    state.tegiwaCatalog.match = partsVehicleLabel() && TEGIWA_MATCH_VALUES.has(proposedMatch) ? proposedMatch : "any";
    for (const key of Object.keys(TEGIWA_SEARCH_DEFAULTS)) {
      const proposed = Object.hasOwn(options, key) ? options[key] : state.tegiwaCatalog[key];
      state.tegiwaCatalog[key] = catalogueFilterValue(key, proposed);
    }
    state.tegiwaCatalog.query = normalizedQuery;
    state.tegiwaCatalog.lastRequest = {
      query: normalizedQuery,
      match: state.tegiwaCatalog.match,
      page: requestedPage,
      sort: state.tegiwaCatalog.sort,
      availability: state.tegiwaCatalog.availability,
      pricing: state.tegiwaCatalog.pricing,
      supplier: state.tegiwaCatalog.supplier,
      currency: state.tegiwaCatalog.currency,
      fitment: state.tegiwaCatalog.fitment,
      scrollResults
    };
    renderTegiwaVehicleContext();
    hideTegiwaSuggestions();
    const grid = root.querySelector("[data-tegiwa-results]");
    const status = root.querySelector("[data-tegiwa-status]");
    const correction = root.querySelector("[data-tegiwa-correction]");
    const controls = root.querySelectorAll("[data-tegiwa-control]");
    if (grid) grid.innerHTML = tegiwaLoadingCards();
    if (status) status.textContent = labels.tegiwaLoading;
    if (correction) { correction.hidden = true; correction.replaceChildren(); }
    controls.forEach(control => { control.disabled = true; });
    try {
      const request = partsCatalogueParams({ query: normalizedQuery, page: requestedPage });
      const result = await fetchPartsCatalogue(request, { signal: controller.signal });
      const payload = result.payload;
      if (!Array.isArray(payload.items)) throw new Error("catalogue_unavailable");
      applyCatalogueSource(result);
      renderTegiwaControls(payload);
      syncTegiwaCatalogueUrl();
      if (scrollResults) requestAnimationFrame(() => {
        const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        root.querySelector("[data-tegiwa-results]")?.scrollIntoView({ behavior, block: "start" });
      });
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (grid) grid.innerHTML = `<div class="notice notice-info tegiwa-error"><strong>${esc(labels.tegiwaLoadError)}</strong><button class="btn btn-sm" type="button" data-action="tegiwa-retry">${esc(labels.tegiwaRetry)}${icons.arrow}</button></div>`;
      if (status) status.textContent = labels.tegiwaLoadError;
    } finally {
      if (state.tegiwaCatalog.controller === controller) {
        state.tegiwaCatalog.controller = null;
        controls.forEach(control => { control.disabled = false; });
        const previous = root.querySelector('[data-action="tegiwa-previous"]');
        const next = root.querySelector('[data-action="tegiwa-next"]');
        if (previous) previous.disabled = state.tegiwaCatalog.currentPage <= 1;
        if (next) next.disabled = state.tegiwaCatalog.totalPages <= 1 || state.tegiwaCatalog.currentPage >= state.tegiwaCatalog.totalPages;
      }
    }
  }

  function setupTegiwaCatalog() {
    const root = document.querySelector("[data-tegiwa-catalog]");
    if (!root || root.dataset.ready === "true") return;
    root.dataset.ready = "true";
    const routeParams = currentRouteQueryParams();
    const routeQuery = cleanText(routeParams.get("q") || "", 120);
    const routePage = Math.max(1, Number.parseInt(routeParams.get("page"), 10) || 1);
    const routeFilters = Object.fromEntries(Object.keys(TEGIWA_SEARCH_DEFAULTS).map(key => [
      key,
      catalogueFilterValue(key, routeParams.get(key))
    ]));
    state.tegiwaCatalog.currentPage = routePage;
    state.tegiwaCatalog.totalPages = 1;
    state.tegiwaCatalog.pageSize = 100;
    state.tegiwaCatalog.query = routeQuery;
    state.tegiwaCatalog.canonicalQuery = "";
    state.tegiwaCatalog.match = "any";
    Object.assign(state.tegiwaCatalog, TEGIWA_SEARCH_DEFAULTS, routeFilters, {
      backend: "unified",
      partialCatalogue: false,
      catalogueSource: "",
      fallbackReason: "",
      sortScope: "",
      catalogProductCount: null,
      availableProductCount: null
    });
    const input = root.querySelector("[data-tegiwa-search-input]");
    if (input) input.value = routeQuery;
    input?.addEventListener("input", () => {
      if (state.tegiwaCatalog.suggestionComposing) return;
      clearTegiwaDirectorySelection();
      scheduleTegiwaSuggestions(input);
    });
    input?.addEventListener("compositionstart", () => {
      state.tegiwaCatalog.suggestionComposing = true;
      window.clearTimeout(state.tegiwaCatalog.suggestionTimer);
    });
    input?.addEventListener("compositionend", () => {
      state.tegiwaCatalog.suggestionComposing = false;
      clearTegiwaDirectorySelection();
      scheduleTegiwaSuggestions(input);
    });
    input?.addEventListener("focus", () => {
      if (cleanText(input.value, 120).length >= 2) scheduleTegiwaSuggestions(input);
    });
    syncTegiwaFilterUi();
    if (partsVehicleLabel()) loadTegiwaCatalog({ query: routeQuery, match: "vehicle", page: routePage });
    else loadTegiwaCatalog({ query: routeQuery, match: "any", page: routePage });
  }

  function partsCatalogueCard(item) {
    return tegiwaProductCard(item);
  }

  function tegiwaVariantAvailability(variant = {}) {
    const labels = storeText();
    return variant.available
      ? { label: labels.tegiwaVariantAvailable, className: "orderable" }
      : { label: labels.tegiwaVariantUnavailable, className: "check" };
  }

  function tegiwaVariantQuoteDetails(product, variant, availabilityLabel) {
    const labels = storeText();
    return [
      cleanText(product.supplier?.name || "Tegiwa", 160),
      cleanText(product.vendor || "", 120),
      cleanText(product.category || labels.productType, 120),
      `${labels.tegiwaSelectedOption}: ${cleanText(variant.title || labels.tegiwaProductDetails, 200)}`,
      `${labels.price}: ${tegiwaPriceLabel(variant.price || {})}`,
      `${labels.availability}: ${availabilityLabel}`
    ].filter(Boolean).join(" • ");
  }

  function updateTegiwaVariantSelection(input) {
    if (!input?.matches?.("[data-tegiwa-variant]") || !input.checked) return;
    const panel = input.closest(".tegiwa-detail-modal");
    if (!panel) return;
    panel.querySelectorAll(".tegiwa-variant-option").forEach(option => {
      option.classList.toggle("is-selected", option.contains(input));
    });
    const price = input.dataset.variantPrice || storeText().requestPrice;
    const availabilityLabel = input.dataset.variantAvailability || storeText().tegiwaVariantUnavailable;
    const available = input.dataset.variantAvailable === "true";
    const productSkuFallback = input.dataset.allowProductSkuFallback === "true" ? input.dataset.productSku : "";
    const sku = cleanText(input.dataset.variantSku || productSkuFallback || "", 120);
    const priceValue = panel.querySelector("[data-tegiwa-selected-price]");
    if (priceValue) priceValue.textContent = price;
    const skuRow = panel.querySelector("[data-tegiwa-selected-sku-row]");
    const skuValue = panel.querySelector("[data-tegiwa-selected-sku]");
    if (skuRow) skuRow.hidden = !sku;
    if (skuValue) {
      skuValue.replaceChildren();
      if (sku) {
        const code = document.createElement("bdi");
        code.dir = "ltr";
        code.textContent = sku;
        skuValue.append(code);
      }
    }
    const availabilityValue = panel.querySelector("[data-tegiwa-selected-availability-value]");
    if (availabilityValue) {
      const leadTime = availabilityValue.dataset.leadTime || "";
      availabilityValue.textContent = [availabilityLabel, leadTime].filter(Boolean).join(" • ");
    }
    const availabilityBadge = panel.querySelector("[data-tegiwa-selected-availability]");
    if (availabilityBadge) {
      availabilityBadge.className = `tegiwa-stock-badge is-${available ? "orderable" : "check"}`;
      availabilityBadge.textContent = availabilityLabel;
    }
    const cartButton = panel.querySelector("[data-tegiwa-variant-cart]");
    if (cartButton) {
      const selectionKey = cleanText(input.dataset.catalogueCartKey || "", 600);
      const selection = state.catalogueCartSelections.get(selectionKey);
      if (selection) cartButton.dataset.catalogueCartKey = selectionKey;
      else delete cartButton.dataset.catalogueCartKey;
      cartButton.disabled = !selection;
      const optionTitle = input.dataset.variantTitle || storeText().tegiwaProductDetails;
      cartButton.setAttribute("aria-label", `${commerceText().addToCart}: ${cartButton.dataset.productTitle} — ${optionTitle}`);
      return;
    }
    const addButton = panel.querySelector("[data-tegiwa-variant-quote]");
    if (!addButton) return;
    const optionTitle = input.dataset.variantTitle || storeText().tegiwaProductDetails;
    const baseDetails = addButton.dataset.baseDetails || "";
    addButton.dataset.id = `${addButton.dataset.baseId}-variant-${input.dataset.variantKey}`;
    if (sku) addButton.dataset.sku = sku;
    else delete addButton.dataset.sku;
    addButton.dataset.details = [
      baseDetails,
      `${storeText().tegiwaSelectedOption}: ${optionTitle}`,
      `${storeText().price}: ${price}`,
      `${storeText().availability}: ${availabilityLabel}`
    ].filter(Boolean).join(" • ");
    addButton.disabled = false;
    addButton.setAttribute("aria-label", `${storeText().addToQuote}: ${addButton.dataset.productTitle} — ${optionTitle}`);
  }

  async function openTegiwaProduct(value, opener, { updateUrl = true } = {}) {
    const handle = tegiwaProductHandle(value);
    if (!handle || currentPath() !== "/parts") return;
    if (updateUrl) updateTegiwaProductUrl(handle);
    const labels = storeText();
    const existingOpener = state.tegiwaCatalog.detailHandle === handle ? state.formContext?.opener : null;
    state.formContext = { opener: existingOpener || opener || null };
    state.tegiwaCatalog.detailHandle = handle;
    state.tegiwaCatalog.detailController?.abort();
    const detailController = new AbortController();
    state.tegiwaCatalog.detailController = detailController;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div><section class="modal-panel tegiwa-detail-modal" role="dialog" aria-modal="true" aria-labelledby="tegiwa-detail-title"><header class="drawer-head"><div><span class="eyebrow">${esc(labels.tegiwaEyebrow)}</span><h2 id="tegiwa-detail-title">${esc(labels.tegiwaLoading)}</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="${esc(U().actions.close)}">${icons.close}</button></header><div class="tegiwa-detail-loading">${tegiwaLoadingCards()}</div></section>`;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => modalRoot.querySelector('[data-action="close-modal"]')?.focus());
    try {
      const request = partsCatalogueParams({ handle });
      const result = await fetchPartsCatalogue(request, { signal: detailController.signal });
      const payload = result.payload;
      if (!payload.product) throw new Error("product_unavailable");
      if (state.tegiwaCatalog.detailController !== detailController || detailController.signal.aborted) return;
      applyCatalogueSource(result);
      const sourceProduct = payload.product;
      const product = localizedCatalogueProduct(sourceProduct);
      const availability = tegiwaAvailability(product.availability);
      const checked = tegiwaCheckedLabel(product.availability?.checkedAt);
      const variantOptions = Array.isArray(product.variants) ? product.variants : [];
      const selectedVariantIndex = variantOptions.length === 1 ? 0 : -1;
      const selectedVariant = selectedVariantIndex >= 0 ? variantOptions[selectedVariantIndex] : null;
      const selectedAvailability = selectedVariant ? tegiwaVariantAvailability(selectedVariant) : availability;
      const selectedPrice = selectedVariant ? tegiwaPriceLabel(selectedVariant.price || {}) : tegiwaPriceLabel(product.price);
      const productSkus = [...new Set([
        ...(Array.isArray(product.skus) ? product.skus : []),
        product.sku,
        product.mpn
      ].map(value => cleanText(value || "", 120)).filter(Boolean))];
      const productSku = cleanText(product.sku || "", 120);
      const selectedSku = selectedVariant
        ? cleanText(selectedVariant.sku || (variantOptions.length === 1 ? productSku : ""), 120)
        : cleanText(variantOptions.length === 0 ? productSku : "", 120);
      const productSkuMarkup = productSkus.map(sku => `<bdi dir="ltr">${esc(sku)}</bdi>`).join("");
      const showSelectedSku = Boolean(selectedVariant && selectedSku && (productSkus.length > 1 || productSkus[0] !== selectedSku));
      const leadTime = cleanText(product.availability?.leadTime || "", 240);
      const supplier = cleanText(product.supplier?.name || "Tegiwa", 160);
      const baseDetails = [supplier, cleanText(product.vendor || "", 120), cleanText(product.category || labels.productType, 120)].filter(Boolean).join(" • ");
      const details = selectedVariant
        ? tegiwaVariantQuoteDetails(product, selectedVariant, selectedAvailability.label)
        : [baseDetails, `${labels.price}: ${selectedPrice}`, `${labels.availability}: ${selectedAvailability.label}`].filter(Boolean).join(" • ");
      const sourceHandle = catalogueSourceHandle(sourceProduct);
      for (const [key, selection] of state.catalogueCartSelections) {
        if (selection?.sourceHandle === sourceHandle) state.catalogueCartSelections.delete(key);
      }
      const variantSelections = variantOptions.map(variant => supplierCatalogueCartSelection(sourceProduct, variant));
      const productSelection = variantOptions.length ? null : supplierCatalogueCartSelection(sourceProduct);
      const directCartSupported = variantOptions.length
        ? variantSelections.some(Boolean)
        : Boolean(productSelection);
      const variants = variantOptions.map((variant, index) => {
        const title = cleanText(variant.title || labels.tegiwaProductDetails, 200);
        const sku = cleanText(variant.sku || "", 120);
        const price = tegiwaPriceLabel(variant.price || {});
        const variantAvailability = tegiwaVariantAvailability(variant);
        const catalogueCartKey = variantSelections[index] ? registerCatalogueCartSelection(variantSelections[index]) : "";
        const selected = index === selectedVariantIndex;
        return `<li><label class="tegiwa-variant-option${selected ? " is-selected" : ""}"><input class="sr-only" type="radio" name="tegiwa-variant-${esc(product.handle)}" value="${index + 1}" data-tegiwa-variant data-variant-key="${index + 1}" data-variant-title="${esc(title)}" data-variant-sku="${esc(sku)}" data-catalogue-cart-key="${esc(catalogueCartKey)}" data-product-sku="${esc(variantOptions.length === 1 ? productSku : "")}" data-allow-product-sku-fallback="${String(variantOptions.length === 1)}" data-variant-price="${esc(price)}" data-variant-availability="${esc(variantAvailability.label)}" data-variant-available="${String(Boolean(variant.available))}"${selected ? " checked" : ""}><span class="tegiwa-variant-title" dir="auto">${esc(title)}</span><strong><bdi>${esc(price)}</bdi></strong>${sku ? `<small class="tegiwa-variant-sku">${esc(U().common.sku)}: <bdi dir="ltr">${esc(sku)}</bdi></small>` : ""}<small class="${variant.available ? "is-available" : ""}">${esc(variantAvailability.label)}</small><span class="tegiwa-variant-check" aria-hidden="true">${icons.check}</span></label></li>`;
      }).join("");
      const availabilityText = [selectedAvailability.label, leadTime].filter(Boolean).join(" • ");
      const selectedCatalogueCartKey = selectedVariant && variantSelections[selectedVariantIndex]
        ? registerCatalogueCartSelection(variantSelections[selectedVariantIndex])
        : (productSelection ? registerCatalogueCartSelection(productSelection) : "");
      const variantQuoteAttributes = `data-base-id="tegiwa-${esc(product.handle)}" data-base-details="${esc(baseDetails)}" data-product-title="${esc(product.title)}" data-product-sku="${esc(variantOptions.length === 1 ? productSku : "")}" data-sku="${esc(selectedSku)}" data-tegiwa-variant-quote`;
      const quoteButtonAttributes = variantOptions.length
        ? `${selectedVariant ? `data-id="tegiwa-${esc(product.handle)}-variant-${selectedVariantIndex + 1}" aria-label="${esc(`${labels.addToQuote}: ${product.title} — ${selectedVariant.title || labels.tegiwaProductDetails}`)}"` : 'aria-describedby="tegiwa-variant-instruction" disabled'} ${variantQuoteAttributes}`
        : `data-id="tegiwa-${esc(product.handle)}" data-sku="${esc(productSku)}"`;
      const cartButtonAttributes = variantOptions.length
        ? `${selectedCatalogueCartKey ? `data-catalogue-cart-key="${esc(selectedCatalogueCartKey)}"` : 'aria-describedby="tegiwa-variant-instruction" disabled'} data-product-title="${esc(product.title)}" data-tegiwa-variant-cart`
        : `${selectedCatalogueCartKey ? `data-catalogue-cart-key="${esc(selectedCatalogueCartKey)}"` : "disabled"} data-product-title="${esc(product.title)}"`;
      const primaryAction = directCartSupported
        ? `<button class="btn" type="button" data-action="add-catalogue-cart" ${cartButtonAttributes}>${esc(commerceText().addToCart)}${icons.cart}</button>`
        : `<button class="btn" type="button" data-action="add-quote" ${quoteButtonAttributes} data-kind="${esc(`${supplier} Parts Product`)}" data-title="${esc(product.title)}" data-details="${esc(details)}">${esc(labels.addToQuote)}${icons.quote}</button>`;
      const variantInstruction = directCartSupported ? labels.tegiwaChooseVariantForCart : labels.tegiwaChooseVariant;
      const selectedFitmentConfidence = selectedVehicleFitmentConfidence(product);
      const fitmentSummary = selectedFitmentConfidence === "exact" ? labels.exactMatch : selectedFitmentConfidence === "possible" ? labels.possibleMatch : "";
      const fitmentRows = (Array.isArray(product.fitments) ? product.fitments : []).slice(0, 8).map(item => {
        const years = item.yearFrom || item.yearTo ? `${item.yearFrom || ""}${item.yearFrom || item.yearTo ? "–" : ""}${item.yearTo || ""}` : "";
        return [years, item.make, item.model, item.generation, item.engine, item.note].filter(Boolean).join(" • ");
      }).filter(Boolean);
      modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div><section class="modal-panel tegiwa-detail-modal" role="dialog" aria-modal="true" aria-labelledby="tegiwa-detail-title"><header class="drawer-head"><div><span class="eyebrow">${esc(labels.tegiwaEyebrow)}</span><h2 id="tegiwa-detail-title" dir="auto">${esc(product.title)}</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="${esc(U().actions.close)}">${icons.close}</button></header><div class="tegiwa-detail-grid"><figure>${tegiwaImageMarkup(product.images?.[0] || product.image, product.title, { eager: true })}</figure><div class="tegiwa-detail-copy"><div class="tegiwa-detail-badges"><span class="tegiwa-stock-badge is-${esc(selectedAvailability.className)}" data-tegiwa-selected-availability>${esc(selectedAvailability.label)}</span>${fitmentSummary ? `<span class="tegiwa-fitment-badge is-${esc(selectedFitmentConfidence)}">${esc(fitmentSummary)}</span>` : ""}</div><p dir="auto">${esc(product.description || labels.tegiwaSourceNote)}</p><dl><div><dt>${esc(labels.supplier)}</dt><dd><bdi>${esc(supplier)}</bdi></dd></div>${product.vendor ? `<div><dt>${esc(U().common.brand)}</dt><dd><bdi>${esc(product.vendor)}</bdi></dd></div>` : ""}<div><dt>${esc(labels.productType)}</dt><dd dir="auto">${esc(product.category || labels.productType)}</dd></div>${productSkus.length ? `<div><dt>${esc(labels.skuMpn)}</dt><dd class="tegiwa-sku-list">${productSkuMarkup}</dd></div>` : ""}<div data-tegiwa-selected-sku-row${showSelectedSku ? "" : " hidden"}><dt>${esc(U().common.selectedSku)}</dt><dd class="tegiwa-sku-list" dir="ltr" data-tegiwa-selected-sku aria-live="polite">${showSelectedSku ? `<bdi dir="ltr">${esc(selectedSku)}</bdi>` : ""}</dd></div><div><dt>${esc(variantOptions.length ? labels.tegiwaOnlinePrice : labels.price)}</dt><dd><bdi data-tegiwa-selected-price aria-live="polite">${esc(selectedPrice)}</bdi></dd></div><div><dt>${esc(labels.availability)}</dt><dd><bdi data-tegiwa-selected-availability-value data-lead-time="${esc(leadTime)}" aria-live="polite">${esc(availabilityText)}</bdi></dd></div>${checked ? `<div><dt>${esc(labels.tegiwaChecked)}</dt><dd><bdi>${esc(checked)}</bdi></dd></div>` : ""}</dl>${fitmentRows.length ? `<div class="tegiwa-fitment-list"><strong>${esc(labels.fitment)}</strong><ul>${fitmentRows.map(item => `<li dir="auto">${esc(item)}</li>`).join("")}</ul></div>` : ""}<small>${esc(labels.tegiwaPriceNote)}</small><div class="store-buy-actions"><button class="btn" type="button" data-action="add-quote" ${quoteButtonAttributes} data-kind="${esc(`${supplier} Parts Product`)}" data-title="${esc(product.title)}" data-details="${esc(details)}">${esc(labels.addToQuote)}${icons.quote}</button>${product.sourceUrl ? `<a class="btn btn-outline" href="${esc(product.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(labels.originalSupplierListing)}${icons.arrow}</a>` : ""}</div></div></div>${variants ? `<section class="tegiwa-variants"><span class="eyebrow" id="tegiwa-variant-heading">${esc(labels.tegiwaVariants)}</span><p class="tegiwa-variant-instruction" id="tegiwa-variant-instruction">${esc(labels.tegiwaChooseVariant)}</p><ul role="radiogroup" aria-labelledby="tegiwa-variant-heading" aria-describedby="tegiwa-variant-instruction">${variants}</ul></section>` : ""}</section>`;
      if (directCartSupported) {
        const quoteButton = modalRoot.querySelector('.store-buy-actions [data-action="add-quote"]');
        if (quoteButton) quoteButton.outerHTML = primaryAction;
        const instruction = modalRoot.querySelector("#tegiwa-variant-instruction");
        if (instruction) instruction.textContent = variantInstruction;
      }
      requestAnimationFrame(() => modalRoot.querySelector('[data-action="close-modal"]')?.focus());
    } catch (error) {
      if (error?.name === "AbortError" || detailController.signal.aborted || state.tegiwaCatalog.detailController !== detailController) return;
      modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div><section class="modal-panel tegiwa-detail-modal" role="dialog" aria-modal="true" aria-labelledby="tegiwa-detail-title"><header class="drawer-head"><div><span class="eyebrow">${esc(labels.tegiwaEyebrow)}</span><h2 id="tegiwa-detail-title">${esc(labels.tegiwaLoadError)}</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="${esc(U().actions.close)}">${icons.close}</button></header><div class="notice notice-info tegiwa-error"><button class="btn btn-sm" type="button" data-action="view-tegiwa-product" data-handle="${esc(handle)}">${esc(labels.tegiwaRetry)}${icons.arrow}</button></div></section>`;
      requestAnimationFrame(() => modalRoot.querySelector('[data-action="close-modal"]')?.focus());
    } finally {
      if (state.tegiwaCatalog.detailController === detailController) state.tegiwaCatalog.detailController = null;
    }
  }

  function syncTegiwaProductFromUrl() {
    updateLanguageRouteLinks();
    const params = currentRouteQueryParams();
    const hasProduct = params.has(TEGIWA_PRODUCT_QUERY);
    const handle = tegiwaProductHandle(params.get(TEGIWA_PRODUCT_QUERY));
    if (currentPath() !== "/parts" || (hasProduct && !handle)) {
      if (hasProduct) removeTegiwaProductUrl();
      if (state.tegiwaCatalog.detailHandle) closeModal({ syncProductUrl: false });
      return;
    }
    if (!handle) {
      if (state.tegiwaCatalog.detailHandle) closeModal({ syncProductUrl: false });
      return;
    }
    if (state.tegiwaCatalog.detailHandle === handle && modalRoot.querySelector(".tegiwa-detail-modal")) return;
    openTegiwaProduct(handle, null, { updateUrl: false });
  }

  function partsCatalogueDirectory() {
    const labels = storeText();
    const localeKey = state.locale === "ar" ? "ar" : "en";
    const groups = PARTS_CATALOGUE_DIRECTORY.map((group, groupIndex) => {
      const groupLabel = group[localeKey] || group.en;
      const groupAria = tegiwaTemplate(labels.partDirectorySearch, { term: groupLabel });
      const panelId = `parts-directory-panel-${groupIndex + 1}`;
      const toggleId = `parts-directory-toggle-${groupIndex + 1}`;
      const links = group.items.map(([query, en, ar, partType = ""]) => {
        const label = localeKey === "ar" ? ar : en;
        const ariaLabel = tegiwaTemplate(labels.partDirectorySearch, { term: label });
        return `<li><button type="button" data-action="search-tegiwa-directory" data-tegiwa-directory-query="${esc(query)}"${partType ? ` data-tegiwa-directory-part-type="${esc(partType)}"` : ""} aria-label="${esc(ariaLabel)}" aria-pressed="false"><span>${esc(label)}</span>${icons.arrow}</button></li>`;
      }).join("");
      const expandLabel = tegiwaTemplate(labels.partDirectoryExpand, { term: groupLabel });
      const groupQuery = group.partType ? "" : group.query;
      const groupPartType = group.partType ? ` data-tegiwa-directory-part-type="${esc(group.partType)}"` : "";
      return `<article class="parts-directory-group" data-parts-directory-group><h3><button class="parts-directory-toggle" id="${toggleId}" type="button" data-action="toggle-parts-directory-group" data-parts-directory-toggle aria-expanded="false" aria-controls="${panelId}" aria-label="${esc(expandLabel)}" data-expanded-label="${esc(tegiwaTemplate(labels.partDirectoryCollapse, { term: groupLabel }))}" data-collapsed-label="${esc(expandLabel)}"><span class="parts-directory-index">${compactNumber(groupIndex + 1)}</span><strong>${esc(groupLabel)}</strong><span class="parts-directory-chevron" aria-hidden="true"></span></button></h3><div class="parts-directory-panel" id="${panelId}" role="region" aria-labelledby="${toggleId}" hidden><ul><li class="parts-directory-view-all"><button type="button" data-action="search-tegiwa-directory" data-tegiwa-directory-query="${esc(groupQuery)}"${groupPartType} aria-label="${esc(groupAria)}" aria-pressed="false"><span><strong>${esc(labels.partDirectoryViewAll)}</strong><small>${esc(groupLabel)}</small></span>${icons.arrow}</button></li>${links}</ul></div></article>`;
    }).join("");
    return `<section class="section parts-directory-section" id="parts-directory"><div class="container"><div class="parts-directory-shell" data-tegiwa-directory>${sectionHead(labels.partDirectoryEyebrow, labels.partDirectoryHeading, labels.partDirectoryText)}<p class="parts-directory-disclaimer" id="parts-directory-note">${icons.check}<span>${esc(labels.partDirectoryNote)}</span></p><div class="parts-directory-accordion" aria-label="${esc(labels.partDirectoryLabel)}" aria-describedby="parts-directory-note">${groups}</div></div></div></section>`;
  }

  function partsPage() {
    const page = P().parts;
    const finder = page.finder;
    const labels = storeText();
    const brandCounts = DATA.brands.map(brand => ({ brand, count: DATA.parts.filter(part => brandsForPart(part.brand).some(match => match.name === brand.name)).length + (DATA.storeProducts || []).filter(product => product.brand === brand.name).length })).filter(item => item.count > 0);
    const vehicle = state.partsVehicle && typeof state.partsVehicle === "object" ? state.partsVehicle : {};
    const directory = partsApplicationDirectory();
    const makes = [...directory.keys()];
    const modelsMap = directory.get(vehicle.make) || new Map();
    const generationsMap = modelsMap.get(vehicle.model) || new Map();
    const engines = [...(generationsMap.get(vehicle.generation) || [])];
    const modelYears = partsModelYears();
    const popularM = state.locale === "ar"
      ? {
          eyebrow: "اختيارات BMW M المراجعة",
          heading: "ترقيات M2 وM3 وM4 المراجعة.",
          text: "اختيارات من صفحات ECS المخصصة للسيارة وترتيب الملاءمة الافتراضي. لا تمثل أرقام مبيعات منشورة، ويجب تأكيد السعر والمخزون والتوافق قبل الطلب.",
          action: "ابحث في قطع ECS",
          possibleFitment: "توافق محتمل · يتطلب التأكيد"
        }
      : {
          eyebrow: "Featured reviewed BMW M selections",
          heading: "Reviewed M2, M3 and M4 upgrades.",
          text: "Curated from ECS vehicle pages and their default relevance ordering. These are not published sales figures; price, stock and exact fitment still require confirmation.",
          action: "Search ECS parts",
          possibleFitment: "Possible fitment · confirmation required"
        };
    const popularMModels = [
      ["BMW M2 G87", "M2", "G87", "S58"],
      ["BMW M3 F80", "M3", "F80", "S55"],
      ["BMW M4 F82", "M4", "F82", "S55"],
      ["BMW M4 F83", "M4", "F83", "S55"],
      ["BMW M3 G80", "M3", "G80", "S58"],
      ["BMW M4 G82", "M4", "G82", "S58"]
    ];
    const popularMMarkup = popularMModels.map(([query, model, chassis, engine]) => `<button type="button" data-action="search-tegiwa-directory" data-tegiwa-directory-query="${esc(query)}" data-tegiwa-directory-supplier="ecs" data-tegiwa-directory-match="any" aria-pressed="false"><span><strong>${esc(model)} <bdi dir="ltr">${esc(chassis)}</bdi></strong><small><bdi dir="ltr">${esc(engine)}</bdi> · ECS Tuning · ${esc(popularM.possibleFitment)}</small></span><span>${esc(popularM.action)}${icons.arrow}</span></button>`).join("");
    const brandTiles = brandCounts.map(({ brand }) => `<button class="parts-brand-card" type="button" data-action="search-tegiwa-directory" data-tegiwa-directory-query="${esc(brand.name)}" aria-pressed="false">${brandLogoMarkup(brand, { compact: true, inline: true })}<span class="parts-brand-copy"><strong dir="ltr">${esc(brand.name)}</strong><small>${esc(finder.byBrand)}</small></span>${icons.arrow}</button>`).join("");
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 27, crumbs: [[U().nav.parts]], actions: `<a class="btn" href="#parts-vehicle">${esc(finder.byVehicle)}${icons.arrow}</a><button class="btn btn-outline-light" type="button" data-action="open-form" data-form-type="Parts Enquiry">${esc(U().actions.enquire)}${icons.quote}</button>` })}
      <div data-parts-shop>
        <section class="section parts-entry-section"><div class="container">
          ${sectionHead(finder.overviewEyebrow, finder.overviewHeading, finder.overviewText)}
          <nav class="parts-paths" aria-label="${esc(finder.overviewEyebrow)}">
            <a href="#parts-vehicle"><span>01</span><strong>${esc(finder.byVehicle)}</strong><small>${esc(finder.vehiclePathText)}</small>${icons.arrow}</a>
            <a href="#parts-directory"><span>02</span><strong>${esc(labels.shopByPart)}</strong><small>${esc(labels.shopByPartText)}</small>${icons.arrow}</a>
            <a href="#parts-brands"><span>03</span><strong>${esc(finder.byBrand)}</strong><small>${esc(finder.brandPathText)}</small>${icons.arrow}</a>
          </nav>
          <div class="parts-vehicle-panel" id="parts-vehicle">
            <div class="parts-vehicle-copy"><span class="mini-label">${esc(finder.vehicleEyebrow)}</span><h2>${esc(finder.vehicleHeading)}</h2><p>${esc(finder.vehicleText)}</p></div>
            <form class="parts-vehicle-form" data-parts-vehicle-form>
              <label for="parts-vehicle-year"><span>${esc(finder.year)}</span><select id="parts-vehicle-year" class="select ltr-input" name="year" required>${selectOptions(modelYears, finder.chooseYear, String(vehicle.year || ""))}</select></label>
              <label><span>${esc(finder.make)}</span><select class="select" name="make" data-parts-vehicle-field required>${selectOptions(makes, finder.chooseMake, vehicle.make)}</select></label>
              <label><span>${esc(finder.model)}</span><select class="select" name="model" data-parts-vehicle-field required ${modelsMap.size ? "" : "disabled"}>${selectOptions([...modelsMap.keys()], labels.chooseModel, vehicle.model)}</select></label>
              <label><span>${esc(labels.generation)}</span><select class="select" name="generation" data-parts-vehicle-field required ${generationsMap.size ? "" : "disabled"}>${selectOptions(vehicleSelectItems([...generationsMap.keys()]), labels.chooseGeneration, vehicle.generation)}</select></label>
              <label><span>${esc(finder.engine)}</span><select class="select" name="engine" data-parts-vehicle-field required ${engines.length ? "" : "disabled"}>${selectOptions(vehicleSelectItems(engines), labels.chooseEngine, vehicle.engine)}</select></label>
              <button class="btn" type="submit">${esc(finder.saveVehicle)}${icons.arrow}</button>
            </form>
            <div class="parts-selected-vehicle ${partsVehicleLabel() ? "is-active" : ""}" data-parts-vehicle-summary>${partsVehicleSummaryMarkup()}</div>
            <p class="parts-directory-note">${icons.check}<span>${esc(labels.fitmentDirectoryNote)}</span></p>
          </div>
          <section class="parts-popular-m" aria-labelledby="parts-popular-m-title">
            <div><span class="mini-label">${esc(popularM.eyebrow)}</span><h2 id="parts-popular-m-title">${esc(popularM.heading)}</h2><p>${esc(popularM.text)}</p></div>
            <div class="parts-popular-m-grid">${popularMMarkup}</div>
          </section>
        </div></section>
        ${partsCatalogueDirectory()}
        <section class="section" id="parts-brands"><div class="container">${sectionHead(finder.brandEyebrow, finder.brandHeading, finder.brandText, `<a class="text-link" href="${routeUrl("/brands")}">${esc(finder.viewAllBrands)}${icons.arrow}</a>`)}<div class="parts-brand-grid">${brandTiles}</div></div></section>
        <section class="section tegiwa-catalog-section" id="tegiwa-catalog"><div class="container"><div class="tegiwa-catalog-shell" data-tegiwa-catalog>
          <header class="tegiwa-catalog-head"><div><span class="eyebrow">${esc(labels.tegiwaEyebrow)}</span><h2>${esc(labels.tegiwaHeading)}</h2><p>${esc(labels.tegiwaText)}</p></div><div class="tegiwa-catalog-stats"><article><strong data-tegiwa-catalog-count aria-label="${esc(labels.tegiwaLoading)}">—</strong><span>${esc(labels.tegiwaCatalogCount)}</span></article><article><strong data-tegiwa-available-count aria-label="${esc(labels.tegiwaLoading)}">—</strong><span>${esc(labels.tegiwaAvailableCount)}</span></article></div></header>
          <form class="tegiwa-search" data-tegiwa-search>
            <label for="tegiwa-search-input">${esc(labels.tegiwaSearchLabel)}</label>
            <div class="tegiwa-search-row">
              <div class="tegiwa-search-box"><span class="tegiwa-search-icon">${icons.search}</span><input id="tegiwa-search-input" class="input" name="q" type="search" minlength="2" maxlength="120" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="search" enterkeyhint="search" dir="auto" placeholder="${esc(labels.tegiwaSearchPlaceholder)}" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="tegiwa-search-suggestions" data-tegiwa-search-input><div class="tegiwa-suggestions" id="tegiwa-search-suggestions" role="listbox" aria-label="${esc(labels.tegiwaSearchSuggestions)}" data-tegiwa-suggestions hidden></div></div>
              <button class="btn" type="submit" data-tegiwa-control>${esc(labels.tegiwaSearchAction)}${icons.search}</button><button class="btn btn-outline" type="button" data-action="tegiwa-reset" data-tegiwa-control>${esc(labels.tegiwaBrowseAction)}${icons.arrow}</button>
            </div>
            <div class="tegiwa-search-toolbar"><button class="tegiwa-filter-toggle" type="button" data-action="toggle-tegiwa-filters" aria-expanded="false" aria-controls="tegiwa-filter-panel">${icons.filter}<span>${esc(labels.tegiwaSortFilter)}</span><small data-tegiwa-filter-count hidden></small></button></div>
            <div class="tegiwa-filter-panel" id="tegiwa-filter-panel" role="group" aria-label="${esc(labels.tegiwaFilterPanelLabel)}" data-tegiwa-filter-panel hidden>
              <label><span>${esc(labels.tegiwaSort)}</span><select class="select" data-tegiwa-filter="sort"><option value="relevance">${esc(labels.tegiwaSortSupplierOrder)}</option><option value="name_asc">${esc(labels.tegiwaSortNameAscSupplier)}</option><option value="name_desc">${esc(labels.tegiwaSortNameDescSupplier)}</option><option value="price_asc">${esc(labels.tegiwaSortPriceAscSupplier)}</option><option value="price_desc">${esc(labels.tegiwaSortPriceDescSupplier)}</option></select><small class="catalogue-sort-note" data-tegiwa-sort-note>${esc(labels.tegiwaMixedSortNote)}</small></label>
              <label><span>${esc(labels.tegiwaFilterAvailability)}</span><select class="select" data-tegiwa-filter="availability"><option value="all">${esc(labels.tegiwaAvailabilityAll)}</option><option value="available">${esc(labels.tegiwaAvailabilityAvailable)}</option><option value="in_stock">${esc(labels.tegiwaAvailabilityInStock)}</option><option value="supplier_stock">${esc(labels.tegiwaAvailabilitySupplierStock)}</option><option value="check">${esc(labels.tegiwaAvailabilityCheck)}</option><option value="unavailable">${esc(labels.tegiwaAvailabilityUnavailable)}</option></select></label>
              <label><span>${esc(labels.tegiwaFilterPricing)}</span><select class="select" data-tegiwa-filter="pricing"><option value="all">${esc(labels.tegiwaPricingAll)}</option><option value="priced">${esc(labels.tegiwaPricingPriced)}</option><option value="request_price">${esc(labels.tegiwaPricingRequest)}</option></select></label>
              <label><span>${esc(labels.supplier)}</span><select class="select" data-tegiwa-filter="supplier"><option value="">${esc(labels.allSuppliers)}</option></select></label>
              <label><span>${esc(labels.filterBrand)}</span><select class="select" data-tegiwa-filter="brand"><option value="">${esc(labels.allBrands)}</option></select></label>
              <label><span>${esc(labels.filterPartType)}</span><select class="select" data-tegiwa-filter="partType"><option value="">${esc(labels.allPartTypes)}</option></select></label>
              <label><span>${esc(labels.currency)}</span><select class="select ltr-input" data-tegiwa-filter="currency"><option value="">${esc(labels.allCurrencies)}</option></select></label>
              <label><span>${esc(labels.filterFitment)}</span><select class="select" data-tegiwa-filter="fitment" ${partsVehicleLabel() ? "" : "disabled"}><option value="all">${esc(labels.allFitment)}</option><option value="exact">${esc(labels.exactMatches)}</option><option value="possible">${esc(labels.possibleMatchesOnly)}</option></select></label>
              <button class="btn btn-outline btn-sm" type="button" data-action="tegiwa-clear-filters" disabled>${esc(labels.tegiwaClearFilters)}${icons.close}</button>
            </div>
            <div class="tegiwa-correction" data-tegiwa-correction role="status" aria-live="polite" hidden></div>
          </form>
          <div class="tegiwa-vehicle-context" data-tegiwa-vehicle-context hidden></div>
          <div class="notice notice-info catalogue-fallback-notice" data-catalogue-fallback role="status" hidden></div>
          <p class="tegiwa-source-note">${icons.check}<span>${esc(labels.tegiwaSourceNote)}</span></p>
          <div class="tegiwa-catalog-status" data-tegiwa-status role="status" aria-live="polite">${esc(labels.tegiwaLoading)}</div>
          <div class="tegiwa-product-grid" id="parts-results" data-tegiwa-results>${tegiwaLoadingCards()}</div>
          <nav class="tegiwa-pagination" data-tegiwa-pagination aria-label="${esc(labels.tegiwaPaginationLabel)}" hidden><button class="btn btn-outline" type="button" data-action="tegiwa-previous" data-tegiwa-control disabled>${icons.arrow}<span>${esc(labels.tegiwaPrevious)}</span></button><div class="tegiwa-pagination-center"><div class="tegiwa-page-list" data-tegiwa-pages dir="ltr"></div><button class="text-link" type="button" data-action="tegiwa-reset" data-tegiwa-control>${esc(labels.tegiwaReset)}</button></div><button class="btn btn-outline" type="button" data-action="tegiwa-next" data-tegiwa-control disabled><span>${esc(labels.tegiwaNext)}</span>${icons.arrow}</button></nav>
          <div class="parts-fitment-note">${icons.check}<span>${esc(finder.compatibility)}</span></div>
        </div></div></section>
      </div>
      ${ctaBlock(state.locale === "ar" ? "عندك رقم قطعة محدد؟" : "Have an exact part number?", state.locale === "ar" ? "أرسل رقم القطعة والسيارة وVIN عند الحاجة ومكان التسليم وخيار التركيب." : "Send the part number, vehicle, VIN where required, delivery location and whether installation is needed.", U().actions.enquire, "Parts Enquiry")}`;
  }

  function brandsPage() {
    const page = P().brands;
    const categories = [...new Set(DATA.brands.map(brand => categoryLabel(brand.category)))];
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 30, crumbs: [[U().nav.brands]], actions: `<button class="btn" type="button" data-action="open-form" data-form-type="Brand / Parts Enquiry">${esc(U().actions.enquire)}${icons.arrow}</button>` })}<section class="section"><div class="container"><div class="filter-bar"><label class="search-control">${icons.search}<input type="search" data-filter-search="brands" placeholder="${esc(U().filters.searchBrands)}" aria-label="${esc(U().filters.searchBrands)}"></label><label class="select-control">${icons.filter}<select data-filter-select="brands" data-filter-attribute="category"><option value="">${esc(U().common.allCategories)}</option>${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label></div><div class="brands-grid" data-filter-grid="brands">${DATA.brands.map(brandCard).join("")}</div><div class="empty-state" data-filter-empty="brands" hidden>${esc(U().common.noResults)}</div></div></section><section class="section section-tone"><div class="container narrow"><div class="notice notice-info"><strong>${state.locale === "ar" ? "ملاحظة عن تصنيف العلامات:" : "Brand-label note:"}</strong> ${state.locale === "ar" ? "تصنيف Dealer أوReseller أوSupported Platform يعتمد على المعلومات الموردة. لا يتم عرض وكالة حصرية أو علاقة معتمدة بدون تأكيد." : "Dealer, reseller and supported-platform labels follow supplied information. Exclusive or authorised status is not implied without confirmation."}</div></div></section>${ctaBlock(state.locale === "ar" ? "تحتاج قطعة من علامة معينة؟" : "Need a part from a specific brand?", state.locale === "ar" ? "أرسل اسم العلامة ورقم القطعة والسيارة حتى نتحقق من التوافق والتوفر." : "Send the brand, part number and vehicle so compatibility and availability can be checked.", U().actions.enquire, "Brand / Parts Enquiry")}`;
  }

  function galleryPage() {
    const page = P().gallery;
    const galleryMedia = DATA.media.filter(item => item.showInGallery !== false);
    const localized = galleryMedia.map(item => mediaItem(item.id));
    const categories = [...new Set(localized.map(item => item.category))];
    const makes = [...new Set(localized.map(item => item.make))];
    state.galleries.archive = galleryMedia.map(item => item.id);
    return `${pageHero({ eyebrow: page.eyebrow, title: page.heading, text: page.intro, media: 20, crumbs: [[U().nav.gallery]], actions: `<a class="btn" href="${CONFIG.instagramUrl}" target="_blank" rel="noopener">${esc(U().actions.openInstagram)}${icons.instagram}</a>` })}<section class="section"><div class="container"><div class="filter-bar"><label class="search-control">${icons.search}<input type="search" data-filter-search="media" placeholder="${esc(U().filters.searchMedia)}" aria-label="${esc(U().filters.searchMedia)}"></label><label class="select-control">${icons.filter}<select data-filter-select="media" data-filter-attribute="category"><option value="">${esc(U().common.allCategories)}</option>${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label><label class="select-control">${icons.filter}<select data-filter-select="media" data-filter-attribute="make"><option value="">${esc(U().common.allMakes)}</option>${makes.map(make => `<option value="${esc(make)}">${esc(make)}</option>`).join("")}</select></label></div><div class="media-grid" data-filter-grid="media">${galleryMedia.map(item => mediaCard(item.id)).join("")}</div><div class="empty-state" data-filter-empty="media" hidden>${esc(U().common.noResults)}</div></div></section>${ctaBlock(state.locale === "ar" ? "حاب تناقش سيارة من الصور؟" : "Want to discuss a vehicle shown here?", state.locale === "ar" ? "اذكر اسم السيارة أو المشروع وأرسل تفاصيل سيارتك الحالية حتى نحدد الخدمة المناسبة." : "Reference the vehicle or project and submit your current vehicle details so the correct service can be identified.", U().actions.contactWorkshop, "Project Consultation")}`;
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

  function commerceMoney(amount, currency) {
    const value = Number(amount);
    if (!Number.isFinite(value) || !/^[A-Z]{3}$/.test(String(currency || ""))) return commerceText().supplierReferencePrice;
    try {
      return new Intl.NumberFormat(state.locale === "ar" ? "ar-KW" : "en-GB", {
        style: "currency",
        currency,
        currencyDisplay: "code"
      }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  }

  function cartTotals() {
    const totals = new Map();
    for (const item of state.cart) {
      totals.set(item.currency, (totals.get(item.currency) || 0) + Number(item.unitAmount) * Number(item.quantity));
    }
    return [...totals.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
  }

  function cartTotalsMarkup() {
    return cartTotals().map(total => `<strong><bdi>${esc(commerceMoney(total.amount, total.currency))}</bdi></strong>`).join("");
  }

  function cartShipmentGroups() {
    const grouped = new Map();
    for (const item of state.cart) {
      const supplier = item.supplier || commercePolicy(commerceProduct(item.productId))?.supplier;
      if (!supplier?.slug || !supplier?.originCountryCode) continue;
      const current = grouped.get(supplier.slug) || {
        supplier: supplier.slug,
        supplierName: supplier.name,
        originCountryCode: supplier.originCountryCode,
        originCountryName: supplier.originCountryName,
        itemCount: 0,
        quantity: 0,
        status: "confirmation_required",
        rate: null
      };
      current.itemCount += 1;
      current.quantity += Number(item.quantity) || 0;
      grouped.set(supplier.slug, current);
    }
    return [...grouped.values()];
  }

  function safeShippingTextList(value, maximum = 12, textLimit = 180) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.slice(0, maximum).map(item => cleanText(item || "", textLimit)).filter(Boolean))];
  }

  function safeShippingCode(value, maximum = 100) {
    const code = cleanText(value || "", maximum).toLowerCase();
    return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(code) ? code : "";
  }

  function safeShippingId(value, maximum = 160) {
    const id = cleanText(value || "", maximum);
    return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) ? id : "";
  }

  function safeShippingToken(value) {
    const token = typeof value === "string" ? value.trim() : "";
    return token.length <= 24_000 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : "";
  }

  function safeShippingMinor(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000 ? value : null;
  }

  function safeShippingDecimal(value) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    const decimal = String(value);
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,12})?$/.test(decimal)) return "";
    const numeric = Number(decimal);
    return Number.isFinite(numeric) && numeric > 0 && numeric < 1_000_000 ? decimal : "";
  }

  function safeShippingCurrency(value) {
    const currency = String(value || "").toUpperCase();
    return /^[A-Z]{3}$/.test(currency) ? currency : "";
  }

  function safeShippingDateTime(value) {
    const timestamp = cleanText(value || "", 40);
    return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : "";
  }

  function safeShippingFlag(value) {
    return typeof value === "boolean" ? value : null;
  }

  function safeShippingDayRange(value) {
    if (Number.isInteger(value) && value >= 0 && value <= 365) return { min: value, max: value };
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const min = Number.isInteger(value.min) && value.min >= 0 && value.min <= 365 ? value.min : null;
    const max = Number.isInteger(value.max) && value.max >= 0 && value.max <= 365 ? value.max : min;
    return min !== null && max !== null && max >= min ? { min, max } : null;
  }

  function safeShippingFees(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 12).map((fee, index) => ({
      code: safeShippingCode(fee?.code || `fee_${index + 1}`, 80),
      label: cleanText(fee?.label || "", 120),
      amountMinor: safeShippingMinor(fee?.amountMinor),
      currency: safeShippingCurrency(fee?.currency),
      included: safeShippingFlag(fee?.included)
    })).filter(fee => fee.code);
  }

  function safeShippingOption(option, inheritedStatus = "confirmation_required") {
    if (!option || typeof option !== "object" || Array.isArray(option)) return null;
    const id = safeShippingId(option.id || option.optionId || option.serviceId);
    if (!id) return null;
    const incoterm = String(option.incoterm || "").toUpperCase();
    return {
      id,
      status: option.status === "confirmed" || (!option.status && inheritedStatus === "confirmed") ? "confirmed" : "confirmation_required",
      carrier: cleanText(option.carrier || "", 120),
      service: cleanText(option.service || "", 160),
      rateMinor: safeShippingMinor(option.rateMinor),
      currency: safeShippingCurrency(option.currency),
      originalAmountMinor: safeShippingMinor(option.originalAmountMinor),
      originalCurrency: safeShippingCurrency(option.originalCurrency),
      convertedRateMinor: safeShippingMinor(option.convertedRateMinor),
      convertedCurrency: safeShippingCurrency(option.convertedCurrency),
      conversionStatus: option.conversionStatus === "confirmed" ? "confirmed" : "confirmation_required",
      conversionReason: safeShippingCode(option.conversionReason, 160),
      exchangeRate: safeShippingDecimal(option.exchangeRate),
      exchangeRateAsOf: safeShippingDateTime(option.exchangeRateAsOf),
      handlingMinor: safeShippingMinor(option.handlingMinor),
      protectionMarginMinor: safeShippingMinor(option.protectionMarginMinor),
      insuranceMinor: safeShippingMinor(option.insuranceMinor),
      localDeliveryMinor: safeShippingMinor(option.localDeliveryMinor),
      fees: safeShippingFees(option.fees),
      quoteId: safeShippingId(option.quoteId || option.rateQuoteId),
      expiresAt: safeShippingDateTime(option.expiresAt || option.quoteExpiresAt || option.rateExpiresAt),
      revalidationStatus: ["confirmed", "required", "failed", "not_revalidated", "server_requoted"].includes(option.revalidationStatus) ? option.revalidationStatus : "required",
      revalidatedAt: safeShippingDateTime(option.revalidatedAt),
      dispatchDays: safeShippingDayRange(option.dispatchDays),
      transitDays: safeShippingDayRange(option.transitDays),
      incoterm: ["DDP", "DAP", "DDU"].includes(incoterm) ? incoterm : "",
      dutiesIncluded: safeShippingFlag(option.dutiesIncluded),
      taxIncluded: safeShippingFlag(option.taxIncluded),
      warnings: safeShippingTextList(option.warnings, 12, 240),
      restrictions: safeShippingTextList(option.restrictions, 12, 240)
    };
  }

  function safeShippingPlan(plan) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
    const groups = Array.isArray(plan.groups) ? plan.groups.slice(0, 20).map(group => ({
      groupId: safeShippingId(group?.groupId || group?.shipmentId || `${group?.supplier || "supplier"}:${group?.originId || group?.originCountryCode || "origin"}`),
      supplier: cleanText(group?.supplier || "", 80),
      supplierName: cleanText(group?.supplierName || "", 120),
      originCountryCode: cleanText(group?.originCountryCode || "", 2).toUpperCase(),
      originCountryName: cleanText(group?.originCountryName || "", 120),
      originId: cleanText(group?.originId || "", 100),
      groupBasis: safeShippingCode(group?.groupBasis),
      itemCount: Math.max(0, Math.min(99, Number(group?.itemCount) || 0)),
      quantity: Math.max(0, Math.min(999, Number(group?.quantity) || 0)),
      status: group?.status === "confirmed" ? "confirmed" : "confirmation_required",
      rate: typeof group?.rate === "number" && Number.isFinite(group.rate) && group.rate >= 0 ? group.rate : null,
      rateMinor: safeShippingMinor(group?.rateMinor),
      currency: safeShippingCurrency(group?.currency),
      carrier: cleanText(group?.carrier || "", 120),
      service: cleanText(group?.service || "", 160),
      quoteId: cleanText(group?.quoteId || group?.rateQuoteId || "", 160),
      quoteExpiresAt: cleanText(group?.quoteExpiresAt || group?.rateExpiresAt || "", 40),
      quoteMethod: safeShippingCode(group?.quoteMethod),
      rateSource: cleanText(group?.rateSource || "", 120),
      fulfilmentSystem: cleanText(group?.fulfilmentSystem || "", 120),
      calculationFactors: safeShippingTextList(group?.calculationFactors),
      requiredInputs: safeShippingTextList(group?.requiredInputs),
      restrictions: safeShippingTextList(group?.restrictions, 16, 240),
      consolidationPolicy: safeShippingCode(group?.consolidationPolicy, 160),
      dutiesMode: safeShippingCode(group?.dutiesMode, 160),
      observedCarrierFamilies: safeShippingTextList(group?.observedCarrierFamilies, 8, 80),
      packageDataStatus: safeShippingCode(group?.packageDataStatus),
      rateAccessStatus: safeShippingCode(group?.rateAccessStatus),
      blockingReasons: safeShippingTextList(group?.blockingReasons, 12, 180),
      warnings: safeShippingTextList(group?.warnings, 16, 240),
      packageCount: Math.max(0, Math.min(99, Number(group?.packageCount) || (Array.isArray(group?.packages) ? group.packages.length : 0))),
      options: Array.isArray(group?.options) ? group.options.slice(0, 24).map(option => safeShippingOption(option, group?.status)).filter(Boolean) : [],
      selectedOptionId: safeShippingId(group?.selectedOptionId),
      originalAmountMinor: safeShippingMinor(group?.originalAmountMinor),
      originalCurrency: safeShippingCurrency(group?.originalCurrency),
      convertedRateMinor: safeShippingMinor(group?.convertedRateMinor),
      convertedCurrency: safeShippingCurrency(group?.convertedCurrency),
      conversionStatus: group?.conversionStatus === "confirmed" ? "confirmed" : "confirmation_required",
      conversionReason: safeShippingCode(group?.conversionReason, 160),
      exchangeRate: safeShippingDecimal(group?.exchangeRate),
      exchangeRateAsOf: safeShippingDateTime(group?.exchangeRateAsOf),
      handlingMinor: safeShippingMinor(group?.handlingMinor),
      protectionMarginMinor: safeShippingMinor(group?.protectionMarginMinor),
      insuranceMinor: safeShippingMinor(group?.insuranceMinor),
      localDeliveryMinor: safeShippingMinor(group?.localDeliveryMinor),
      fees: safeShippingFees(group?.fees),
      dispatchDays: safeShippingDayRange(group?.dispatchDays),
      transitDays: safeShippingDayRange(group?.transitDays),
      incoterm: ["DDP", "DAP", "DDU"].includes(String(group?.incoterm || "").toUpperCase()) ? String(group.incoterm).toUpperCase() : "",
      dutiesIncluded: safeShippingFlag(group?.dutiesIncluded),
      taxIncluded: safeShippingFlag(group?.taxIncluded),
      evidenceAsOf: /^\d{4}-\d{2}-\d{2}$/.test(String(group?.evidenceAsOf || "")) ? String(group.evidenceAsOf) : ""
    })).filter(group => group.supplier && /^[A-Z]{2}$/.test(group.originCountryCode)) : [];
    if (!groups.length) return null;
    return {
      schemaVersion: safeShippingCode(plan.schemaVersion, 40),
      status: ["confirmed", "partial"].includes(plan.status) ? plan.status : "confirmation_required",
      quoteId: safeShippingId(plan.quoteId),
      fingerprint: safeShippingId(plan.fingerprint, 200),
      quotedAt: safeShippingDateTime(plan.quotedAt),
      expiresAt: safeShippingDateTime(plan.expiresAt || plan.quoteExpiresAt),
      idempotencyKey: safeShippingId(plan.idempotencyKey, 200),
      revalidated: plan.revalidated === true,
      revalidationStatus: ["confirmed", "required", "failed", "unconfigured", "not_revalidated", "server_requoted"].includes(plan.revalidationStatus) ? plan.revalidationStatus : "required",
      revalidationId: safeShippingId(plan.revalidationId || plan.revalidationToken, 200),
      revalidationToken: safeShippingToken(plan.revalidationToken),
      revalidatedFromQuoteId: safeShippingId(plan.revalidatedFromQuoteId),
      revalidatedAt: safeShippingDateTime(plan.revalidatedAt),
      revalidationExpiresAt: safeShippingDateTime(plan.revalidationExpiresAt),
      splitShipment: groups.length > 1,
      groupCount: groups.length,
      totalShippingMinor: safeShippingMinor(plan.totalShippingMinor),
      confirmedShippingMinor: safeShippingMinor(plan.confirmedShippingMinor),
      currency: safeShippingCurrency(plan.currency || plan.totalCurrency),
      originalTotalMinor: safeShippingMinor(plan.originalTotalMinor),
      originalCurrency: safeShippingCurrency(plan.originalCurrency),
      baseShippingMinor: safeShippingMinor(plan.baseShippingMinor),
      exchangeRate: safeShippingDecimal(plan.exchangeRate),
      exchangeRateAsOf: safeShippingDateTime(plan.exchangeRateAsOf),
      commercialRulesVersion: safeShippingId(plan.commercialRulesVersion, 80),
      commercialRulesEnabled: plan.commercialRulesEnabled === true,
      handlingMinor: safeShippingMinor(plan.handlingMinor),
      protectionMarginMinor: safeShippingMinor(plan.protectionMarginMinor),
      insuranceMinor: safeShippingMinor(plan.insuranceMinor),
      fragileFeeMinor: safeShippingMinor(plan.fragileFeeMinor),
      oversizeFeeMinor: safeShippingMinor(plan.oversizeFeeMinor),
      forwarderFeeMinor: safeShippingMinor(plan.forwarderFeeMinor),
      localDeliveryMinor: safeShippingMinor(plan.localDeliveryMinor),
      roundingAdjustmentMinor: safeShippingMinor(plan.roundingAdjustmentMinor),
      manualReviewRequired: plan.manualReviewRequired === true,
      fees: safeShippingFees(plan.fees),
      dutiesStatus: safeShippingCode(plan.dutiesStatus, 80),
      incoterm: ["DDP", "DAP", "DDU"].includes(String(plan.incoterm || "").toUpperCase()) ? String(plan.incoterm).toUpperCase() : "",
      dutiesIncluded: safeShippingFlag(plan.dutiesIncluded),
      taxIncluded: safeShippingFlag(plan.taxIncluded),
      localDeliveryIncluded: safeShippingFlag(plan.localDeliveryIncluded),
      paymentEligible: plan.paymentEligible === true,
      warnings: safeShippingTextList(plan.warnings, 20, 240),
      destination: {
        countryCode: cleanText(plan.destination?.countryCode || "", 2).toUpperCase(),
        country: cleanText(plan.destination?.country || "", 100),
        governorate: cleanText(plan.destination?.governorate || plan.destination?.region || "", 120),
        city: cleanText(plan.destination?.city || "", 100),
        area: cleanText(plan.destination?.area || "", 120),
        addressLine1: cleanText(plan.destination?.addressLine1 || "", 240),
        addressLine2: cleanText(plan.destination?.addressLine2 || "", 240),
        postcode: cleanText(plan.destination?.postcode || "", 30),
        phone: cleanText(plan.destination?.phone || "", 50)
      },
      groups
    };
  }

  function shippingOriginLabel(group, text) {
    if (group.originCountryCode === "GB") return text.originGB;
    if (group.originCountryCode === "US") return text.originUS;
    if (group.originCountryCode === "KW") return text.originKW;
    return group.originCountryName || group.originCountryCode;
  }

  function shippingMetadataFallback(group) {
    const supplier = cleanText(group?.supplier || "", 80).toLowerCase();
    if (supplier === "tegiwa") return {
      quoteMethod: "shopify_dynamic_checkout",
      rateSource: "Calcurates",
      fulfilmentSystem: "Despatch Cloud",
      calculationFactors: ["destination", "cart_contents", "verified_package_weight_and_dimensions", "eligible_carrier_service", "supplier_shipping_rules"],
      requiredInputs: ["destination_country", "destination_city", "destination_postcode", "cart_contents", "verified_package_weight_and_dimensions"],
      restrictions: ["live_rate_requires_supplier_checkout_or_authorised_rate_access", "dhl_express_observation_is_limited_to_one_bounded_kuwait_test", "despatch_cloud_is_a_fulfilment_and_data_processor_not_a_verified_rating_engine"],
      consolidationPolicy: "supplier_checkout_confirmation_required",
      dutiesMode: "not_proven_included_confirm_exact_quote",
      observedCarrierFamilies: ["DHL Express"],
      evidenceAsOf: "2026-08-10"
    };
    if (supplier === "ecs" || supplier === "ecs-tuning") return {
      quoteMethod: "dynamic_destination_aware_supplier_cart",
      rateSource: "undisclosed_supplier_backend",
      fulfilmentSystem: "undisclosed",
      calculationFactors: ["destination", "cart_contents", "verified_package_weight_and_dimensions", "eligible_carrier_service", "fulfilment_location", "supplier_shipping_rules"],
      requiredInputs: ["destination_country", "destination_city", "destination_postcode", "cart_contents", "verified_package_weight_and_dimensions", "fulfilment_location"],
      restrictions: ["backend_rating_vendor_is_not_publicly_disclosed", "live_rate_requires_supplier_cart_and_complete_package_data", "direct_ship_freight_and_partial_shipments_may_price_separately", "carrier_availability_varies_by_destination_and_package"],
      consolidationPolicy: "hold_until_all_items_are_in_stock_unless_partial_shipment_is_requested",
      dutiesMode: "recipient_responsible_unless_supplier_explicitly_states_otherwise",
      observedCarrierFamilies: ["UPS", "FedEx", "USPS"],
      evidenceAsOf: "2026-08-10"
    };
    return {
      quoteMethod: "supplier_confirmation",
      rateSource: "undisclosed",
      fulfilmentSystem: "undisclosed",
      calculationFactors: ["destination", "cart_contents", "verified_package_weight_and_dimensions", "supplier_shipping_rules"],
      requiredInputs: ["destination_country", "destination_city", "destination_postcode", "cart_contents", "verified_package_weight_and_dimensions"],
      restrictions: ["live_rate_requires_authorised_supplier_or_carrier_access"],
      consolidationPolicy: "supplier_confirmation_required",
      dutiesMode: "supplier_confirmation_required",
      observedCarrierFamilies: [],
      evidenceAsOf: "2026-08-10"
    };
  }

  function shippingPresentationGroup(group) {
    const fallback = shippingMetadataFallback(group);
    return {
      ...fallback,
      ...group,
      quoteMethod: group.quoteMethod || fallback.quoteMethod,
      rateSource: group.rateSource || fallback.rateSource,
      fulfilmentSystem: group.fulfilmentSystem || fallback.fulfilmentSystem,
      calculationFactors: group.calculationFactors?.length ? group.calculationFactors : fallback.calculationFactors,
      requiredInputs: group.requiredInputs?.length ? group.requiredInputs : fallback.requiredInputs,
      restrictions: group.restrictions?.length ? group.restrictions : fallback.restrictions,
      observedCarrierFamilies: group.observedCarrierFamilies?.length ? group.observedCarrierFamilies : fallback.observedCarrierFamilies,
      consolidationPolicy: group.consolidationPolicy || fallback.consolidationPolicy,
      dutiesMode: group.dutiesMode || fallback.dutiesMode,
      evidenceAsOf: group.evidenceAsOf || fallback.evidenceAsOf,
      blockingReasons: group.blockingReasons?.length ? group.blockingReasons : (group.status === "confirmed" ? [] : ["verified_package_data_required", "authorised_dynamic_rate_access_required"])
    };
  }

  function shippingMetadataLabel(value) {
    const safe = cleanText(value || "", 240);
    if (!safe) return "—";
    const values = shippingMetadataText().values;
    return Object.prototype.hasOwnProperty.call(values, safe)
      ? values[safe]
      : safe.replace(/[_-]+/g, " ").replace(/^./, character => character.toUpperCase());
  }

  function shippingMinorDigits(currency) {
    return ["KWD", "BHD", "OMR", "JOD", "TND", "IQD"].includes(String(currency || "").toUpperCase()) ? 3 : 2;
  }

  function shippingMoneyMinor(amountMinor, currency) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !/^[A-Z]{3}$/.test(String(currency || "").toUpperCase())) return "—";
    const digits = shippingMinorDigits(currency);
    const amount = amountMinor / (10 ** digits);
    try {
      return new Intl.NumberFormat(state.locale === "ar" ? "ar-KW" : "en-KW", {
        style: "currency",
        currency: String(currency).toUpperCase(),
        currencyDisplay: "code",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(amount);
    } catch {
      return `${String(currency).toUpperCase()} ${amount.toFixed(digits)}`;
    }
  }

  function shippingPlanCommercialBreakdown(plan) {
    const currency = safeShippingCurrency(plan?.currency);
    const totalMinor = safeShippingMinor(plan?.totalShippingMinor);
    const components = [
      { key: "baseShippingMinor", amountMinor: safeShippingMinor(plan?.baseShippingMinor) },
      { key: "handlingMinor", amountMinor: safeShippingMinor(plan?.handlingMinor) },
      { key: "protectionMarginMinor", amountMinor: safeShippingMinor(plan?.protectionMarginMinor) },
      { key: "insuranceMinor", amountMinor: safeShippingMinor(plan?.insuranceMinor) },
      { key: "fragileFeeMinor", amountMinor: safeShippingMinor(plan?.fragileFeeMinor) },
      { key: "oversizeFeeMinor", amountMinor: safeShippingMinor(plan?.oversizeFeeMinor) },
      { key: "forwarderFeeMinor", amountMinor: safeShippingMinor(plan?.forwarderFeeMinor) },
      { key: "localDeliveryMinor", amountMinor: safeShippingMinor(plan?.localDeliveryMinor) },
      { key: "roundingAdjustmentMinor", amountMinor: safeShippingMinor(plan?.roundingAdjustmentMinor) }
    ];
    const complete = Boolean(currency) && totalMinor !== null && components.every(component => component.amountMinor !== null);
    const componentTotal = complete ? components.reduce((sum, component) => sum + component.amountMinor, 0) : null;
    return {
      currency,
      totalMinor,
      components,
      componentTotal,
      reconciles: complete && Number.isSafeInteger(componentTotal) && componentTotal === totalMinor
    };
  }

  function shippingGroupKey(group) {
    return safeShippingId(group?.groupId || `${group?.supplier || "supplier"}:${group?.originId || group?.originCountryCode || "origin"}`);
  }

  function shippingSelectedOption(group) {
    if (!Array.isArray(group?.options) || !group.options.length) return null;
    const selectedId = state.shippingSelections[shippingGroupKey(group)] || group.selectedOptionId;
    return group.options.find(option => option.id === selectedId) || null;
  }

  function shippingCandidateQuote(option, group, plan) {
    const quoteId = safeShippingId(option?.quoteId || group?.quoteId || plan?.quoteId);
    const expiresAt = safeShippingDateTime(option?.expiresAt || group?.quoteExpiresAt || plan?.expiresAt);
    return { quoteId, expiresAt, expiry: Date.parse(expiresAt) };
  }

  function shippingOptionHasConfirmedQuote(option, group, plan) {
    const rateMinor = option ? option.rateMinor : group?.rateMinor;
    const legacyRate = option ? null : group?.rate;
    const currency = safeShippingCurrency(option?.currency || group?.currency);
    const carrier = cleanText(option?.carrier || group?.carrier || "", 120);
    const service = cleanText(option?.service || group?.service || "", 160);
    const status = option?.status || group?.status;
    const quote = shippingCandidateQuote(option, group, plan);
    const hasAmount = safeShippingMinor(rateMinor) !== null
      || (typeof legacyRate === "number" && Number.isFinite(legacyRate) && legacyRate >= 0);
    return status === "confirmed"
      && hasAmount
      && Boolean(currency)
      && Boolean(carrier)
      && Boolean(service)
      && Boolean(quote.quoteId)
      && Number.isFinite(quote.expiry)
      && quote.expiry > Date.now();
  }

  function shippingGroupHasConfirmedRate(group, plan) {
    if (group?.options?.length) {
      const selected = shippingSelectedOption(group);
      return Boolean(selected && shippingOptionHasConfirmedQuote(selected, group, plan));
    }
    return shippingOptionHasConfirmedQuote(null, group, plan);
  }

  function shippingPlanHasCurrentRevalidation(plan) {
    const expiry = Date.parse(String(plan?.expiresAt || ""));
    const optionExpiries = (plan?.groups || []).map(group => {
      const selected = shippingSelectedOption(group);
      return Date.parse(String(selected?.expiresAt || group?.quoteExpiresAt || plan?.expiresAt || ""));
    });
    return plan?.revalidated === true
      && plan?.revalidationStatus === "server_requoted"
      && Boolean(plan?.quoteId)
      && Boolean(plan?.revalidatedAt)
      && shippingPlanCommercialBreakdown(plan).reconciles
      && Number.isFinite(expiry)
      && expiry > Date.now()
      && optionExpiries.length > 0
      && optionExpiries.every(optionExpiry => Number.isFinite(optionExpiry) && optionExpiry > Date.now());
  }

  function shippingPlanCanRevalidate(plan, groups) {
    return Boolean(
      plan?.quoteId
      && plan?.revalidationToken
      && Array.isArray(groups)
      && groups.length
      && groups.every(group => shippingGroupHasConfirmedRate(group, plan))
    );
  }

  function shippingDayRangeLabel(range) {
    if (!range || !Number.isInteger(range.min) || !Number.isInteger(range.max)) return "—";
    const days = range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
    return `${days} ${shippingCheckoutText().workingDays}`;
  }

  function shippingIncotermLabel(value, dutiesIncluded = null) {
    const text = shippingCheckoutText();
    const incoterm = String(value || "").toUpperCase();
    if (incoterm === "DDP" && dutiesIncluded === true) return text.ddp;
    if (["DAP", "DDU"].includes(incoterm) || dutiesIncluded === false) return text.dap;
    return text.dutiesUnverified;
  }

  function shippingRateLabel(option, group, plan) {
    if (!shippingOptionHasConfirmedQuote(option, group, plan)) return commerceText().shippingConfirmationRequired;
    const rateMinor = option ? option.rateMinor : group.rateMinor;
    const currency = option?.currency || group.currency;
    return rateMinor !== null ? shippingMoneyMinor(rateMinor, currency) : commerceMoney(group.rate, currency);
  }

  function shippingMetadataList(values) {
    return `<ul>${values.map(value => `<li>${esc(shippingMetadataLabel(value))}</li>`).join("")}</ul>`;
  }

  function shippingPricingAuditMarkup(option, group, plan) {
    if (!shippingOptionHasConfirmedQuote(option, group, plan)) return "";
    const text = shippingCheckoutText();
    const candidate = option || group;
    const rows = [];
    const addAmount = (label, amountMinor, currency) => {
      if (safeShippingMinor(amountMinor) !== null && safeShippingCurrency(currency)) rows.push(`<div><dt>${esc(label)}</dt><dd><bdi>${esc(shippingMoneyMinor(amountMinor, currency))}</bdi></dd></div>`);
    };
    addAmount(text.originalSupplierRate, candidate.originalAmountMinor, candidate.originalCurrency);
    if (candidate.exchangeRate) rows.push(`<div><dt>${esc(text.exchangeRate)}</dt><dd><bdi dir="ltr">${esc(candidate.exchangeRate)}</bdi></dd></div>`);
    if (candidate.exchangeRateAsOf) rows.push(`<div><dt>${esc(text.exchangeRateAsOf)}</dt><dd><bdi dir="ltr">${esc(candidate.exchangeRateAsOf)}</bdi></dd></div>`);
    addAmount(text.convertedShipping, candidate.convertedRateMinor, candidate.convertedCurrency);
    addAmount(text.handlingFee, candidate.handlingMinor, candidate.convertedCurrency || candidate.currency);
    addAmount(text.protectionMargin, candidate.protectionMarginMinor, candidate.convertedCurrency || candidate.currency);
    addAmount(text.insuranceFee, candidate.insuranceMinor, candidate.convertedCurrency || candidate.currency);
    addAmount(text.localDeliveryFee, candidate.localDeliveryMinor, candidate.convertedCurrency || candidate.currency);
    for (const fee of candidate.fees || []) addAmount(fee.label || text.otherFees, fee.amountMinor, fee.currency);
    const quote = shippingCandidateQuote(option, group, plan);
    rows.push(`<div><dt>${esc(text.incoterm)}</dt><dd>${esc(shippingIncotermLabel(candidate.incoterm || group.incoterm || plan?.incoterm, candidate.dutiesIncluded ?? group.dutiesIncluded))}</dd></div>`);
    if (quote.expiresAt) rows.push(`<div><dt>${esc(text.quoteExpires)}</dt><dd><bdi dir="ltr">${esc(quote.expiresAt)}</bdi></dd></div>`);
    return `<details class="shipping-pricing-audit"><summary>${esc(text.pricingAudit)}</summary><dl>${rows.join("")}</dl></details>`;
  }

  function shippingPlanPricingAuditMarkup(plan) {
    const text = shippingCheckoutText();
    const breakdown = shippingPlanCommercialBreakdown(plan);
    if (!breakdown.currency || breakdown.totalMinor === null) return "";
    const labels = {
      baseShippingMinor: text.baseShipping,
      handlingMinor: text.handlingFee,
      protectionMarginMinor: text.protectionMargin,
      insuranceMinor: text.insuranceFee,
      fragileFeeMinor: text.fragileFee,
      oversizeFeeMinor: text.oversizeFee,
      forwarderFeeMinor: text.forwarderFee,
      localDeliveryMinor: text.localDeliveryFee,
      roundingAdjustmentMinor: text.roundingAdjustment
    };
    const componentRows = breakdown.components
      .filter(component => component.key === "baseShippingMinor" || component.amountMinor > 0)
      .map(component => `<div><dt>${esc(labels[component.key])}</dt><dd><bdi>${esc(shippingMoneyMinor(component.amountMinor, breakdown.currency))}</bdi></dd></div>`);
    const rulesState = plan.commercialRulesEnabled ? text.commercialRulesEnabled : text.commercialRulesDisabled;
    const ruleVersion = plan.commercialRulesVersion
      ? `<div><dt>${esc(text.commercialRulesVersion)}</dt><dd><bdi dir="ltr">${esc(plan.commercialRulesVersion)}</bdi></dd></div>`
      : "";
    const manualState = plan.manualReviewRequired ? text.manualReviewRequired : text.manualReviewNotRequired;
    const reconciliationState = breakdown.reconciles ? text.breakdownReconciled : text.breakdownMismatch;
    return `<details class="shipping-pricing-audit shipping-total-audit"><summary>${esc(text.totalPricingAudit)}</summary><dl>${componentRows.join("")}<div class="is-total"><dt>${esc(text.totalShipping)}</dt><dd><bdi>${esc(shippingMoneyMinor(breakdown.totalMinor, breakdown.currency))}</bdi></dd></div><div><dt>${esc(text.commercialRulesStatus)}</dt><dd>${esc(rulesState)}</dd></div>${ruleVersion}<div><dt>${esc(text.manualReviewStatus)}</dt><dd>${esc(manualState)}</dd></div><div class="${breakdown.reconciles ? "is-reconciled" : "is-warning"}"><dt>${esc(text.breakdownStatus)}</dt><dd>${esc(reconciliationState)}</dd></div></dl></details>`;
  }

  function shippingOptionsMarkup(group, plan) {
    const text = shippingCheckoutText();
    const key = shippingGroupKey(group);
    if (!group.options?.length) {
      if (!shippingGroupHasConfirmedRate(group, plan)) return `<div class="shipping-manual-notice" role="status"><strong>${esc(text.manualShipment)}</strong><span>${esc(text.noAutomaticOptions)}</span></div>`;
      return `<article class="shipping-option is-selected is-confirmed"><div><strong><bdi>${esc(group.carrier)}</bdi> · <bdi>${esc(group.service)}</bdi></strong><small>${esc(text.selected)}</small></div><bdi class="shipping-option-price">${esc(shippingRateLabel(null, group, plan))}</bdi>${shippingPricingAuditMarkup(null, group, plan)}</article>`;
    }
    const selectedId = state.shippingSelections[key] || group.selectedOptionId;
    return `<fieldset class="shipping-options"><legend>${esc(text.selectShippingService)}</legend>${group.options.map(option => {
      const eligible = shippingOptionHasConfirmedQuote(option, group, plan);
      const checked = eligible && selectedId === option.id;
      const label = [option.carrier, option.service].filter(Boolean).join(" · ") || text.manualShipment;
      return `<article class="shipping-option${checked ? " is-selected" : ""}${eligible ? " is-confirmed" : " is-disabled"}"><label><input type="radio" name="shipping-option-${esc(key)}" value="${esc(option.id)}" data-shipping-option data-shipping-group="${esc(key)}"${checked ? " checked" : ""}${eligible ? "" : " disabled"}><span class="shipping-option-main"><strong><bdi>${esc(label)}</bdi></strong><small>${eligible ? esc(text.confirmedShipment) : esc(text.manualShipment)}</small></span><bdi class="shipping-option-price">${esc(eligible ? shippingRateLabel(option, group, plan) : commerceText().shippingConfirmationRequired)}</bdi><span class="shipping-option-timing"><small>${esc(text.dispatchEstimate)}: ${esc(shippingDayRangeLabel(option.dispatchDays || group.dispatchDays))}</small><small>${esc(text.transitEstimate)}: ${esc(shippingDayRangeLabel(option.transitDays || group.transitDays))}</small></span></label>${eligible ? shippingPricingAuditMarkup(option, group, plan) : ""}</article>`;
    }).join("")}</fieldset>`;
  }

  function shippingPlanSummaryMarkup(plan, groups) {
    const text = shippingCheckoutText();
    const confirmed = groups.filter(group => shippingGroupHasConfirmedRate(group, plan));
    const fullyConfirmed = groups.length > 0 && confirmed.length === groups.length;
    const selectionsAligned = fullyConfirmed && groups.every(group => !group.options?.length || shippingSelectedOption(group)?.id === group.selectedOptionId);
    const commercialBreakdown = shippingPlanCommercialBreakdown(plan);
    const totalReconciles = selectionsAligned && commercialBreakdown.reconciles;
    const totalMinor = totalReconciles ? plan?.totalShippingMinor : plan?.status === "partial" ? plan?.confirmedShippingMinor : null;
    const totalLabel = totalReconciles ? text.totalShipping : plan?.status === "partial" && confirmed.length ? text.confirmedShippingPortion : commerceText().shippingPending;
    const total = safeShippingMinor(totalMinor) !== null && safeShippingCurrency(plan?.currency)
      ? `<strong><bdi>${esc(shippingMoneyMinor(totalMinor, plan.currency))}</bdi></strong>`
      : `<strong>${esc(text.shippingTotalPending)}</strong>`;
    const revalidated = totalReconciles && shippingPlanHasCurrentRevalidation(plan);
    const canRevalidate = fullyConfirmed && commercialBreakdown.reconciles && shippingPlanCanRevalidate(plan, groups);
    const status = state.shippingRevalidationStatus === "loading" ? text.revalidatingShipping
      : state.shippingRevalidationStatus === "error" ? text.revalidationFailed
        : revalidated ? text.revalidationReady : text.revalidationPending;
    const summary = selectionsAligned && !commercialBreakdown.reconciles ? text.breakdownMismatch
      : selectionsAligned ? text.noPaymentWithRates
        : plan?.status === "partial" ? text.partialPlan : text.shippingTotalPending;
    const pricingAudit = selectionsAligned ? shippingPlanPricingAuditMarkup(plan) : "";
    const manualReview = selectionsAligned && plan?.manualReviewRequired
      ? `<p class="shipping-manual-notice" role="status"><strong>${esc(text.manualReviewRequired)}</strong><span>${esc(text.manualReviewNotice)}</span></p>`
      : "";
    return `<section class="shipping-total-panel" aria-live="polite"><div><span>${esc(totalLabel)}</span>${total}</div>${pricingAudit}${manualReview}<p>${esc(summary)}</p><p>${esc(text.separateDeliveries)}</p><button class="btn btn-sm btn-outline" type="button" data-action="revalidate-shipping"${canRevalidate ? "" : " disabled"}>${esc(text.revalidateShipping)}${icons.arrow}</button><small class="shipping-revalidation-status">${esc(status)}</small></section>`;
  }

  function shippingCalculationMarkup(sourceGroup, plan = null) {
    const text = commerceText();
    const group = shippingPresentationGroup(sourceGroup);
    const supplier = cleanText(group.supplier || "", 80).toLowerCase();
    const isTegiwa = supplier === "tegiwa";
    const isEcs = supplier === "ecs" || supplier === "ecs-tuning";
    const evidence = isTegiwa
      ? `<p>${esc(text.shippingTegiwaEvidence)}</p><p>${esc(text.shippingDespatchCloudClarification)}</p>`
      : isEcs ? `<p>${esc(text.shippingEcsEvidence)}</p>` : "";
    const readiness = group.blockingReasons.length
      ? shippingMetadataList(group.blockingReasons)
      : `<p>${esc(shippingGroupHasConfirmedRate(group, plan) ? text.shippingRateConfirmed : text.shippingNoConfirmedRate)}</p>`;
    const observedCarriers = group.observedCarrierFamilies.length ? group.observedCarrierFamilies.join(" / ") : "—";
    return `<details class="shipping-calculation-details">
      <summary><span><strong>${esc(text.shippingHowCalculated)}</strong><small>${esc(text.shippingHowCalculatedHint)}</small></span><span class="shipping-disclosure-icon" aria-hidden="true">+</span></summary>
      <div class="shipping-calculation-body">
        <div class="shipping-evidence-note">${evidence}<p>${esc(text.shippingDestinationSpecific)}</p></div>
        <dl class="shipping-calculation-facts">
          <div><dt>${esc(text.shippingMethod)}</dt><dd>${esc(shippingMetadataLabel(group.quoteMethod))}</dd></div>
          <div><dt>${esc(text.shippingRateSource)}</dt><dd><bdi>${esc(shippingMetadataLabel(group.rateSource))}</bdi></dd></div>
          <div><dt>${esc(text.shippingFulfilmentSystem)}</dt><dd><bdi>${esc(shippingMetadataLabel(group.fulfilmentSystem))}</bdi></dd></div>
          <div><dt>${esc(text.shippingObservedCarriers)}</dt><dd><bdi>${esc(observedCarriers)}</bdi></dd></div>
          <div><dt>${esc(text.shippingEvidenceAsOf)}</dt><dd><bdi dir="ltr">${esc(group.evidenceAsOf || "—")}</bdi></dd></div>
        </dl>
        <div class="shipping-calculation-grid">
          <section><h4>${esc(text.shippingCalculationFactors)}</h4>${shippingMetadataList(group.calculationFactors)}</section>
          <section><h4>${esc(text.shippingRequiredInputs)}</h4>${shippingMetadataList(group.requiredInputs)}</section>
          <section><h4>${esc(text.shippingReadiness)}</h4>${readiness}</section>
          <section><h4>${esc(text.shippingRestrictions)}</h4>${shippingMetadataList(group.restrictions)}</section>
        </div>
        <dl class="shipping-policy-notes">
          <div><dt>${esc(text.shippingConsolidationPolicy)}</dt><dd>${esc(shippingMetadataLabel(group.consolidationPolicy))}</dd></div>
          <div class="shipping-duties-note"><dt>${esc(text.shippingDutiesMode)}</dt><dd>${esc(shippingMetadataLabel(group.dutiesMode))} ${esc(text.shippingDutiesExcluded)}</dd></div>
        </dl>
      </div>
    </details>`;
  }

  function shipmentPlannerMarkup(plan = state.shippingEstimate, { live = true } = {}) {
    const text = commerceText();
    const safePlan = safeShippingPlan(plan);
    const groups = safePlan?.groups || cartShipmentGroups();
    const split = groups.length > 1;
    const allRatesConfirmed = groups.length > 0 && groups.every(group => shippingGroupHasConfirmedRate(group, safePlan));
    const checkoutText = shippingCheckoutText();
    const statusText = state.shippingEstimateStatus === "loading" && live ? text.shippingEstimating
      : state.shippingEstimateStatus === "error" && live ? text.shippingEstimateError
        : allRatesConfirmed ? text.shippingRatesConfirmed
          : safePlan ? text.shippingAuthorisedAccessRequired : text.shippingEnterDestination;
    const destination = safePlan?.destination?.country && safePlan?.destination?.city
      ? `<p class="shipping-planner-destination"><strong>${esc(text.shippingDestination)}:</strong> ${esc(`${safePlan.destination.city}, ${safePlan.destination.country}`)}</p>` : "";
    const cards = groups.map(group => {
      const selectedOption = shippingSelectedOption(group);
      const rate = shippingGroupHasConfirmedRate(group, safePlan)
        ? shippingRateLabel(selectedOption, group, safePlan) : text.shippingConfirmationRequired;
      const countLabel = group.itemCount === 1 ? text.item : text.items;
      const confirmed = shippingGroupHasConfirmedRate(group, safePlan);
      return `<article class="shipping-group${confirmed ? " is-confirmed" : " is-manual"}" data-shipping-supplier="${esc(group.supplier)}" data-shipping-group="${esc(shippingGroupKey(group))}">
        <span class="shipping-origin-code" aria-hidden="true"><bdi dir="ltr">${esc(group.originCountryCode)}</bdi></span>
        <div class="shipping-group-copy"><span>${esc(text.shippingSupplier)}</span><strong>${esc(group.supplierName || group.supplier)}</strong><p>${esc(text.shippingFrom)} ${esc(shippingOriginLabel(group, text))}</p><small class="shipping-group-state">${esc(confirmed ? checkoutText.confirmedShipment : checkoutText.manualShipment)}</small></div>
        <dl><div><dt>${esc(text.quantity)}</dt><dd>${esc(`${group.itemCount} ${countLabel} / ${group.quantity} ${group.quantity === 1 ? text.shippingUnit : text.shippingUnits}`)}</dd></div><div><dt>${esc(text.shippingRate)}</dt><dd>${esc(rate)}</dd></div></dl>
        ${shippingOptionsMarkup(group, safePlan)}
        ${shippingCalculationMarkup(group, safePlan)}
      </article>`;
    }).join("");
    const splitNotice = split ? `<div class="shipping-split-notice">${icons.filter}<span>${esc(text.splitSupplierNotice)}</span></div>` : "";
    const rootAttribute = live ? " data-shipping-planner" : "";
    return `<section class="shipping-planner${state.shippingEstimateStatus === "loading" && live ? " is-loading" : ""}"${rootAttribute} aria-live="polite" aria-busy="${state.shippingEstimateStatus === "loading" && live ? "true" : "false"}">
      <header><div><span class="eyebrow">${esc(text.shippingPlannerTitle)}</span><h3>${esc(split ? text.splitSupplierShipment.replace("{count}", String(groups.length)) : text.singleSupplierShipment)}</h3></div><span class="shipping-plan-status${allRatesConfirmed ? " is-confirmed" : safePlan?.status === "partial" ? " is-partial" : ""}">${esc(allRatesConfirmed ? text.shippingRateConfirmed : safePlan?.status === "partial" ? checkoutText.partialPlan : text.shippingConfirmationRequired)}</span></header>
      <p>${esc(text.shippingPlannerIntro)}</p>${destination}${splitNotice}<div class="shipping-groups">${cards}</div>
      ${currentPath() === "/checkout" ? shippingPlanSummaryMarkup(safePlan, groups) : ""}<div class="shipping-plan-message"><strong>${esc(statusText)}</strong><span>${esc(text.shippingDutiesExcluded)} ${esc(text.shippingNotCharged)}</span></div>
    </section>`;
  }

  function refreshShipmentPlanner() {
    document.querySelectorAll("[data-shipping-planner]").forEach(element => {
      element.outerHTML = shipmentPlannerMarkup();
    });
  }

  function cartItemMarkup(item, { editable = true } = {}) {
    const product = commerceProduct(item.productId);
    const supplierItem = product ? null : normalizeSupplierCatalogueCartItem(item);
    if (!product && !supplierItem) return "";
    const local = product ? localizedStoreProduct(product) : {
      title: state.locale === "ar" && supplierItem.titleAr ? supplierItem.titleAr : supplierItem.title,
      brand: supplierItem.brand || supplierItem.supplier.name,
      images: [supplierItem.image]
    };
    const policy = commercePolicy(product);
    const image = local.images?.[0];
    const lineTotal = Number(item.unitAmount) * Number(item.quantity);
    const notice = state.locale === "ar" ? policy?.noticeAr : policy?.notice;
    const supplierProductHandle = supplierItem?.supplier?.slug === "tegiwa"
      ? tegiwaProductHandle(`tegiwa-${supplierItem.sourceHandle}`)
      : tegiwaProductHandle(supplierItem?.sourceHandle);
    const directSupplierProductHandle = policy?.sourceHandle
      ? tegiwaProductHandle(`tegiwa-${policy.sourceHandle}`)
      : "";
    const productHref = supplierItem
      ? tegiwaProductUrl(supplierProductHandle)
      : (directSupplierProductHandle ? tegiwaProductUrl(directSupplierProductHandle) : routeUrl(`/parts/${product.slug}`));
    const optionTitle = supplierItem?.optionTitle ? ` — ${supplierItem.optionTitle}` : "";
    const confirmationRequired = item.fitmentConfirmationRequired || item.availabilityConfirmationRequired;
    return `<article class="commerce-line" data-cart-line="${esc(item.id)}">
      <a class="commerce-line-media" href="${esc(productHref)}"><img src="${esc(versionedAsset(image?.src || ""))}" width="${Number(image?.width) || 1}" height="${Number(image?.height) || 1}" alt="${esc(image?.alt || local.title)}" loading="lazy" decoding="async"></a>
      <div class="commerce-line-copy"><span class="mini-label">${esc(local.brand)}</span><h2><a href="${esc(productHref)}">${esc(`${local.title}${optionTitle}`)}</a></h2><p><bdi dir="ltr">${esc(item.sku)}</bdi></p>${confirmationRequired ? `<div class="commerce-line-notice"><strong>${esc(item.fitmentConfirmationRequired ? commerceText().fitmentRequired : commerceText().availabilityRequired)}</strong><span>${esc(notice || commerceText().availabilityRequired)}</span></div>` : ""}</div>
      <div class="commerce-line-price"><small>${esc(commerceText().supplierReferencePrice)}</small><bdi>${esc(commerceMoney(item.unitAmount, item.currency))} ${esc(commerceText().each)}</bdi><strong><bdi>${esc(commerceMoney(lineTotal, item.currency))}</bdi></strong></div>
      ${editable ? `<div class="commerce-line-actions"><div class="quote-quantity" aria-label="${esc(commerceText().quantity)}"><button type="button" data-action="adjust-cart-quantity" data-delta="-1" data-id="${esc(item.id)}" aria-label="${esc(`${storeText().decrease}: ${local.title}`)}">−</button><bdi>${Number(item.quantity)}</bdi><button type="button" data-action="adjust-cart-quantity" data-delta="1" data-id="${esc(item.id)}" aria-label="${esc(`${storeText().increase}: ${local.title}`)}">+</button></div><button class="commerce-remove" type="button" data-action="remove-cart" data-id="${esc(item.id)}">${icons.close}<span>${esc(commerceText().remove)}</span></button></div>` : `<div class="commerce-summary-quantity"><span>${esc(commerceText().quantity)}</span><strong><bdi>${Number(item.quantity)}</bdi></strong></div>`}
    </article>`;
  }

  function stagingNotice() {
    const text = commerceText();
    return `<aside class="staging-notice" aria-label="${esc(text.stagingBadge)}"><span>${icons.check}</span><div><strong>${esc(text.stagingBadge)}</strong><p>${esc(text.checkoutIntro)} ${esc(text.paymentNone)}</p></div></aside>`;
  }

  function commerceSummary({ editable = false } = {}) {
    const text = commerceText();
    return `<section class="commerce-summary" aria-labelledby="commerce-summary-title"><header><div><span class="eyebrow">${esc(text.stagingBadge)}</span><h2 id="commerce-summary-title">${esc(text.orderSummary)}</h2></div>${editable ? `<a class="text-link" href="${routeUrl("/cart")}">${esc(text.editCart)}${icons.arrow}</a>` : ""}</header><div class="commerce-lines">${state.cart.map(item => cartItemMarkup(item, { editable: false })).join("")}</div><dl class="commerce-totals"><div><dt>${esc(text.subtotal)}</dt><dd>${cartTotalsMarkup()}</dd></div><div><dt>${esc(text.shippingPending)}</dt><dd>${esc(text.shippingConfirmationRequired)}</dd></div><div><dt>${esc(text.dutiesPending)}</dt><dd>—</dd></div></dl>${shipmentPlannerMarkup()}<div class="notice notice-info">${icons.check}<span>${esc(text.finalPriceNotice)}</span></div></section>`;
  }

  function cartPage() {
    const text = commerceText();
    const itemCount = cartCount();
    const content = state.cart.length
      ? `<div class="commerce-layout"><section class="commerce-cart-panel" aria-label="${esc(text.cartTitle)}"><div class="commerce-lines">${state.cart.map(item => cartItemMarkup(item)).join("")}</div><p class="commerce-saved-note">${icons.check}${esc(text.savedOnDevice)}</p></section><aside class="commerce-cart-summary"><span class="eyebrow">${esc(text.stagingBadge)}</span><h2>${esc(text.subtotal)}</h2><div class="commerce-total-values">${cartTotalsMarkup()}</div><ul class="commerce-caveats"><li>${esc(text.shippingPending)}</li><li>${esc(text.dutiesPending)}</li><li>${esc(text.fitmentRequired)}</li><li>${esc(text.availabilityRequired)}</li></ul>${shipmentPlannerMarkup()}<p>${esc(text.finalPriceNotice)}</p><a class="btn btn-block" href="${routeUrl("/checkout")}">${esc(text.proceedCheckout)}${icons.arrow}</a><a class="btn btn-outline btn-block" href="${routeUrl("/parts")}">${esc(text.continueShopping)}</a></aside></div>`
      : `<div class="empty-state commerce-empty"><span>${icons.cart}</span><strong>${esc(text.emptyCart)}</strong><p>${esc(text.emptyCartText)}</p><a class="btn" href="${routeUrl("/parts")}">${esc(text.browseParts)}${icons.arrow}</a></div>`;
    return `${pageHero({ eyebrow: text.stagingBadge, title: text.cartTitle, text: text.cartIntro, media: 68, crumbs: [[text.cart]], meta: itemCount ? statusBadge(`${itemCount} ${itemCount === 1 ? text.item : text.items}`) : "", actions: `<a class="btn btn-outline-light" href="${routeUrl("/parts")}">${esc(text.continueShopping)}${icons.arrow}</a>` })}<section class="section commerce-page"><div class="container">${stagingNotice()}${content}</div></section>`;
  }

  function checkoutReceiptPage(receipt) {
    const text = commerceText();
    const simulated = receipt.simulated === true;
    const title = simulated ? text.simulationTitle : text.successTitle;
    const description = simulated ? text.simulationText : text.successText;
    return `${pageHero({ eyebrow: text.stagingBadge, title, text: description, media: 53, crumbs: [[text.checkout]], meta: statusBadge(text.noPayment), actions: `<a class="btn" href="${routeUrl("/parts")}" data-action="start-new-test-order">${esc(text.startAnother)}${icons.arrow}</a>` })}<section class="section commerce-page"><div class="container narrow"><article class="commerce-receipt"><span>${icons.check}</span><div><p>${esc(text.reference)}</p><h2><bdi dir="ltr">${esc(receipt.ref || "")}</bdi></h2><p>${esc(description)}</p>${simulated ? `<div class="notice notice-info">${icons.check}<span>${esc(text.notificationNone)}</span></div>` : ""}${receipt.duplicate ? `<div class="notice notice-info">${esc(text.duplicate)}</div>` : ""}<dl><div><dt>${esc(text.noPayment)}</dt><dd>${esc(text.paymentNone)}</dd></div><div><dt>${esc(text.subtotal)}</dt><dd>${(receipt.totals || []).map(total => `<bdi>${esc(commerceMoney(total.amount, total.currency))}</bdi>`).join(" ") || "—"}</dd></div></dl>${receipt.shipping ? `<h3 class="receipt-shipping-title">${esc(text.shippingPlannerReceipt)}</h3>${shipmentPlannerMarkup(receipt.shipping, { live: false })}` : ""}</div></article></div></section>`;
  }

  function legacyCheckoutPage() {
    const text = commerceText();
    const receipt = safeParse(storage.get(LAST_ORDER_STORAGE_KEY), null);
    if (receipt?.ref) return checkoutReceiptPage(receipt);
    if (!state.cart.length) {
      return `${pageHero({ eyebrow: text.stagingBadge, title: text.checkoutTitle, text: text.checkoutIntro, media: 53, crumbs: [[text.checkout]] })}<section class="section commerce-page"><div class="container narrow">${stagingNotice()}<div class="empty-state commerce-empty"><span>${icons.cart}</span><strong>${esc(text.emptyCart)}</strong><p>${esc(text.emptyCartText)}</p><a class="btn" href="${routeUrl("/parts")}">${esc(text.browseParts)}${icons.arrow}</a></div></div></section>`;
    }
    const vehicle = partsVehicleLabel();
    return `${pageHero({ eyebrow: text.stagingBadge, title: text.checkoutTitle, text: text.checkoutIntro, media: 53, crumbs: [[text.cart, "/cart"], [text.checkout]], meta: statusBadge(text.noPayment) })}<section class="section commerce-page"><div class="container">${stagingNotice()}<div class="checkout-account-option"><div><strong>${esc(text.signInCreate)}</strong><p>${esc(text.accountOptional)}</p></div><a class="btn btn-sm btn-outline" href="${routeUrl("/account")}">${esc(text.signInCreate)}${icons.arrow}</a></div><div class="checkout-layout"><form class="checkout-form" data-staging-checkout><input type="text" name="website" class="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="startedAt" value="${Date.now()}"><header><span class="eyebrow">${esc(text.guestCheckout)}</span><h2>${esc(text.customerDetails)}</h2><p>${esc(text.guestNote)}</p></header><fieldset><legend>${esc(text.customerDetails)}</legend><div class="form-grid"><div class="form-group"><label class="required" for="checkout-name">${esc(text.name)}</label><input class="input" id="checkout-name" name="name" required autocomplete="name" maxlength="160"></div><div class="form-group"><label class="required" for="checkout-email">${esc(text.email)}</label><input class="input ltr-input" id="checkout-email" name="email" type="email" required autocomplete="email" maxlength="254"></div><div class="form-group full"><label class="required" for="checkout-phone">${esc(text.phone)}</label><input class="input ltr-input" id="checkout-phone" name="phone" required inputmode="tel" autocomplete="tel" maxlength="50"></div></div></fieldset><fieldset><legend>${esc(text.deliveryDetails)}</legend><div class="form-grid"><div class="form-group"><label class="required" for="checkout-country">${esc(text.country)}</label><input class="input" id="checkout-country" name="country" required autocomplete="country-name" maxlength="100"></div><div class="form-group"><label class="required" for="checkout-city">${esc(text.city)}</label><input class="input" id="checkout-city" name="city" required autocomplete="address-level2" maxlength="100"></div><div class="form-group full"><label for="checkout-address">${esc(text.address)} <small>${esc(text.optional)}</small></label><input class="input" id="checkout-address" name="addressLine" autocomplete="street-address" maxlength="300"></div><div class="form-group"><label for="checkout-postcode">${esc(text.postcode)} <small>${esc(text.optional)}</small></label><input class="input ltr-input" id="checkout-postcode" name="postcode" autocomplete="postal-code" maxlength="30"></div><div class="form-group"><label for="checkout-fulfilment">${esc(text.fulfilment)}</label><select class="select" id="checkout-fulfilment" name="fulfilment"><option value="courier">${esc(text.courier)}</option><option value="workshop">${esc(text.workshop)}</option></select></div></div></fieldset><fieldset><legend>${esc(text.vehicleDetails)}</legend><div class="form-grid"><div class="form-group full"><label class="required" for="checkout-vehicle">${esc(text.vehicle)}</label><input class="input" id="checkout-vehicle" name="vehicle" value="${esc(vehicle)}" required maxlength="300"></div><div class="form-group full"><label for="checkout-vin">${esc(text.vin)} <small>${esc(text.optional)}</small></label><input class="input ltr-input" id="checkout-vin" name="vin" maxlength="24" autocomplete="off"></div><div class="form-group full"><label for="checkout-notes">${esc(text.notes)} <small>${esc(text.optional)}</small></label><textarea class="textarea" id="checkout-notes" name="notes" maxlength="2000"></textarea></div></div></fieldset><label class="checkbox checkout-confirm"><input type="checkbox" name="acknowledgement" required><span>${esc(text.acknowledgement)}</span></label><label class="checkbox checkout-confirm"><input type="checkbox" name="consent" required><span>${esc(text.consent)}</span></label><button class="btn btn-block" type="submit">${esc(text.submit)}${icons.arrow}</button><p class="form-status" role="status" aria-live="polite"></p></form>${commerceSummary({ editable: true })}</div></div></section>`;
  }

  function checkoutCountryName(code, locale = state.locale) {
    const country = GCC_DESTINATIONS[String(code || "").toUpperCase()];
    return country ? country[locale === "ar" ? "ar" : "en"] : "";
  }

  function checkoutCountryOptions(selected = "KW") {
    const text = shippingCheckoutText();
    return `<option value="">${esc(text.selectCountry)}</option>${Object.entries(GCC_DESTINATIONS).map(([code, country]) => `<option value="${esc(code)}"${code === selected ? " selected" : ""}>${esc(country[state.locale === "ar" ? "ar" : "en"])} · ${esc(code)}</option>`).join("")}`;
  }

  function checkoutRegionOptions(countryCode = "KW") {
    return (GCC_DESTINATIONS[countryCode]?.regions || []).map(region => `<option value="${esc(region)}"></option>`).join("");
  }

  function checkoutDestinationFields(text) {
    const shippingText = shippingCheckoutText();
    return `<fieldset class="checkout-destination"><legend>${esc(text.deliveryDetails)}</legend><p class="checkout-fieldset-help" id="checkout-address-help">${esc(shippingText.addressHelp)}</p><div class="form-grid">
      <div class="form-group"><label class="required" for="checkout-country-code">${esc(shippingText.countryCode)}</label><select class="select" id="checkout-country-code" name="countryCode" autocomplete="country" required>${checkoutCountryOptions()}</select></div>
      <div class="form-group"><label class="required" for="checkout-governorate">${esc(shippingText.governorate)}</label><input class="input" id="checkout-governorate" name="governorate" list="checkout-region-options" required autocomplete="address-level1" maxlength="120"><datalist id="checkout-region-options">${checkoutRegionOptions()}</datalist></div>
      <div class="form-group"><label class="required" for="checkout-city">${esc(text.city)}</label><input class="input" id="checkout-city" name="city" required autocomplete="address-level2" maxlength="100"></div>
      <div class="form-group"><label class="required" for="checkout-area">${esc(shippingText.area)}</label><input class="input" id="checkout-area" name="area" required autocomplete="address-level3" maxlength="120"></div>
      <div class="form-group full"><label class="required" for="checkout-address-line-1">${esc(shippingText.addressLine1)}</label><input class="input" id="checkout-address-line-1" name="addressLine1" required autocomplete="address-line1" maxlength="240" aria-describedby="checkout-address-help"></div>
      <div class="form-group full"><label for="checkout-address-line-2">${esc(shippingText.addressLine2)} <small>${esc(text.optional)}</small></label><input class="input" id="checkout-address-line-2" name="addressLine2" autocomplete="address-line2" maxlength="240"></div>
      <div class="form-group"><label class="required" for="checkout-postcode">${esc(text.postcode)}</label><input class="input ltr-input" id="checkout-postcode" name="postcode" required autocomplete="postal-code" maxlength="30" aria-describedby="checkout-postcode-help"><small class="form-help" id="checkout-postcode-help">${esc(shippingText.postcodeHelp)}</small></div>
      <div class="form-group"><label for="checkout-fulfilment">${esc(text.fulfilment)}</label><select class="select" id="checkout-fulfilment" name="fulfilment"><option value="courier">${esc(text.courier)}</option><option value="workshop">${esc(text.workshop)}</option></select></div>
    </div></fieldset>`;
  }

  function checkoutPage() {
    const text = commerceText();
    const receipt = safeParse(storage.get(LAST_ORDER_STORAGE_KEY), null);
    if (receipt?.ref) return checkoutReceiptPage(receipt);
    if (!state.cart.length) {
      return `${pageHero({ eyebrow: text.stagingBadge, title: text.checkoutTitle, text: text.checkoutIntro, media: 53, crumbs: [[text.checkout]] })}<section class="section commerce-page"><div class="container narrow">${stagingNotice()}<div class="empty-state commerce-empty"><span>${icons.cart}</span><strong>${esc(text.emptyCart)}</strong><p>${esc(text.emptyCartText)}</p><a class="btn" href="${routeUrl("/parts")}">${esc(text.browseParts)}${icons.arrow}</a></div></div></section>`;
    }
    const vehicle = partsVehicleLabel();
    const shippingText = shippingCheckoutText();
    return `${pageHero({ eyebrow: text.stagingBadge, title: text.checkoutTitle, text: text.checkoutIntro, media: 53, crumbs: [[text.cart, "/cart"], [text.checkout]], meta: statusBadge(text.noPayment) })}<section class="section commerce-page"><div class="container">${stagingNotice()}<div class="checkout-account-option"><div><strong>${esc(text.signInCreate)}</strong><p>${esc(text.accountOptional)}</p></div><a class="btn btn-sm btn-outline" href="${routeUrl("/account")}">${esc(text.signInCreate)}${icons.arrow}</a></div><div class="checkout-layout"><form class="checkout-form" data-staging-checkout><input type="text" name="website" class="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="startedAt" value="${Date.now()}"><header><span class="eyebrow">${esc(text.guestCheckout)}</span><h2>${esc(text.customerDetails)}</h2><p>${esc(text.guestNote)}</p></header>
      <fieldset><legend>${esc(text.customerDetails)}</legend><div class="form-grid"><div class="form-group"><label class="required" for="checkout-name">${esc(text.name)}</label><input class="input" id="checkout-name" name="name" required autocomplete="name" maxlength="160"></div><div class="form-group"><label class="required" for="checkout-email">${esc(text.email)}</label><input class="input ltr-input" id="checkout-email" name="email" type="email" required autocomplete="email" maxlength="254"></div><div class="form-group full"><label class="required" for="checkout-phone">${esc(text.phone)}</label><input class="input ltr-input" id="checkout-phone" name="phone" required inputmode="tel" autocomplete="tel" maxlength="50" aria-describedby="checkout-phone-help"><small class="form-help" id="checkout-phone-help">${esc(shippingText.phoneHelp)}</small></div></div></fieldset>
      ${checkoutDestinationFields(text)}
      <fieldset><legend>${esc(text.vehicleDetails)}</legend><div class="form-grid"><div class="form-group full"><label class="required" for="checkout-vehicle">${esc(text.vehicle)}</label><input class="input" id="checkout-vehicle" name="vehicle" value="${esc(vehicle)}" required maxlength="300"></div><div class="form-group full"><label for="checkout-vin">${esc(text.vin)} <small>${esc(text.optional)}</small></label><input class="input ltr-input" id="checkout-vin" name="vin" maxlength="24" autocomplete="off"></div><div class="form-group full"><label for="checkout-notes">${esc(text.notes)} <small>${esc(text.optional)}</small></label><textarea class="textarea" id="checkout-notes" name="notes" maxlength="2000"></textarea></div></div></fieldset>
      <label class="checkbox checkout-confirm"><input type="checkbox" name="acknowledgement" required><span>${esc(text.acknowledgement)}</span></label><label class="checkbox checkout-confirm"><input type="checkbox" name="consent" required><span>${esc(text.consent)}</span></label><button class="btn btn-block" type="submit" data-checkout-submit>${esc(shippingText.submitQuoteRequest)}${icons.arrow}</button><p class="form-status" role="status" aria-live="polite"></p></form>${commerceSummary({ editable: true })}</div></div></section>`;
  }

  function shippingAdminLockedMarkup({ signedIn = false, loading = false } = {}) {
    const text = shippingAdminText();
    if (loading) return `<div class="shipping-admin-status" role="status"><span class="spinner" aria-hidden="true"></span><strong>${esc(text.loading)}</strong></div>`;
    if (!signedIn) {
      return `<div class="shipping-admin-status is-locked" role="status"><div><span class="eyebrow">${esc(text.readOnly)}</span><strong>${esc(text.signInRequired)}</strong><p>${esc(text.signInText)}</p></div><a class="btn btn-sm" href="${routeUrl("/account")}">${esc(text.openAccount)}${icons.arrow}</a></div>`;
    }
    const cards = [text.supplierAdapters, text.rateLogs, text.routingRules, text.commercialRules, text.auditLog].map(label => `<article class="shipping-admin-card"><span>${esc(text.readOnly)}</span><h2>${esc(label)}</h2><p>${esc(text.unavailable)}</p><strong>${esc(text.noLiveCredentials)}</strong></article>`).join("");
    const actions = [text.recalculation, text.manualApproval, text.paymentLink, text.supplierOrder].map(label => `<button class="btn btn-sm btn-outline" type="button" disabled title="${esc(text.disabledSecurity)}"><span>${esc(label)}</span>${icons.arrow}</button>`).join("");
    const countries = Object.keys(GCC_DESTINATIONS).map(code => `<li><bdi dir="ltr">${esc(code)}</bdi> â€” ${esc(checkoutCountryName(code))}</li>`).join("");
    return `<div class="shipping-admin-shell"><div class="shipping-admin-status is-unconfigured" role="status"><div><span class="eyebrow">${esc(text.readOnly)}</span><strong>${esc(text.notConfigured)}</strong><p>${esc(text.notConfiguredText)}</p></div></div><div class="shipping-admin-grid">${cards}</div><section class="shipping-admin-card"><span>${esc(text.countryCoverage)}</span><ul>${countries}</ul></section><div class="shipping-admin-actions" aria-label="${esc(text.disabledSecurity)}">${actions}</div><p class="shipping-admin-security-note">${icons.check}<span>${esc(text.securityNote)} ${esc(text.disabledSecurity)}</span></p></div>`;
  }

  function shippingAdminPage() {
    const text = shippingAdminText();
    return `${pageHero({ eyebrow: text.eyebrow, title: text.title, text: text.intro, media: 53, crumbs: [[text.title]], meta: statusBadge(text.readOnly), actions: `<a class="btn btn-outline-light" href="${routeUrl("/account")}">${esc(text.backToAccount)}${icons.arrow}</a>` })}<section class="section shipping-admin"><div class="container"><div data-shipping-admin-root>${shippingAdminLockedMarkup({ loading: true })}</div></div></section>`;
  }

  async function mountShippingAdminDashboard() {
    const root = document.querySelector("[data-shipping-admin-root]");
    if (!root) return;
    state.shippingAdminStatus = "loading";
    root.innerHTML = shippingAdminLockedMarkup({ loading: true });
    try {
      const clerk = await loadClerk();
      if (!document.body.contains(root)) return;
      state.shippingAdminStatus = clerk?.isSignedIn ? "unconfigured" : "signed-out";
      root.innerHTML = shippingAdminLockedMarkup({ signedIn: Boolean(clerk?.isSignedIn) });
    } catch {
      if (!document.body.contains(root)) return;
      state.shippingAdminStatus = "signed-out";
      root.innerHTML = shippingAdminLockedMarkup({ signedIn: false });
    }
  }

  function accountPage() {
    const isAr = state.locale === "ar";
    return `${pageHero({
      eyebrow: isAr ? "حساب العميل" : "Customer account",
      title: isAr ? "تسجيل الدخول أو إنشاء حساب." : "Sign in or create an account.",
      text: isAr ? "بوابة آمنة لإدارة هوية العميل وبيانات الحساب. تقدر ترسل أي استفسار بدون تسجيل دخول." : "A secure portal for customer identity and account details. Website enquiries remain available without signing in.",
      media: 20,
      crumbs: [[isAr ? "حساب العميل" : "Customer account"]],
      actions: `<a class="btn" href="${routeUrl("/contact")}">${esc(U().actions.contactWorkshop)}${icons.arrow}</a>`
    })}<section class="section account-section"><div class="container account-layout"><aside class="account-intro"><span class="eyebrow">${esc(isAr ? "دخول آمن" : "Secure access")}</span><h2>${esc(isAr ? "حساب واحد للتواصل مع Projx Racing." : "One account for your Projx Racing access.")}</h2><p>${esc(isAr ? "التسجيل وتسجيل الدخول والتحقق من البريد واستعادة كلمة المرور تتم من خلال مزود هوية آمن. فريق الورشة ما يشوف كلمة المرور." : "Registration, sign-in, email verification and password recovery are handled by a secure identity provider. The workshop never sees your password.")}</p><ul class="feature-list"><li>${icons.check}<span>${esc(isAr ? "إنشاء حساب جديد أو تسجيل الدخول" : "Create a new account or sign in")}</span></li><li>${icons.check}<span>${esc(isAr ? "إدارة بيانات الحساب بأمان" : "Manage account details securely")}</span></li><li>${icons.check}<span>${esc(isAr ? "الاستفسارات متاحة بدون حساب" : "Enquiries remain available without an account")}</span></li></ul></aside><div class="account-panel"><div class="account-tabs" role="tablist" aria-label="${esc(isAr ? "خيارات الحساب" : "Account options")}" aria-orientation="horizontal"><button id="account-tab-sign-in" class="is-active" type="button" role="tab" aria-selected="true" aria-controls="account-auth-root" tabindex="0" data-action="account-mode" data-account-mode="sign-in">${esc(isAr ? "تسجيل الدخول" : "Sign in")}</button><button id="account-tab-sign-up" type="button" role="tab" aria-selected="false" aria-controls="account-auth-root" tabindex="-1" data-action="account-mode" data-account-mode="sign-up">${esc(isAr ? "إنشاء حساب" : "Register")}</button></div><div id="account-auth-root" class="account-auth-root" role="tabpanel" aria-labelledby="account-tab-sign-in" tabindex="0" data-account-mode="sign-in"><div class="account-loading" role="status">${esc(isAr ? "جاري تحميل بوابة الحساب الآمنة..." : "Loading the secure account portal...")}</div></div></div></div></section>`;
  }

  let clerkLoadPromise = null;
  function loadAccountScript(src, attributes = {}) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${CSS.escape(src)}"]`);
      if (existing?.dataset.loaded === "true") return resolve();
      const script = existing || document.createElement("script");
      if (!existing) {
        script.src = src;
        script.async = true;
        script.crossOrigin = "anonymous";
        Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
        document.head.append(script);
      }
      script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
      script.addEventListener("error", () => reject(new Error("account_script_failed")), { once: true });
    });
  }

  async function loadClerk() {
    if (window.Clerk?.loaded) return window.Clerk;
    if (clerkLoadPromise) return clerkLoadPromise;
    const key = String(CONFIG.clerkPublishableKey || "").trim();
    if (!/^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(key)) throw new Error("account_not_configured");
    clerkLoadPromise = (async () => {
      const domain = atob(key.split("_")[2]).slice(0, -1);
      if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error("account_domain_invalid");
      await loadAccountScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
      await loadAccountScript(`https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { "data-clerk-publishable-key": key });
      await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      return window.Clerk;
    })();
    return clerkLoadPromise;
  }

  async function prefillCheckoutAccount() {
    const form = document.querySelector("[data-staging-checkout]");
    if (!form || form.dataset.accountPrefill === "true") return;
    form.dataset.accountPrefill = "true";
    try {
      const clerk = window.Clerk?.loaded ? window.Clerk : await loadClerk();
      if (!clerk?.isSignedIn || !document.body.contains(form)) return;
      const user = clerk.user;
      const known = {
        name: cleanText(user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" "), 160),
        email: cleanText(user?.primaryEmailAddress?.emailAddress || "", 254),
        phone: cleanText(user?.primaryPhoneNumber?.phoneNumber || "", 50)
      };
      for (const [name, value] of Object.entries(known)) {
        if (value && !cleanText(form.elements[name]?.value || "", 300)) form.elements[name].value = value;
      }
    } catch {
      // Guest checkout remains fully available when Clerk is not configured or cannot load.
    }
  }

  function checkoutShippingPayload(form) {
    const fields = new FormData(form);
    const countryCode = cleanText(fields.get("countryCode"), 2).toUpperCase();
    const addressLine1 = cleanText(fields.get("addressLine1"), 240);
    const addressLine2 = cleanText(fields.get("addressLine2"), 240);
    return {
      idempotencyKey: checkoutToken(),
      destination: {
        countryCode,
        country: checkoutCountryName(countryCode, "en"),
        governorate: cleanText(fields.get("governorate"), 120),
        city: cleanText(fields.get("city"), 100),
        area: cleanText(fields.get("area"), 120),
        addressLine1,
        addressLine2,
        addressLine: [addressLine1, addressLine2].filter(Boolean).join(", "),
        postcode: cleanText(fields.get("postcode"), 30),
        phone: cleanText(fields.get("phone"), 50),
        fulfilment: fields.get("fulfilment") === "workshop" ? "workshop" : "courier"
      },
      items: state.cart.map(item => ({
        supplier: cleanText(item.supplier?.slug || "", 80).toLowerCase(),
        productId: item.productId,
        sourceHandle: cleanText(item.sourceHandle || "", 255) || null,
        sku: item.sku,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        currency: item.currency
      })),
      selectedOptions: shippingEstimateSelectionSnapshot(state.shippingEstimate)
    };
  }

  function shippingSelectionSnapshot(plan) {
    const safePlan = safeShippingPlan(plan);
    if (!safePlan) return [];
    return safePlan.groups.map(group => {
      const option = shippingSelectedOption(group);
      return option ? { groupId: group.groupId, optionId: option.id } : null;
    }).filter(Boolean);
  }

  function shippingEstimateSelectionSnapshot(plan) {
    const safePlan = safeShippingPlan(plan);
    if (!safePlan) return [];
    return safePlan.groups.map(group => {
      const option = shippingSelectedOption(group);
      return option ? { supplier: group.supplier, originId: group.originId, optionId: option.id } : null;
    }).filter(Boolean);
  }

  function shippingDestinationReady(destination) {
    if (!destination?.countryCode || !destination?.city) return false;
    if (destination.fulfilment === "workshop") return false;
    return Boolean(destination.governorate && destination.area && destination.addressLine1 && destination.postcode && destination.phone);
  }

  function resetShippingRevalidation() {
    state.shippingRevalidationStatus = "idle";
    state.shippingRevalidationError = "";
  }

  function resetShippingEstimate() {
    state.shippingEstimateController?.abort();
    state.shippingEstimateController = null;
    window.clearTimeout(state.shippingEstimateTimer);
    state.shippingEstimateTimer = null;
    state.shippingEstimate = null;
    state.shippingEstimateStatus = "idle";
    state.shippingEstimateError = "";
    state.shippingSelections = Object.create(null);
    resetShippingRevalidation();
    state.shippingEstimateRequestId += 1;
    refreshShipmentPlanner();
  }

  async function requestShippingEstimate(form) {
    if (!form || !document.body.contains(form)) return false;
    window.clearTimeout(state.shippingEstimateTimer);
    state.shippingEstimateTimer = null;
    const payload = checkoutShippingPayload(form);
    if (!shippingDestinationReady(payload.destination) || !payload.items.length) {
      resetShippingEstimate();
      return false;
    }
    state.shippingEstimateController?.abort();
    const controller = new AbortController();
    const requestId = state.shippingEstimateRequestId + 1;
    state.shippingEstimateRequestId = requestId;
    state.shippingEstimateController = controller;
    state.shippingEstimateStatus = "loading";
    state.shippingEstimateError = "";
    refreshShipmentPlanner();
    try {
      const endpoint = new URL(SHIPPING_ESTIMATE_ENDPOINT, location.origin).href;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.accepted || !safeShippingPlan(result.estimate)) {
        const error = new Error(result.error || "shipping_estimate_failed");
        error.code = result.error || "shipping_estimate_failed";
        throw error;
      }
      if (requestId !== state.shippingEstimateRequestId || !document.body.contains(form)) return false;
      state.shippingEstimate = safeShippingPlan(result.estimate);
      state.shippingEstimateStatus = "ready";
      state.shippingEstimateError = "";
      state.shippingSelections = Object.create(null);
      for (const group of state.shippingEstimate.groups) {
        if (group.selectedOptionId) state.shippingSelections[shippingGroupKey(group)] = group.selectedOptionId;
      }
      resetShippingRevalidation();
      return true;
    } catch (error) {
      if (error?.name === "AbortError" || requestId !== state.shippingEstimateRequestId) return false;
      state.shippingEstimate = null;
      state.shippingEstimateStatus = "error";
      state.shippingEstimateError = cleanText(error?.code || "shipping_estimate_failed", 120);
      return false;
    } finally {
      if (requestId === state.shippingEstimateRequestId) {
        state.shippingEstimateController = null;
        refreshShipmentPlanner();
      }
    }
  }

  function scheduleShippingEstimate(form, delay = 450) {
    window.clearTimeout(state.shippingEstimateTimer);
    state.shippingEstimateController?.abort();
    state.shippingEstimateController = null;
    state.shippingEstimateRequestId += 1;
    state.shippingSelections = Object.create(null);
    resetShippingRevalidation();
    const payload = checkoutShippingPayload(form);
    if (!shippingDestinationReady(payload.destination)) {
      state.shippingEstimate = null;
      state.shippingEstimateStatus = "idle";
      state.shippingEstimateError = "";
      refreshShipmentPlanner();
      return;
    }
    state.shippingEstimateStatus = "loading";
    state.shippingEstimateError = "";
    refreshShipmentPlanner();
    state.shippingEstimateTimer = window.setTimeout(() => requestShippingEstimate(form), delay);
  }

  function setupCheckoutShippingEstimator() {
    const form = document.querySelector("[data-staging-checkout]");
    if (!form || form.dataset.shippingEstimator === "true") return;
    form.dataset.shippingEstimator = "true";
    ["governorate", "city", "area", "addressLine1", "addressLine2", "postcode", "phone"].forEach(name => form.elements[name]?.addEventListener("input", () => scheduleShippingEstimate(form)));
    form.elements.countryCode?.addEventListener("change", () => {
      const code = cleanText(form.elements.countryCode.value, 2).toUpperCase();
      const regionOptions = form.querySelector("#checkout-region-options");
      if (regionOptions) regionOptions.innerHTML = checkoutRegionOptions(code);
      if (form.elements.governorate) form.elements.governorate.value = "";
      if (form.elements.phone) form.elements.phone.placeholder = `${GCC_DESTINATIONS[code]?.dial || "+"} ...`;
      scheduleShippingEstimate(form, 0);
    });
    form.elements.fulfilment?.addEventListener("change", () => scheduleShippingEstimate(form, 0));
    if (form.elements.phone) form.elements.phone.placeholder = `${GCC_DESTINATIONS[form.elements.countryCode?.value || "KW"]?.dial || "+965"} ...`;
    const payload = checkoutShippingPayload(form);
    if (shippingDestinationReady(payload.destination)) scheduleShippingEstimate(form, 0);
    else refreshShipmentPlanner();
  }

  function shippingSelectionsMatchPlan(requested, previousPlan, nextPlan) {
    if (!Array.isArray(requested) || !previousPlan || !nextPlan) return false;
    const requestedByGroup = new Map(requested.map(item => [item.groupId, item.optionId]));
    const expected = new Map(previousPlan.groups.map(group => [
      `${group.supplier}\u0000${group.originId || group.originCountryCode}`,
      requestedByGroup.get(group.groupId) || ""
    ]));
    return nextPlan.groups.every(group => {
      if (!group.options.length) return true;
      return Boolean(group.selectedOptionId && expected.get(`${group.supplier}\u0000${group.originId || group.originCountryCode}`) === group.selectedOptionId);
    });
  }

  async function requestShippingRevalidation(form) {
    if (!form || !document.body.contains(form) || state.shippingRevalidationStatus === "loading") return false;
    const plan = safeShippingPlan(state.shippingEstimate);
    if (!shippingPlanCanRevalidate(plan, plan?.groups || [])) return false;
    const shipping = checkoutShippingPayload(form);
    const requestedOptions = shippingSelectionSnapshot(plan);
    state.shippingRevalidationStatus = "loading";
    state.shippingRevalidationError = "";
    refreshShipmentPlanner();
    try {
      const response = await fetch(new URL(SHIPPING_REVALIDATE_ENDPOINT, location.origin).href, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": shipping.idempotencyKey },
        body: JSON.stringify({
          quoteId: plan.quoteId,
          revalidationToken: plan.revalidationToken,
          destination: shipping.destination,
          items: shipping.items,
          selectedOptions: requestedOptions
        })
      });
      const result = await response.json().catch(() => ({}));
      const next = safeShippingPlan(result.estimate);
      if (next) state.shippingEstimate = next;
      if (!response.ok || result.accepted !== true || !next
          || !shippingPlanHasCurrentRevalidation(next)
          || !shippingSelectionsMatchPlan(requestedOptions, plan, next)) {
        const error = new Error(result.reason || result.error || "shipping_revalidation_failed");
        error.code = result.reason || result.error || "shipping_revalidation_failed";
        throw error;
      }
      state.shippingSelections = Object.create(null);
      for (const group of next.groups) {
        if (group.selectedOptionId) state.shippingSelections[shippingGroupKey(group)] = group.selectedOptionId;
      }
      state.shippingRevalidationStatus = "ready";
      state.shippingRevalidationError = "";
      return true;
    } catch (error) {
      state.shippingRevalidationStatus = "error";
      state.shippingRevalidationError = cleanText(error?.code || "shipping_revalidation_failed", 160);
      return false;
    } finally {
      refreshShipmentPlanner();
    }
  }

  let mountedAccountProfile = null;
  const accountDashboardCache = Object.create(null);

  function accountDashboardText() {
    return state.locale === "ar" ? {
      title: "لوحة حساب العميل",
      profile: "الملف الشخصي",
      addresses: "العناوين",
      orders: "الطلبات",
      savedCart: "السلة المحفوظة",
      quotes: "طلبات الأسعار",
      security: "الأمان وكلمة المرور",
      loading: "جاري تحميل بيانات الحساب الخاصة…",
      dataUnavailable: "تخزين بيانات الحساب غير مفعّل بعد",
      dataUnavailableText: "تسجيل الدخول آمن، لكن العناوين والطلبات والسلة وطلبات الأسعار تحتاج ربط قاعدة البيانات الخاصة قبل عرض أي بيانات حقيقية.",
      sessionExpired: "انتهت جلسة تسجيل الدخول. سجل الدخول مرة ثانية للوصول إلى بيانات الحساب.",
      loadError: "تعذر تحميل بيانات الحساب حالياً. لم يتم عرض أي بيانات خاصة.",
      retry: "إعادة المحاولة",
      saveChanges: "حفظ التغييرات",
      saving: "جاري الحفظ…",
      profileUpdated: "تم تحديث بيانات الحساب.",
      actionError: "تعذر حفظ التغيير. لم يتم تعديل البيانات.",
      displayName: "الاسم",
      email: "البريد الإلكتروني",
      phone: "الهاتف",
      language: "اللغة المفضلة",
      noAddresses: "لا توجد عناوين محفوظة.",
      addAddress: "إضافة عنوان",
      editAddress: "تعديل",
      deleteAddress: "حذف",
      cancel: "إلغاء",
      addressLabel: "اسم العنوان",
      recipientName: "اسم المستلم",
      addressLine1: "العنوان الأول",
      addressLine2: "العنوان الثاني",
      area: "المنطقة",
      city: "المدينة",
      postalCode: "الرمز البريدي",
      countryCode: "رمز الدولة",
      addressSaved: "تم حفظ العنوان.",
      addressDeleted: "تم حذف العنوان.",
      confirmDeleteAddress: "هل تريد حذف هذا العنوان المحفوظ؟",
      shippingDefault: "عنوان الشحن الافتراضي",
      billingDefault: "عنوان الفوترة الافتراضي",
      noOrders: "لا توجد طلبات مرتبطة بهذا الحساب.",
      noQuotes: "لا توجد طلبات أسعار محفوظة في الحساب.",
      noSavedCart: "لا توجد سلة محفوظة في الحساب.",
      localCart: "سلة الاختبار على هذا الجهاز",
      localCartText: "تبقى سلة الاختبار الحالية محفوظة محلياً على هذا الجهاز عند تسجيل الدخول.",
      viewCart: "فتح السلة",
      saveCurrentCart: "حفظ السلة الحالية في الحساب",
      restoreSavedCart: "استعادة سلة الحساب على هذا الجهاز",
      cartSaved: "تم حفظ السلة الحالية في الحساب.",
      cartRestored: "تمت استعادة سلة الحساب على هذا الجهاز.",
      cartEmptyError: "أضف قطعة مؤهلة إلى سلة الاختبار قبل حفظها.",
      cartRestoreError: "لا توجد قطع مؤهلة حالياً للاستعادة من سلة الحساب.",
      wishlist: "المنتجات المحفوظة",
      wishlistPending: "قائمة الرغبات غير مفعّلة في نسخة الاختبار الحالية، لذلك لن نعرض بيانات غير محفوظة على أنها متزامنة.",
      status: "الحالة",
      paymentStatus: "حالة الدفع",
      reference: "الرقم المرجعي",
      submitted: "تاريخ الإرسال",
      total: "المجموع",
      quantity: "الكمية",
      securityText: "يدير مزود الهوية الآمن البريد وكلمة المرور والتحقق وتسجيل الخروج. Projx Racing لا يمكنه رؤية كلمة المرور.",
      emptyValue: "غير مضاف"
    } : {
      title: "Customer account dashboard",
      profile: "Profile",
      addresses: "Addresses",
      orders: "Orders",
      savedCart: "Saved cart",
      quotes: "Quote history",
      security: "Security & password",
      loading: "Loading private account data…",
      dataUnavailable: "Account data storage is not active yet",
      dataUnavailableText: "Sign-in remains secure, but addresses, orders, saved carts and quote history require the private database connection before any real data can be shown.",
      sessionExpired: "Your sign-in session expired. Sign in again to access account data.",
      loadError: "Account data could not be loaded. No private information has been displayed.",
      retry: "Try again",
      saveChanges: "Save changes",
      saving: "Saving…",
      profileUpdated: "Account details updated.",
      actionError: "The change could not be saved. No account data was modified.",
      displayName: "Name",
      email: "Email",
      phone: "Phone",
      language: "Preferred language",
      noAddresses: "No saved addresses yet.",
      addAddress: "Add address",
      editAddress: "Edit",
      deleteAddress: "Delete",
      cancel: "Cancel",
      addressLabel: "Address label",
      recipientName: "Recipient name",
      addressLine1: "Address line 1",
      addressLine2: "Address line 2",
      area: "Area",
      city: "City",
      postalCode: "Postcode",
      countryCode: "Country code",
      addressSaved: "Address saved.",
      addressDeleted: "Address deleted.",
      confirmDeleteAddress: "Delete this saved address?",
      shippingDefault: "Default delivery address",
      billingDefault: "Default billing address",
      noOrders: "No orders are linked to this account.",
      noQuotes: "No saved quotation requests are linked to this account.",
      noSavedCart: "No account-saved cart is available.",
      localCart: "Staging cart on this device",
      localCartText: "Your current staging cart remains stored locally on this device when you sign in.",
      viewCart: "Open cart",
      saveCurrentCart: "Save current cart to account",
      restoreSavedCart: "Restore account cart on this device",
      cartSaved: "Current cart saved to your account.",
      cartRestored: "Account cart restored on this device.",
      cartEmptyError: "Add an eligible item to the staging cart before saving it.",
      cartRestoreError: "The account cart has no currently eligible items to restore.",
      wishlist: "Saved products",
      wishlistPending: "Wishlist sync is not enabled in this testing build, so unsaved data is never presented as synchronised.",
      status: "Status",
      paymentStatus: "Payment status",
      reference: "Reference",
      submitted: "Submitted",
      total: "Total",
      quantity: "Quantity",
      securityText: "The secure identity provider manages email, password, verification and sign-out. Projx Racing cannot see your password.",
      emptyValue: "Not added"
    };
  }

  async function accountApi(resource, { method = "GET", body } = {}) {
    const clerk = window.Clerk;
    const token = await clerk?.session?.getToken?.();
    if (!token) {
      const error = new Error("authentication_required");
      error.code = "authentication_required";
      error.status = 401;
      throw error;
    }
    const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`/api/${resource}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(typeof payload.error === "string" ? payload.error : "account_data_unavailable");
      error.code = typeof payload.error === "string" ? payload.error : "account_data_unavailable";
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function accountQuoteKey(value, fallback) {
    const key = cleanText(value || "", 255).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return key || fallback;
  }

  function accountQuoteItems(type, fields) {
    const selected = state.quote.length ? state.quote : (/quote/i.test(type) ? [{
      id: fields.context || type,
      kind: "Projx Racing",
      title: type,
      sku: "",
      details: fields.context || "",
      quantity: 1
    }] : []);
    return selected.map((item, index) => {
      const kind = cleanText(item.kind || "", 120);
      const supplier = /ecs/i.test(kind) ? "ecs-tuning" : /tegiwa/i.test(kind) ? "tegiwa" : "projx-racing";
      return {
        supplier,
        productId: accountQuoteKey(item.id, `website-quote-${index + 1}`),
        supplierProductId: "",
        variantId: "",
        sku: cleanText(item.sku || "", 255),
        title: cleanText(item.title || type, 500),
        optionTitle: cleanText(item.details || "", 300),
        quantity: Math.min(1000, Math.max(1, Number.parseInt(item.quantity, 10) || 1)),
        unitAmount: null,
        currency: null
      };
    });
  }

  function accountQuoteNotes(ref, type, fields) {
    const lines = [`Website reference: ${ref}`, `Request type: ${type}`];
    for (const [key, value] of Object.entries(fields)) {
      if (!value || key === "consent" || key === "selectedItems") continue;
      lines.push(`${key}: ${Array.isArray(value) ? value.join(" | ") : value}`);
    }
    return cleanText(lines.join("\n"), 4000);
  }

  async function saveWebsiteQuoteToAccount({ ref, type, fields }) {
    if (!window.Clerk?.isSignedIn) return null;
    const items = accountQuoteItems(type, fields);
    if (!items.length) return null;
    const vehicleDescription = cleanText([
      fields.year, fields.make, fields.model, fields.vehicle, fields.engine, fields.transmission
    ].filter(Boolean).join(" "), 500);
    return accountApi("quotes", {
      method: "POST",
      body: {
        idempotencyKey: randomCheckoutToken(),
        locale: state.locale,
        customer: {
          name: cleanText(fields.name || window.Clerk.user?.fullName || "", 200),
          email: cleanText(fields.email || window.Clerk.user?.primaryEmailAddress?.emailAddress || "", 320),
          phone: cleanText(fields.phone || window.Clerk.user?.primaryPhoneNumber?.phoneNumber || "", 60)
        },
        destination: {
          country: cleanText(fields.country || "", 100),
          city: cleanText(fields.city || "", 150),
          addressLine: cleanText(fields.address || fields.addressLine || "", 500),
          postcode: cleanText(fields.postcode || "", 40),
          fulfilment: cleanText(fields.fulfilment || "", 60)
        },
        vehicle: { description: vehicleDescription, vin: cleanText(fields.vin || "", 40) },
        notes: accountQuoteNotes(ref, type, fields),
        items
      }
    });
  }

  function accountDate(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return accountDashboardText().emptyValue;
    return new Intl.DateTimeFormat(state.locale === "ar" ? "ar-KW" : "en-GB", { dateStyle: "medium" }).format(date);
  }

  function accountTotals(totals) {
    if (!Array.isArray(totals) || !totals.length) return accountDashboardText().emptyValue;
    return totals.slice(0, 8).map(total => `<bdi>${esc(commerceMoney(Number(total.amount || 0) / 100, total.currency))}</bdi>`).join(" · ");
  }

  function accountRecordStatus(value) {
    const cleanStatus = cleanText(value || accountDashboardText().emptyValue, 80).replaceAll("_", " ");
    return cleanStatus ? cleanStatus.charAt(0).toUpperCase() + cleanStatus.slice(1) : accountDashboardText().emptyValue;
  }

  function accountDataError(error, tab) {
    const text = accountDashboardText();
    const notConfigured = ["backend_not_configured", "auth_not_configured"].includes(error?.code);
    const expired = ["authentication_required", "invalid_session_token"].includes(error?.code) || error?.status === 401;
    const heading = notConfigured ? text.dataUnavailable : expired ? text.sessionExpired : text.loadError;
    const detail = notConfigured ? text.dataUnavailableText : expired ? text.sessionExpired : text.loadError;
    return `<div class="account-data-state" role="status"><span>${icons.check}</span><div><strong>${esc(heading)}</strong><p>${esc(detail)}</p><button class="btn btn-sm btn-outline" type="button" data-account-dashboard-tab="${esc(tab)}">${esc(text.retry)}</button></div></div>`;
  }

  function accountProfileMarkup(account = {}) {
    const text = accountDashboardText();
    return `<div class="account-data-grid"><article class="account-data-card account-profile-card"><span class="eyebrow">${esc(text.profile)}</span><dl><div><dt>${esc(text.email)}</dt><dd><bdi>${esc(account.email || text.emptyValue)}</bdi></dd></div><div><dt>${esc(text.status)}</dt><dd>${esc(accountRecordStatus(account.status))}</dd></div></dl><form class="account-edit-form" data-account-profile-form><div class="form-grid"><div class="form-group"><label for="account-display-name">${esc(text.displayName)}</label><input class="input" id="account-display-name" name="displayName" value="${esc(account.displayName || "")}" maxlength="200" autocomplete="name"></div><div class="form-group"><label for="account-phone">${esc(text.phone)}</label><input class="input ltr-input" id="account-phone" name="phone" value="${esc(account.phone || "")}" maxlength="60" autocomplete="tel" inputmode="tel"></div><div class="form-group"><label for="account-locale">${esc(text.language)}</label><select class="select" id="account-locale" name="preferredLocale"><option value="en"${account.preferredLocale !== "ar" ? " selected" : ""}>English</option><option value="ar"${account.preferredLocale === "ar" ? " selected" : ""}>العربية</option></select></div></div><div class="account-form-actions"><button class="btn btn-sm" type="submit">${esc(text.saveChanges)}${icons.arrow}</button><button class="btn btn-sm btn-outline" type="button" data-account-dashboard-tab="security">${esc(text.security)}</button></div><p class="form-status" role="status" aria-live="polite"></p></form></article></div>`;
  }

  function accountAddressesMarkup(addresses = []) {
    const text = accountDashboardText();
    const cards = addresses.length ? `<div class="account-data-grid">${addresses.map(address => `<article class="account-data-card"><header><div><span>${esc(address.label || text.addresses)}</span><strong>${esc(address.recipientName || text.emptyValue)}</strong></div><div class="account-address-badges">${address.isDefaultShipping ? `<small>${esc(text.shippingDefault)}</small>` : ""}${address.isDefaultBilling ? `<small>${esc(text.billingDefault)}</small>` : ""}</div></header><address>${[address.addressLine1, address.addressLine2, address.area, address.city, address.postalCode, address.countryCode].filter(Boolean).map(value => esc(value)).join("<br>")}</address><p><bdi>${esc(address.phone || text.emptyValue)}</bdi></p><div class="account-card-actions"><button class="btn btn-sm btn-outline" type="button" data-account-edit-address="${esc(address.id)}">${esc(text.editAddress)}</button><button class="text-link account-delete-link" type="button" data-account-delete-address="${esc(address.id)}">${esc(text.deleteAddress)}</button></div></article>`).join("")}</div>` : `<div class="account-empty-card"><span>${icons.map}</span><strong>${esc(text.noAddresses)}</strong></div>`;
    return `${cards}<form class="account-address-form" data-account-address-form><input type="hidden" name="addressId" value=""><header><div><span class="eyebrow">${esc(text.addresses)}</span><h3 data-account-address-form-title>${esc(text.addAddress)}</h3></div><button class="text-link" type="button" data-account-cancel-address hidden>${esc(text.cancel)}</button></header><div class="form-grid"><div class="form-group"><label class="required" for="account-address-label">${esc(text.addressLabel)}</label><input class="input" id="account-address-label" name="label" maxlength="80" required></div><div class="form-group"><label class="required" for="account-recipient-name">${esc(text.recipientName)}</label><input class="input" id="account-recipient-name" name="recipientName" maxlength="200" autocomplete="name" required></div><div class="form-group"><label class="required" for="account-address-phone">${esc(text.phone)}</label><input class="input ltr-input" id="account-address-phone" name="phone" maxlength="60" autocomplete="tel" inputmode="tel" required></div><div class="form-group"><label class="required" for="account-address-country">${esc(text.countryCode)}</label><input class="input ltr-input" id="account-address-country" name="countryCode" value="KW" minlength="2" maxlength="2" pattern="[A-Za-z]{2}" autocapitalize="characters" required></div><div class="form-group full"><label class="required" for="account-address-line-1">${esc(text.addressLine1)}</label><input class="input" id="account-address-line-1" name="addressLine1" maxlength="300" autocomplete="address-line1" required></div><div class="form-group full"><label for="account-address-line-2">${esc(text.addressLine2)}</label><input class="input" id="account-address-line-2" name="addressLine2" maxlength="300" autocomplete="address-line2"></div><div class="form-group"><label for="account-address-area">${esc(text.area)}</label><input class="input" id="account-address-area" name="area" maxlength="150" autocomplete="address-level3"></div><div class="form-group"><label class="required" for="account-address-city">${esc(text.city)}</label><input class="input" id="account-address-city" name="city" maxlength="150" autocomplete="address-level2" required></div><div class="form-group"><label for="account-address-postcode">${esc(text.postalCode)}</label><input class="input ltr-input" id="account-address-postcode" name="postalCode" maxlength="40" autocomplete="postal-code"></div><div class="account-default-options form-group full"><label class="checkbox"><input type="checkbox" name="isDefaultShipping"><span>${esc(text.shippingDefault)}</span></label><label class="checkbox"><input type="checkbox" name="isDefaultBilling"><span>${esc(text.billingDefault)}</span></label></div></div><button class="btn btn-sm" type="submit">${esc(text.saveChanges)}${icons.arrow}</button><p class="form-status" role="status" aria-live="polite"></p></form>`;
  }

  function accountOrdersMarkup(orders = []) {
    const text = accountDashboardText();
    if (!orders.length) return `<div class="account-empty-card"><span>${icons.cart}</span><strong>${esc(text.noOrders)}</strong></div>`;
    return `<div class="account-data-grid">${orders.map(order => `<article class="account-data-card"><header><div><span>${esc(text.reference)}</span><strong><bdi>${esc(order.reference || text.emptyValue)}</bdi></strong></div><small>${esc(accountDate(order.createdAt))}</small></header><dl><div><dt>${esc(text.status)}</dt><dd>${esc(accountRecordStatus(order.status))}</dd></div><div><dt>${esc(text.paymentStatus)}</dt><dd>${esc(accountRecordStatus(order.paymentStatus))}</dd></div><div><dt>${esc(text.total)}</dt><dd>${accountTotals(order.totals)}</dd></div></dl></article>`).join("")}</div>`;
  }

  function accountQuotesMarkup(quotes = []) {
    const text = accountDashboardText();
    if (!quotes.length) return `<div class="account-empty-card"><span>${icons.quote}</span><strong>${esc(text.noQuotes)}</strong></div>`;
    return `<div class="account-data-grid">${quotes.map(quote => `<article class="account-data-card"><header><div><span>${esc(text.reference)}</span><strong><bdi>${esc(quote.reference || text.emptyValue)}</bdi></strong></div><small>${esc(accountDate(quote.submittedAt))}</small></header><dl><div><dt>${esc(text.status)}</dt><dd>${esc(accountRecordStatus(quote.status))}</dd></div><div><dt>${esc(text.total)}</dt><dd>${accountTotals(quote.totals)}</dd></div></dl></article>`).join("")}</div>`;
  }

  function accountSavedCartMarkup(cart = {}) {
    const text = accountDashboardText();
    const items = Array.isArray(cart.items) ? cart.items : [];
    const saved = items.length ? `<div class="account-data-grid">${items.map(item => `<article class="account-data-card"><span>${esc(item.sku || text.savedCart)}</span><strong>${esc(item.title || text.emptyValue)}</strong><p>${esc(text.quantity)}: <bdi>${esc(String(item.quantity || 1))}</bdi></p>${item.unitAmount !== null && item.currency ? `<p>${esc(commerceMoney(Number(item.unitAmount) / 100, item.currency))}</p>` : ""}</article>`).join("")}</div>` : `<div class="account-empty-card"><span>${icons.cart}</span><strong>${esc(text.noSavedCart)}</strong></div>`;
    return `${saved}<div class="account-local-cart"><div><span>${esc(text.localCart)}</span><strong>${esc(String(cartCount()))} ${esc(cartCount() === 1 ? commerceText().item : commerceText().items)}</strong><p>${esc(text.localCartText)}</p></div><div class="account-cart-actions"><button class="btn btn-sm" type="button" data-account-save-cart>${esc(text.saveCurrentCart)}</button><button class="btn btn-sm btn-outline" type="button" data-account-restore-cart${items.length ? "" : " disabled"}>${esc(text.restoreSavedCart)}</button><a class="text-link" href="${routeUrl("/cart")}">${esc(text.viewCart)}${icons.arrow}</a></div></div><p class="form-status account-cart-status" role="status" aria-live="polite"></p><div class="account-data-state is-muted"><span>${icons.check}</span><div><strong>${esc(text.wishlist)}</strong><p>${esc(text.wishlistPending)}</p></div></div>`;
  }

  function accountActionErrorText(error) {
    const text = accountDashboardText();
    if (["backend_not_configured", "auth_not_configured"].includes(error?.code)) return text.dataUnavailableText;
    if (["authentication_required", "invalid_session_token"].includes(error?.code) || error?.status === 401) return text.sessionExpired;
    return text.actionError;
  }

  function setAccountActionStatus(status, message, isError = false) {
    if (!status) return;
    status.textContent = message;
    status.className = `form-status${isError ? " is-error" : " is-success"}`;
  }

  function accountAddressPayload(form) {
    const fields = new FormData(form);
    return {
      label: cleanText(fields.get("label"), 80),
      recipientName: cleanText(fields.get("recipientName"), 200),
      phone: cleanText(fields.get("phone"), 60),
      addressLine1: cleanText(fields.get("addressLine1"), 300),
      addressLine2: cleanText(fields.get("addressLine2"), 300) || null,
      area: cleanText(fields.get("area"), 150) || null,
      city: cleanText(fields.get("city"), 150),
      postalCode: cleanText(fields.get("postalCode"), 40) || null,
      countryCode: cleanText(fields.get("countryCode"), 2).toUpperCase(),
      isDefaultShipping: fields.get("isDefaultShipping") === "on",
      isDefaultBilling: fields.get("isDefaultBilling") === "on"
    };
  }

  function resetAccountAddressForm(form) {
    if (!form) return;
    form.reset();
    form.elements.addressId.value = "";
    form.elements.countryCode.value = "KW";
    const text = accountDashboardText();
    const heading = form.querySelector("[data-account-address-form-title]");
    const cancel = form.querySelector("[data-account-cancel-address]");
    if (heading) heading.textContent = text.addAddress;
    if (cancel) cancel.hidden = true;
    setAccountActionStatus(form.querySelector(".form-status"), "", false);
  }

  function editAccountAddress(root, addressId) {
    const addresses = accountDashboardCache.addresses?.addresses || [];
    const address = addresses.find(item => item.id === addressId);
    const form = root.querySelector("[data-account-address-form]");
    if (!address || !form) return;
    for (const name of ["label", "recipientName", "phone", "addressLine1", "addressLine2", "area", "city", "postalCode", "countryCode"]) {
      form.elements[name].value = address[name] || "";
    }
    form.elements.addressId.value = address.id;
    form.elements.isDefaultShipping.checked = address.isDefaultShipping === true;
    form.elements.isDefaultBilling.checked = address.isDefaultBilling === true;
    const text = accountDashboardText();
    form.querySelector("[data-account-address-form-title]").textContent = text.editAddress;
    form.querySelector("[data-account-cancel-address]").hidden = false;
    scrollElementIntoView(form);
    window.setTimeout(() => form.elements.label.focus(), motionDelay());
  }

  async function restoreSavedSupplierCatalogueItem(item, productCache, now = Date.now()) {
    const supplier = cleanText(item?.supplier || "", 80).toLowerCase();
    const sourceHandle = tegiwaProductHandle(item?.sourceHandle);
    const productId = cleanText(item?.productId || "", 280);
    const sku = cleanText(item?.sku || "", 120);
    if (!sourceHandle || !productId || !sku || !["tegiwa", "ecs"].includes(supplier)) return null;
    const requestHandle = supplier === "tegiwa"
      ? `tegiwa-${sourceHandle}`
      : sourceHandle;
    const cacheKey = `${supplier}\u0000${requestHandle}`;
    if (!productCache.has(cacheKey)) {
      productCache.set(cacheKey, (async () => {
        const result = await fetchPartsCatalogue(partsCatalogueParams({ handle: requestHandle }));
        return result?.payload?.product || null;
      })());
    }
    const product = await productCache.get(cacheKey);
    if (!product || cleanText(product?.supplier?.slug || "", 80).toLowerCase() !== supplier) return null;
    let variant = null;
    if (supplier === "tegiwa") {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      variant = variants.find(option => cleanText(option?.sku || "", 120) === sku) || null;
      if (variants.length && !variant) return null;
    }
    const selection = supplierCatalogueCartSelection(product, variant, now);
    const savedMinor = Number(item.unitAmount);
    if (!selection || selection.productId !== productId || selection.sku !== sku
        || selection.currency !== String(item.currency || "").toUpperCase()
        || !Number.isSafeInteger(savedMinor) || savedMinor !== Math.round(selection.unitAmount * 100)) return null;
    return normalizeSupplierCatalogueCartItem({ ...selection, quantity: item.quantity }, item.quantity, now);
  }

  async function restoreSavedAccountCartItems(savedItems) {
    if (!Array.isArray(savedItems)) return [];
    const restored = [];
    const productCache = new Map();
    for (const item of savedItems.slice(0, MAX_CART_LINES)) {
      const direct = normalizeCart([{ productId: item?.productId, quantity: item?.quantity }])[0];
      if (direct) {
        restored.push(direct);
        continue;
      }
      try {
        const supplierItem = await restoreSavedSupplierCatalogueItem(item, productCache);
        if (supplierItem) restored.push(supplierItem);
      } catch { /* A supplier item is restored only after a current canonical catalogue check succeeds. */ }
    }
    return normalizeCart(restored);
  }

  function accountCartItemsForApi() {
    return state.cart.map(item => {
      const supplierItem = normalizeSupplierCatalogueCartItem(item);
      if (supplierItem) return {
        supplier: supplierItem.supplier.slug,
        productId: supplierItem.productId,
        sourceHandle: supplierItem.sourceHandle,
        supplierProductId: null,
        variantId: supplierItem.variantId,
        sku: supplierItem.sku,
        title: supplierItem.title,
        optionTitle: supplierItem.optionTitle || null,
        quantity: supplierItem.quantity,
        unitAmount: Math.round(supplierItem.unitAmount * 100),
        currency: supplierItem.currency
      };
      const product = commerceProduct(item.productId);
      const policy = commercePolicy(product);
      const supplier = cleanText(policy?.supplier?.slug || "", 80).toLowerCase();
      if (!product || !policy || !supplier) return null;
      return {
        supplier,
        productId: item.productId,
        sourceHandle: cleanText(item.sourceHandle || "", 255) || null,
        supplierProductId: null,
        variantId: policy.variantId || policy.sku || null,
        sku: item.sku,
        title: product ? localizedStoreProduct(product).title : item.sku,
        optionTitle: policy.variantTitle || null,
        quantity: item.quantity,
        unitAmount: Math.round(Number(item.unitAmount) * 100),
        currency: item.currency
      };
    }).filter(Boolean);
  }

  async function showAccountDashboardTab(root, clerk, tab = "profile") {
    const allowed = new Set(["profile", "addresses", "orders", "cart", "quotes", "security"]);
    const selected = allowed.has(tab) ? tab : "profile";
    const text = accountDashboardText();
    const panel = root.querySelector("[data-account-dashboard-panel]");
    if (!panel) return;
    if (mountedAccountProfile && typeof clerk.unmountUserProfile === "function") clerk.unmountUserProfile(mountedAccountProfile);
    mountedAccountProfile = null;
    root.querySelectorAll("[data-account-dashboard-tab]").forEach(button => {
      const active = button.dataset.accountDashboardTab === selected;
      button.classList.toggle("is-active", active);
      if (button.getAttribute("role") === "tab") {
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      }
    });
    panel.setAttribute("aria-labelledby", `account-dashboard-tab-${selected}`);
    if (selected === "security") {
      panel.innerHTML = `<div class="account-security-intro"><strong>${esc(text.security)}</strong><p>${esc(text.securityText)}</p></div><div id="account-user-profile"></div>`;
      mountedAccountProfile = panel.querySelector("#account-user-profile");
      if (mountedAccountProfile && typeof clerk.mountUserProfile === "function") clerk.mountUserProfile(mountedAccountProfile);
      return;
    }
    panel.innerHTML = `<div class="account-loading" role="status">${esc(text.loading)}</div>`;
    const resource = selected === "profile" ? "account" : selected;
    try {
      const payload = await accountApi(resource);
      if (!document.body.contains(root) || panel.getAttribute("aria-labelledby") !== `account-dashboard-tab-${selected}`) return;
      accountDashboardCache[selected] = payload;
      if (selected === "profile") panel.innerHTML = accountProfileMarkup(payload.account);
      else if (selected === "addresses") panel.innerHTML = accountAddressesMarkup(payload.addresses);
      else if (selected === "orders") panel.innerHTML = accountOrdersMarkup(payload.orders);
      else if (selected === "cart") panel.innerHTML = accountSavedCartMarkup(payload.cart);
      else panel.innerHTML = accountQuotesMarkup(payload.quotes);
    } catch (error) {
      if (document.body.contains(root) && panel.getAttribute("aria-labelledby") === `account-dashboard-tab-${selected}`) {
        panel.innerHTML = accountDataError(error, selected);
      }
    }
  }

  function mountAccountDashboard(root, clerk) {
    const text = accountDashboardText();
    const tabs = [
      ["profile", text.profile], ["addresses", text.addresses], ["orders", text.orders],
      ["cart", text.savedCart], ["quotes", text.quotes], ["security", text.security]
    ];
    root.setAttribute("aria-labelledby", "account-dashboard-heading");
    root.innerHTML = `<div class="account-signed-in"><header class="account-dashboard-head"><div><span>${esc(state.locale === "ar" ? "تم تسجيل الدخول" : "Signed in")}</span><h2 id="account-dashboard-heading">${esc(clerk.user?.fullName || clerk.user?.primaryEmailAddress?.emailAddress || text.title)}</h2></div><div id="account-user-button"></div></header><div class="account-dashboard-tabs" role="tablist" aria-label="${esc(text.title)}">${tabs.map(([id, label], index) => `<button id="account-dashboard-tab-${id}" class="${index === 0 ? "is-active" : ""}" type="button" role="tab" aria-selected="${index === 0}" aria-controls="account-dashboard-panel" tabindex="${index === 0 ? 0 : -1}" data-account-dashboard-tab="${id}">${esc(label)}</button>`).join("")}</div><section id="account-dashboard-panel" class="account-dashboard-panel" role="tabpanel" aria-labelledby="account-dashboard-tab-profile" data-account-dashboard-panel></section></div>`;
    clerk.mountUserButton(root.querySelector("#account-user-button"));
    root.addEventListener("click", async event => {
      const text = accountDashboardText();
      const tabButton = event.target.closest("[data-account-dashboard-tab]");
      if (tabButton) {
        showAccountDashboardTab(root, clerk, tabButton.dataset.accountDashboardTab);
        return;
      }
      const editButton = event.target.closest("[data-account-edit-address]");
      if (editButton) {
        editAccountAddress(root, editButton.dataset.accountEditAddress);
        return;
      }
      const cancelAddress = event.target.closest("[data-account-cancel-address]");
      if (cancelAddress) {
        resetAccountAddressForm(cancelAddress.closest("form"));
        return;
      }
      const deleteButton = event.target.closest("[data-account-delete-address]");
      if (deleteButton) {
        if (!window.confirm(text.confirmDeleteAddress)) return;
        const status = root.querySelector("[data-account-address-form] .form-status");
        deleteButton.disabled = true;
        try {
          await accountApi(`addresses?id=${encodeURIComponent(deleteButton.dataset.accountDeleteAddress)}`, { method: "DELETE" });
          delete accountDashboardCache.addresses;
          showToast(text.addressDeleted);
          await showAccountDashboardTab(root, clerk, "addresses");
        } catch (error) {
          setAccountActionStatus(status, accountActionErrorText(error), true);
          if (document.body.contains(deleteButton)) deleteButton.disabled = false;
        }
        return;
      }
      const saveCartButton = event.target.closest("[data-account-save-cart]");
      if (saveCartButton) {
        const status = root.querySelector(".account-cart-status");
        const items = accountCartItemsForApi();
        if (!items.length) {
          setAccountActionStatus(status, text.cartEmptyError, true);
          return;
        }
        saveCartButton.disabled = true;
        try {
          const payload = await accountApi("cart", { method: "PUT", body: { items } });
          accountDashboardCache.cart = payload;
          showToast(text.cartSaved);
          await showAccountDashboardTab(root, clerk, "cart");
        } catch (error) {
          setAccountActionStatus(status, accountActionErrorText(error), true);
          if (document.body.contains(saveCartButton)) saveCartButton.disabled = false;
        }
        return;
      }
      const restoreCartButton = event.target.closest("[data-account-restore-cart]");
      if (restoreCartButton) {
        const status = root.querySelector(".account-cart-status");
        const savedItems = accountDashboardCache.cart?.cart?.items || [];
        restoreCartButton.disabled = true;
        const restored = await restoreSavedAccountCartItems(savedItems);
        if (!restored.length) {
          setAccountActionStatus(status, text.cartRestoreError, true);
          if (document.body.contains(restoreCartButton)) restoreCartButton.disabled = false;
          return;
        }
        state.cart = restored;
        saveCart();
        setAccountActionStatus(status, text.cartRestored);
        showToast(text.cartRestored);
        const localCount = root.querySelector(".account-local-cart strong");
        if (localCount) localCount.textContent = `${cartCount()} ${cartCount() === 1 ? commerceText().item : commerceText().items}`;
        if (document.body.contains(restoreCartButton)) restoreCartButton.disabled = false;
      }
    });
    root.addEventListener("submit", async event => {
      const text = accountDashboardText();
      const profileForm = event.target.closest("[data-account-profile-form]");
      const addressForm = event.target.closest("[data-account-address-form]");
      if (!profileForm && !addressForm) return;
      event.preventDefault();
      const form = profileForm || addressForm;
      if (!form.reportValidity()) return;
      const submit = form.querySelector('button[type="submit"]');
      const status = form.querySelector(".form-status");
      submit.disabled = true;
      setAccountActionStatus(status, text.saving);
      try {
        if (profileForm) {
          const fields = new FormData(profileForm);
          const payload = await accountApi("account", {
            method: "PATCH",
            body: {
              displayName: cleanText(fields.get("displayName"), 200) || null,
              phone: cleanText(fields.get("phone"), 60) || null,
              preferredLocale: fields.get("preferredLocale") === "ar" ? "ar" : "en"
            }
          });
          accountDashboardCache.profile = payload;
          setAccountActionStatus(status, text.profileUpdated);
          showToast(text.profileUpdated);
        } else {
          const addressId = cleanText(addressForm.elements.addressId.value, 80);
          const resource = `addresses${addressId ? `?id=${encodeURIComponent(addressId)}` : ""}`;
          await accountApi(resource, { method: addressId ? "PUT" : "POST", body: accountAddressPayload(addressForm) });
          delete accountDashboardCache.addresses;
          showToast(text.addressSaved);
          await showAccountDashboardTab(root, clerk, "addresses");
        }
      } catch (error) {
        setAccountActionStatus(status, accountActionErrorText(error), true);
      } finally {
        if (document.body.contains(submit)) submit.disabled = false;
      }
    });
    root.addEventListener("keydown", event => {
      const tab = event.target.closest('[role="tab"][data-account-dashboard-tab]');
      if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabButtons = [...root.querySelectorAll('[role="tab"][data-account-dashboard-tab]')];
      const index = tabButtons.indexOf(tab);
      const direction = state.locale === "ar" ? -1 : 1;
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabButtons.length - 1
        : (index + (event.key === "ArrowRight" ? direction : -direction) + tabButtons.length) % tabButtons.length;
      event.preventDefault();
      tabButtons[nextIndex].focus();
      showAccountDashboardTab(root, clerk, tabButtons[nextIndex].dataset.accountDashboardTab);
    });
    showAccountDashboardTab(root, clerk, "profile");
  }

  async function mountAccountPortal(mode = "sign-in") {
    const root = document.getElementById("account-auth-root");
    if (!root) return;
    root.dataset.accountMode = mode;
    root.setAttribute("aria-labelledby", `account-tab-${mode}`);
    const modeTabs = root.closest(".account-panel")?.querySelector(".account-tabs");
    if (modeTabs) modeTabs.hidden = false;
    root.innerHTML = `<div class="account-loading" role="status">${esc(state.locale === "ar" ? "جاري تحميل بوابة الحساب الآمنة..." : "Loading the secure account portal...")}</div>`;
    try {
      const clerk = await loadClerk();
      if (!document.body.contains(root)) return;
      root.innerHTML = "";
      if (clerk.isSignedIn) {
        if (modeTabs) modeTabs.hidden = true;
        mountAccountDashboard(root, clerk);
      } else if (mode === "sign-up") {
        clerk.mountSignUp(root, { routing: "hash" });
      } else {
        clerk.mountSignIn(root, { routing: "hash" });
      }
    } catch (error) {
      const notConfigured = error?.message === "account_not_configured";
      root.innerHTML = `<div class="account-setup-notice"><strong>${esc(state.locale === "ar" ? (notConfigured ? "بوابة الحساب جاهزة للربط" : "تعذر تحميل بوابة الحساب") : (notConfigured ? "Account portal ready to connect" : "Account portal could not load"))}</strong><p>${esc(state.locale === "ar" ? (notConfigured ? "يتطلب التفعيل إعداد Clerk للواجهة والخادم والـ webhook، ثم تشغيل ترحيل قاعدة البيانات الخاصة وربطها ببيئة Vercel." : "حاول مرة ثانية أو تواصل مع الورشة مباشرة.") : (notConfigured ? "Activation requires Clerk client, server verification and webhook settings, plus the private database migration and Vercel connection." : "Try again or contact the workshop directly."))}</p><a class="btn btn-sm" href="${routeUrl("/contact")}">${esc(U().actions.contactWorkshop)}${icons.arrow}</a></div>`;
    }
  }

  function genericForm(type = "General Enquiry", context = "") {
    const ui = U();
    const labels = storeText();
    const id = `form-${slugify(type)}-${Math.random().toString(36).slice(2, 6)}`;
    const partsFlow = /Parts/.test(type) || (type === "General Quote" && state.quote.some(item => /Parts/.test(item.kind)));
    const shippingFields = partsFlow ? `<fieldset class="form-group full shipping-fields"><legend>${esc(labels.shippingHeading)}</legend><p>${esc(labels.shippingText)}</p><div class="form-grid"><div class="form-group"><label class="required" for="${id}-country">${esc(labels.destinationCountry)}</label><input id="${id}-country" class="input" name="country" required autocomplete="country-name"></div><div class="form-group"><label class="required" for="${id}-city">${esc(labels.destinationCity)}</label><input id="${id}-city" class="input" name="city" required autocomplete="address-level2"></div><div class="form-group"><label for="${id}-postcode">${esc(labels.postcode)} <small>${esc(ui.forms.optional)}</small></label><input id="${id}-postcode" class="input ltr-input" name="postcode" autocomplete="postal-code"></div><div class="form-group"><label for="${id}-fulfilment">${esc(labels.fulfilment)}</label><select id="${id}-fulfilment" class="select" name="fulfilment"><option>${esc(labels.courier)}</option><option>${esc(labels.workshop)}</option></select></div><div class="form-group full"><label for="${id}-vin">${esc(labels.vin)} <small>${esc(ui.forms.optional)}</small></label><input id="${id}-vin" class="input ltr-input" name="vin" maxlength="24"></div></div></fieldset>` : "";
    return `<form class="enquiry-form" data-enquiry-form data-form-type="${esc(type)}" data-context="${esc(context)}" novalidate><input type="text" name="website" class="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="startedAt" value="${Date.now()}"><div class="form-grid"><div class="form-group"><label class="required" for="${id}-name">${esc(ui.forms.name)}</label><input id="${id}-name" class="input" name="name" required autocomplete="name" placeholder="${esc(ui.forms.placeholders.name)}"></div><div class="form-group"><label class="required" for="${id}-phone">${esc(ui.forms.phone)}</label><input id="${id}-phone" class="input ltr-input" name="phone" required inputmode="tel" autocomplete="tel" placeholder="${esc(ui.forms.placeholders.phone)}"></div><div class="form-group"><label for="${id}-email">${esc(ui.forms.email)} <small>${esc(ui.forms.optional)}</small></label><input id="${id}-email" class="input ltr-input" name="email" type="email" autocomplete="email" placeholder="${esc(ui.forms.placeholders.email)}"></div><div class="form-group"><label for="${id}-contact">${esc(ui.forms.preferredContact)}</label><select id="${id}-contact" class="select" name="preferredContact">${ui.forms.contactMethods.map(item => `<option>${esc(item)}</option>`).join("")}</select></div><div class="form-group full"><label class="required" for="${id}-vehicle">${esc(ui.forms.vehicle)}</label><input id="${id}-vehicle" class="input" name="vehicle" required placeholder="${esc(ui.forms.placeholders.vehicle)}"></div><div class="form-group"><label for="${id}-engine">${esc(ui.forms.engine)}</label><input id="${id}-engine" class="input" name="engine" placeholder="${esc(ui.forms.placeholders.engine)}"></div><div class="form-group"><label for="${id}-service">${esc(ui.forms.service)}</label><input id="${id}-service" class="input" name="service" value="${esc(context || type)}"></div>${shippingFields}<div class="form-group full"><label for="${id}-mods">${esc(ui.forms.modifications)} <small>${esc(ui.forms.optional)}</small></label><textarea id="${id}-mods" class="textarea" name="modifications" placeholder="${esc(ui.forms.placeholders.modifications)}"></textarea></div><div class="form-group full"><label class="required" for="${id}-message">${esc(ui.forms.message)}</label><textarea id="${id}-message" class="textarea" name="message" required placeholder="${esc(ui.forms.placeholders.message)}"></textarea></div><div class="form-group full"><label for="${id}-files">${esc(ui.forms.files)} <small>${esc(ui.forms.optional)}</small></label><input id="${id}-files" class="input file-input" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.log,.txt" aria-describedby="${id}-files-help"><small class="form-help" id="${id}-files-help">${esc(ui.forms.fileNote)}</small></div><label class="checkbox form-group full"><input type="checkbox" name="consent" required><span>${esc(ui.forms.consent)}</span></label></div><button class="btn btn-block" type="submit">${esc(ui.actions.submit)}${icons.arrow}</button><p class="form-status" role="status" aria-live="polite"></p></form>`;
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

  function connectUploadHelp(root) {
    root.querySelectorAll('input[type="file"]').forEach((input, index) => {
      const help = input.parentElement?.querySelector(".form-help");
      if (!help) return;
      const helpId = help.id || `${input.id || `file-upload-${index + 1}`}-help`;
      help.id = helpId;
      const descriptions = new Set((input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      descriptions.add(helpId);
      input.setAttribute("aria-describedby", [...descriptions].join(" "));
    });
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
    else if (path.startsWith("/parts/")) html = packageDetailPage(path.split("/")[2]);
    else if (path === "/brands") html = brandsPage();
    else if (path === "/gallery") html = galleryPage();
    else if (path === "/reviews") html = reviewsPage();
    else if (path === "/about") html = aboutPage();
    else if (path === "/contact") html = contactPage();
    else if (path === "/cart") html = cartPage();
    else if (path === "/checkout") html = checkoutPage();
    else if (path === "/account") html = accountPage();
    else if (path === "/admin/shipping") html = shippingAdminPage();
    else if (path === "/faq") html = faqPage();
    else if (path.startsWith("/legal/")) html = legalPage(path.split("/")[2]);
    else html = notFoundPage();
    main.innerHTML = html;
    connectUploadHelp(main);
    renderHeader();
    renderFooter();
    updateThemeControls();
    setupFilters();
    setupPartsStore();
    setupTegiwaCatalog();
    setupTuningFinder();
    syncTegiwaProductFromUrl();
    if (path === "/account") mountAccountPortal("sign-in");
    if (path === "/admin/shipping") mountShippingAdminDashboard();
    if (path === "/checkout") {
      prefillCheckoutAccount();
      setupCheckoutShippingEstimator();
    }
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

  function setupPartsStore() {
    const form = document.querySelector("[data-parts-vehicle-form]");
    if (form) updatePartsVehicleCascades(form);
    document.querySelector("[data-parts-sort]")?.addEventListener("change", sortPartsGrid);
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
        const itemValue = item.dataset[attribute] || "";
        if (select.dataset.filterMatch === "vehicle") {
          if (select.value !== "possible") return true;
          if (item.dataset.fitmentMode === "universal-confirm") return true;
          const selectedMake = new Set(normalizedBrandWords(state.partsVehicle?.make || ""));
          const fitmentMakes = item.dataset.fitmentMakes || "";
          return fitmentMakes.split("|").filter(Boolean).some(word => selectedMake.has(word));
        }
        return select.dataset.filterMatch === "includes" ? itemValue.split("|").includes(select.value) : itemValue === select.value;
      });
      const show = searchMatch && selectMatch;
      item.hidden = !show;
      if (show) visible += 1;
    });
    const empty = document.querySelector(`[data-filter-empty="${CSS.escape(group)}"]`);
    if (empty) empty.hidden = visible > 0;
    if (group === "parts") updatePartsFilterState(visible);
  }

  function sortPartsGrid() {
    const grid = document.querySelector('[data-filter-grid="parts"]');
    const select = document.querySelector("[data-parts-sort]");
    if (!grid || !select) return;
    const key = select.value;
    const items = [...grid.querySelectorAll(".filter-item")];
    items.sort((left, right) => {
      if (key === "featured") return Number(left.dataset.sortIndex || 0) - Number(right.dataset.sortIndex || 0);
      return String(left.dataset[`sort${key[0].toUpperCase()}${key.slice(1)}`] || "").localeCompare(String(right.dataset[`sort${key[0].toUpperCase()}${key.slice(1)}`] || ""), state.locale);
    });
    items.forEach(item => grid.append(item));
  }

  function updatePartsFilterState(visible) {
    const count = document.querySelector("[data-parts-result-count]");
    if (count) count.textContent = String(visible);
    const brand = document.querySelector('[data-filter-select="parts"][data-filter-attribute="brand"]')?.value || "";
    document.querySelectorAll("[data-parts-brand]").forEach(button => {
      const active = button.dataset.partsBrand === brand;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function selectPartsFilter(attribute, value) {
    const select = document.querySelector(`[data-filter-select="parts"][data-filter-attribute="${attribute}"]`);
    if (!select) return;
    select.value = select.value === value ? "" : value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    scrollElementIntoView(document.getElementById("parts-results"));
  }

  function searchTegiwaDirectory(query, trigger) {
    const normalizedQuery = cleanText(query, 120);
    const requestedPartType = catalogueFilterValue("partType", trigger?.dataset.tegiwaDirectoryPartType || "");
    if (normalizedQuery.length < 2 && !requestedPartType) return;
    const requestedSupplier = catalogueFilterValue("supplier", trigger?.dataset.tegiwaDirectorySupplier || "");
    const requestedMatch = trigger?.dataset.tegiwaDirectoryMatch === "any"
      ? "any"
      : (partsVehicleLabel() ? "vehicle" : "any");
    Object.assign(state.tegiwaCatalog, TEGIWA_SEARCH_DEFAULTS, {
      supplier: requestedSupplier,
      partType: requestedPartType,
      sortScope: ""
    });
    syncTegiwaFilterUi();
    const searchInput = document.querySelector('[data-tegiwa-search] input[name="q"]');
    if (searchInput) searchInput.value = normalizedQuery;
    hideTegiwaSuggestions();
    document.querySelectorAll("[data-tegiwa-directory-query]").forEach(button => {
      const active = button === trigger;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const catalogue = document.getElementById("tegiwa-catalog");
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    catalogue?.scrollIntoView({ behavior, block: "start" });
    loadTegiwaCatalog({
      query: normalizedQuery,
      match: requestedMatch,
      page: 1
    });
    window.setTimeout(() => searchInput?.focus({ preventScroll: true }), behavior === "smooth" ? 450 : 0);
  }

  function togglePartsDirectoryGroup(trigger) {
    if (!trigger) return;
    const shouldOpen = trigger.getAttribute("aria-expanded") !== "true";
    document.querySelectorAll("[data-parts-directory-toggle]").forEach(toggle => {
      const open = toggle === trigger && shouldOpen;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? toggle.dataset.expandedLabel : toggle.dataset.collapsedLabel);
      toggle.closest("[data-parts-directory-group]")?.classList.toggle("is-open", open);
      const panel = document.getElementById(toggle.getAttribute("aria-controls") || "");
      if (panel) panel.hidden = !open;
    });
  }

  function clearPartsFilters() {
    document.querySelectorAll('[data-filter-search="parts"], [data-filter-select="parts"]').forEach(control => { control.value = ""; });
    const sort = document.querySelector("[data-parts-sort]");
    if (sort) { sort.value = "featured"; sortPartsGrid(); }
    const search = document.querySelector('[data-filter-search="parts"]');
    if (search) applyFilter({ currentTarget: search });
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

  function closeModal({ syncProductUrl = true } = {}) {
    const productHandle = state.tegiwaCatalog.detailHandle;
    const queryHandle = tegiwaProductHandle(currentRouteQueryParams().get(TEGIWA_PRODUCT_QUERY));
    const historyHandle = tegiwaProductHandle(history.state?.[TEGIWA_PRODUCT_HISTORY_KEY]);
    const returnToPreviousEntry = Boolean(syncProductUrl && productHandle && queryHandle === productHandle && historyHandle === productHandle);
    state.tegiwaCatalog.detailController?.abort();
    state.tegiwaCatalog.detailController = null;
    state.tegiwaCatalog.detailHandle = "";
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
    state.formContext?.opener?.focus?.();
    state.formContext = null;
    if (!syncProductUrl || !productHandle) return;
    if (returnToPreviousEntry) history.back();
    else removeTegiwaProductUrl();
  }

  function renderQuoteDrawer() {
    const ui = U();
    const labels = storeText();
    const items = state.quote.map((item, index) => {
      const sku = cleanText(item.sku || "", 120);
      return `<article class="quote-item"><span>${compactNumber(index + 1)}</span><div class="quote-item-copy"><small>${esc(item.kind)}</small><strong>${esc(item.title)}</strong>${sku ? `<p class="quote-item-sku">${esc(ui.common.sku)}: <bdi dir="ltr">${esc(sku)}</bdi></p>` : ""}<p>${esc(item.details)}</p></div><div class="quote-item-actions"><div class="quote-quantity" aria-label="${esc(labels.quantity)}"><button type="button" data-action="adjust-quote-quantity" data-delta="-1" data-id="${esc(item.id)}" aria-label="${esc(`${labels.decrease}: ${item.title}`)}">−</button><bdi>${Number(item.quantity) || 1}</bdi><button type="button" data-action="adjust-quote-quantity" data-delta="1" data-id="${esc(item.id)}" aria-label="${esc(`${labels.increase}: ${item.title}`)}">+</button></div><button class="quote-remove" type="button" data-action="remove-quote" data-id="${esc(item.id)}" aria-label="${esc(`${ui.actions.remove}: ${item.title}`)}">${icons.close}</button></div></article>`;
    }).join("");
    const content = state.quote.length
      ? `<div class="quote-items">${items}</div><div class="quote-form-wrap">${genericForm("General Quote", state.quote.map(item => `${item.title} × ${item.quantity || 1}`).join(", "))}</div>`
      : `<div class="empty-state"><strong>${esc(ui.common.emptyQuote)}</strong><p>${state.locale === "ar" ? "أضف خدمة أو مشروع أو قطعة أو منصة برمجة حتى تجهز طلب واحد مرتب." : "Add a service, project, part or tuning platform to prepare one structured request."}</p><a class="btn" href="${routeUrl("/services")}" data-action="close-quote">${esc(ui.actions.viewAllServices)}${icons.arrow}</a></div>`;
    drawer.innerHTML = `<div class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="quote-title"><header class="drawer-head"><div><span class="eyebrow">${esc(ui.actions.requestQuote)}</span><h2 id="quote-title">${esc(ui.common.selectedItems)}${state.quote.length ? ` · ${quoteCount()}` : ""}</h2></div><button class="icon-btn" type="button" data-action="close-quote" aria-label="${esc(ui.actions.close)}">${icons.close}</button></header>${content}</div>`;
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
    const quantity = Math.min(99, Math.max(1, Number.parseInt(item.quantity, 10) || 1));
    const existing = state.quote.find(entry => entry.id === item.id);
    const normalizedItem = { ...item, sku: cleanText(item.sku || "", 120), quantity };
    if (existing) Object.assign(existing, normalizedItem, { quantity: Math.min(99, (Number(existing.quantity) || 1) + quantity) });
    else state.quote.push(normalizedItem);
    saveQuote();
    showToast(state.locale === "ar" ? "تمت الإضافة لطلب السعر" : "Added to quote request", item.title);
  }

  function addCart(productId, quantity = 1) {
    const product = commerceProduct(cleanText(productId || "", 180));
    const item = canonicalCartItem(product, quantity);
    if (!item) {
      showToast(commerceText().priceExpired, product ? localizedStoreProduct(product).title : "");
      return;
    }
    const identity = cartLineIdentity(item);
    const existing = state.cart.find(entry => cartLineIdentity(entry) === identity);
    if (!existing && state.cart.length >= MAX_CART_LINES) {
      showToast(commerceText().cartLimitReached, "");
      return;
    }
    if (existing) Object.assign(existing, item, { quantity: Math.min(99, Number(existing.quantity) + item.quantity) });
    else state.cart.push(item);
    saveCart();
    showToast(commerceText().addedToCart, localizedStoreProduct(product).title);
  }

  function addCatalogueCart(selectionKey, quantity = 1) {
    const selection = state.catalogueCartSelections.get(cleanText(selectionKey || "", 600));
    const item = normalizeSupplierCatalogueCartItem(selection, quantity);
    if (!item) {
      showToast(commerceText().priceExpired, "");
      return;
    }
    const identity = cartLineIdentity(item);
    const existing = state.cart.find(entry => cartLineIdentity(entry) === identity);
    if (!existing && state.cart.length >= MAX_CART_LINES) {
      showToast(commerceText().cartLimitReached, "");
      return;
    }
    if (existing) Object.assign(existing, item, { quantity: Math.min(99, Number(existing.quantity) + item.quantity) });
    else state.cart.push(item);
    saveCart();
    const option = item.optionTitle ? ` — ${item.optionTitle}` : "";
    showToast(commerceText().addedToCart, `${item.title}${option}`);
  }

  function randomCheckoutToken() {
    const bytes = new Uint8Array(24);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function checkoutToken() {
    const fingerprint = cartFingerprint();
    const saved = safeParse(storage.get(CHECKOUT_TOKEN_STORAGE_KEY), null);
    if (saved?.fingerprint === fingerprint && /^[a-f0-9]{48}$/.test(String(saved.token || ""))) return saved.token;
    const token = randomCheckoutToken();
    storage.set(CHECKOUT_TOKEN_STORAGE_KEY, JSON.stringify({ fingerprint, token }));
    return token;
  }

  async function submitStagingCheckout(form) {
    if (state.checkoutSubmitting || !form?.reportValidity()) return;
    const text = commerceText();
    const status = form.querySelector(".form-status");
    const submit = form.querySelector('button[type="submit"]');
    const fields = new FormData(form);
    const shippingRequest = checkoutShippingPayload(form);
    const payload = {
      idempotencyKey: checkoutToken(),
      locale: state.locale,
      page: location.href,
      startedAt: Number(fields.get("startedAt") || Date.now()),
      website: cleanText(fields.get("website"), 120),
      customer: {
        name: cleanText(fields.get("name"), 160),
        email: cleanText(fields.get("email"), 254),
        phone: cleanText(fields.get("phone"), 50)
      },
      destination: shippingRequest.destination,
      vehicle: {
        description: cleanText(fields.get("vehicle"), 300),
        vin: cleanText(fields.get("vin"), 24)
      },
      notes: cleanText(fields.get("notes"), 2000),
      acknowledgement: fields.get("acknowledgement") === "on",
      consent: fields.get("consent") === "on",
      items: state.cart.map(item => ({
        supplier: cleanText(item.supplier?.slug || "", 80).toLowerCase(),
        productId: item.productId,
        sourceHandle: cleanText(item.sourceHandle || "", 255) || null,
        sku: item.sku,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        currency: item.currency
      }))
    };
    state.checkoutSubmitting = true;
    submit.disabled = true;
    submit.classList.add("is-loading");
    status.className = "form-status";
    status.textContent = text.submitting;
    try {
      await requestShippingEstimate(form);
      const currentShipping = safeShippingPlan(state.shippingEstimate);
      payload.shipping = currentShipping ? {
        quoteId: currentShipping.quoteId || null,
        selections: shippingSelectionSnapshot(currentShipping),
        revalidated: shippingPlanHasCurrentRevalidation(currentShipping),
        paymentEligible: false
      } : null;
      const endpoint = new URL(STAGING_ORDER_ENDPOINT, location.origin).href;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": payload.idempotencyKey },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.accepted || !result.ref) {
        const error = new Error(result.error || "staging_order_failed");
        error.code = result.error || "staging_order_failed";
        throw error;
      }
      const receipt = {
        ref: cleanText(result.ref, 80),
        duplicate: Boolean(result.duplicate),
        simulated: result.simulated === true,
        notificationSent: result.notificationSent === true,
        totals: Array.isArray(result.totals) ? result.totals.slice(0, 8) : cartTotals(),
        shipping: safeShippingPlan(result.shipping),
        submittedAt: new Date().toISOString()
      };
      storage.set(LAST_ORDER_STORAGE_KEY, JSON.stringify(receipt));
      state.cart = [];
      state.shippingEstimate = null;
      state.shippingEstimateStatus = "idle";
      state.shippingEstimateError = "";
      storage.remove(CART_STORAGE_KEY);
      storage.remove(CHECKOUT_TOKEN_STORAGE_KEY);
      renderPage();
      showToast(receipt.simulated ? text.simulationTitle : text.successTitle, receipt.ref);
    } catch (error) {
      status.textContent = ["order_notifications_not_configured", "order_email_anti_abuse_not_configured"].includes(error?.code) ? text.deliveryUnavailable
        : error?.code === "invalid_or_stale_cart" ? text.invalidCart : text.submitError;
      status.className = "form-status is-error";
    } finally {
      state.checkoutSubmitting = false;
      if (document.body.contains(submit)) {
        submit.disabled = false;
        submit.classList.remove("is-loading");
      }
    }
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
    updateMediaImageSource(image, item, "100vw");
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
    if (form.dataset.formType === "General Quote" && state.quote.length) result.selectedItems = state.quote.map(item => {
      const sku = cleanText(item.sku || "", 120);
      return [
        `${item.kind}: ${item.title} × ${item.quantity || 1}`,
        sku ? `${U().common.sku}: ${sku}` : "",
        item.details
      ].filter(Boolean).join(" — ");
    });
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
    const labelsEn = { name: "Name", phone: "Phone / WhatsApp", email: "Email", country: "Country", city: "City", postcode: "Postcode", fulfilment: "Fulfilment", vin: "VIN", vehicle: "Vehicle", engine: "Engine", transmission: "Transmission", service: "Service", fuel: "Fuel", modifications: "Current modifications", intendedUse: "Intended use", target: "Target", faults: "Known faults", device: "Device / software", unlock: "Unlock status", message: "Project details", preferredContact: "Preferred contact", year: "Model year", model: "Model", tuneType: "Tune type", files: "Files to attach", context: "Context", platform: "Platform", selectedItems: "Selected items" };
    const labelsAr = { name: "الاسم", phone: "الهاتف / WhatsApp", email: "البريد", country: "الدولة", city: "المدينة", postcode: "الرمز البريدي", fulfilment: "طريقة الاستلام", vin: "VIN", vehicle: "السيارة", engine: "المحرك", transmission: "القير", service: "الخدمة", fuel: "الوقود", modifications: "التعديلات الحالية", intendedUse: "الاستخدام", target: "الهدف", faults: "الأعطال", device: "الجهاز / البرنامج", unlock: "حالة Unlock", message: "تفاصيل المشروع", preferredContact: "طريقة التواصل", year: "سنة الموديل", model: "الموديل", tuneType: "نوع البرمجة", files: "ملفات للإرفاق", context: "المرجع", platform: "المنصة", selectedItems: "العناصر المختارة" };
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
    let savedToAccount = false;
    try {
      const accountQuote = await saveWebsiteQuoteToAccount({ ref, type, fields });
      if (accountQuote?.accepted) {
        delivered = true;
        savedToAccount = true;
      }
    } catch {
      // If private account storage is unavailable, continue through the public fail-closed enquiry path.
    }
    if (!savedToAccount && ["api", "auto"].includes(CONFIG.formMode)) {
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
      status.textContent = savedToAccount
        ? `${state.locale === "ar" ? "تم حفظ طلب السعر في حسابك." : "Quote saved to your account."} ${U().forms.success.reference}: ${ref}`
        : `${U().forms.success.sent} ${U().forms.success.reference}: ${ref}`;
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
    const localHashLink = event.target.closest('a[href^="#"]');
    const localHash = localHashLink?.getAttribute("href") || "";
    if (/^#[A-Za-z][\w:.-]*$/.test(localHash)) {
      const section = document.getElementById(localHash.slice(1));
      if (section) {
        event.preventDefault();
        scrollElementIntoView(section);
        if (localHash === "#main-content") window.setTimeout(() => section.focus({ preventScroll: true }), motionDelay());
      }
      return;
    }
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle-review-markers") {
      const markersHidden = document.body.classList.toggle("review-markers-hidden");
      document.querySelectorAll('[data-action="toggle-review-markers"]').forEach(button => {
        button.setAttribute("aria-pressed", String(!markersHidden));
        const label = button.querySelector('[data-role="review-toggle-label"]');
        if (label) label.textContent = markersHidden ? button.dataset.showLabel : button.dataset.hideLabel;
      });
      return;
    }
    if (action === "toggle-menu") { setMobileOpen(!state.mobileOpen); return; }
    if (action === "close-menu") { setMobileOpen(false); return; }
    if (action === "toggle-theme") { applyTheme(currentTheme() === "dark" ? "light" : "dark"); renderHeader(); return; }
    if (action === "scroll-to") {
      scrollElementIntoView(document.getElementById(target.dataset.target || ""));
      return;
    }
    if (action === "account-mode") {
      const mode = target.dataset.accountMode === "sign-up" ? "sign-up" : "sign-in";
      document.querySelectorAll('[data-action="account-mode"]').forEach(button => {
        const active = button === target;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
      mountAccountPortal(mode);
      return;
    }
    if (action === "revalidate-shipping") {
      const form = document.querySelector("[data-staging-checkout]");
      if (form) requestShippingRevalidation(form);
      return;
    }
    if (action === "select-engine-family") {
      const select = document.querySelector('[data-role="engine-family"]');
      if (select) { select.value = target.dataset.engineFamily || select.value; updateEngineFamilyForm(select); }
      scrollElementIntoView(document.getElementById("engine-consultation"));
      window.setTimeout(() => select?.focus(), motionDelay());
      return;
    }
    if (action === "select-engine-service") {
      const select = document.querySelector('[data-role="engine-service"]');
      if (select) { select.value = target.dataset.engineService || select.value; updateEngineSelectionPhoto(select.closest("[data-engine-consultation]")); }
      scrollElementIntoView(document.getElementById("engine-consultation"));
      window.setTimeout(() => select?.focus(), motionDelay());
      return;
    }
    if (action === "select-engine-package") {
      const packageSelect = document.querySelector('[data-role="engine-package"]');
      const familySelect = document.querySelector('[data-role="engine-family"]');
      const serviceSelect = document.querySelector('[data-role="engine-service"]');
      if (packageSelect) packageSelect.value = target.dataset.enginePackage || packageSelect.value;
      if (familySelect && target.dataset.engineFamily) { familySelect.value = target.dataset.engineFamily; updateEngineFamilyForm(familySelect); }
      if (serviceSelect && target.dataset.engineService) serviceSelect.value = target.dataset.engineService;
      updateEngineSelectionPhoto(packageSelect?.closest("[data-engine-consultation]"));
      scrollElementIntoView(document.getElementById("engine-consultation"));
      window.setTimeout(() => packageSelect?.focus(), motionDelay());
      return;
    }
    if (action === "select-parts-brand") { selectPartsFilter("brand", target.dataset.partsBrand || ""); return; }
    if (action === "toggle-parts-directory-group") { togglePartsDirectoryGroup(target); return; }
    if (action === "search-tegiwa-directory") { searchTegiwaDirectory(target.dataset.tegiwaDirectoryQuery || "", target); return; }
    if (action === "clear-parts-filters") { clearPartsFilters(); return; }
    if (action === "tegiwa-suggestion") { chooseTegiwaSuggestion(target); return; }
    if (action === "toggle-tegiwa-filters") {
      hideTegiwaSuggestions();
      const panel = document.getElementById(target.getAttribute("aria-controls") || "tegiwa-filter-panel");
      const expanded = target.getAttribute("aria-expanded") === "true";
      target.setAttribute("aria-expanded", String(!expanded));
      if (panel) panel.hidden = expanded;
      return;
    }
    if (action === "tegiwa-clear-filters") { resetTegiwaFilters(); return; }
    if (action === "view-tegiwa-product") {
      const handle = tegiwaProductHandle(target.dataset.handle);
      if (!handle) return;
      if (target.matches("a") && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
      event.preventDefault();
      openTegiwaProduct(handle, target);
      return;
    }
    if (action === "tegiwa-next") {
      if (state.tegiwaCatalog.currentPage < state.tegiwaCatalog.totalPages) loadTegiwaCatalog({ page: state.tegiwaCatalog.currentPage + 1, scrollResults: true });
      return;
    }
    if (action === "tegiwa-previous") {
      if (state.tegiwaCatalog.currentPage > 1) loadTegiwaCatalog({ page: state.tegiwaCatalog.currentPage - 1, scrollResults: true });
      return;
    }
    if (action === "tegiwa-page") {
      const requestedPage = Number.parseInt(target.dataset.page, 10);
      if (Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= state.tegiwaCatalog.totalPages && requestedPage !== state.tegiwaCatalog.currentPage) loadTegiwaCatalog({ page: requestedPage, scrollResults: true });
      return;
    }
    if (action === "tegiwa-reset") {
      const search = document.querySelector('[data-tegiwa-search] input[name="q"]');
      if (search) search.value = "";
      resetTegiwaFilters({ reload: false });
      hideTegiwaSuggestions();
      clearTegiwaDirectorySelection();
      loadTegiwaCatalog({ query: "", match: partsVehicleLabel() ? "vehicle" : "any", page: 1, scrollResults: true });
      return;
    }
    if (action === "tegiwa-retry") { loadTegiwaCatalog(state.tegiwaCatalog.lastRequest); return; }
    if (action === "clear-parts-vehicle") {
      const resetLiveCatalogue = state.tegiwaCatalog.match === "vehicle";
      const activeQuery = state.tegiwaCatalog.query;
      state.partsVehicle = null;
      storage.remove("projxPartsVehicle");
      const vehicleForm = document.querySelector("[data-parts-vehicle-form]");
      vehicleForm?.reset();
      if (vehicleForm) {
        vehicleForm.elements.year.value = "";
        vehicleForm.elements.make.value = "";
        updatePartsVehicleCascades(vehicleForm, "make");
      }
      state.tegiwaCatalog.fitment = "all";
      renderPartsVehicleSummary();
      if (resetLiveCatalogue) {
        loadTegiwaCatalog({ query: activeQuery, match: "any", page: 1, scrollResults: true });
      }
      showToast(P().parts.finder.vehicleCleared);
      return;
    }
    if (action === "open-form") {
      const selectedVehicle = currentPath().startsWith("/parts") && partsVehicleLabel() ? `${P().parts.finder.selectedVehicle}: ${partsVehicleLabel()}` : "";
      const context = [target.dataset.context || "", selectedVehicle].filter(Boolean).join(" | ");
      openForm(target.dataset.formType || "General Enquiry", context);
      return;
    }
    if (action === "close-modal") { if (event.target === target || target.closest("button")) closeModal(); return; }
    if (action === "open-quote") { openQuote(); return; }
    if (action === "close-quote") { closeQuote(); return; }
    if (action === "add-cart") {
      const quantity = Number.parseInt(target.closest(".store-detail-buy")?.querySelector("[data-item-quantity]")?.value, 10) || 1;
      addCart(target.dataset.productId || "", quantity);
      return;
    }
    if (action === "add-catalogue-cart") {
      const quantity = Number.parseInt(target.closest(".store-detail-buy")?.querySelector("[data-item-quantity]")?.value, 10) || 1;
      const selectedOption = target.closest(".tegiwa-detail-modal")?.querySelector("[data-tegiwa-variant]:checked");
      const selectionKey = selectedOption
        ? selectedOption.dataset.catalogueCartKey
        : target.dataset.catalogueCartKey;
      addCatalogueCart(selectionKey || "", quantity);
      return;
    }
    if (action === "adjust-cart-quantity") {
      const item = state.cart.find(entry => entry.id === target.dataset.id);
      if (!item) return;
      item.quantity = Math.min(99, Math.max(1, Number(item.quantity) + (Number(target.dataset.delta) || 0)));
      saveCart();
      if (["/cart", "/checkout"].includes(currentPath())) renderPage();
      return;
    }
    if (action === "remove-cart") {
      state.cart = state.cart.filter(item => item.id !== target.dataset.id);
      saveCart();
      if (["/cart", "/checkout"].includes(currentPath())) renderPage();
      return;
    }
    if (action === "start-new-test-order") {
      storage.remove(LAST_ORDER_STORAGE_KEY);
      storage.remove(CHECKOUT_TOKEN_STORAGE_KEY);
      return;
    }
    if (action === "add-quote") {
      const selectedVehicle = currentPath().startsWith("/parts") && partsVehicleLabel() ? `${P().parts.finder.selectedVehicle}: ${partsVehicleLabel()}` : "";
      const quantity = Number.parseInt(target.closest(".store-detail-buy")?.querySelector("[data-item-quantity]")?.value, 10) || 1;
      addQuote({ id: target.dataset.id || `${target.dataset.kind}-${target.dataset.title}`.toLowerCase().replace(/\s+/g, "-"), kind: target.dataset.kind || "Enquiry", title: target.dataset.title || "Projx Racing", sku: target.dataset.sku || "", details: [target.dataset.details || "", selectedVehicle].filter(Boolean).join(" | "), quantity });
      return;
    }
    if (action === "adjust-quote-quantity") {
      const item = state.quote.find(entry => entry.id === target.dataset.id);
      if (!item) return;
      item.quantity = Math.min(99, Math.max(1, (Number(item.quantity) || 1) + (Number(target.dataset.delta) || 0)));
      saveQuote();
      renderQuoteDrawer();
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
    const checkoutForm = event.target.closest("[data-staging-checkout]");
    if (checkoutForm) {
      event.preventDefault();
      submitStagingCheckout(checkoutForm);
      return;
    }
    const tegiwaSearch = event.target.closest("[data-tegiwa-search]");
    if (tegiwaSearch) {
      event.preventDefault();
      if (!tegiwaSearch.reportValidity()) return;
      const query = cleanText(new FormData(tegiwaSearch).get("q"), 120);
      hideTegiwaSuggestions();
      clearTegiwaDirectorySelection();
      loadTegiwaCatalog({ query, match: partsVehicleLabel() ? "vehicle" : "any", page: 1 });
      return;
    }
    const vehicleForm = event.target.closest("[data-parts-vehicle-form]");
    if (vehicleForm) {
      event.preventDefault();
      savePartsVehicle(vehicleForm);
      return;
    }
    const form = event.target.closest("[data-enquiry-form]");
    if (!form) return;
    event.preventDefault();
    submitEnquiry(form);
  });

  document.addEventListener("change", event => {
    const shippingOption = event.target.closest("[data-shipping-option]");
    if (shippingOption && !shippingOption.disabled) {
      const plan = safeShippingPlan(state.shippingEstimate);
      const group = plan?.groups.find(item => shippingGroupKey(item) === shippingOption.dataset.shippingGroup);
      const option = group?.options.find(item => item.id === shippingOption.value);
      if (group && option && shippingOptionHasConfirmedQuote(option, group, plan)) {
        state.shippingSelections[shippingGroupKey(group)] = option.id;
        resetShippingRevalidation();
        refreshShipmentPlanner();
        const form = document.querySelector("[data-staging-checkout]");
        if (form && shippingDestinationReady(checkoutShippingPayload(form).destination)) requestShippingEstimate(form);
      }
      return;
    }
    const tegiwaFilter = event.target.closest("[data-tegiwa-filter]");
    if (tegiwaFilter) updateTegiwaFilter(tegiwaFilter);
    const tegiwaVariant = event.target.closest("[data-tegiwa-variant]");
    if (tegiwaVariant) updateTegiwaVariantSelection(tegiwaVariant);
    const partsVehicleField = event.target.closest("[data-parts-vehicle-field]");
    if (partsVehicleField) updatePartsVehicleCascades(partsVehicleField.form, partsVehicleField.name);
    const engineSelect = event.target.closest('[data-role="platform-engine"]');
    if (engineSelect) updatePlatformModels(engineSelect);
    const finderSelect = event.target.closest("[data-tuning-finder] select");
    if (finderSelect) updateTuningFinder(finderSelect.closest("[data-tuning-finder]"));
    const engineFamilySelect = event.target.closest('[data-role="engine-family"]');
    if (engineFamilySelect) updateEngineFamilyForm(engineFamilySelect);
    const engineFlowSelect = event.target.closest('[data-role="engine-service"], [data-role="engine-package"]');
    if (engineFlowSelect) updateEngineSelectionPhoto(engineFlowSelect.closest("[data-engine-consultation]"));
  });

  document.addEventListener("click", event => {
    const language = event.target.closest("[data-language]");
    if (language) storage.set("projxLanguage", language.dataset.language);
    if (event.target.closest(".mobile-nav-link")) state.mobileOpen = false;
    if (!event.target.closest("[data-tegiwa-search]")) hideTegiwaSuggestions();
  });

  document.addEventListener("keydown", event => {
    const accountTab = event.target.closest?.('[role="tab"][data-action="account-mode"]');
    if (accountTab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabs = [...document.querySelectorAll('.account-tabs [role="tab"][data-action="account-mode"]')];
      const currentIndex = tabs.indexOf(accountTab);
      if (currentIndex >= 0 && tabs.length) {
        let nextIndex;
        if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = tabs.length - 1;
        else {
          const visualStep = event.key === "ArrowRight" ? 1 : -1;
          const directionStep = isRtl() ? -visualStep : visualStep;
          nextIndex = (currentIndex + directionStep + tabs.length) % tabs.length;
        }
        event.preventDefault();
        tabs[nextIndex].focus();
        tabs[nextIndex].click();
        return;
      }
    }
    const tegiwaSearchInput = event.target.closest("[data-tegiwa-search-input]");
    if (tegiwaSearchInput && handleTegiwaSuggestionKeydown(event, tegiwaSearchInput)) return;
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

  window.addEventListener("popstate", () => {
    if (!PREVIEW_MODE) syncTegiwaProductFromUrl();
  });

  window.addEventListener("hashchange", () => {
    if (!PREVIEW_MODE) return;
    parsePreviewLocation();
    renderPage();
  });

  window.addEventListener("pageshow", () => {
    const stored = storage.get("projxTheme");
    if (stored) applyTheme(stored, false);
    syncTegiwaProductFromUrl();
  });

  document.documentElement.classList.add("js");
  applyTheme(currentTheme(), false);
  renderPage();

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !PREVIEW_MODE) {
    window.addEventListener("load", () => navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => {}), { once: true });
  }
})();
