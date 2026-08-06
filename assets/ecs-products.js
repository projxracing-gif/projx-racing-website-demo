(() => {
  "use strict";

  const runtime = typeof window === "undefined" ? globalThis : window;

  const common = Object.freeze({
    catalogType: "product",
    provider: "ECS Tuning",
    providerSlug: "ecs",
    dataOrigin: "manual-public-page-review",
    catalogueStatus: "reviewed-partial",
    quoteOnly: false,
    purchaseMode: "fitment-confirmation-required",
    priceCurrency: "USD",
    priceType: "supplier-public-retail",
    projxSellingPrice: null,
    priceIncludesShipping: false,
    priceVerifiedAt: "2026-08-04",
    priceNote: "ECS public USD price — manually checked 2026-08-04",
    priceNoteAr: "سعر ECS العام بالدولار الأمريكي — تمت المراجعة اليدوية في 2026-08-04",
    status: "Supplier stock — confirmation required",
    statusAr: "مخزون المورد — يتطلب التأكيد",
    checkedAt: "2026-08-04",
    staleAfterDays: 7,
    stockPolicy: "manual-confirm",
    availabilityCode: "check_availability",
    fitmentStatus: "supplier-title-confirm",
    fitmentConfidence: "possible"
  });

  const reviewed20260806 = Object.freeze({
    priceVerifiedAt: "2026-08-06",
    priceNote: "ECS public USD price — manually checked 2026-08-06; supplier confirmation required before sale",
    priceNoteAr: "سعر ECS العام بالدولار الأمريكي — تمت المراجعة اليدوية في 2026-08-06؛ يلزم تأكيد المورد قبل البيع",
    checkedAt: "2026-08-06",
    selectionEvidence: "ecs-vehicle-relevance-curation",
    selectionNote: "Curated from ECS vehicle-category relevance and editorial placement; ECS does not publish a sales rank or unit-sales count.",
    selectionNoteAr: "تم الاختيار من ترتيب الصلة والظهور التحريري في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة."
  });

  const products = [
    {
      ...common,
      slug: "high-performance-heat-exchanger-polished",
      title: "High Performance Heat Exchanger — Polished",
      titleAr: "مبادل حراري عالي الأداء — تشطيب مصقول",
      summary: "Polished CSF high-performance heat exchanger for BMW F-chassis B46, B48 and B58 applications. Exact vehicle fitment must be confirmed before quotation.",
      summaryAr: "مبادل حراري عالي الأداء بتشطيب مصقول من CSF لتطبيقات BMW فئة F بمحركات B46 وB48 وB58. يجب تأكيد توافق السيارة بدقة قبل عرض السعر.",
      brand: "CSF Cooling",
      category: "Cooling",
      categoryAr: "التبريد",
      subcategory: "Heat Exchanger",
      subcategoryAr: "مبادل حراري",
      sku: "ES#3987599",
      ecsPartNumber: "ES#3987599",
      mpn: "8131",
      priceAmount: 695,
      originalUrl: "https://www.ecstuning.com/b-csf-parts/high-performance-heat-exchanger/8131~csf/",
      observedAvailability: "In stock",
      observedAvailabilityAr: "متوفر",
      fitments: [
        { make: "BMW", model: "M240i / 340i / 440i", generation: "F-chassis — confirm exact chassis", engines: ["B46", "B48", "B58"] }
      ],
      images: [
        { src: "assets/products/ecs/high-performance-heat-exchanger-polished.jpg", width: 800, height: 600, alt: "Polished CSF high-performance heat exchanger", altAr: "مبادل حراري عالي الأداء من CSF بتشطيب مصقول" }
      ]
    },
    {
      ...common,
      slug: "gen1-b58-aluminum-radiator",
      title: "High-Performance Aluminum Radiator — Gen 1 B58",
      titleAr: "رديتر ألمنيوم عالي الأداء — B58 الجيل الأول",
      summary: "CSF all-aluminum performance radiator for BMW F-chassis models using the first-generation B58. Exact chassis and cooling configuration must be confirmed before quotation.",
      summaryAr: "رديتر أداء كامل من الألمنيوم من CSF لسيارات BMW فئة F بمحرك B58 الجيل الأول. يجب تأكيد الشاصي ونظام التبريد قبل عرض السعر.",
      brand: "CSF Cooling",
      category: "Cooling",
      categoryAr: "التبريد",
      subcategory: "Radiator",
      subcategoryAr: "رديتر",
      sku: "ES#4905994",
      ecsPartNumber: "ES#4905994",
      mpn: "7089",
      priceAmount: 649,
      originalUrl: "https://www.ecstuning.com/b-csf-parts/csf-bmw-f-chassis-gen-1-b58-high-performance-all-aluminum-radiator/7089~csf/",
      observedAvailability: "In stock",
      observedAvailabilityAr: "متوفر",
      fitments: [
        { make: "BMW", model: "Gen 1 B58 applications", generation: "F-chassis — confirm exact chassis", engines: ["B58 Gen 1"] }
      ],
      images: [
        { src: "assets/products/ecs/gen1-b58-aluminum-radiator.jpg", width: 800, height: 600, alt: "CSF aluminum radiator for first-generation BMW B58 applications", altAr: "رديتر ألمنيوم من CSF لتطبيقات BMW B58 الجيل الأول" }
      ]
    },
    {
      ...common,
      slug: "b46-b48-b58-front-mount-intercooler",
      title: "VRSF B48/B46/B58 Front Mount Intercooler Upgrade",
      titleAr: "ترقية إنتركولر أمامي VRSF لمحركات B46 وB48 وB58",
      summary: "VRSF front-mount intercooler upgrade for supported BMW B46, B48 and B58 applications. Exact chassis, engine and charge-pipe compatibility must be confirmed before quotation.",
      summaryAr: "ترقية إنتركولر أمامي من VRSF لتطبيقات BMW المدعومة بمحركات B46 وB48 وB58. يجب تأكيد الشاصي والمحرك وتوافق مواسير الشحن قبل عرض السعر.",
      brand: "VRSF",
      category: "Cooling",
      categoryAr: "التبريد",
      subcategory: "Front-Mount Intercooler",
      subcategoryAr: "إنتركولر أمامي",
      sku: "ES#4642591",
      ecsPartNumber: "ES#4642591",
      mpn: "VRSFFMI16",
      priceAmount: 449.99,
      originalUrl: "https://www.ecstuning.com/b-vrsf-parts/vrsf-b48-b46-b58-front-mount-intercooler-upgrade/vrsffmi16~vrf/",
      observedAvailability: "In stock — estimated dispatch today",
      observedAvailabilityAr: "متوفر — التقدير كان الإرسال في نفس اليوم",
      fitments: [
        { make: "BMW", model: "M240i / 340i / 440i / 740i / X3 / X4", generation: "Confirm exact chassis and model year", engines: ["B46", "B48", "B58"] }
      ],
      images: [
        { src: "assets/products/ecs/b46-b48-b58-front-mount-intercooler.jpg", width: 800, height: 600, alt: "VRSF front-mount intercooler for BMW B46 B48 and B58", altAr: "إنتركولر أمامي VRSF لمحركات BMW B46 وB48 وB58" }
      ]
    },
    {
      ...common,
      slug: "s55-pro-series-1000-turbo-build-kit",
      title: "S55 Pro-Series Turbo Build Kit — Level 2 (1000 HP)",
      titleAr: "طقم بناء تيربو Pro-Series لمحرك S55 — المستوى الثاني (1000 حصان)",
      summary: "5150 Autosport Level 2 forged engine-build package for high-output BMW S55 applications. Final specification, machining, supporting hardware and power target require technical review.",
      summaryAr: "باقة بناء محرك بمكونات داخلية مطروقة من 5150 Autosport لتطبيقات BMW S55 عالية القوة. تحتاج المواصفات النهائية والخراطة والقطع المساندة وهدف القوة إلى مراجعة فنية.",
      brand: "5150 Autosport",
      category: "Engine Build",
      categoryAr: "بناء المحرك",
      subcategory: "Forged Internals",
      subcategoryAr: "مكونات داخلية مطروقة",
      sku: "ES#4736753",
      ecsPartNumber: "ES#4736753",
      mpn: "PR01000S55",
      priceAmount: 6299.99,
      originalUrl: "https://www.ecstuning.com/b-5150-autosport-parts/5150-autosport-pro-series-1000-turbo-build-kit-bmw-s55/pro1000s55~51/",
      observedAvailability: "Ships from supplier — estimated 3 business days",
      observedAvailabilityAr: "يشحن من المورد — التقدير 3 أيام عمل",
      fitments: [
        { make: "BMW", model: "M3 / M4 / M2 Competition", generation: "F80 / F82 / F83 / F87", engines: ["S55"] }
      ],
      images: [
        { src: "assets/products/ecs/s55-pro-series-1000-turbo-build-kit.jpg", width: 800, height: 600, alt: "5150 Autosport S55 Pro-Series 1000 turbo engine build kit", altAr: "طقم بناء محرك وتيربو S55 Pro-Series 1000 من 5150 Autosport" }
      ]
    },
    {
      ...common,
      slug: "s58-charge-air-cooler-manifold-raw",
      title: "S58 Charge Air Cooler Manifold — Raw Finish",
      titleAr: "مشعب مبرد هواء الشحن لمحرك S58 — تشطيب خام",
      summary: "CSF charge-air cooler manifold with raw finish for supported BMW S58 applications. Exact chassis, engine hardware and installation requirements must be confirmed before quotation.",
      summaryAr: "مشعب مبرد هواء الشحن من CSF بتشطيب خام لتطبيقات BMW S58 المدعومة. يجب تأكيد الشاصي وقطع المحرك ومتطلبات التركيب قبل عرض السعر.",
      brand: "CSF Cooling",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Charge-Air Cooler Manifold",
      subcategoryAr: "مشعب مبرد هواء الشحن",
      sku: "ES#4657797",
      ecsPartNumber: "ES#4657797",
      mpn: "8233",
      priceAmount: 6599,
      originalUrl: "https://www.ecstuning.com/b-csf-parts/s58-charge-air-cooler-g80-g82-g83-m4-m4/8233~csf/",
      observedAvailability: "In stock — estimated 1 business day",
      observedAvailabilityAr: "متوفر — التقدير يوم عمل واحد",
      fitments: [
        { make: "BMW", model: "M3 / M4 / M2", generation: "G80 / G82 / G83 / G87", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/s58-charge-air-cooler-manifold-raw.jpg", width: 800, height: 600, alt: "Raw-finish CSF charge-air cooler manifold for BMW S58", altAr: "مشعب مبرد هواء الشحن من CSF بتشطيب خام لمحرك BMW S58" }
      ]
    },
    {
      ...common,
      slug: "audi-b85-supercharger-intercooler-kit",
      title: "Audi B8.5 S4/S5 Luft-Technik Performance Supercharger Intercooler Kit",
      titleAr: "طقم إنتركولر سوبرتشارجر Luft-Technik لأودي S4 وS5 B8.5",
      summary: "ECS Luft-Technik supercharger cooling package for supported Audi B8 and B8.5 3.0T applications. Exact model, cooling layout and installation scope must be confirmed before quotation.",
      summaryAr: "باقة تبريد سوبرتشارجر Luft-Technik من ECS لتطبيقات أودي B8 وB8.5 بمحرك 3.0T. يجب تأكيد الموديل ونظام التبريد ونطاق التركيب قبل عرض السعر.",
      brand: "ECS Tuning",
      category: "Cooling",
      categoryAr: "التبريد",
      subcategory: "Supercharger Intercooler Kit",
      subcategoryAr: "طقم تبريد السوبرتشارجر",
      sku: "ES#3569215",
      ecsPartNumber: "ES#3569215",
      mpn: "025496ECS01KT",
      priceAmount: 726.39,
      originalUrl: "https://www.ecstuning.com/b-ecs-parts/b85-s4-facelift-performance-supercharger-cooling-kit/025496ecs01kt/",
      observedAvailability: "In stock — estimated dispatch today",
      observedAvailabilityAr: "متوفر — التقدير كان الإرسال في نفس اليوم",
      fitments: [
        { make: "Audi", model: "S4 / S5", generation: "B8 / B8.5 — confirm exact model year", engines: ["3.0T supercharged"] }
      ],
      images: [
        { src: "assets/products/ecs/audi-b85-supercharger-intercooler-kit.jpg", width: 800, height: 600, alt: "ECS Luft-Technik supercharger intercooler kit for Audi B8.5 S4 and S5", altAr: "طقم إنتركولر سوبرتشارجر ECS Luft-Technik لأودي S4 وS5 B8.5" }
      ]
    },
    {
      ...common,
      slug: "racingline-stage2-evo-big-brake-kit-red",
      title: "RacingLine Stage 2 EVO Monoblock Big Brake Kit — Red, 345mm",
      titleAr: "طقم فرامل كبير RacingLine Stage 2 EVO Monoblock — أحمر، 345 مم",
      summary: "RacingLine 345mm Stage 2 EVO monoblock front brake package in red for supported MQB Audi and Volkswagen applications. Wheel clearance and exact fitment require confirmation.",
      summaryAr: "طقم فرامل أمامي RacingLine Stage 2 EVO Monoblock مقاس 345 مم باللون الأحمر لتطبيقات أودي وفولكس واجن MQB المدعومة. يجب تأكيد توافق الجنوط والتركيب بدقة.",
      brand: "RacingLine",
      category: "Braking",
      categoryAr: "الفرامل",
      subcategory: "Big Brake Kit",
      subcategoryAr: "طقم فرامل كبير",
      sku: "ES#4447343",
      ecsPartNumber: "ES#4447343",
      mpn: "VWR652000-RED",
      priceAmount: 2655,
      originalUrl: "https://www.ecstuning.com/b-racingline-parts/racingline-stage-2-evo-monoblock-performance-big-brake-kit-red/vwr652000-red~vw/",
      observedAvailability: "Ships from supplier — estimated 31 August 2026",
      observedAvailabilityAr: "يشحن من المورد — التقدير 31 أغسطس 2026",
      fitments: [
        { make: "Audi", model: "TTRS / A3 / S3", generation: "8S / 8V / 8Y — confirm exact application", engines: ["MQB applications — confirm engine"] },
        { make: "Volkswagen", model: "MQB applications", generation: "Confirm exact chassis and model year", engines: ["Confirm engine"] }
      ],
      images: [
        { src: "assets/products/ecs/racingline-stage2-evo-big-brake-kit-red.jpg", width: 800, height: 600, alt: "Red RacingLine Stage 2 EVO 345mm monoblock big brake kit", altAr: "طقم فرامل كبير RacingLine Stage 2 EVO Monoblock أحمر مقاس 345 مم" }
      ]
    },
    {
      ...common,
      slug: "mqb-adjustable-damping-coilover-system",
      title: "MK7/MK8/8V Adjustable Damping Coilover System",
      titleAr: "نظام كويل أوفر بتخميد قابل للتعديل لمنصات MK7 وMK8 و8V",
      summary: "ECS adjustable-damping coilover system for supported MQB Volkswagen MK7/MK8 and Audi 8V applications. Exact chassis, axle load and setup must be confirmed before quotation.",
      summaryAr: "نظام كويل أوفر من ECS بتخميد قابل للتعديل لتطبيقات فولكس واجن MK7 وMK8 وأودي 8V المدعومة. يجب تأكيد الشاصي وحمولة المحور والإعداد قبل عرض السعر.",
      brand: "ECS Tuning",
      category: "Suspension",
      categoryAr: "نظام التعليق",
      subcategory: "Coilovers",
      subcategoryAr: "كويل أوفر",
      sku: "ES#4045787",
      ecsPartNumber: "ES#4045787",
      mpn: "003929LB01",
      priceAmount: 779.99,
      originalUrl: "https://www.ecstuning.com/b-ecs-parts/mk7-mk8-8v-adjustable-damping-coilover-system/003929lb01~a/",
      observedAvailability: "In stock — estimated 1 business day",
      observedAvailabilityAr: "متوفر — التقدير يوم عمل واحد",
      fitments: [
        { make: "Audi", model: "A3 / S3", generation: "8V — confirm exact application", engines: ["Confirm engine"] },
        { make: "Volkswagen", model: "Golf / GTI / Golf R", generation: "MK7 / MK8 — confirm exact application", engines: ["Confirm engine"] }
      ],
      images: [
        { src: "assets/products/ecs/mqb-adjustable-damping-coilover-system.jpg", width: 800, height: 600, alt: "ECS adjustable damping coilover system for MQB MK7 MK8 and Audi 8V", altAr: "نظام كويل أوفر ECS بتخميد قابل للتعديل لمنصات MQB MK7 وMK8 وأودي 8V" }
      ]
    },
    {
      ...common,
      slug: "porsche-718-stage1-power-package-pdk",
      title: "Porsche 718 Stage 1 Power Package with PDK Flashing",
      titleAr: "باقة قوة Stage 1 لبورش 718 مع برمجة PDK",
      summary: "COBB Stage 1 ECU and PDK calibration hardware package for supported Porsche 718 Boxster and Cayman 2.0/2.5 turbo models. Vehicle, transmission and software compatibility require confirmation.",
      summaryAr: "باقة أجهزة برمجة ECU وPDK من COBB بمستوى Stage 1 لطرازات بورش 718 Boxster وCayman تيربو 2.0 و2.5 المدعومة. يجب تأكيد توافق السيارة والقير والبرنامج.",
      brand: "COBB Tuning",
      category: "Software",
      categoryAr: "البرمجة",
      subcategory: "ECU & TCU Tuning Hardware",
      subcategoryAr: "أجهزة برمجة ECU وTCU",
      sku: "ES#4141464",
      ecsPartNumber: "ES#4141464",
      mpn: "POR0100010-PDK",
      priceAmount: 2600,
      originalUrl: "https://www.ecstuning.com/b-cobbtuning-parts/718-cayman-cayman-s-boxster-boxster-s-stage-1-power-package-with-pdk-flashing/por0100010-pdk~c/",
      observedAvailability: "Ships from supplier — estimated 2 business days",
      observedAvailabilityAr: "يشحن من المورد — التقدير يومان عمل",
      fitments: [
        { make: "Porsche", model: "718 Boxster / Cayman", generation: "982 — 2017–2024 — PDK", engines: ["2.0 turbo", "2.5 turbo"] }
      ],
      images: [
        { src: "assets/products/ecs/porsche-718-stage1-power-package-pdk.jpg", width: 800, height: 600, alt: "COBB Stage 1 power package with PDK flashing for Porsche 718", altAr: "باقة قوة COBB Stage 1 مع برمجة PDK لبورش 718" }
      ]
    },
    {
      ...common,
      slug: "porsche-718-high-flow-catted-downpipe",
      title: "High-Flow Catted Downpipe — Porsche 718",
      titleAr: "داون بايب عالي التدفق مع دبة تلوث — بورش 718",
      summary: "Racing Dynamics high-flow catted downpipe for supported turbocharged Porsche 718 Boxster and Cayman applications. Exact model, engine, emissions requirements and fitment must be confirmed.",
      summaryAr: "داون بايب عالي التدفق مع دبة تلوث من Racing Dynamics لتطبيقات بورش 718 Boxster وCayman التيربو المدعومة. يجب تأكيد الموديل والمحرك ومتطلبات الانبعاثات والتركيب.",
      brand: "Racing Dynamics",
      category: "Exhaust",
      categoryAr: "العادم",
      subcategory: "High-Flow Catted Downpipe",
      subcategoryAr: "داون بايب عالي التدفق مع دبة تلوث",
      sku: "ES#4858335",
      ecsPartNumber: "ES#4858335",
      mpn: "987.10.00.750",
      priceAmount: 1395,
      originalUrl: "https://www.ecstuning.com/b-racing-dynamics-parts/high-flow-catted-downpipe-porsche-cayman-boxster-718-2016-2021/987.10.00.750~rd/",
      observedAvailability: "Ships from supplier — estimated 2 business days",
      observedAvailabilityAr: "يشحن من المورد — التقدير يومان عمل",
      fitments: [
        { make: "Porsche", model: "718 Boxster / Cayman", generation: "982 — 2017–2021", engines: ["2.0 turbo", "2.5 turbo"] }
      ],
      images: [
        { src: "assets/products/ecs/porsche-718-high-flow-catted-downpipe.jpg", width: 800, height: 600, alt: "Racing Dynamics high-flow catted downpipe for Porsche 718", altAr: "داون بايب عالي التدفق مع دبة تلوث من Racing Dynamics لبورش 718" }
      ]
    },
    {
      ...common,
      slug: "audi-b8-supercharger-heat-exchanger",
      title: "034Motorsport Supercharger Heat Exchanger Upgrade Kit",
      titleAr: "طقم ترقية مبادل حراري للسوبرتشارجر من 034Motorsport",
      summary: "034Motorsport supercharger heat-exchanger upgrade for supported Audi B8 and B8.5 S4/S5 3.0T applications. Exact model and cooling-system configuration must be confirmed.",
      summaryAr: "ترقية مبادل حراري للسوبرتشارجر من 034Motorsport لتطبيقات أودي S4 وS5 B8 وB8.5 بمحرك 3.0T. يجب تأكيد الموديل ونظام التبريد بدقة.",
      brand: "034Motorsport",
      category: "Cooling",
      categoryAr: "التبريد",
      subcategory: "Supercharger Heat Exchanger",
      subcategoryAr: "مبادل حراري للسوبرتشارجر",
      sku: "ES#3639608",
      ecsPartNumber: "ES#3639608",
      mpn: "034-102-1000",
      priceAmount: 1288,
      originalUrl: "https://www.ecstuning.com/b-034motorsport-parts/034motorsport-supercharger-heat-exchanger-upgrade-kit/034-102-1000~034/",
      observedAvailability: "Ships from supplier — estimated 2 business days",
      observedAvailabilityAr: "يشحن من المورد — التقدير يومان عمل",
      fitments: [
        { make: "Audi", model: "S4 / S5", generation: "B8 / B8.5 — confirm exact model year", engines: ["3.0T supercharged"] }
      ],
      images: [
        { src: "assets/products/ecs/audi-b8-supercharger-heat-exchanger.jpg", width: 800, height: 600, alt: "034Motorsport supercharger heat exchanger upgrade kit for Audi B8", altAr: "طقم ترقية مبادل حراري للسوبرتشارجر من 034Motorsport لأودي B8" }
      ]
    },
    {
      ...common,
      slug: "mercedes-c63s-c205-br-coilovers",
      title: "BR Series Coilover Suspension Kit — Mercedes-AMG C63 S Coupe",
      titleAr: "طقم كويل أوفر BR Series — مرسيدس-AMG C63 S كوبيه",
      summary: "BC Racing BR Series coilover kit for supported Mercedes-AMG C63 and C63 S W205/C205 applications. Exact body style, axle load and setup require confirmation.",
      summaryAr: "طقم كويل أوفر BC Racing BR Series لتطبيقات مرسيدس-AMG C63 وC63 S W205 وC205 المدعومة. يجب تأكيد نوع الهيكل وحمولة المحاور والإعداد.",
      brand: "BC Racing",
      category: "Suspension",
      categoryAr: "نظام التعليق",
      subcategory: "Coilovers",
      subcategoryAr: "كويل أوفر",
      sku: "ES#4872489",
      ecsPartNumber: "ES#4872489",
      mpn: "J-27",
      priceAmount: 1195,
      originalUrl: "https://www.ecstuning.com/b-bc-racing-parts/br-series-coilover-suspension-kit-2017-2021-mercedes-benz-c63-s-amg-coupe-c205-j-27-br/j-27~bcr/",
      observedAvailability: "Ships from supplier — estimated 5 business days",
      observedAvailabilityAr: "يشحن من المورد — التقدير 5 أيام عمل",
      fitments: [
        { make: "Mercedes-AMG", model: "C63 / C63 S", generation: "W205 / C205 — 2017–2021", engines: ["M177"] }
      ],
      images: [
        { src: "assets/products/ecs/mercedes-c63s-c205-br-coilovers.jpg", width: 800, height: 600, alt: "BC Racing BR Series coilovers for Mercedes-AMG C63 S C205", altAr: "طقم كويل أوفر BC Racing BR Series لمرسيدس-AMG C63 S C205" }
      ]
    },
    {
      ...common,
      slug: "m177-upgraded-intake-manifolds-w205",
      title: "Weistec M177 Upgraded Intake Manifolds — W205 C63 AMG",
      titleAr: "مشعبات سحب مطورة Weistec لمحرك M177 — W205 C63 AMG",
      summary: "Configuration-dependent Weistec upgraded intake-manifold package for supported W205-family Mercedes-AMG C63/C63 S M177 applications. USD 3,499 is the manually checked starting price; final configuration requires review.",
      summaryAr: "باقة مشعبات سحب مطورة من Weistec تعتمد على المواصفات لتطبيقات مرسيدس-AMG C63 وC63 S بمحرك M177 من عائلة W205. مبلغ 3,499 دولار هو السعر الابتدائي الذي تمت مراجعته يدوياً؛ يجب مراجعة المواصفات النهائية.",
      brand: "Weistec",
      category: "Engine",
      categoryAr: "المحرك",
      subcategory: "Intake Manifolds",
      subcategoryAr: "مشعبات سحب الهواء",
      sku: "ES#5375145",
      ecsPartNumber: "ES#5375145",
      mpn: "01-177-022XXX",
      priceAmount: 3499,
      priceStartingAt: true,
      originalUrl: "https://www.ecstuning.com/b-weistec-parts/weistec-m177-upgraded-intake-manifolds-w205-c63-amg/01-177-022xxx~dk/",
      observedAvailability: "Ships from supplier — estimated 1 business day",
      observedAvailabilityAr: "يشحن من المورد — التقدير يوم عمل واحد",
      fitments: [
        { make: "Mercedes-AMG", model: "C63 / C63 S", generation: "W205 / S205 / C205 / A205", engines: ["M177"] }
      ],
      images: [
        { src: "assets/products/ecs/m177-upgraded-intake-manifolds-w205.jpg", width: 800, height: 600, alt: "Weistec upgraded M177 intake manifolds for W205 Mercedes-AMG C63", altAr: "مشعبات سحب مطورة Weistec لمحرك M177 في مرسيدس-AMG C63 W205" }
      ]
    },
    {
      ...common,
      slug: "m177-gen2-cold-air-intake-e63-gt63",
      title: "Mercedes-AMG E63 / GT63 M177 Cold Air Intake System — Gen 2",
      titleAr: "نظام سحب هواء بارد M177 لمرسيدس-AMG E63 وGT63 — الجيل الثاني",
      summary: "BlackBoost Gen 2 cold-air intake system for supported Mercedes-AMG E63/E63 S and GT63/GT63 S M177 applications. Exact chassis and engine configuration must be confirmed.",
      summaryAr: "نظام سحب هواء بارد BlackBoost الجيل الثاني لتطبيقات مرسيدس-AMG E63 وE63 S وGT63 وGT63 S بمحرك M177. يجب تأكيد الشاصي ومواصفات المحرك بدقة.",
      brand: "BlackBoost",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Cold-Air Intake",
      subcategoryAr: "نظام سحب هواء بارد",
      sku: "ES#4814055",
      ecsPartNumber: "ES#4814055",
      mpn: "BBCAIS002",
      priceAmount: 1799,
      originalUrl: "https://www.ecstuning.com/b-blackboost-parts/mercedes-e63-amg-s-gt63-amg-m177-cold-air-intake-system-gen-2/bbcais002~blb/",
      observedAvailability: "Ships from supplier — estimated 6 business days",
      observedAvailabilityAr: "يشحن من المورد — التقدير 6 أيام عمل",
      fitments: [
        { make: "Mercedes-AMG", model: "E63 / E63 S", generation: "W213", engines: ["M177"] },
        { make: "Mercedes-AMG", model: "GT63 / GT63 S", generation: "X290", engines: ["M177"] }
      ],
      images: [
        { src: "assets/products/ecs/m177-gen2-cold-air-intake-e63-gt63.jpg", width: 800, height: 600, alt: "BlackBoost Gen 2 M177 cold-air intake for Mercedes-AMG E63 and GT63", altAr: "نظام سحب هواء بارد BlackBoost الجيل الثاني لمحرك M177 في مرسيدس-AMG E63 وGT63" }
      ]
    },
    {
      ...common,
      slug: "034motorsport-55mm-exhaust-clamp",
      title: "034Motorsport 55mm Exhaust Clamp",
      titleAr: "مشبك عادم 55 مم من 034Motorsport",
      summary: "OE-style stainless-steel clamp for 55 mm outside-diameter exhaust tubing. ECS lists it for supported Audi applications; confirm the exact vehicle and exhaust configuration before order.",
      summaryAr: "مشبك عادم من الستانلس ستيل بتصميم مماثل للوكالة لأنابيب عادم بقطر خارجي 55 مم. تعرضه ECS لتطبيقات أودي المدعومة؛ يجب تأكيد السيارة ومواصفات العادم قبل الطلب.",
      brand: "034Motorsport",
      category: "Exhaust",
      categoryAr: "العادم",
      subcategory: "Clamps & Hardware",
      subcategoryAr: "المشابك وملحقات التثبيت",
      sku: "ES#4877039",
      ecsPartNumber: "ES#4877039",
      mpn: "034-105-D300",
      priceAmount: 33,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD price — manually checked 2026-08-06",
      priceNoteAr: "سعر ECS العام بالدولار الأمريكي — تمت المراجعة اليدوية في 2026-08-06",
      checkedAt: "2026-08-06",
      originalUrl: "https://www.ecstuning.com/b-034motorsport-parts/55mm-exhaust-clamp/034-105-d300~034/",
      observedAvailability: "In stock — estimated to ship in 1 business day when checked",
      observedAvailabilityAr: "متوفر عند الفحص — تقدير الشحن خلال يوم عمل واحد",
      detailedDescriptionAvailable: true,
      specifications: [
        { label: "Construction", value: "Stainless steel", labelAr: "الخامة", valueAr: "ستانلس ستيل" },
        { label: "Tube outside diameter", value: "55 mm", labelAr: "القطر الخارجي للأنبوب", valueAr: "55 مم" },
        { label: "Design", value: "OE-style even-clamping sleeve", labelAr: "التصميم", valueAr: "غلاف تثبيت مماثل للوكالة يوزّع الضغط بالتساوي" }
      ],
      fitments: [
        { make: "Audi", model: "S4", generation: "B8 / B8.5 — 2010–2017", engines: ["3.0 TFSI Supercharged"] },
        { make: "Audi", model: "S4", generation: "B9 — 2018–2026", engines: ["3.0 TFSI"] }
      ],
      images: [
        { src: "assets/products/ecs/034motorsport-55mm-exhaust-clamp.jpg", width: 1200, height: 1200, alt: "034Motorsport 55 mm stainless-steel exhaust clamp", altAr: "مشبك عادم 55 مم من الستانلس ستيل من 034Motorsport" },
        { src: "assets/products/ecs/034motorsport-55mm-exhaust-clamp-2.jpg", width: 1200, height: 1200, alt: "Rear view of the 034Motorsport 55 mm exhaust clamp", altAr: "منظر خلفي لمشبك عادم 55 مم من 034Motorsport" },
        { src: "assets/products/ecs/034motorsport-55mm-exhaust-clamp-3.jpg", width: 1200, height: 1200, alt: "Top view of the 034Motorsport 55 mm exhaust clamp", altAr: "منظر علوي لمشبك عادم 55 مم من 034Motorsport" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "eventuri-g8x-carbon-intake-v2-gloss",
      title: "Eventuri G8X Carbon Intake System V2 — Gloss",
      titleAr: "نظام سحب كربون Eventuri G8X V2 — لامع",
      summary: "Sealed gloss-carbon intake system with filter housings, ducts and turbo inlets for supported G80 M3 and G82 M4 S58 applications. Confirm the exact model, drivetrain and hardware before order.",
      summaryAr: "نظام سحب مغلق من الكربون اللامع مع بيوت فلاتر وقنوات ومداخل تيربو لتطبيقات G80 M3 وG82 M4 بمحرك S58 المدعومة. يجب تأكيد الموديل ونظام الدفع والقطع قبل الطلب.",
      brand: "Eventuri",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Cold-Air Intake",
      subcategoryAr: "نظام سحب هواء بارد",
      sku: "ES#4716362",
      ecsPartNumber: "ES#4716362",
      mpn: "EVE-G8XMV2-CF-IN",
      priceAmount: 2995,
      originalUrl: "https://www.ecstuning.com/b-eventuri-parts/g8x-m2-m3-m4-black-carbon-intake-system-v2-gloss/eve-g8xmv2-cf-in/",
      observedAvailability: "In stock when checked — dispatch timing requires confirmation",
      observedAvailabilityAr: "متوفر عند الفحص — يلزم تأكيد موعد الإرسال",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/eventuri-g8x-carbon-intake-v2-gloss.jpg", width: 800, height: 600, alt: "Eventuri gloss-carbon G8X intake system for BMW G80 M3 and G82 M4", altAr: "نظام سحب Eventuri من الكربون اللامع لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "dinan-g8x-carbon-intake-gloss",
      title: "Dinan G8X Carbon Fiber Cold-Air Intake — Gloss",
      titleAr: "نظام سحب هواء بارد كربون Dinan G8X — لامع",
      summary: "Gloss 2x2 carbon-fiber intake with larger airboxes, tubes and filter area for supported G80 M3 and G82 M4 S58 models. Exact vehicle fitment must be confirmed before order.",
      summaryAr: "نظام سحب من ألياف الكربون اللامع بنسيج 2x2 مع بيوت هواء وأنابيب ومساحة فلتر أكبر لطرازات G80 M3 وG82 M4 بمحرك S58 المدعومة. يجب تأكيد توافق السيارة قبل الطلب.",
      brand: "Dinan",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Cold-Air Intake",
      subcategoryAr: "نظام سحب هواء بارد",
      sku: "ES#4642623",
      ecsPartNumber: "ES#4642623",
      mpn: "D760-0063",
      priceAmount: 1664.96,
      originalUrl: "https://www.ecstuning.com/b-dinan-parts/dinan-gloss-carbon-fiber-cold-air-intake/d760-0063~din/",
      observedAvailability: "In stock — estimated dispatch today when checked",
      observedAvailabilityAr: "متوفر — كان تقدير الإرسال في نفس اليوم عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/dinan-g8x-carbon-intake-gloss.jpg", width: 800, height: 600, alt: "Dinan gloss-carbon cold-air intake for BMW G80 M3 and G82 M4", altAr: "نظام سحب هواء بارد Dinan من الكربون اللامع لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "turner-g80-g82-carbon-cold-air-intake",
      title: "Turner G80/G82 Carbon Cold-Air Intake",
      titleAr: "نظام سحب هواء بارد كربون Turner لطرازات G80/G82",
      summary: "Carbon-fiber airboxes and intake tubes with turbo inlets and reusable filters for supported G80 M3 and G82 M4 S58 applications. Confirm the complete vehicle specification before order.",
      summaryAr: "بيوت هواء وأنابيب سحب من ألياف الكربون مع مداخل تيربو وفلاتر قابلة لإعادة الاستخدام لتطبيقات G80 M3 وG82 M4 بمحرك S58 المدعومة. يجب تأكيد مواصفات السيارة كاملة قبل الطلب.",
      brand: "Turner Motorsport",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Cold-Air Intake",
      subcategoryAr: "نظام سحب هواء بارد",
      sku: "ES#4642560",
      ecsPartNumber: "ES#4642560",
      mpn: "013859LA10",
      priceAmount: 1981.70,
      originalUrl: "https://www.ecstuning.com/b-turner-motorsport-parts/g80-g82-carbon-cold-air-intake/013859la10~a/",
      observedAvailability: "In stock — estimated dispatch today when checked",
      observedAvailabilityAr: "متوفر — كان تقدير الإرسال في نفس اليوم عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/turner-g80-g82-carbon-cold-air-intake.jpg", width: 800, height: 600, alt: "Turner carbon cold-air intake for BMW G80 M3 and G82 M4", altAr: "نظام سحب هواء بارد Turner من الكربون لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "mst-s58-g80-g82-cold-air-intake",
      title: "MST S58 Cold-Air Intake — G80/G82 M3/M4",
      titleAr: "نظام سحب هواء بارد MST لمحرك S58 — G80/G82 M3/M4",
      summary: "High-flow intake system with filters and heat shields for supported G80 M3 and G82 M4 S58 models. Vehicle, engine and installation compatibility require confirmation.",
      summaryAr: "نظام سحب عالي التدفق مع فلاتر وحواجز حرارية لطرازات G80 M3 وG82 M4 بمحرك S58 المدعومة. يلزم تأكيد توافق السيارة والمحرك والتركيب.",
      brand: "MST Performance",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Cold-Air Intake",
      subcategoryAr: "نظام سحب هواء بارد",
      sku: "ES#4465353",
      ecsPartNumber: "ES#4465353",
      mpn: "BW-S5801",
      priceAmount: 767.99,
      originalUrl: "https://www.ecstuning.com/b-mst-performance-parts/mst-cold-air-intake-system-s58-g80-g82-m3-m4/bw-s5801~mst/",
      observedAvailability: "Back ordered — no ETA when checked",
      observedAvailabilityAr: "طلب مؤجل — لا يوجد موعد متوقع عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/mst-s58-g80-g82-cold-air-intake.jpg", width: 800, height: 600, alt: "MST S58 cold-air intake for BMW G80 M3 and G82 M4", altAr: "نظام سحب هواء بارد MST لمحرك S58 في BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "turner-g80-g82-stainless-valved-catback",
      title: "Turner G80/G82 Stainless Valved Cat-Back Exhaust",
      titleAr: "عادم خلفي بصمامات من الستانلس Turner لطرازات G80/G82",
      summary: "Dual 3-inch T304 stainless-steel cat-back exhaust with an X-pipe and factory-controlled valves for supported G80 M3 and G82 M4 models. Final price depends on the selected configuration.",
      summaryAr: "نظام عادم خلفي مزدوج 3 إنش من ستانلس T304 مع وصلة X وصمامات تعمل بتحكم الوكالة لطرازات G80 M3 وG82 M4 المدعومة. يعتمد السعر النهائي على المواصفات المختارة.",
      brand: "Turner Motorsport",
      category: "Exhaust",
      categoryAr: "العادم",
      subcategory: "Cat-Back Exhaust",
      subcategoryAr: "نظام عادم خلفي",
      sku: "ES#4658164",
      ecsPartNumber: "ES#4658164",
      mpn: "008621LA01",
      priceAmount: 1137.49,
      priceStartingAt: true,
      originalUrl: "https://www.ecstuning.com/b-turner-motorsport-parts/g80-m3-g82-m4-stainless-valved-catback-exhaust/008621la01~dk/",
      observedAvailability: "Selected configuration in stock — estimated dispatch today when checked",
      observedAvailabilityAr: "المواصفات المختارة كانت متوفرة — كان تقدير الإرسال في نفس اليوم عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/turner-g80-g82-stainless-valved-catback.jpg", width: 800, height: 600, alt: "Turner stainless valved cat-back exhaust for BMW G80 M3 and G82 M4", altAr: "نظام عادم خلفي بصمامات من الستانلس Turner لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "kw-has-g80-g82-height-adjustable-springs",
      title: "KW H.A.S. Height-Adjustable Spring Kit — G80/G82",
      titleAr: "طقم يايات KW H.A.S. قابل لتعديل الارتفاع — G80/G82",
      summary: "Height-adjustable spring kit designed to retain compatible factory electronic dampers on supported G80 M3 and G82 M4 models. Confirm suspension specification and axle configuration.",
      summaryAr: "طقم يايات قابل لتعديل الارتفاع ومصمم للاحتفاظ بالمساعدات الإلكترونية الأصلية المتوافقة في طرازات G80 M3 وG82 M4 المدعومة. يجب تأكيد مواصفات التعليق والمحاور.",
      brand: "KW Suspension",
      category: "Suspension",
      categoryAr: "نظام التعليق",
      subcategory: "Height-Adjustable Springs",
      subcategoryAr: "يايات قابلة لتعديل الارتفاع",
      sku: "ES#4361903",
      ecsPartNumber: "ES#4361903",
      mpn: "253200EB",
      priceAmount: 1284,
      originalUrl: "https://www.ecstuning.com/b-kw-suspension-parts/kw-has-coilover-kit-bmw-m3-g80-m4-g82-2wd-xdrive-incl-comp/253200eb~kw/",
      observedAvailability: "Ships directly from supplier — estimated 5 business days when checked",
      observedAvailabilityAr: "يشحن مباشرة من المورد — كان التقدير 5 أيام عمل عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/kw-has-g80-g82-height-adjustable-springs.jpg", width: 800, height: 600, alt: "KW H.A.S. height-adjustable spring kit for BMW G80 M3 and G82 M4", altAr: "طقم يايات KW H.A.S. قابل لتعديل الارتفاع لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "cts-g82-m4-lowering-springs",
      title: "CTS Turbo Lowering Springs — G82 M4",
      titleAr: "يايات تخفيض CTS Turbo — G82 M4",
      summary: "DCC-compatible lowering springs with an advertised average 1.2-inch front and rear drop for supported G82 M4 and M4 Competition models. Confirm exact suspension specification.",
      summaryAr: "يايات تخفيض متوافقة مع DCC بانخفاض معلن بمتوسط 1.2 إنش أماماً وخلفاً لطرازات G82 M4 وM4 Competition المدعومة. يجب تأكيد مواصفات التعليق.",
      brand: "CTS Turbo",
      category: "Suspension",
      categoryAr: "نظام التعليق",
      subcategory: "Lowering Springs",
      subcategoryAr: "يايات تخفيض",
      sku: "ES#4726451",
      ecsPartNumber: "ES#4726451",
      mpn: "CTS-LS-015",
      priceAmount: 299.99,
      originalUrl: "https://www.ecstuning.com/b-cts-parts/cts-turbo-lowering-springs-g82-m4-m4c/cts-ls-015~hen/",
      observedAvailability: "Ships directly from supplier — estimated 7 business days when checked",
      observedAvailabilityAr: "يشحن مباشرة من المورد — كان التقدير 7 أيام عمل عند الفحص",
      fitments: [
        { make: "BMW", model: "M4 / M4 Competition", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/cts-g82-m4-lowering-springs.jpg", width: 800, height: 600, alt: "CTS Turbo lowering springs for BMW G82 M4", altAr: "يايات تخفيض CTS Turbo لسيارة BMW G82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "cts-g80-m3-lowering-springs",
      title: "CTS Turbo Lowering Springs — G80 M3",
      titleAr: "يايات تخفيض CTS Turbo — G80 M3",
      summary: "Lowering springs with advertised average drops of 1.4 inches front and 1.0 inch rear for supported G80 M3 and M3 Competition models. Confirm exact suspension specification.",
      summaryAr: "يايات تخفيض بانخفاض معلن بمتوسط 1.4 إنش أماماً و1.0 إنش خلفاً لطرازات G80 M3 وM3 Competition المدعومة. يجب تأكيد مواصفات التعليق.",
      brand: "CTS Turbo",
      category: "Suspension",
      categoryAr: "نظام التعليق",
      subcategory: "Lowering Springs",
      subcategoryAr: "يايات تخفيض",
      sku: "ES#4726444",
      ecsPartNumber: "ES#4726444",
      mpn: "CTS-LS-014",
      priceAmount: 254.99,
      originalUrl: "https://www.ecstuning.com/b-cts-parts/cts-turbo-lowering-springs-g80-m3-m3c/cts-ls-014~hen/",
      observedAvailability: "Ships directly from supplier — estimated 7 business days when checked",
      observedAvailabilityAr: "يشحن مباشرة من المورد — كان التقدير 7 أيام عمل عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition", generation: "G80 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/cts-g80-m3-lowering-springs.jpg", width: 800, height: 600, alt: "CTS Turbo lowering springs for BMW G80 M3", altAr: "يايات تخفيض CTS Turbo لسيارة BMW G80 M3" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "hr-g80-m3-super-sport-springs",
      title: "H&R Super Sport Springs — G80 M3",
      titleAr: "يايات H&R Super Sport — G80 M3",
      summary: "Super Sport lowering springs with advertised approximate drops of 1.4 inches front and 1.0 inch rear for supported G80 M3 and M3 Competition models. Not listed here for G82 or xDrive.",
      summaryAr: "يايات Super Sport بانخفاض معلن يقارب 1.4 إنش أماماً و1.0 إنش خلفاً لطرازات G80 M3 وM3 Competition المدعومة. غير مدرجة هنا لطراز G82 أو xDrive.",
      brand: "H&R",
      category: "Suspension",
      categoryAr: "نظام التعليق",
      subcategory: "Lowering Springs",
      subcategoryAr: "يايات تخفيض",
      sku: "ES#4430972",
      ecsPartNumber: "ES#4430972",
      mpn: "50496-77",
      priceAmount: 509.15,
      originalUrl: "https://www.ecstuning.com/b-h-and-r-parts/g80-hr-super-sport-springs/50496-77~hr/",
      observedAvailability: "In stock when checked — dispatch timing requires confirmation",
      observedAvailabilityAr: "متوفر عند الفحص — يلزم تأكيد موعد الإرسال",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition", generation: "G80 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/hr-g80-m3-super-sport-springs.jpg", width: 800, height: 600, alt: "H&R Super Sport lowering springs for BMW G80 M3", altAr: "يايات تخفيض H&R Super Sport لسيارة BMW G80 M3" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "turner-g80-g82-aluminum-skid-plate",
      title: "Turner Aluminum Skid Plate — G80/G82",
      titleAr: "صفيحة حماية ألمنيوم Turner — G80/G82",
      summary: "Milled-finish 1/8-inch 5052 aluminum skid plate designed to protect the exposed oil cooler and belly area on supported G80 M3 and G82 M4 models. Does not fit CS or CSL models.",
      summaryAr: "صفيحة حماية ألمنيوم 5052 بسماكة 1/8 إنش وتشطيب مشغول لحماية مبرد الزيت والمنطقة السفلية في طرازات G80 M3 وG82 M4 المدعومة. لا تناسب طرازات CS أو CSL.",
      brand: "Turner Motorsport",
      category: "Protection",
      categoryAr: "الحماية",
      subcategory: "Skid Plate",
      subcategoryAr: "صفيحة حماية سفلية",
      sku: "ES#4375774",
      ecsPartNumber: "ES#4375774",
      mpn: "008771LA01-01",
      priceAmount: 866.99,
      originalUrl: "https://www.ecstuning.com/b-turner-motorsport-parts/turner-motorsport-skid-plate-milled-finish-g80-g82-m3-m4/008771la01-01~a/",
      observedAvailability: "In stock — estimated dispatch today when checked",
      observedAvailabilityAr: "متوفر — كان تقدير الإرسال في نفس اليوم عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — excludes CS; confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — excludes CSL; confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/turner-g80-g82-aluminum-skid-plate.jpg", width: 800, height: 600, alt: "Turner aluminum skid plate for BMW G80 M3 and G82 M4", altAr: "صفيحة حماية ألمنيوم Turner لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "turner-g80-g82-carbon-fiber-front-lip",
      title: "Turner Carbon Fiber Front Lip — G80/G82",
      titleAr: "سبويلر أمامي كربون Turner — G80/G82",
      summary: "Gloss 2x2 twill carbon-fiber front lip using factory mounting locations for supported G80 M3 and G82 M4 models. Confirm bumper, trim and drivetrain compatibility before order.",
      summaryAr: "سبويلر أمامي من كربون لامع بنسيج 2x2 يستخدم نقاط التثبيت الأصلية لطرازات G80 M3 وG82 M4 المدعومة. يجب تأكيد توافق الصدام والفئة ونظام الدفع قبل الطلب.",
      brand: "Turner Motorsport",
      category: "Exterior",
      categoryAr: "الهيكل الخارجي",
      subcategory: "Front Lip",
      subcategoryAr: "سبويلر أمامي",
      sku: "ES#4642692",
      ecsPartNumber: "ES#4642692",
      mpn: "008686LA01KT",
      priceAmount: 893.34,
      originalUrl: "https://www.ecstuning.com/b-turner-motorsport-parts/g80-m3-carbon-fiber-front-lip/008686la01kt/",
      observedAvailability: "In stock when checked — dispatch timing requires confirmation",
      observedAvailabilityAr: "متوفر عند الفحص — يلزم تأكيد موعد الإرسال",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/turner-g80-g82-carbon-fiber-front-lip.jpg", width: 800, height: 600, alt: "Turner carbon-fiber front lip for BMW G80 M3 and G82 M4", altAr: "سبويلر أمامي من ألياف الكربون Turner لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "turner-g80-g82-carbon-fiber-strut-brace",
      title: "Turner Carbon Fiber Strut Brace — G80/G82",
      titleAr: "دعامة أبراج كربون Turner — G80/G82",
      summary: "Structural carbon-fiber front strut brace with billet 6061-T6 aluminum ends for supported G80 M3 and G82 M4 models. Confirm exact under-hood and model compatibility.",
      summaryAr: "دعامة أبراج أمامية إنشائية من ألياف الكربون مع أطراف ألمنيوم 6061-T6 مشغولة لطرازات G80 M3 وG82 M4 المدعومة. يجب تأكيد توافق الموديل ومساحة حجرة المحرك.",
      brand: "Turner Motorsport",
      category: "Chassis",
      categoryAr: "الشاصي",
      subcategory: "Strut Brace",
      subcategoryAr: "دعامة أبراج",
      sku: "ES#4391015",
      ecsPartNumber: "ES#4391015",
      mpn: "013800LA01",
      priceAmount: 1138.99,
      originalUrl: "https://www.ecstuning.com/b-turner-motorsport-parts/turner-motorsport-carbon-fiber-strut-brace-g80-g82-m3-m4-s58/013800la01~a/",
      observedAvailability: "In stock — estimated dispatch today when checked",
      observedAvailabilityAr: "متوفر — كان تقدير الإرسال في نفس اليوم عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/turner-g80-g82-carbon-fiber-strut-brace.jpg", width: 800, height: 600, alt: "Turner carbon-fiber strut brace for BMW G80 M3 and G82 M4", altAr: "دعامة أبراج Turner من ألياف الكربون لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "csf-g80-g82-automatic-transmission-oil-cooler",
      title: "CSF Automatic Transmission Oil Cooler — G80/G82",
      titleAr: "مبرد زيت ناقل الحركة الأوتوماتيكي CSF — G80/G82",
      summary: "Drop-in automatic-transmission oil cooler with a dual-core design and increased fluid capacity for supported G80 M3 and G82 M4 automatic models. Not listed here for manual-transmission vehicles.",
      summaryAr: "مبرد زيت لناقل الحركة الأوتوماتيكي بتركيب مباشر وتصميم ثنائي النواة وسعة زيت أكبر لطرازات G80 M3 وG82 M4 الأوتوماتيكية المدعومة. غير مدرج هنا للسيارات اليدوية.",
      brand: "CSF Cooling",
      category: "Cooling",
      categoryAr: "التبريد",
      subcategory: "Transmission Oil Cooler",
      subcategoryAr: "مبرد زيت ناقل الحركة",
      sku: "ES#4642935",
      ecsPartNumber: "ES#4642935",
      mpn: "8221",
      priceAmount: 599,
      originalUrl: "https://www.ecstuning.com/b-csf-parts/high-performance-automatic-transmission-oil-cooler-g80-g82-g83-m3-m4/8221~csf/",
      observedAvailability: "In stock — estimated 1 business day when checked",
      observedAvailabilityAr: "متوفر — كان التقدير يوم عمل واحد عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — automatic transmission only; confirm exact model year", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — automatic transmission only; confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/csf-g80-g82-automatic-transmission-oil-cooler.jpg", width: 800, height: 600, alt: "CSF automatic-transmission oil cooler for BMW G80 M3 and G82 M4", altAr: "مبرد زيت ناقل الحركة الأوتوماتيكي CSF لسيارات BMW G80 M3 وG82 M4" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "dinan-s58-performance-ignition-coils-red",
      title: "Dinan S58 Performance Ignition Coils — Red, Set of Six",
      titleAr: "كويلات إشعال Dinan Performance لمحرك S58 — حمراء، طقم 6",
      summary: "Plug-and-play set of six red Dinan performance ignition coils for supported BMW S58 applications, including possible G80 M3 and G82 M4 fitment. Confirm by VIN before order.",
      summaryAr: "طقم من 6 كويلات إشعال Dinan Performance حمراء بتركيب مباشر لتطبيقات BMW S58 المدعومة، مع توافق محتمل لطرازات G80 M3 وG82 M4. يجب التأكيد برقم الهيكل قبل الطلب.",
      brand: "Dinan",
      category: "Ignition",
      categoryAr: "نظام الإشعال",
      subcategory: "Ignition Coils",
      subcategoryAr: "كويلات إشعال",
      sku: "ES#4773018",
      ecsPartNumber: "ES#4773018",
      mpn: "D650-0009KT2",
      priceAmount: 233.99,
      originalUrl: "https://www.ecstuning.com/b-dinan-parts/b-series-performance-ignition-coil-red-set-of-six/d650-0009kt2/",
      observedAvailability: "In stock — estimated dispatch today when checked",
      observedAvailabilityAr: "متوفر — كان تقدير الإرسال في نفس اليوم عند الفحص",
      fitments: [
        { make: "BMW", model: "M3", generation: "G80 — VIN confirmation required", engines: ["S58"] },
        { make: "BMW", model: "M4", generation: "G82 — VIN confirmation required", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/dinan-s58-performance-ignition-coils-red.jpg", width: 800, height: 600, alt: "Set of six red Dinan performance ignition coils for BMW S58", altAr: "طقم 6 كويلات إشعال Dinan Performance حمراء لمحرك BMW S58" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "ecs-g80-g82-12-5mm-spacer-bolt-kit",
      title: "ECS 12.5mm Wheel Spacer and Extended Bolt Kit",
      titleAr: "طقم سبيسر جنوط ECS مقاس 12.5 مم مع مسامير طويلة",
      summary: "Pair of 12.5 mm wheel spacers with 14x1.25x40 mm conical-seat extended bolts for supported BMW 5x112 applications, including possible G80 M3 and G82 M4 fitment. Confirm wheel and brake clearance.",
      summaryAr: "زوج سبيسر جنوط 12.5 مم مع مسامير طويلة مخروطية المقعد 14x1.25x40 مم لتطبيقات BMW 5x112 المدعومة، مع توافق محتمل لطرازات G80 M3 وG82 M4. يجب تأكيد خلوص الجنوط والفرامل.",
      brand: "ECS Tuning",
      category: "Wheels & Tires",
      categoryAr: "الجنوط والإطارات",
      subcategory: "Wheel Spacers",
      subcategoryAr: "سبيسرات الجنوط",
      sku: "ES#3006162",
      ecsPartNumber: "ES#3006162",
      mpn: "002411ECSKT18",
      priceAmount: 153.70,
      originalUrl: "https://www.ecstuning.com/b-ecs-parts/ecs-125mm-wheel-spacer-ecs-conical-seat-bolt-kit/002411ecskt18/",
      observedAvailability: "In stock — estimated dispatch today when checked",
      observedAvailabilityAr: "متوفر — كان تقدير الإرسال في نفس اليوم عند الفحص",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm wheel and brake clearance", engines: ["S58"] },
        { make: "BMW", model: "M4 / M4 Competition / M4 Competition xDrive", generation: "G82 — confirm wheel and brake clearance", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/ecs-g80-g82-12-5mm-spacer-bolt-kit.jpg", width: 800, height: 600, alt: "ECS 12.5 mm wheel spacers and extended bolt kit for BMW G80 and G82", altAr: "طقم سبيسرات جنوط ECS مقاس 12.5 مم ومسامير طويلة لسيارات BMW G80 وG82" }
      ]
    },
    {
      ...common,
      ...reviewed20260806,
      slug: "g80-carbon-front-lip-high-kick-spoiler-bundle",
      title: "G80 M3 Carbon Front Lip and High-Kick Spoiler Bundle",
      titleAr: "طقم سبويلر أمامي وجناح High-Kick كربون لطراز G80 M3",
      summary: "Gloss 2x2 twill carbon-fiber front lip and high-kick trunk spoiler bundle for supported G80 M3, M3 Competition and M3 Competition xDrive models. Not listed here for G82.",
      summaryAr: "طقم سبويلر أمامي وجناح شنطة High-Kick من كربون لامع بنسيج 2x2 لطرازات G80 M3 وM3 Competition وM3 Competition xDrive المدعومة. غير مدرج هنا لطراز G82.",
      brand: "Enthusiast Bundles",
      category: "Exterior",
      categoryAr: "الهيكل الخارجي",
      subcategory: "Aero Bundle",
      subcategoryAr: "طقم إيروديناميكي",
      sku: "ES#4751482",
      ecsPartNumber: "ES#4751482",
      mpn: "008686LA01EBKT",
      priceAmount: 1399,
      originalUrl: "https://www.ecstuning.com/b-enthusiast-bundles-parts/g80-m3-carbon-front-lip-carbon-high-kick-trunk-spoiler/008686la01ebkt/",
      observedAvailability: "In stock when checked — dispatch timing requires confirmation",
      observedAvailabilityAr: "متوفر عند الفحص — يلزم تأكيد موعد الإرسال",
      fitments: [
        { make: "BMW", model: "M3 / M3 Competition / M3 Competition xDrive", generation: "G80 — confirm exact model year", engines: ["S58"] }
      ],
      images: [
        { src: "assets/products/ecs/g80-carbon-front-lip-high-kick-spoiler-bundle.jpg", width: 800, height: 600, alt: "Carbon front lip and high-kick trunk spoiler bundle for BMW G80 M3", altAr: "طقم سبويلر أمامي وجناح شنطة High-Kick من الكربون لسيارة BMW G80 M3" }
      ]
    }
,
    {
      ...common,
      slug: "f8x-s55-luft-technik-intake",
      title: "F8X S55 Luft-Technik Performance Intake System",
      titleAr: "نظام سحب هواء عالي الأداء Luft-Technik لمحرك S55 في F8X",
      summary: "ECS Luft-Technik intake system with aluminum inlet tubes, sealed heat shields and dual reusable cotton-gauze filters. ECS states that it retains factory MAF scaling and air-fuel ratios; exact vehicle fitment must be confirmed before order.",
      summaryAr: "نظام سحب هواء ECS Luft-Technik مع أنابيب ألمنيوم وحواجز حرارية محكمة وفلاتر قطنية مزدوجة قابلة لإعادة الاستخدام. تذكر ECS أنه يحافظ على معايرة حساس MAF ونسب الهواء والوقود الأصلية؛ يجب تأكيد توافق السيارة بدقة قبل الطلب.",
      brand: "ECS Tuning",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Cold-Air Intake",
      subcategoryAr: "نظام سحب هواء بارد",
      sku: "ES#4877104",
      ecsPartNumber: "ES#4877104",
      mpn: "055023LA02",
      priceAmount: 442.79,
      originalPriceAmount: 491.99,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD sale price $442.79 (previously $491.99) — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر التخفيض العام لدى ECS هو 442.79 دولاراً أمريكياً (بدلاً من 491.99 دولاراً) — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as In Stock with an estimated ship date in 3 business days on 2026-08-06; supplier confirmation is required before order.",
      stockNoteAr: "ظهر لدى المورد كمتوفر مع تقدير للشحن خلال 3 أيام عمل بتاريخ 2026-08-06؛ يجب تأكيد التوفر قبل الطلب.",
      observedAvailability: "In stock — estimated ship date in 3 business days when checked",
      observedAvailabilityAr: "متوفر عند الفحص — تقدير الشحن خلال 3 أيام عمل",
      originalUrl: "https://www.ecstuning.com/b-ecs-parts/s55-luft-technik-performance-intake-system/055023la02~a/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80", engines: ["S55"], confidence: "possible", evidence: "ecs-vehicle-page-and-product-application" },
        { make: "BMW", model: "M4", generation: "F82", engines: ["S55"], confidence: "possible", evidence: "ecs-vehicle-page-and-product-application" }
      ],
      images: [
        { src: "assets/products/ecs/f8x-s55-luft-technik-intake.jpg", width: 800, height: 600, alt: "ECS Luft-Technik performance intake system for BMW F80 M3 and F82 M4 S55", altAr: "نظام سحب هواء ECS Luft-Technik لمحرك S55 في BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "vrsf-s55-charge-pipe-kit",
      title: "VRSF S55 Charge Pipe Upgrade Kit",
      titleAr: "طقم ترقية مواسير الشحن VRSF لمحرك S55",
      summary: "Black powder-coated aluminum VRSF charge-pipe kit with billet CNC flanges and two plugged water-methanol bungs. O-rings are not included; exact vehicle and supporting-hardware fitment must be confirmed before order.",
      summaryAr: "طقم مواسير شحن VRSF من الألمنيوم المطلي بالأسود مع فلنجات مصنّعة بتقنية CNC وفتحتين مسدودتين لحقن الماء والميثانول. حلقات O-ring غير مشمولة؛ يجب تأكيد توافق السيارة والقطع المساندة قبل الطلب.",
      brand: "VRSF",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Charge Pipes",
      subcategoryAr: "مواسير الشحن",
      sku: "ES#3984876",
      ecsPartNumber: "ES#3984876",
      mpn: "10801050",
      priceAmount: 299.99,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD price $299.99 — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر ECS العام هو 299.99 دولاراً أمريكياً — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as In Stock with an estimated ship date of Today on 2026-08-06; supplier confirmation is required before order.",
      stockNoteAr: "ظهر لدى المورد كمتوفر مع تقدير للشحن في اليوم نفسه بتاريخ 2026-08-06؛ يجب تأكيد التوفر قبل الطلب.",
      observedAvailability: "In stock — estimated to ship today when checked",
      observedAvailabilityAr: "متوفر عند الفحص — كان تقدير الشحن في اليوم نفسه",
      originalUrl: "https://www.ecstuning.com/b-vrsf-parts/vrsf-charge-pipe-upgrade-kit-2015-2019-bmw-m3-m4-m2-competition-f80-f82-f87-s55/10801050~vrf/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80 — 2015–2019", engines: ["S55"], confidence: "possible", evidence: "ecs-product-title-year-range" },
        { make: "BMW", model: "M4", generation: "F82 — 2015–2019", engines: ["S55"], confidence: "possible", evidence: "ecs-product-title-year-range" }
      ],
      images: [
        { src: "assets/products/ecs/vrsf-s55-charge-pipe-kit.jpg", width: 800, height: 600, alt: "VRSF charge pipe upgrade kit for BMW F80 M3 and F82 M4 S55", altAr: "طقم ترقية مواسير الشحن VRSF لمحرك S55 في BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "f8x-dct-transmission-service-kit",
      title: "F8X Ultimate DCT Transmission Service Kit",
      titleAr: "طقم صيانة شامل لناقل الحركة DCT في BMW F8X",
      summary: "ECS-assembled DCT service kit containing seven litres of Pentosin DCTF-1, cartridge and suction filters, drain and fill plugs, and an oil pan with gasket. ECS recommends a 40,000-mile service interval; transmission specification and fitment require confirmation.",
      summaryAr: "طقم صيانة DCT مجمّع من ECS يضم سبعة لترات من زيت Pentosin DCTF-1 وفلتر خرطوشة وفلتر سحب وسدادات تصريف وتعبئة وحوض زيت مع جلدة. توصي ECS بالصيانة كل 40,000 ميل؛ يجب تأكيد مواصفات ناقل الحركة والتوافق قبل الطلب.",
      brand: "Assembled by ECS",
      category: "Drivetrain",
      categoryAr: "نظام نقل الحركة",
      subcategory: "Transmission Service Kit",
      subcategoryAr: "طقم صيانة ناقل الحركة",
      sku: "ES#4213325",
      ecsPartNumber: "ES#4213325",
      mpn: "F8XDCTSKKT3",
      priceAmount: 771.02,
      originalPriceAmount: 851.99,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD sale price $771.02 (previously $851.99) — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر التخفيض العام لدى ECS هو 771.02 دولاراً أمريكياً (بدلاً من 851.99 دولاراً) — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as On Order with an estimated ship date in 3 business days on 2026-08-06; supplier confirmation is required before order.",
      stockNoteAr: "ظهر لدى المورد بحالة «قيد الطلب» مع تقدير للشحن خلال 3 أيام عمل بتاريخ 2026-08-06؛ يجب تأكيد التوفر قبل الطلب.",
      observedAvailability: "On order — estimated ship date in 3 business days when checked",
      observedAvailabilityAr: "قيد الطلب عند الفحص — تقدير الشحن خلال 3 أيام عمل",
      originalUrl: "https://www.ecstuning.com/b-assembled-by-ecs-parts/dct-transmission-service-kit/f8xdctskkt3/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80", engines: ["S55"], confidence: "possible", evidence: "ecs-vehicle-page-and-product-application" },
        { make: "BMW", model: "M4", generation: "F82", engines: ["S55"], confidence: "possible", evidence: "ecs-vehicle-page-and-product-application" }
      ],
      images: [
        { src: "assets/products/ecs/f8x-dct-transmission-service-kit.jpg", width: 800, height: 600, alt: "ECS DCT transmission service kit for BMW F80 M3 and F82 M4", altAr: "طقم صيانة ناقل الحركة DCT من ECS لسيارات BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "mad-s55-catted-downpipes",
      title: "MAD S55 Catted Downpipes with Flex Sections",
      titleAr: "داون بايب MAD مع دبات تلوث ووصلات مرنة لمحرك S55",
      summary: "MAD S55 downpipes with 200-cell Euro 5 catalysts and flex sections for supported left- and right-hand-drive applications. Emissions legality, engine calibration, installation requirements and exact vehicle fitment must be confirmed before order.",
      summaryAr: "داون بايب MAD لمحرك S55 مع دبات تلوث Euro 5 بكثافة 200 خلية ووصلات مرنة، للتطبيقات المدعومة ذات المقود الأيسر أو الأيمن. يجب تأكيد قانونية الانبعاثات وبرمجة المحرك ومتطلبات التركيب والتوافق الدقيق قبل الطلب.",
      brand: "MAD",
      category: "Exhaust",
      categoryAr: "العادم",
      subcategory: "Catted Downpipes",
      subcategoryAr: "داون بايب مع دبات تلوث",
      sku: "ES#4630139",
      ecsPartNumber: "ES#4630139",
      mpn: "MAD-2050",
      priceAmount: 569,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD price $569.00 — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر ECS العام هو 569.00 دولاراً أمريكياً — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as Available from Supplier with an estimated ship time of 6 business days on 2026-08-06; supplier confirmation is required before order.",
      stockNoteAr: "ظهر كمتوفر من المورد مع تقدير للشحن خلال 6 أيام عمل بتاريخ 2026-08-06؛ يجب تأكيد التوفر قبل الطلب.",
      observedAvailability: "Available from supplier — estimated to ship in 6 business days when checked",
      observedAvailabilityAr: "متوفر من المورد عند الفحص — تقدير الشحن خلال 6 أيام عمل",
      originalUrl: "https://www.ecstuning.com/b-mad-parts/mad-s55-catted-downpipes-m2c-m3-m4-with-flex-section/mad-2050~aad/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80", engines: ["S55"], confidence: "possible", evidence: "ecs-vehicle-page-and-product-application" },
        { make: "BMW", model: "M4", generation: "F82", engines: ["S55"], confidence: "possible", evidence: "ecs-vehicle-page-and-product-application" }
      ],
      images: [
        { src: "assets/products/ecs/mad-s55-catted-downpipes.jpg", width: 800, height: 600, alt: "MAD catted downpipes with flex sections for BMW F80 M3 and F82 M4 S55", altAr: "داون بايب MAD مع دبات تلوث ووصلات مرنة لمحرك S55 في BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "turner-s55-crank-seal-guard",
      title: "Turner S55 Crank Seal Guard",
      titleAr: "واقي صوفة عمود الكرنك Turner لمحرك S55",
      summary: "Turner Motorsport 6061 billet-aluminum guard installed behind the harmonic balancer to reduce the risk of accessory-belt debris entering the front crank seal. Exact engine and installation fitment must be confirmed before order.",
      summaryAr: "واقي Turner Motorsport مصنوع من ألمنيوم 6061 ومثبت خلف بكرة الكرنك لتقليل خطر دخول بقايا سير الملحقات إلى صوفة عمود الكرنك الأمامية. يجب تأكيد المحرك ومتطلبات التركيب والتوافق قبل الطلب.",
      brand: "Turner Motorsport",
      category: "Engine",
      categoryAr: "المحرك",
      subcategory: "Crank Seal Protection",
      subcategoryAr: "حماية صوفة عمود الكرنك",
      sku: "ES#4674312",
      ecsPartNumber: "ES#4674312",
      mpn: "049453LA01-02",
      priceAmount: 99.99,
      originalPriceAmount: 132.99,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD sale price $99.99 (previously $132.99) — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر التخفيض العام لدى ECS هو 99.99 دولاراً أمريكياً (بدلاً من 132.99 دولاراً) — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as In Stock with an estimated ship date of Today on 2026-08-06; supplier confirmation is required before order.",
      stockNoteAr: "ظهر لدى المورد كمتوفر مع تقدير للشحن في اليوم نفسه بتاريخ 2026-08-06؛ يجب تأكيد التوفر قبل الطلب.",
      observedAvailability: "In stock — estimated to ship today when checked",
      observedAvailabilityAr: "متوفر عند الفحص — كان تقدير الشحن في اليوم نفسه",
      originalUrl: "https://www.ecstuning.com/b-turner-motorsport-parts/n52-n54-n55-s55-crank-seal-guard/049453la01-02~a/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80", engines: ["S55"], confidence: "possible", evidence: "ecs-engine-application-and-vehicle-curation" },
        { make: "BMW", model: "M4", generation: "F82", engines: ["S55"], confidence: "possible", evidence: "ecs-engine-application-and-vehicle-curation" }
      ],
      images: [
        { src: "assets/products/ecs/turner-s55-crank-seal-guard.jpg", width: 800, height: 600, alt: "Turner Motorsport crank seal guard for BMW F80 M3 and F82 M4 S55", altAr: "واقي صوفة عمود الكرنك Turner Motorsport لمحرك S55 في BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "dinan-s55-high-flow-filter",
      title: "Dinan S55 High-Flow Drop-in Air Filter",
      titleAr: "فلتر هواء Dinan عالي التدفق لمحرك S55",
      summary: "Washable Dinan high-flow replacement air-filter set designed to install in the factory air boxes on supported S55 applications. Exact air-box and vehicle fitment must be confirmed before order.",
      summaryAr: "طقم فلاتر هواء بديلة من Dinan عالي التدفق وقابل للغسل، مصمم للتركيب داخل علب فلتر الهواء الأصلية في تطبيقات S55 المدعومة. يجب تأكيد علبة الهواء وتوافق السيارة بدقة قبل الطلب.",
      brand: "Dinan",
      category: "Intake",
      categoryAr: "سحب الهواء",
      subcategory: "Replacement Air Filter",
      subcategoryAr: "فلتر هواء بديل",
      sku: "ES#4690610",
      ecsPartNumber: "ES#4690610",
      mpn: "D401-0042",
      priceAmount: 86.30,
      originalPriceAmount: 95.99,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD sale price $86.30 (previously $95.99) — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر التخفيض العام لدى ECS هو 86.30 دولاراً أمريكياً (بدلاً من 95.99 دولاراً) — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as In Stock with an estimated ship date of Today on 2026-08-06; supplier confirmation is required before order.",
      stockNoteAr: "ظهر لدى المورد كمتوفر مع تقدير للشحن في اليوم نفسه بتاريخ 2026-08-06؛ يجب تأكيد التوفر قبل الطلب.",
      observedAvailability: "In stock — estimated to ship today when checked",
      observedAvailabilityAr: "متوفر عند الفحص — كان تقدير الشحن في اليوم نفسه",
      originalUrl: "https://www.ecstuning.com/b-dinan-parts/dinan-high-flow-drop-in-replacement-air-filter-f06-f10-f12-f13-f80-f82-f83-f87-s55-s63/d401-0042~din/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80", engines: ["S55"], confidence: "possible", evidence: "ecs-product-title-and-vehicle-application" },
        { make: "BMW", model: "M4", generation: "F82", engines: ["S55"], confidence: "possible", evidence: "ecs-product-title-and-vehicle-application" }
      ],
      images: [
        { src: "assets/products/ecs/dinan-s55-high-flow-filter.jpg", width: 800, height: 600, alt: "Dinan high-flow replacement air filters for BMW F80 M3 and F82 M4 S55", altAr: "فلاتر هواء Dinan عالية التدفق لمحرك S55 في BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "f8x-performance-brake-service-kit",
      title: "F8X Front and Rear Performance Brake Service Kit",
      titleAr: "طقم صيانة فرامل أداء أمامي وخلفي لسيارات BMW F8X",
      summary: "ECS-assembled service package with four ECS V5 rotors, EBC RedStuff front and rear pads, wear sensors, hardware and lubricant. ECS lists it only for supported vehicles without carbon-ceramic brakes; exact brake configuration must be confirmed.",
      summaryAr: "باقة صيانة مجمّعة من ECS تشمل أربعة أقراص فرامل ECS V5 وفحمات EBC RedStuff أمامية وخلفية وحساسات تآكل وملحقات تثبيت ومادة تشحيم. تعرضها ECS للتطبيقات المدعومة من دون فرامل كربون سيراميك فقط؛ يجب تأكيد مواصفات الفرامل بدقة.",
      brand: "Assembled by ECS",
      category: "Braking",
      categoryAr: "الفرامل",
      subcategory: "Brake Service Kit",
      subcategoryAr: "طقم صيانة الفرامل",
      sku: "ES#4745170",
      ecsPartNumber: "ES#4745170",
      mpn: "34112284809SKT",
      priceAmount: 1396.74,
      originalPriceAmount: 1468.99,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD sale price $1,396.74 (previously $1,468.99) — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر التخفيض العام لدى ECS هو 1,396.74 دولاراً أمريكياً (بدلاً من 1,468.99 دولاراً) — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as In Stock with an estimated ship date of Today on 2026-08-06; supplier confirmation and non-carbon-ceramic brake verification are required before order.",
      stockNoteAr: "ظهر لدى المورد كمتوفر مع تقدير للشحن في اليوم نفسه بتاريخ 2026-08-06؛ يجب تأكيد التوفر والتأكد من أن السيارة لا تستخدم فرامل كربون سيراميك قبل الطلب.",
      observedAvailability: "In stock — estimated to ship today when checked",
      observedAvailabilityAr: "متوفر عند الفحص — كان تقدير الشحن في اليوم نفسه",
      originalUrl: "https://www.ecstuning.com/b-assembled-by-ecs-parts/front-and-rear-performance-brake-service-kit/34112284809skt/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80 — without carbon-ceramic brakes", engines: ["S55"], confidence: "possible", evidence: "ecs-product-fitment-qualification" },
        { make: "BMW", model: "M4", generation: "F82 — without carbon-ceramic brakes", engines: ["S55"], confidence: "possible", evidence: "ecs-product-fitment-qualification" }
      ],
      images: [
        { src: "assets/products/ecs/f8x-performance-brake-service-kit.jpg", width: 800, height: 600, alt: "ECS front and rear performance brake service kit for BMW F80 M3 and F82 M4", altAr: "طقم صيانة فرامل أداء أمامي وخلفي من ECS لسيارات BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "f8x-v5-drilled-front-rotors",
      title: "F8X Front V5 Drilled Brake Rotors — 380×30 mm Set",
      titleAr: "طقم أقراص فرامل أمامية ECS V5 مثقبة — 380×30 مم",
      summary: "Pair of ECS V5 drilled 380×30 mm front brake rotors with GeoSpec corrosion-resistant coating. ECS lists them for supported vehicles without M Carbon Ceramic brakes; exact brake configuration must be confirmed before order.",
      summaryAr: "زوج من أقراص الفرامل الأمامية ECS V5 المثقبة مقاس 380×30 مم مع طلاء GeoSpec مقاوم للتآكل. تعرضها ECS للتطبيقات المدعومة من دون فرامل M Carbon Ceramic؛ يجب تأكيد مواصفات الفرامل قبل الطلب.",
      brand: "ECS Tuning",
      category: "Braking",
      categoryAr: "الفرامل",
      subcategory: "Brake Rotors",
      subcategoryAr: "أقراص الفرامل",
      sku: "ES#4669181",
      ecsPartNumber: "ES#4669181",
      mpn: "34112284809-X",
      priceAmount: 467.38,
      originalPriceAmount: 501.99,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD sale price $467.38 (previously $501.99) — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر التخفيض العام لدى ECS هو 467.38 دولاراً أمريكياً (بدلاً من 501.99 دولاراً) — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as In Stock with an estimated ship date of Today on 2026-08-06; supplier confirmation and non-carbon-ceramic brake verification are required before order.",
      stockNoteAr: "ظهر لدى المورد كمتوفر مع تقدير للشحن في اليوم نفسه بتاريخ 2026-08-06؛ يجب تأكيد التوفر والتأكد من أن السيارة لا تستخدم فرامل كربون سيراميك قبل الطلب.",
      observedAvailability: "In stock — estimated to ship today when checked",
      observedAvailabilityAr: "متوفر عند الفحص — كان تقدير الشحن في اليوم نفسه",
      originalUrl: "https://www.ecstuning.com/b-ecs-parts/front-v5-drilled-brake-rotors-set-380x30/34112284809-x/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80 — without M Carbon Ceramic brakes", engines: ["S55"], confidence: "possible", evidence: "ecs-product-fitment-qualification" },
        { make: "BMW", model: "M4", generation: "F82 — without M Carbon Ceramic brakes", engines: ["S55"], confidence: "possible", evidence: "ecs-product-fitment-qualification" }
      ],
      images: [
        { src: "assets/products/ecs/f8x-v5-drilled-front-rotors.jpg", width: 800, height: 600, alt: "ECS V5 drilled 380 by 30 millimetre front brake rotors for BMW F80 M3 and F82 M4", altAr: "أقراص فرامل أمامية ECS V5 مثقبة مقاس 380×30 مم لسيارات BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "f8x-stainless-brake-lines",
      title: "F8X Exact-Fit Stainless-Steel Brake Lines — Complete Kit",
      titleAr: "طقم كامل لليات فرامل ستانلس ستيل بتوافق مباشر لسيارات BMW F8X",
      summary: "Complete DOT-compliant ECS braided stainless-steel brake-line kit with red polymer coating. ECS states that every line is pressure-tested to 3,000 psi; exact brake and vehicle fitment must be confirmed before order.",
      summaryAr: "طقم كامل من ليات الفرامل المجدولة من الستانلس ستيل من ECS ومتوافق مع متطلبات DOT، مع طبقة بوليمر حمراء. تذكر ECS أن كل لي تم اختباره بضغط 3,000 psi؛ يجب تأكيد مواصفات الفرامل وتوافق السيارة قبل الطلب.",
      brand: "ECS Tuning",
      category: "Braking",
      categoryAr: "الفرامل",
      subcategory: "Brake Lines",
      subcategoryAr: "ليات الفرامل",
      sku: "ES#3006376",
      ecsPartNumber: "ES#3006376",
      mpn: "010025ECS02AKT",
      priceAmount: 190.79,
      originalPriceAmount: 211.99,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD sale price $190.79 (previously $211.99) — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر التخفيض العام لدى ECS هو 190.79 دولاراً أمريكياً (بدلاً من 211.99 دولاراً) — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as In Stock with an estimated ship date of Today on 2026-08-06; supplier confirmation is required before order.",
      stockNoteAr: "ظهر لدى المورد كمتوفر مع تقدير للشحن في اليوم نفسه بتاريخ 2026-08-06؛ يجب تأكيد التوفر قبل الطلب.",
      observedAvailability: "In stock — estimated to ship today when checked",
      observedAvailabilityAr: "متوفر عند الفحص — كان تقدير الشحن في اليوم نفسه",
      originalUrl: "https://www.ecstuning.com/b-ecs-parts/exact-fit-stainless-steel-brake-lines-complete-kit/010025ecs02akt/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80", engines: ["S55"], confidence: "possible", evidence: "ecs-vehicle-page-and-product-application" },
        { make: "BMW", model: "M4", generation: "F82", engines: ["S55"], confidence: "possible", evidence: "ecs-vehicle-page-and-product-application" }
      ],
      images: [
        { src: "assets/products/ecs/f8x-stainless-brake-lines.jpg", width: 800, height: 600, alt: "ECS exact-fit stainless-steel brake-line kit for BMW F80 M3 and F82 M4", altAr: "طقم ليات فرامل ستانلس ستيل بتوافق مباشر من ECS لسيارات BMW M3 F80 وM4 F82" }
      ]
    },
    {
      ...common,
      slug: "burger-s55-jb4",
      title: "Burger Motorsports S55 JB4 Tuning Module",
      titleAr: "وحدة برمجة JB4 من Burger Motorsports لمحرك S55",
      summary: "Plug-and-play Burger Motorsports JB4 tuning module with data logging and update support for supported S55 applications. Performance results vary by vehicle, fuel, hardware and calibration; emissions legality and exact fitment must be confirmed before order.",
      summaryAr: "وحدة برمجة JB4 من Burger Motorsports بتركيب مباشر مع دعم تسجيل البيانات والتحديث لتطبيقات S55 المدعومة. تختلف النتائج حسب السيارة والوقود والقطع والبرمجة؛ يجب تأكيد قانونية الانبعاثات والتوافق الدقيق قبل الطلب.",
      brand: "Burger Motorsports",
      category: "Software",
      categoryAr: "البرمجة",
      subcategory: "Piggyback Tuning Module",
      subcategoryAr: "وحدة برمجة إضافية",
      sku: "ES#3508709",
      ecsPartNumber: "ES#3508709",
      mpn: "JB4-S55",
      priceAmount: 599,
      priceVerifiedAt: "2026-08-06",
      priceNote: "ECS public USD price $599.00 — manually checked 2026-08-06; shipping, customs and Kuwait delivery are excluded.",
      priceNoteAr: "سعر ECS العام هو 599.00 دولاراً أمريكياً — تمت المراجعة اليدوية في 2026-08-06؛ لا يشمل الشحن والجمارك والتوصيل في الكويت.",
      checkedAt: "2026-08-06",
      stockObservedAt: "2026-08-06",
      stockNote: "Observed as In Stock with an estimated ship date of Today on 2026-08-06; supplier confirmation is required before order.",
      stockNoteAr: "ظهر لدى المورد كمتوفر مع تقدير للشحن في اليوم نفسه بتاريخ 2026-08-06؛ يجب تأكيد التوفر قبل الطلب.",
      observedAvailability: "In stock — estimated to ship today when checked",
      observedAvailabilityAr: "متوفر عند الفحص — كان تقدير الشحن في اليوم نفسه",
      originalUrl: "https://www.ecstuning.com/b-burger-motorsports-parts/jb4s55-m3-4-jb4/jb4-s55~bum/",
      selectionEvidence: "ecs-vehicle-relevance-curation",
      selectionNote: "Curated from ECS vehicle-category relevance ordering; ECS does not publish a sales rank or unit-sales count.",
      selectionNoteAr: "تم الاختيار من ترتيب الصلة في فئة السيارة لدى ECS؛ لا تنشر ECS ترتيباً للمبيعات أو عدد الوحدات المباعة.",
      fitments: [
        { make: "BMW", model: "M3", generation: "F80", engines: ["S55"], confidence: "possible", evidence: "ecs-product-title-and-vehicle-application" },
        { make: "BMW", model: "M4", generation: "F82", engines: ["S55"], confidence: "possible", evidence: "ecs-product-title-and-vehicle-application" }
      ],
      images: [
        { src: "assets/products/ecs/burger-s55-jb4.jpg", width: 800, height: 600, alt: "Burger Motorsports JB4 tuning module for BMW F80 M3 and F82 M4 S55", altAr: "وحدة برمجة JB4 من Burger Motorsports لمحرك S55 في BMW M3 F80 وM4 F82" }
      ]
    }

  ];
  const slugify = value => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";

  const values = value => [...new Set(String(value || "")
    .split("/")
    .map(item => item.trim())
    .filter(Boolean))];

  const chassisValues = value => [...new Set(
    String(value || "").match(/\b(?:F\d{2}|G\d{2}|B8(?:\.5)?|8[SVY]|MK[78]|982|W\d{3}|C\d{3}|S\d{3}|A\d{3}|X\d{3})\b/gi) || []
  )];

  const yearRange = value => {
    const years = (String(value || "").match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
    return years.length ? { yearFrom: Math.min(...years), yearTo: Math.max(...years) } : { yearFrom: null, yearTo: null };
  };

  const fitmentNote = "Supplier title/application wording only; confirm the exact vehicle, VIN, chassis, engine and drivetrain before order.";
  const fitmentNoteAr = "بيانات التوافق مأخوذة من عنوان أو تطبيق المورد فقط؛ يجب تأكيد السيارة ورقم الهيكل والشاصي والمحرك ونظام الدفع قبل الطلب.";
  const availabilityNote = "Availability confirmation required. The supplier observation is retained for reference and is not a live stock promise.";
  const availabilityNoteAr = "يجب تأكيد التوفر. تُحفظ ملاحظة المورد للمرجع فقط ولا تمثل وعداً مباشراً بالمخزون.";

  const normalizedProducts = products.map(product => {
    const fitments = product.fitments.map(fitment => ({
      ...fitment,
      models: values(fitment.model),
      chassis: chassisValues(fitment.generation),
      ...yearRange(fitment.generation),
      drivetrains: [],
      confidence: "possible",
      evidence: "supplier-title",
      note: fitmentNote,
      noteAr: fitmentNoteAr
    }));
    const unique = key => [...new Set(fitments.flatMap(fitment => fitment[key] || []).filter(Boolean))];
    const years = [...new Set(fitments.flatMap(fitment => {
      if (!fitment.yearFrom || !fitment.yearTo) return [];
      return Array.from({ length: fitment.yearTo - fitment.yearFrom + 1 }, (_, index) => fitment.yearFrom + index);
    }))];
    return {
      ...product,
      publicKey: `ecs-${product.slug}`,
      brandSlug: slugify(product.brand),
      categorySlug: slugify(product.category),
      subcategorySlug: slugify(product.subcategory),
      description: product.summary,
      descriptionAr: product.summaryAr,
      detailedDescriptionAvailable: product.detailedDescriptionAvailable === true,
      identifiers: Object.freeze({ ecs: product.ecsPartNumber, sku: product.sku, mpn: product.mpn }),
      specifications: Array.isArray(product.specifications) ? product.specifications : [],
      options: Array.isArray(product.options) ? product.options : [],
      variants: Array.isArray(product.variants) ? product.variants : [],
      fitments,
      filters: Object.freeze({
        supplier: ["ecs"],
        makes: unique("make"),
        models: unique("models"),
        chassis: unique("chassis"),
        years,
        engines: unique("engines"),
        drivetrains: [],
        brands: [slugify(product.brand)],
        categories: [slugify(product.category)],
        subcategories: [slugify(product.subcategory)],
        availability: ["confirmation-required"],
        fitment: ["possible"]
      }),
      availabilityNote,
      availabilityNoteAr,
      installation: Object.freeze({ status: "confirmation-required", note: fitmentNote, noteAr: fitmentNoteAr }),
      shipping: Object.freeze({
        status: "quote-required",
        note: "Shipping, oversized handling, customs and Kuwait delivery are confirmed before order.",
        noteAr: "يتم تأكيد الشحن ومناولة القطع الكبيرة والجمارك والتوصيل في الكويت قبل الطلب."
      }),
      seo: Object.freeze({
        pageTitle: `${product.title} | Projx Racing`,
        metaDescription: product.summary,
        path: `/parts/${product.slug}/`
      }),
      relatedProductSlugs: []
    };
  });

  for (const product of normalizedProducts) {
    const engines = new Set(product.filters.engines.map(value => value.toLowerCase()));
    const makes = new Set(product.filters.makes.map(value => value.toLowerCase()));
    product.relatedProductSlugs = normalizedProducts
      .filter(candidate => candidate.slug !== product.slug)
      .map(candidate => ({
        slug: candidate.slug,
        score: (candidate.category === product.category ? 4 : 0)
          + (candidate.brand === product.brand ? 3 : 0)
          + (candidate.filters.engines.some(engine => engines.has(engine.toLowerCase())) ? 2 : 0)
          + (candidate.filters.makes.some(make => makes.has(make.toLowerCase())) ? 1 : 0)
      }))
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug))
      .slice(0, 4)
      .map(candidate => candidate.slug);
  }

  const data = runtime.PROJX_DATA;
  if (typeof window !== "undefined" && data === undefined) {
    throw new Error("Projx catalogue data must load before the manual ECS catalogue.");
  }
  if (data !== undefined) {
    if (!Array.isArray(data.storeProducts)) {
      throw new Error("Projx catalogue data must load before the manual ECS catalogue.");
    }
    const existingSlugs = new Set(data.storeProducts.map(product => product.slug));
    for (const product of normalizedProducts) {
      if (existingSlugs.has(product.slug)) throw new Error(`Duplicate catalogue slug: ${product.slug}`);
      existingSlugs.add(product.slug);
    }
    data.storeProducts.push(...normalizedProducts);
  }
  runtime.PROJX_ECS_PRODUCTS = normalizedProducts;
})();
