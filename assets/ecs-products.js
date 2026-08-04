(() => {
  "use strict";

  const common = Object.freeze({
    catalogType: "product",
    provider: "ECS Tuning",
    quoteOnly: false,
    priceCurrency: "USD",
    priceVerifiedAt: "2026-08-04",
    priceNote: "ECS public USD price — manually checked 2026-08-04",
    priceNoteAr: "سعر ECS العام بالدولار الأمريكي — تمت المراجعة اليدوية في 2026-08-04",
    status: "Supplier stock — confirmation required",
    statusAr: "مخزون المورد — يتطلب التأكيد",
    checkedAt: "2026-08-04",
    staleAfterDays: 7,
    stockPolicy: "manual-confirm",
    fitmentStatus: "supplier-title-confirm"
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
    }
  ];
  const data = window.PROJX_DATA;

  if (!data || !Array.isArray(data.storeProducts)) {
    throw new Error("Projx catalogue data must load before the manual ECS catalogue.");
  }

  const existingSlugs = new Set(data.storeProducts.map(product => product.slug));
  for (const product of products) {
    if (existingSlugs.has(product.slug)) throw new Error(`Duplicate catalogue slug: ${product.slug}`);
    existingSlugs.add(product.slug);
  }

  data.storeProducts.push(...products);
  window.PROJX_ECS_PRODUCTS = products;
})();
