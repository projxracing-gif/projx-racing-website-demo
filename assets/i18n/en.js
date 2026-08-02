(() => {
  "use strict";
  const data = window.PROJX_DATA;
  const bySlug = items => Object.fromEntries(items.map(item => [item.slug, item]));
  const media = Object.fromEntries(data.media.map(item => [item.id, {
    title: item.title,
    alt: item.alt,
    caption: item.caption,
    category: item.category
  }]));

  window.PROJX_TRANSLATIONS = window.PROJX_TRANSLATIONS || {};
  window.PROJX_TRANSLATIONS.en = {
    locale: "en-KW",
    lang: "en",
    dir: "ltr",
    name: "English",
    shortName: "EN",
    ui: {
      skipToContent: "Skip to content",
      menu: "Menu",
      closeMenu: "Close menu",
      language: "Language",
      switchToArabic: "العربية",
      theme: "Theme",
      useDarkTheme: "Use dark theme",
      useLightTheme: "Use light theme",
      darkTheme: "Dark",
      lightTheme: "Light",
      nav: {
        home: "Home",
        services: "Services",
        tuning: "Online Tuning",
        engineBuilding: "Engine Building",
        projects: "Projects",
        parts: "Performance Parts",
        brands: "Brands",
        gallery: "Workshop Gallery",
        about: "About",
        reviews: "Reviews",
        contact: "Contact",
        faq: "FAQ"
      },
      actions: {
        exploreServices: "Explore Our Services",
        viewProjects: "View Completed Builds",
        requestQuote: "Request a Quote",
        contactWorkshop: "Contact the Workshop",
        whatsapp: "Message Us on WhatsApp",
        call: "Call Projx Racing",
        directions: "Get Directions",
        learnMore: "Learn More",
        viewService: "View Service",
        viewProject: "View Project",
        viewAllProjects: "View All Projects",
        viewAllServices: "View All Services",
        viewGallery: "View Workshop Gallery",
        viewBrands: "View All Brands",
        startTuning: "Start a Tuning Enquiry",
        checkCompatibility: "Check Compatibility",
        engineConsultation: "Request an Engine Build Consultation",
        discussBuild: "Discuss Your Build",
        enquire: "Enquire",
        openInstagram: "Open Instagram",
        openGoogleReviews: "View Current Google Reviews",
        loadMap: "Load Map",
        submit: "Prepare Enquiry",
        sendWhatsApp: "Continue on WhatsApp",
        close: "Close",
        previous: "Previous",
        next: "Next",
        openQuote: "Open quote request",
        addToQuote: "Add to Quote",
        remove: "Remove",
        clearFilters: "Clear Filters",
        backHome: "Return Home"
      },
      common: {
        location: "Location",
        dyno: "Mainline Dyno",
        onlineTuning: "Online Tuning",
        engineBuilding: "Engine Building",
        officialContact: "Direct Contact",
        supportedSystems: "Supported Systems",
        selectedPlatforms: "Selected Platforms",
        whatWeDo: "What Projx Racing Does",
        howItWorks: "How the Service Works",
        whatYouReceive: "What You Receive",
        whatToProvide: "Information to Provide",
        relatedProjects: "Related Projects",
        projectWork: "Work Completed",
        projectObjective: "Project Objective",
        recordedResults: "Recorded Results",
        importantNote: "Important Note",
        verifiedMedia: "Verified Projx Racing Media",
        category: "Category",
        vehicle: "Vehicle",
        brand: "Brand",
        relationship: "Relationship",
        status: "Status",
        availability: "Availability",
        platform: "Platform",
        compatibleVehicles: "Compatible Vehicles",
        requirements: "Requirements",
        included: "Included",
        quotation: "Quotation",
        byReview: "Confirmed after technical review",
        noResults: "No matching items were found.",
        noPrice: "Quoted after compatibility review",
        customerInput: "Customer information",
        serviceScope: "Service scope",
        address: "Workshop Address",
        contactBeforeVisit: "Contact the workshop before visiting",
        publishedInformation: "Current information at the source",
        allMedia: "All Media",
        allCategories: "All Categories",
        allMakes: "All Makes",
        viewAtSource: "View at Source",
        selectedItems: "Selected Items",
        emptyQuote: "No items have been selected yet.",
        currentYear: "Current year"
      },
      filters: {
        all: "All",
        searchServices: "Search services",
        searchProjects: "Search projects, vehicles or work",
        searchParts: "Search parts or applications",
        searchBrands: "Search brands or categories",
        searchMedia: "Search workshop media",
        filterByCategory: "Filter by category",
        filterByMake: "Filter by make"
      },
      forms: {
        title: "Tell us about the vehicle",
        intro: "Provide the main vehicle details and the result you need. Projx Racing will review the request before confirming scope, timing and price.",
        name: "Customer name",
        phone: "Phone / WhatsApp",
        email: "Email",
        country: "Country",
        vehicleMake: "Vehicle make",
        vehicleModel: "Vehicle model",
        vehicleYear: "Model year",
        vehicle: "Vehicle",
        engine: "Engine / engine code",
        transmission: "Transmission",
        service: "Required service",
        fuel: "Fuel",
        modifications: "Current modifications",
        intendedUse: "Intended use",
        target: "Objective or target",
        faults: "Known faults or warning lights",
        device: "Tuning device / software status",
        unlock: "ECU / DME unlock status",
        message: "Project details",
        preferredContact: "Preferred contact method",
        files: "Supporting files",
        fileNote: "File names are added to the enquiry summary. Attach the actual files in WhatsApp or through the secure upload method confirmed by the workshop.",
        consent: "I confirm that the information is accurate and may be used to respond to this enquiry.",
        optional: "Optional",
        required: "Required",
        placeholders: {
          name: "Full name",
          phone: "+965 ...",
          email: "name@example.com",
          country: "Kuwait",
          make: "BMW, Toyota, Porsche, Chevrolet...",
          model: "Model and chassis",
          year: "2020",
          vehicle: "Year, make, model and engine",
          engine: "B58, S58, LS3, LT4...",
          transmission: "Manual, ZF8, PDK...",
          modifications: "Turbo, intake, fuel system, exhaust, suspension...",
          target: "Street use, track reliability, power target, problem to solve...",
          faults: "Fault codes, symptoms and when they occur",
          message: "Explain the work required, current condition and any deadline"
        },
        contactMethods: ["WhatsApp", "Phone", "Email"],
        validation: {
          required: "Complete the required fields before continuing.",
          invalidEmail: "Enter a valid email address or leave the optional field empty.",
          consent: "Please confirm the consent statement.",
          tooFast: "Please review the information before submitting.",
          backendUnavailable: "Secure email delivery is not configured. The enquiry has been prepared for WhatsApp instead.",
          error: "The enquiry could not be prepared. Check the fields and try again."
        },
        success: {
          prepared: "Your enquiry is ready to send on WhatsApp.",
          sent: "Your enquiry was sent successfully.",
          reference: "Reference"
        }
      },
      accessibility: {
        openMenu: "Open navigation menu",
        closeMenu: "Close navigation menu",
        openImage: "Open image",
        closeImage: "Close image viewer",
        previousImage: "Previous image",
        nextImage: "Next image",
        quoteCount: "Selected quote items",
        themeButton: "Change colour theme",
        languageButton: "Change language"
      }
    },
    pages: {
      home: {
        title: "Projx Racing Co. | Motorsport Engineering Kuwait",
        description: "Motorsport preparation, Mainline dyno tuning, engine building, wiring, fabrication, chassis setup and performance upgrades in Kuwait.",
        eyebrow: "Motorsport Engineering in Kuwait",
        heading: "Built for performance. Engineered for the job.",
        intro: "Projx Racing integrates tuning, engine building, wiring, fabrication, suspension, brakes and track preparation around the way each vehicle is actually used.",
        serviceEyebrow: "Workshop Services",
        serviceHeading: "One workshop. Connected systems.",
        serviceText: "Mechanical, electronic and chassis work is planned as one programme instead of a collection of unrelated parts.",
        whyEyebrow: "Why Projx Racing",
        whyHeading: "Specific work, clear process, measurable results.",
        whyText: "The workshop combines real track experience with controlled inspection, calibration and vehicle setup.",
        whyCards: [
          ["Integrated planning", "Engine, fuel, cooling, electronics, drivetrain, suspension and brakes are reviewed together."],
          ["Controlled development", "Mainline dyno work, datalogging, alignment and track feedback are used to verify changes."],
          ["Application-led specification", "The vehicle's fuel, environment, duty cycle and customer objective guide the recommendation."],
          ["Direct workshop support", "Customers can discuss the vehicle with the workshop before parts or work are approved."]
        ],
        projectsEyebrow: "Completed & Ongoing Work",
        projectsHeading: "Projects from the Projx Racing workshop.",
        projectsText: "Only supplied and verified project information is shown. Unsupported specifications are not added.",
        capabilitiesEyebrow: "Workshop Capability",
        capabilitiesHeading: "From inspection to dyno and track support.",
        capabilitiesText: "Genuine Projx Racing media shows the workshop, Mainline dyno, engine room, fabrication, alignment and customer vehicles.",
        brandsEyebrow: "Brands & Technical Platforms",
        brandsHeading: "Selected systems we supply, install or support.",
        brandsText: "Relationship labels are shown only where supplied or verified. Technical-platform support does not imply dealer status.",
        reviewsEyebrow: "Customer Reviews",
        reviewsHeading: "Read the current reviews on Google.",
        reviewsText: "The live Google Business profile is the source for the latest public rating, review count and customer comments.",
        contactHeading: "Tell us the vehicle, the objective and the current specification.",
        contactText: "Projx Racing will confirm the correct workshop, tuning or parts route before work is accepted."
      },
      services: {
        title: "Motorsport & Performance Services | Projx Racing Kuwait",
        description: "ECU and dyno tuning, engine building, wiring, fabrication, suspension, alignment, brakes and race preparation in Kuwait.",
        eyebrow: "Workshop Services",
        heading: "Integrated motorsport services.",
        intro: "Choose the service closest to the vehicle's current need. Complex projects can combine several departments under one approved scope.",
        processHeading: "Start with the vehicle and the intended use.",
        processText: "A useful enquiry includes the exact vehicle, engine, current modifications, fuel, symptoms, objective and required timing."
      },
      tuning: {
        title: "Custom Online Tuning | Projx Racing Kuwait",
        description: "Remote calibration for selected BMW and Toyota GR Supra through MHD, Porsche through COBB and GM LS/LT V8 applications through HP Tuners.",
        eyebrow: "Remote Calibration",
        heading: "Custom online tuning with compatibility review first.",
        intro: "Projx Racing confirms the vehicle, controller, hardware, fuel and logging route before calibration begins. Unsupported or uncertain combinations are reviewed manually.",
        platformsHeading: "Choose the correct platform.",
        platformsText: "Online tuning is limited to the supported scope shown on each page.",
        processHeading: "A controlled remote-tuning process.",
        process: [
          ["Submit the vehicle", "Provide the exact year, model, engine, transmission, modifications, fuel and current faults."],
          ["Confirm compatibility", "The controller, software, licence, device and unlock requirements are reviewed."],
          ["Receive instructions", "Projx Racing confirms the read-file or logging method and the safety conditions."],
          ["Base calibration", "A calibration is prepared for the confirmed hardware and fuel."],
          ["Collect requested data", "Logs are completed only under the supplied conditions and in accordance with local law."],
          ["Review and revise", "The data is reviewed and agreed revisions are issued within the quoted scope."],
          ["Final handover", "The customer receives the final file and operating recommendations."]
        ],
        safetyHeading: "Mechanical condition comes before calibration.",
        safetyText: "Fuel supply, ignition, cooling, boost control, sensors and mechanical condition must be suitable. Tuning is paused when a fault prevents safe development."
      },
      engineBuilding: {
        title: "GM LS/LT & Ford Coyote Engine Building | Projx Racing Kuwait",
        description: "In-house GM LS/LT and Ford Coyote long-block, short-block, rebuild and upgrade consultation in Kuwait.",
        eyebrow: "In-House Engine Building",
        heading: "GM - LS/LT",
        intro: "Choose LS, LT or Ford Coyote, then select the exact engine code and build level. Projx Racing confirms the block, application and scope before quotation.",
        familyEyebrow: "Choose Engine Family",
        familyHeading: "Start with the correct engine family.",
        familyText: "Choose the family first. The enquiry form then lists the exact generation and engine code.",
        families: [
          {
            value: "GM - LS",
            title: "GM - LS",
            text: "Gen III and Gen IV LS variants. Select the exact engine code in the next step.",
            highlights: ["Gen III", "Gen IV"],
            variants: [
              "Gen III · LS1 · 5.7L aluminum",
              "Gen III · LS6 · 5.7L aluminum",
              "Gen III Truck · LR4 · 4.8L iron",
              "Gen III Truck · LM7 · 5.3L iron",
              "Gen III Truck · L59 · 5.3L iron FlexFuel",
              "Gen III Truck · LM4 · 5.3L aluminum",
              "Gen III Truck · L33 · 5.3L aluminum",
              "Gen III Truck · LQ4 · 6.0L iron",
              "Gen III Truck · LQ9 · 6.0L iron",
              "Gen IV · LS2 · 6.0L aluminum",
              "Gen IV · LS3 · 6.2L aluminum",
              "Gen IV · LS7 · 7.0L aluminum",
              "Gen IV · LS9 · 6.2L supercharged",
              "Gen IV · LSA · 6.2L supercharged",
              "Gen IV Truck · LY2 · 4.8L iron",
              "Gen IV Truck · L20 · 4.8L iron",
              "Gen IV Truck · LY5 · 5.3L iron",
              "Gen IV Truck · LMG · 5.3L iron FlexFuel",
              "Gen IV Truck · LH6 · 5.3L aluminum",
              "Gen IV Truck · LH8 · 5.3L aluminum",
              "Gen IV Truck · LH9 · 5.3L aluminum",
              "Gen IV Truck · LC9 · 5.3L aluminum",
              "Gen IV · L76 · 6.0L aluminum",
              "Gen IV Truck · LY6 · 6.0L iron",
              "Gen IV Truck · L96 · 6.0L iron",
              "Gen IV Truck · L92 · 6.2L aluminum",
              "Gen IV Truck · L9H · 6.2L aluminum",
              "Gen IV Truck · L94 · 6.2L aluminum"
            ]
          },
          {
            value: "GM - LT",
            title: "GM - LT",
            text: "Gen V LT variants. Select the exact engine code in the next step.",
            highlights: ["Gen V"],
            variants: [
              "Gen V · LT1 · 6.2L aluminum",
              "Gen V · LT2 · 6.2L aluminum",
              "Gen V · LT4 · 6.2L supercharged",
              "Gen V · LT5 · 6.2L supercharged",
              "Gen V Truck · L83 · 5.3L aluminum",
              "Gen V Truck · L84 · 5.3L aluminum",
              "Gen V Truck · L86 · 6.2L aluminum",
              "Gen V Truck · L87 · 6.2L aluminum",
              "Gen V Truck · L8T · 6.6L iron",
              "Gen V Crate · L8P · 6.6L iron"
            ]
          },
          {
            value: "Ford - Coyote",
            title: "Ford - Coyote only",
            text: "Ford engine enquiries are limited to Coyote variants. Other Ford engine families are not included.",
            highlights: ["Coyote Gen 1", "Coyote Gen 2", "Coyote Gen 3", "Coyote Gen 4"],
            variants: ["Coyote Gen 1", "Coyote Gen 2", "Coyote Gen 3", "Coyote Gen 4"]
          }
        ],
        optionsHeading: "Choose the required build level.",
        optionsText: "",
        options: [
          ["Long Block", "An assembled core package with the included block, rotating assembly, heads and valvetrain defined in the quotation."],
          ["Short Block / Bottom End", "A defined block and rotating-assembly package, with compression, intended use and power-adder route confirmed before assembly."],
          ["Rebuild or Upgrade", "The customer engine is inspected and measured before parts, machining and reuse decisions are approved."]
        ],
        processHeading: "Engine-building process.",
        process: [
          ["Application review", "Vehicle, fuel, induction, transmission, RPM, duty cycle and service-life objective."],
          ["Inspection", "Disassembly, cleaning, measurement and condition documentation."],
          ["Specification", "Parts, machining, clearances, oiling, compression and valvetrain are approved."],
          ["Preparation", "Machining is coordinated and components are checked before assembly."],
          ["Assembly", "Trial checks, final clearances, controlled assembly and documentation."],
          ["Commissioning", "Optional installation, startup support, break-in guidance, dyno and calibration."]
        ],
        provideHeading: "Send these details for a faster answer.",
        provide: ["Vehicle, model year and engine family", "Exact engine or truck-block code", "Required build level or on-shelf package", "Current condition or failure history", "Fuel, induction and intended use", "Objective and required timing"],
        note: ""
      },
      projects: {
        title: "Motorsport Projects & Completed Builds | Projx Racing Kuwait",
        description: "Verified Projx Racing race, track, tuning, engine, wiring, fabrication and chassis projects in Kuwait.",
        eyebrow: "Workshop Projects",
        heading: "Real vehicles. Documented work.",
        intro: "Browse supplied project media and confirmed technical information. Missing specifications are left out rather than estimated."
      },
      parts: {
        title: "Performance Parts & Motorsport Components | Projx Racing",
        description: "Quote-led performance parts for engine, electronics, cooling, suspension, brakes, drivetrain and vehicle-specific applications.",
        eyebrow: "Performance Parts",
        heading: "Parts selected for the exact application.",
        intro: "Projx Racing confirms part number, compatibility, availability, freight and installation before accepting an order.",
        noticeHeading: "No unverified stock or price claims.",
        noticeText: "Availability and pricing can change. Each enquiry is checked against the exact vehicle and required part number."
      },
      brands: {
        title: "Performance Brands & Technical Platforms | Projx Racing",
        description: "Search the Projx Racing supplier, reseller, dealer and supported-platform directory.",
        eyebrow: "Brands & Suppliers",
        heading: "Performance brands available through Projx Racing.",
        intro: "Relationship labels follow the supplied company list. A supported system or frequently installed brand is not presented as an authorised dealer relationship."
      },
      gallery: {
        title: "Projx Racing Workshop Gallery | Kuwait Motorsport",
        description: "Genuine Projx Racing workshop, dyno, engine, wiring, fabrication, track and project photography.",
        eyebrow: "Workshop Gallery",
        heading: "Genuine media from Projx Racing.",
        intro: "Browse the supplied workshop and project photographs by vehicle make or work category."
      },
      reviews: {
        title: "Projx Racing Reviews & Google Business Profile",
        description: "Open the live Projx Racing Google Business profile for current reviews, rating, photos and directions.",
        eyebrow: "Verified Review Source",
        heading: "Current customer reviews are shown by Google.",
        intro: "The website does not copy or invent review text. Use the live Google Business profile for the current rating, review count and public customer comments.",
        cards: [
          ["Current information", "Google displays the latest public rating, review count, comments and customer photographs."],
          ["No rewritten testimonials", "Review meaning and wording are not altered for marketing use."],
          ["Directions and business profile", "The same source provides current directions and public profile information."]
        ]
      },
      about: {
        title: "About Projx Racing | Motorsport Workshop Kuwait",
        description: "Projx Racing integrates mechanical work, electronics, tuning, engine building, wiring, fabrication and chassis setup in Kuwait.",
        eyebrow: "About Projx Racing",
        heading: "Integrated vehicle development in Kuwait.",
        intro: "Projx Racing works on performance and competition vehicles from individual services through complete programmes. The workshop connects mechanical, electronic and chassis systems around the customer's intended use.",
        approachHeading: "The whole vehicle matters.",
        approachText: "A reliable result depends on compatible engine, fuel, cooling, electronics, drivetrain, suspension, brakes, tires and calibration—not one isolated component.",
        capabilityHeading: "Workshop capability shown through real work.",
        capabilityText: "The supplied media includes the Mainline dyno, engine-build area, wiring, fabrication, alignment, suspension, brakes and track projects."
      },
      contact: {
        title: "Contact Projx Racing | Shuwaikh Industrial, Kuwait",
        description: "Call or WhatsApp Projx Racing for workshop, tuning, engine-building, parts and project enquiries in Shuwaikh Industrial, Kuwait.",
        eyebrow: "Contact Projx Racing",
        heading: "Send the vehicle details before visiting.",
        intro: "A useful first message includes the vehicle, engine, current modifications, required service, symptoms or objective and preferred timing.",
        visitHeading: "Workshop location",
        visitText: "Street 35, Unit 261, Shuwaikh Industrial, Block C, Kuwait City, Kuwait.",
        availabilityHeading: "Arrange the visit first",
        availabilityText: "Call or WhatsApp to confirm workshop availability and the information or parts that should be brought with the vehicle.",
        socialHeading: "Public company channels",
        socialText: "Use the official Instagram profile for current workshop media and the Google Business profile for directions and reviews."
      },
      faq: {
        title: "Frequently Asked Questions | Projx Racing Kuwait",
        description: "Answers about workshop enquiries, online tuning compatibility, engine building, parts and customer-supplied components.",
        eyebrow: "Frequently Asked Questions",
        heading: "Clear answers before work begins.",
        intro: "Contact the workshop when the exact vehicle or controller is not covered by the general information below.",
        tuningHeading: "Online Tuning",
        enginesHeading: "Engine Building",
        generalHeading: "Workshop & Enquiries"
      },
      notFound: {
        title: "Page Not Found | Projx Racing",
        description: "The requested Projx Racing page could not be found.",
        eyebrow: "404",
        heading: "Page not found.",
        intro: "The requested page does not exist or has moved."
      }
    },
    legal: {
      privacy: {
        title: "Privacy Information | Projx Racing",
        heading: "Website privacy information.",
        description: "How the Projx Racing website handles enquiry details and external contact services.",
        sections: [
          ["Information submitted", "Enquiry forms may collect contact details, vehicle information and project notes. The public website prepares a WhatsApp message unless secure email delivery is configured."],
          ["File handling", "Files selected in the browser are not uploaded by the static website. Customers receive instructions for an approved transfer method."],
          ["Local preferences", "Language, theme and selected quote items may be stored in the browser on the visitor's device."],
          ["External services", "WhatsApp, Instagram and Google services operate under their own privacy terms when opened."],
          ["Contact", "Questions about website information can be sent to the verified Projx Racing telephone or WhatsApp number."]
        ]
      },
      terms: {
        title: "Website & Workshop Information | Projx Racing",
        heading: "Website and workshop information.",
        description: "General conditions for website information and workshop enquiries.",
        sections: [
          ["Website information", "Service descriptions explain general capability and do not replace a vehicle-specific inspection or quotation."],
          ["Quotations", "Scope, parts, price, deposit, lead time and warranty are confirmed in the written quotation for the exact project."],
          ["Compatibility", "Vehicle, controller and part compatibility must be confirmed before work or ordering."],
          ["Customer information", "The customer is responsible for providing accurate vehicle, modification, fuel and fault information."],
          ["Final terms", "Vehicle-specific workshop and commercial terms are provided with the quotation and require customer approval."]
        ]
      },
      tuning: {
        title: "Online Tuning Information | Projx Racing",
        heading: "Online tuning conditions.",
        description: "Compatibility, vehicle condition, logging and customer responsibilities for remote calibration.",
        sections: [
          ["Compatibility first", "Tuning begins only after the exact vehicle, controller, software, device, licence and unlock route are confirmed."],
          ["Mechanical condition", "The vehicle must be mechanically healthy and use the approved fuel. Existing faults can pause or stop the service."],
          ["Logging safety", "Customers must follow local law and the supplied instructions. High-load testing may require a dyno or suitable closed course."],
          ["Scope", "Revision count, support period, response targets and additional-map charges are confirmed in the quotation."],
          ["Vehicle-specific file", "A calibration is supplied for the submitted vehicle and approved specification. Modification changes may require review and a new quotation."]
        ]
      },
      engine: {
        title: "Engine Building Information | Projx Racing",
        heading: "Engine-building conditions.",
        description: "Inspection, specification, customer-supplied parts and final approval for engine-building work.",
        sections: [
          ["Inspection", "An existing engine may require disassembly, cleaning and measurement before the final parts list and price can be confirmed."],
          ["Customer-supplied parts", "Parts are inspected before use and may be rejected when damaged, unsuitable, counterfeit or incompatible."],
          ["Specification", "Power, RPM, compression, clearances, oiling, fuel, duty cycle and maintenance requirements are tied to the approved build specification."],
          ["Changes", "Unexpected damage, machining requirements or specification changes require customer approval before additional work proceeds."],
          ["Final terms", "Price, deposit, lead time, warranty, break-in and maintenance conditions are confirmed in the written quotation."]
        ]
      }
    },
    services: bySlug(data.services),
    projects: bySlug(data.projects),
    media,
    parts: data.parts,
    tuning: data.tuningPlatforms,
    faq: data.faq,
    brandCategories: {},
    brandRelationships: {}
  };
})();
