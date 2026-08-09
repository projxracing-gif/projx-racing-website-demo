import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const ECS_PRODUCT_HOST = 'www.ecstuning.com';
const ECS_IMAGE_HOST = 'assets.ecstuning.com';
const PRODUCT_PATH = /^\/b-[^/?#]+-parts\/[^/?#]+\/[^/?#]+\/$/i;
const SAFE_ASSET_PATH = /^assets\/products\/ecs\/g-series-(?:performance|exterior|interior|drivetrain)\/[a-z0-9][a-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/i;
const VEHICLES = Object.freeze({
  'BMW G87 M2 S58 3.0L': Object.freeze({ model: 'M2', trim: null, generation: 'G87' }),
  'BMW G80 M3 Competition S58 3.0L': Object.freeze({ model: 'M3', trim: 'Competition', generation: 'G80' }),
  'BMW G82 M4 Competition S58 3.0L': Object.freeze({ model: 'M4', trim: 'Competition', generation: 'G82' })
});
const VEHICLE_SOURCE_PATHS = Object.freeze({
  'BMW G87 M2 S58 3.0L': '/BMW-G87-M2-S58_3.0L/Performance/',
  'BMW G80 M3 Competition S58 3.0L': '/BMW-G80-M3_Competition-S58_3.0L/Performance/',
  'BMW G82 M4 Competition S58 3.0L': '/BMW-G82-M4_Competition-S58_3.0L/Performance/'
});
const ECS_PLACEHOLDER_IMAGE = 'https://assets.ecstuning.com/static/img/category/ecs_box_no_image.jpg';
const EXPECTED_CATEGORY_COUNTS = Object.freeze({
  'BMW G80 M3 Competition S58 3.0L': Object.freeze([251, 177, 116, 113, 76, 68, 50, 48, 18, 6, 3]),
  'BMW G82 M4 Competition S58 3.0L': Object.freeze([247, 176, 112, 115, 70, 70, 50, 49, 18, 6, 3]),
  'BMW G87 M2 S58 3.0L': Object.freeze([207, 158, 113, 100, 69, 65, 43, 32, 19, 6, 2])
});
const CATEGORY_AR = Object.freeze({
  'Performance Engine & Drivetrain Parts': 'أجزاء أداء المحرك ونظام الدفع',
  'Performance Exhaust Parts & Upgrades': 'أجزاء وترقيات عادم الأداء',
  'Performance Exterior Parts & Upgrades': 'أجزاء وترقيات الأداء الخارجية',
  'Interior Performance Parts & Upgrades': 'أجزاء وترقيات الأداء الداخلية',
  'Performance Suspension Parts & Upgrades': 'أجزاء وترقيات نظام التعليق',
  'Racing Safety Accessories': 'معدات السلامة للسباقات',
  'Performance Brake Parts & Upgrades': 'أجزاء وترقيات فرامل الأداء',
  'Performance Wheel Parts & Upgrades': 'أجزاء وترقيات عجلات الأداء',
  'Performance Software & Tuning': 'برامج وضبط الأداء',
  'Essential Performance Parts & Upgrades': 'أجزاء وترقيات الأداء الأساسية',
  'Performance Lighting Parts & Upgrades': 'أجزاء وترقيات إضاءة الأداء'
});
const CATEGORY_SOURCE_PATHS = Object.freeze({
  'Performance Engine & Drivetrain Parts': 'Engine_-or-_Drivetrain/',
  'Performance Exhaust Parts & Upgrades': 'Exhaust/',
  'Performance Exterior Parts & Upgrades': 'Exterior/',
  'Interior Performance Parts & Upgrades': 'Interior/',
  'Performance Suspension Parts & Upgrades': 'Suspension/',
  'Racing Safety Accessories': 'Racing_Safety_Accessories/',
  'Performance Brake Parts & Upgrades': 'Braking/',
  'Performance Wheel Parts & Upgrades': 'Wheels/',
  'Performance Software & Tuning': 'Software_-or-_Tuning/',
  'Essential Performance Parts & Upgrades': 'Essentials/',
  'Performance Lighting Parts & Upgrades': 'Lighting/'
});
const EXTERIOR_VEHICLE_SOURCE_PATHS = Object.freeze({
  'BMW G87 M2 S58 3.0L': '/BMW-G87-M2-S58_3.0L/Exterior/',
  'BMW G80 M3 Competition S58 3.0L': '/BMW-G80-M3_Competition-S58_3.0L/Exterior/',
  'BMW G82 M4 Competition S58 3.0L': '/BMW-G82-M4_Competition-S58_3.0L/Exterior/'
});
const EXTERIOR_CATEGORY_AR = Object.freeze({
  'Exterior Body Parts': '\u0623\u062c\u0632\u0627\u0621 \u0627\u0644\u0647\u064a\u0643\u0644 \u0627\u0644\u062e\u0627\u0631\u062c\u064a',
  'Exterior Vinyl Wrap': '\u062a\u063a\u0644\u064a\u0641 \u0627\u0644\u0641\u064a\u0646\u064a\u0644 \u0627\u0644\u062e\u0627\u0631\u062c\u064a',
  'Exterior Tools': '\u0623\u062f\u0648\u0627\u062a \u0627\u0644\u0647\u064a\u0643\u0644 \u0627\u0644\u062e\u0627\u0631\u062c\u064a',
  'Exterior Wiper Parts': '\u0623\u062c\u0632\u0627\u0621 \u0645\u0633\u0627\u062d\u0627\u062a \u0627\u0644\u0632\u062c\u0627\u062c',
  'Emblems & Badges': '\u0627\u0644\u0634\u0639\u0627\u0631\u0627\u062a \u0648\u0627\u0644\u0634\u0627\u0631\u0627\u062a',
  'Exterior Roof Rack Parts': '\u0623\u062c\u0632\u0627\u0621 \u062d\u0648\u0627\u0645\u0644 \u0627\u0644\u0633\u0642\u0641',
  'Exterior Mirror Parts': '\u0623\u062c\u0632\u0627\u0621 \u0627\u0644\u0645\u0631\u0627\u064a\u0627 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629',
  'Exterior Electrical Parts': '\u0627\u0644\u0623\u062c\u0632\u0627\u0621 \u0627\u0644\u0643\u0647\u0631\u0628\u0627\u0626\u064a\u0629 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629',
  'Skid Plate Parts': '\u0623\u0644\u0648\u0627\u062d \u062d\u0645\u0627\u064a\u0629 \u0623\u0633\u0641\u0644 \u0627\u0644\u0633\u064a\u0627\u0631\u0629',
  'Antenna Parts & Accessories': '\u0623\u062c\u0632\u0627\u0621 \u0627\u0644\u0647\u0648\u0627\u0626\u064a \u0648\u0645\u0644\u062d\u0642\u0627\u062a\u0647',
  'Exterior Window Parts': '\u0623\u062c\u0632\u0627\u0621 \u0627\u0644\u0646\u0648\u0627\u0641\u0630 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629',
  'Exterior Alarm Systems & Parts': '\u0623\u0646\u0638\u0645\u0629 \u0627\u0644\u0625\u0646\u0630\u0627\u0631 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629 \u0648\u0623\u062c\u0632\u0627\u0624\u0647\u0627',
  'Exterior CSL Parts': '\u0623\u062c\u0632\u0627\u0621 CSL \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629',
  'Exterior Electronic Accessories': '\u0645\u0644\u062d\u0642\u0627\u062a \u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629 \u062e\u0627\u0631\u062c\u064a\u0629'
});
const EXTERIOR_CATEGORY_SOURCE_PATHS = Object.freeze({
  'Exterior Body Parts': 'Body/',
  'Exterior Vinyl Wrap': 'Vinyl_Wrap/',
  'Exterior Tools': 'Tools/',
  'Exterior Wiper Parts': 'Wiper/',
  'Emblems & Badges': 'Emblem/',
  'Exterior Roof Rack Parts': 'Roof_Rack/',
  'Exterior Mirror Parts': 'Mirrors/',
  'Exterior Electrical Parts': 'Electrical/',
  'Skid Plate Parts': 'Skid_Plate/',
  'Antenna Parts & Accessories': 'Antennas/',
  'Exterior Window Parts': 'Window/',
  'Exterior Alarm Systems & Parts': 'Alarm/',
  'Exterior CSL Parts': 'CSL/',
  'Exterior Electronic Accessories': 'Electronic_Accessories/'
});
const EXTERIOR_EXPECTED_CATEGORY_COUNTS = Object.freeze({
  'BMW G80 M3 Competition S58 3.0L': Object.freeze([379, 57, 45, 28, 19, 15, 14, 10, 9, 7, 4, 2, 1, 1]),
  'BMW G82 M4 Competition S58 3.0L': Object.freeze([364, 57, 45, 23, 17, 14, 13, 9, 8, 6, 4, 2, 0, 1]),
  'BMW G87 M2 S58 3.0L': Object.freeze([369, 57, 45, 23, 19, 15, 16, 9, 5, 5, 5, 1, 1, 1])
});
const INTERIOR_VEHICLE_SOURCE_PATHS = Object.freeze({
  'BMW G87 M2 S58 3.0L': '/BMW-G87-M2-S58_3.0L/Interior/',
  'BMW G80 M3 Competition S58 3.0L': '/BMW-G80-M3_Competition-S58_3.0L/Interior/',
  'BMW G82 M4 Competition S58 3.0L': '/BMW-G82-M4_Competition-S58_3.0L/Interior/'
});
const INTERIOR_CATEGORY_AR = Object.freeze({
  'Interior Gauges': 'عدادات المقصورة',
  'Interior Seat Parts': 'أجزاء المقاعد الداخلية',
  'Interior Steering Parts': 'أجزاء عجلة القيادة الداخلية',
  'Interior Vinyl Wrap': 'تغليف الفينيل الداخلي',
  'Center Console Parts': 'أجزاء الكونسول الوسطي',
  'Interior Safety Parts': 'أجزاء السلامة الداخلية',
  'Interior Trim Parts': 'أجزاء التطعيمات الداخلية',
  'Floor Mats': 'دواسات الأرضية',
  'Interior Dashboard Parts': 'أجزاء لوحة العدادات الداخلية',
  'Interior Pedal Parts': 'أجزاء الدواسات الداخلية',
  'Interior Cell Phone Accessories': 'ملحقات الهاتف داخل السيارة',
  'Interior Trunk Parts': 'أجزاء صندوق الأمتعة الداخلية',
  'Interior Key Fob Parts': 'أجزاء ريموت المفتاح',
  'Interior Shifter Parts': 'أجزاء ناقل الحركة الداخلية',
  'Interior Tools': 'أدوات المقصورة',
  'Interior Window Parts': 'أجزاء النوافذ الداخلية',
  'Interior Sound System Parts': 'أجزاء النظام الصوتي الداخلي',
  'Interior Sun Shades': 'حواجب الشمس الداخلية',
  'Interior Electronic Parts': 'الأجزاء الإلكترونية الداخلية',
  'Interior Door Parts': 'أجزاء الأبواب الداخلية',
  'Interior Hood Release Parts': 'أجزاء فتح غطاء المحرك الداخلية',
  'Interior Lighting Parts': 'أجزاء الإضاءة الداخلية',
  'Interior Storage Parts': 'أجزاء التخزين الداخلية',
  'Interior Convertible Parts': 'أجزاء السقف القابل للطي الداخلية',
  'Interior Headliner Parts': 'أجزاء بطانة السقف',
  'Interior Mirror Parts': 'أجزاء المرايا الداخلية',
  'Interior Sunroof Parts': 'أجزاء فتحة السقف',
  'Airbag Parts': 'أجزاء الوسائد الهوائية',
  'Interior Carpeting Covers': 'أغطية سجاد المقصورة',
  'Interior Navigation Parts': 'أجزاء الملاحة الداخلية',
  'Interior Armrest Parts': 'أجزاء مسند الذراع',
  'Interior Hatch Parts': 'أجزاء الباب الخلفي الداخلية'
});
const INTERIOR_CATEGORY_SOURCE_PATHS = Object.freeze({
  'Interior Gauges': 'Gauges/',
  'Interior Seat Parts': 'Seats/',
  'Interior Steering Parts': 'Steering/',
  'Interior Vinyl Wrap': 'Vinyl_Wrap/',
  'Center Console Parts': 'Center_Console/',
  'Interior Safety Parts': 'Safety/',
  'Interior Trim Parts': 'Trim/',
  'Floor Mats': 'Floor_Mats/',
  'Interior Dashboard Parts': 'Dashboard/',
  'Interior Pedal Parts': 'Pedal/',
  'Interior Cell Phone Accessories': 'Cellular_Phone/',
  'Interior Trunk Parts': 'Trunk/',
  'Interior Key Fob Parts': 'Key_Fob/',
  'Interior Shifter Parts': 'Shifter/',
  'Interior Tools': 'Tools/',
  'Interior Window Parts': 'Window/',
  'Interior Sound System Parts': 'Sound_System/',
  'Interior Sun Shades': 'Sun_Shade/',
  'Interior Electronic Parts': 'Electronic/',
  'Interior Door Parts': 'Door/',
  'Interior Hood Release Parts': 'Hood_Release/',
  'Interior Lighting Parts': 'Lighting/',
  'Interior Storage Parts': 'Storage/',
  'Interior Convertible Parts': 'Convertible/',
  'Interior Headliner Parts': 'Headliner/',
  'Interior Mirror Parts': 'Mirror/',
  'Interior Sunroof Parts': 'Sunroof/',
  'Airbag Parts': 'Airbag/',
  'Interior Carpeting Covers': 'Carpet/',
  'Interior Navigation Parts': 'Navigation/',
  'Interior Armrest Parts': 'Armrest/',
  'Interior Hatch Parts': 'Hatch/'
});
const INTERIOR_CATEGORY_SLUGS = Object.freeze({
  'Interior Gauges': 'gauges',
  'Interior Seat Parts': 'seats',
  'Interior Steering Parts': 'steering',
  'Interior Vinyl Wrap': 'vinyl-wrap',
  'Center Console Parts': 'center-console',
  'Interior Safety Parts': 'safety',
  'Interior Trim Parts': 'trim',
  'Floor Mats': 'floor-mats',
  'Interior Dashboard Parts': 'dashboard',
  'Interior Pedal Parts': 'pedal',
  'Interior Cell Phone Accessories': 'cellular-phone',
  'Interior Trunk Parts': 'trunk',
  'Interior Key Fob Parts': 'key-fob',
  'Interior Shifter Parts': 'shifter',
  'Interior Tools': 'tools',
  'Interior Window Parts': 'window',
  'Interior Sound System Parts': 'sound-system',
  'Interior Sun Shades': 'sun-shade',
  'Interior Electronic Parts': 'electronic',
  'Interior Door Parts': 'door',
  'Interior Hood Release Parts': 'hood-release',
  'Interior Lighting Parts': 'lighting',
  'Interior Storage Parts': 'storage',
  'Interior Convertible Parts': 'convertible',
  'Interior Headliner Parts': 'headliner',
  'Interior Mirror Parts': 'mirror',
  'Interior Sunroof Parts': 'sunroof',
  'Airbag Parts': 'airbag',
  'Interior Carpeting Covers': 'carpet',
  'Interior Navigation Parts': 'navigation',
  'Interior Armrest Parts': 'armrest',
  'Interior Hatch Parts': 'hatch'
});
const INTERIOR_EXPECTED_CATEGORY_COUNTS = Object.freeze({
  'BMW G80 M3 Competition S58 3.0L': Object.freeze([108, 107, 80, 56, 37, 35, 32, 25, 21, 19, 18, 18, 17, 17, 17, 15, 12, 12, 10, 6, 5, 4, 3, 2, 2, 2, 2, 1, 1, 1, 0, 0]),
  'BMW G82 M4 Competition S58 3.0L': Object.freeze([108, 108, 82, 56, 37, 36, 38, 20, 21, 19, 16, 20, 17, 17, 17, 6, 12, 3, 11, 6, 5, 5, 1, 2, 0, 1, 2, 1, 1, 1, 0, 1]),
  'BMW G87 M2 S58 3.0L': Object.freeze([106, 102, 75, 56, 36, 34, 27, 13, 20, 21, 16, 15, 14, 10, 17, 5, 9, 1, 6, 3, 3, 5, 1, 1, 0, 0, 2, 1, 1, 0, 3, 0])
});
const DRIVETRAIN_VEHICLE_SOURCE_PATHS = Object.freeze({
  'BMW G87 M2 S58 3.0L': '/BMW-G87-M2-S58_3.0L/Drivetrain/',
  'BMW G80 M3 Competition S58 3.0L': '/BMW-G80-M3_Competition-S58_3.0L/Drivetrain/',
  'BMW G82 M4 Competition S58 3.0L': '/BMW-G82-M4_Competition-S58_3.0L/Drivetrain/'
});
const DRIVETRAIN_VEHICLE_BASE_PATHS = Object.freeze({
  'BMW G87 M2 S58 3.0L': '/BMW-G87-M2-S58_3.0L/',
  'BMW G80 M3 Competition S58 3.0L': '/BMW-G80-M3_Competition-S58_3.0L/',
  'BMW G82 M4 Competition S58 3.0L': '/BMW-G82-M4_Competition-S58_3.0L/'
});
const CATALOGUE_SCOPES = Object.freeze({
  performance: Object.freeze({
    key: 'performance', label: 'Performance', exportName: 'ECS_G_SERIES_PERFORMANCE_PRODUCTS',
    vehicleSourcePaths: VEHICLE_SOURCE_PATHS, expectedCategoryCounts: EXPECTED_CATEGORY_COUNTS,
    categoryAr: CATEGORY_AR, categorySourcePaths: CATEGORY_SOURCE_PATHS,
    fitmentNoteAr: 'أدرجت ECS القطعة ضمن فئة الأداء لهذه السيارة؛ يجب تأكيد رقم الهيكل وسنة الصنع والمحرك ونظام الدفع والخيارات قبل الطلب.',
    selectionNoteAr: 'مدرج ضمن فئات أداء السيارة لدى ECS وفق ترتيب الصلة الظاهر؛ لا تنشر ECS ترتيباً بحسب عدد الوحدات المباعة.'
  }),
  exterior: Object.freeze({
    key: 'exterior', label: 'Exterior', exportName: 'ECS_G_SERIES_EXTERIOR_PRODUCTS',
    parentCategorySlug: 'exterior',
    vehicleSourcePaths: EXTERIOR_VEHICLE_SOURCE_PATHS,
    expectedCategoryCounts: EXTERIOR_EXPECTED_CATEGORY_COUNTS,
    categoryAr: EXTERIOR_CATEGORY_AR, categorySourcePaths: EXTERIOR_CATEGORY_SOURCE_PATHS,
    fitmentNoteAr: 'أدرجت ECS القطعة ضمن فئة هذه السيارة؛ يجب تأكيد رقم الهيكل وسنة الصنع والمحرك ونظام الدفع والخيارات قبل الطلب.',
    selectionNoteAr: 'مدرج ضمن فئات السيارة لدى ECS وفق ترتيب الصلة الظاهر؛ لا تنشر ECS ترتيباً بحسب عدد الوحدات المباعة.'
  }),
  interior: Object.freeze({
    key: 'interior', label: 'Interior', exportName: 'ECS_G_SERIES_INTERIOR_PRODUCTS',
    parentCategorySlug: 'interior',
    vehicleSourcePaths: INTERIOR_VEHICLE_SOURCE_PATHS,
    expectedCategoryCounts: INTERIOR_EXPECTED_CATEGORY_COUNTS,
    categoryAr: INTERIOR_CATEGORY_AR, categorySourcePaths: INTERIOR_CATEGORY_SOURCE_PATHS,
    categorySlugs: INTERIOR_CATEGORY_SLUGS,
    fitmentNoteAr: 'أدرجت ECS القطعة ضمن فئة المقصورة لهذه السيارة؛ يجب تأكيد رقم الهيكل وسنة الصنع والمحرك ونظام الدفع والخيارات قبل الطلب.',
    selectionNoteAr: 'مدرج ضمن فئات المقصورة لدى ECS وفق ترتيب الصلة الظاهر؛ لا تنشر ECS ترتيباً بحسب عدد الوحدات المباعة.'
  }),
  drivetrain: Object.freeze({
    key: 'drivetrain', label: 'Drivetrain', exportName: 'ECS_G_SERIES_DRIVETRAIN_PRODUCTS',
    parentCategorySlug: 'g-series-drivetrain',
    vehicleSourcePaths: DRIVETRAIN_VEHICLE_SOURCE_PATHS,
    vehicleBasePaths: DRIVETRAIN_VEHICLE_BASE_PATHS,
    categoryPathsAreVehicleRelative: true,
    manifestRequired: true,
    fitmentNoteAr: '\u0623\u062f\u0631\u062c\u062a ECS \u0627\u0644\u0642\u0637\u0639\u0629 \u0636\u0645\u0646 \u0641\u0626\u0629 \u0646\u0638\u0627\u0645 \u0627\u0644\u062f\u0641\u0639 \u0644\u0647\u0630\u0647 \u0627\u0644\u0633\u064a\u0627\u0631\u0629\u061b \u064a\u062c\u0628 \u062a\u0623\u0643\u064a\u062f \u0631\u0642\u0645 \u0627\u0644\u0647\u064a\u0643\u0644 \u0648\u0633\u0646\u0629 \u0627\u0644\u0635\u0646\u0639 \u0648\u0627\u0644\u0645\u062d\u0631\u0643 \u0648\u0646\u0638\u0627\u0645 \u0627\u0644\u062f\u0641\u0639 \u0648\u0627\u0644\u062e\u064a\u0627\u0631\u0627\u062a \u0642\u0628\u0644 \u0627\u0644\u0637\u0644\u0628.',
    selectionNoteAr: '\u0645\u062f\u0631\u062c \u0636\u0645\u0646 \u0641\u0626\u0627\u062a \u0646\u0638\u0627\u0645 \u0627\u0644\u062f\u0641\u0639 \u0644\u062f\u0649 ECS \u0648\u0641\u0642 \u062a\u0631\u062a\u064a\u0628 \u0627\u0644\u0635\u0644\u0629 \u0627\u0644\u0638\u0627\u0647\u0631\u061b \u0644\u0627 \u062a\u0646\u0634\u0631 ECS \u062a\u0631\u062a\u064a\u0628\u0627\u064b \u0628\u062d\u0633\u0628 \u0639\u062f\u062f \u0627\u0644\u0648\u062d\u062f\u0627\u062a \u0627\u0644\u0645\u0628\u0627\u0639\u0629.'
  })
});

function clean(value, maximum = 2_048) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function supplierCopy(value, maximum = 5_000) {
  const entities = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
  const decoded = String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (Object.hasOwn(entities, normalized)) return entities[normalized];
    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try {
      return Number.isInteger(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : ' ';
    } catch {
      return ' ';
    }
  });
  return clean(decoded
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:\d+\s*[x×]\s*)?Entries For Our (?:25th Anniversary|Spin To Win) Sweepstakes!\s*/gi, ' ')
    .replace(/Call In Or Chat For Best Price!\s*/gi, ' ')
    .replace(/Want To Haggle\?\s*Give Us A Call Or Chat To Make An Offer On This Product!\s*/gi, ' ')
    .replace(/We Price Match\s*[-\u2013\u2014]\s*Give Us A Call Or Chat!\s*/gi, ' ')
    .replace(/Don['\u2019]t See A Bundle You Want\s*[-\u2013\u2014]\s*Give Us A Call Or Chat\s*[-\u2013\u2014]\s*We Will Make One!\s*/gi, ' ')
    .replace(/Don['\u2019]t Wait,?\s*They May Not Be Around Forever!\s*/gi, ' '), maximum);
}

function slugify(value) {
  return clean(value, 500).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeVehicleRelativeCategoryPath(value) {
  const sourcePath = clean(value, 300);
  if (!sourcePath || sourcePath.startsWith('/') || !sourcePath.endsWith('/')
    || sourcePath.includes('\\') || /[?#]/.test(sourcePath)) return null;
  const segments = sourcePath.slice(0, -1).split('/');
  if (!segments.includes('Drivetrain') || segments.some(segment => !segment
    || segment === '.' || segment === '..'
    || !/^[a-z0-9][a-z0-9_.!%+&(),~-]*$/i.test(segment))) return null;
  return sourcePath;
}

export function createGSeriesDrivetrainScope(manifestDocument) {
  const document = manifestDocument?.scopeManifest || manifestDocument;
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || document?.kind !== 'g-series-drivetrain-scope-manifest'
    || !isPlainObject(document?.categories) || !isPlainObject(document?.counts)) {
    throw new Error('A validated G-Series Drivetrain scope manifest is required.');
  }
  const categoryEntries = Object.entries(document.categories);
  if (!categoryEntries.length) throw new Error('The G-Series Drivetrain scope manifest has no categories.');
  const categoryKeys = {};
  const categoryAr = {};
  const categorySourcePaths = {};
  const categorySlugs = {};
  const canonicalCategories = {};
  const seenNames = new Set();
  const seenPaths = new Set();
  const seenSlugs = new Set();
  for (const [key, entry] of categoryEntries) {
    const name = clean(entry?.name, 160);
    const nameAr = clean(entry?.nameAr, 160);
    const sourcePath = safeVehicleRelativeCategoryPath(entry?.sourcePath);
    const categorySlug = clean(entry?.slug, 120).toLocaleLowerCase('en-US');
    const catalogueDisposition = clean(entry?.catalogueDisposition, 40);
    const quarantineReason = clean(entry?.quarantineReason, 500);
    const quarantineConfigured = Object.hasOwn(entry || {}, 'excludeFromCustomerFacing')
      || Boolean(catalogueDisposition) || Boolean(quarantineReason);
    const quarantineValid = !quarantineConfigured || (entry?.excludeFromCustomerFacing === true
      && catalogueDisposition === 'quarantined' && Boolean(quarantineReason));
    const normalizedName = name.toLocaleLowerCase('en-US');
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(key) || !name || !nameAr || !sourcePath
      || !/^drivetrain-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categorySlug)
      || !quarantineValid || seenNames.has(normalizedName) || seenPaths.has(sourcePath)
      || seenSlugs.has(categorySlug)) {
      throw new Error(`The G-Series Drivetrain category manifest is invalid for ${key || 'an entry'}.`);
    }
    seenNames.add(normalizedName);
    seenPaths.add(sourcePath);
    seenSlugs.add(categorySlug);
    categoryKeys[key] = name;
    categoryAr[name] = nameAr;
    categorySourcePaths[name] = sourcePath;
    categorySlugs[name] = categorySlug;
    canonicalCategories[key] = {
      name, nameAr, sourcePath, slug: categorySlug,
      ...(quarantineConfigured ? {
        catalogueDisposition: 'quarantined',
        excludeFromCustomerFacing: true,
        quarantineReason
      } : {})
    };
  }
  const expectedVehicleNames = Object.keys(VEHICLES);
  if (Object.keys(document.counts).length !== expectedVehicleNames.length
    || expectedVehicleNames.some(vehicle => !Object.hasOwn(document.counts, vehicle))) {
    throw new Error('The G-Series Drivetrain scope manifest must contain exact keyed counts for G87, G80 and G82.');
  }
  const expectedCategoryKeys = Object.keys(categoryKeys);
  const expectedCategoryCounts = {};
  const canonicalCounts = {};
  let totalPlacements = 0;
  for (const vehicle of expectedVehicleNames) {
    const vehicleCounts = document.counts[vehicle];
    if (!isPlainObject(vehicleCounts) || Object.keys(vehicleCounts).length !== expectedCategoryKeys.length
      || expectedCategoryKeys.some(key => !Object.hasOwn(vehicleCounts, key))) {
      throw new Error(`The G-Series Drivetrain scope manifest has incomplete keyed counts for ${vehicle}.`);
    }
    expectedCategoryCounts[vehicle] = {};
    canonicalCounts[vehicle] = {};
    for (const key of expectedCategoryKeys) {
      const count = Number(vehicleCounts[key]);
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`The G-Series Drivetrain scope manifest has an invalid count for ${vehicle} / ${key}.`);
      }
      const category = categoryKeys[key];
      expectedCategoryCounts[vehicle][category] = count;
      canonicalCounts[vehicle][key] = count;
      totalPlacements += count;
    }
  }
  if (!totalPlacements) throw new Error('The G-Series Drivetrain scope manifest has no captured placements.');
  const scopeManifest = Object.freeze({
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'g-series-drivetrain-scope-manifest',
    categories: Object.freeze(canonicalCategories),
    counts: Object.freeze(canonicalCounts)
  });
  const quarantinedCategories = Object.freeze(Object.values(canonicalCategories)
    .filter(category => category.excludeFromCustomerFacing === true)
    .map(category => Object.freeze({ ...category })));
  return Object.freeze({
    ...CATALOGUE_SCOPES.drivetrain,
    categoryKeys: Object.freeze(categoryKeys),
    categoryAr: Object.freeze(categoryAr),
    categorySourcePaths: Object.freeze(categorySourcePaths),
    categorySlugs: Object.freeze(categorySlugs),
    expectedCategoryCounts: Object.freeze(expectedCategoryCounts),
    quarantinedCategories,
    scopeManifest
  });
}

function catalogueScope(scopeName, manifestDocument = null) {
  const configured = CATALOGUE_SCOPES[scopeName];
  if (!configured) throw new Error(`Unknown ECS G-Series catalogue scope: ${scopeName}.`);
  return configured.manifestRequired ? createGSeriesDrivetrainScope(manifestDocument) : configured;
}

function expectedCategorySourcePath(scope, vehicle, category) {
  const categoryPath = scope.categorySourcePaths?.[category];
  const vehiclePath = scope.categoryPathsAreVehicleRelative
    ? scope.vehicleBasePaths?.[vehicle]
    : scope.vehicleSourcePaths?.[vehicle];
  return categoryPath && vehiclePath ? `${vehiclePath}${categoryPath}` : null;
}

function expectedCategoryCount(scope, vehicle, category, categoryIndex) {
  const configured = scope.expectedCategoryCounts?.[vehicle];
  const count = Array.isArray(configured) ? configured[categoryIndex] : configured?.[category];
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`The ${scope.label} scope has no valid expected count for ${vehicle} / ${category}.`);
  }
  return count;
}

function canonicalUrl(value, hostname, pattern = null) {
  try {
    const parsed = new URL(clean(value, 4_096));
    if (parsed.protocol !== 'https:' || parsed.hostname !== hostname || parsed.username
      || parsed.password || parsed.port || parsed.search || parsed.hash
      || (pattern && !pattern.test(parsed.pathname))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function observedAt(value) {
  const source = clean(value, 40);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source
    || milliseconds > Date.now() + 5 * 60 * 1_000) return null;
  return source;
}

function priceAmount(value) {
  const match = /^(?:Starting at )?\$([0-9][0-9,]*(?:\.\d{2})?) USD$/i.exec(clean(value, 300));
  if (!match) return null;
  const amount = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(amount) && amount >= 0 ? Number(amount.toFixed(2)) : null;
}

function mediaMap(document) {
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning') {
    throw new Error('The media index metadata is invalid.');
  }
  const entries = Array.isArray(document?.images) ? document.images : [];
  const result = new Map();
  for (const entry of entries) {
    const sourceUrl = canonicalUrl(entry?.sourceUrl, ECS_IMAGE_HOST);
    const localPath = clean(entry?.localPath, 500).replaceAll('\\', '/').replace(/^\/+/, '');
    const width = Number(entry?.width);
    const height = Number(entry?.height);
    const sha256 = clean(entry?.sha256, 64).toLowerCase();
    const contentType = clean(entry?.contentType, 40).toLowerCase();
    if (!sourceUrl || !SAFE_ASSET_PATH.test(localPath) || !Number.isInteger(width)
      || !Number.isInteger(height) || width < 100 || height < 100 || width > 8_000 || height > 8_000
      || !/^[a-f0-9]{64}$/.test(sha256) || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      throw new Error('The media index contains an invalid ECS product image.');
    }
    result.set(sourceUrl, { src: localPath, width, height, sourceUrl, sha256, contentType });
  }
  return result;
}

function validateRecord(record, index, scope) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Record ${index + 1} is not an object.`);
  }
  const ecsDigits = clean(record.ecsPartNumber, 40).replace(/^ES#/i, '');
  const productUrl = canonicalUrl(record.productUrl, ECS_PRODUCT_HOST, PRODUCT_PATH);
  const imageUrl = canonicalUrl(record.imageUrl, ECS_IMAGE_HOST) || ECS_PLACEHOLDER_IMAGE;
  const imageFallbackUrl = canonicalUrl(record.imageFallbackUrl, ECS_IMAGE_HOST) || ECS_PLACEHOLDER_IMAGE;
  const vehicle = clean(record.vehicle, 160);
  const category = clean(record.category, 160);
  const sourceUrl = canonicalUrl(record.sourceUrl, ECS_PRODUCT_HOST);
  const timestamp = observedAt(record.observedAt);
  const price = priceAmount(record.priceText);
  const quarantinedCategory = scope.quarantinedCategories?.find(item => item.name === category) || null;
  const quarantineMatches = quarantinedCategory
    ? record?.excludeFromCustomerFacing === true
      && clean(record?.catalogueDisposition, 40) === 'quarantined'
      && clean(record?.quarantineReason, 500) === quarantinedCategory.quarantineReason
    : record?.excludeFromCustomerFacing !== true
      && clean(record?.catalogueDisposition, 40) !== 'quarantined';
  let sourceMatchesScope = false;
  if (sourceUrl) {
    const sourcePath = new URL(sourceUrl).pathname;
    const expectedPath = expectedCategorySourcePath(scope, vehicle, category);
    if (expectedPath) {
      const pageSuffix = sourcePath.slice(expectedPath.length);
      sourceMatchesScope = sourcePath.startsWith(expectedPath)
        && (pageSuffix === '' || /^[1-9]\d*$/.test(pageSuffix));
    }
  }
  if (!/^\d{3,12}$/.test(ecsDigits) || !productUrl
    || !VEHICLES[vehicle] || !scope.categoryAr[category] || !sourceMatchesScope || !timestamp
    || price === null || !quarantineMatches) {
    throw new Error(`Record ${index + 1} failed ECS source validation.`);
  }
  const required = ['title', 'manufacturerPartNumber', 'availabilityText'];
  for (const key of required) {
    if (!clean(record[key], key === 'description' ? 5_000 : 500)) {
      throw new Error(`Record ${index + 1} is missing ${key}.`);
    }
  }
  const position = Number(record.relevancePosition);
  if (!Number.isInteger(position) || position < 1 || position > 100_000) {
    throw new Error(`Record ${index + 1} has an invalid relevance position.`);
  }
  return {
    ...record,
    title: clean(record.title, 300),
    description: supplierCopy(record.description, 5_000),
    brand: clean(record.brand, 160),
    ecsDigits,
    manufacturerPartNumber: clean(record.manufacturerPartNumber, 160),
    price,
    availabilityText: clean(record.availabilityText, 300),
    shippingText: clean(record.shippingText, 300),
    productUrl,
    imageUrl,
    imageFallbackUrl,
    imageAlt: supplierCopy(record.imageAlt || record.title, 500),
    category,
    vehicle,
    sourceUrl,
    relevancePosition: position,
    observedAt: timestamp
  };
}

function validateCaptureCompleteness(document, records, scope) {
  const expectedVehicles = Object.keys(VEHICLES);
  const expectedCategories = Object.keys(scope.categoryAr);
  if (!Array.isArray(document.vehicleCategories)) {
    throw new Error('The ECS capture is missing its vehicle/category reconciliation manifest.');
  }
  const manifestVehicles = document.vehicleCategories.map(entry => clean(entry?.vehicle, 160));
  if (manifestVehicles.length !== expectedVehicles.length
    || new Set(manifestVehicles).size !== expectedVehicles.length
    || expectedVehicles.some(vehicle => !manifestVehicles.includes(vehicle))) {
    throw new Error('The ECS capture does not contain the complete requested G87/G80/G82 manifest.');
  }
  for (const vehicle of expectedVehicles) {
    for (const [categoryIndex, category] of expectedCategories.entries()) {
      const expectedCount = expectedCategoryCount(scope, vehicle, category, categoryIndex);
      const matching = records.filter(record => record.vehicle === vehicle && record.category === category);
      const positions = new Set(matching.map(record => record.relevancePosition));
      if (matching.length !== expectedCount || positions.size !== expectedCount
        || [...positions].some(position => position < 1 || position > expectedCount)) {
        throw new Error(`The ECS capture does not reconcile ${vehicle} / ${category}.`);
      }
    }
  }
  for (const vehicleEntry of Array.isArray(document.vehicleCategories) ? document.vehicleCategories : []) {
    const vehicle = clean(vehicleEntry?.vehicle, 160);
    if (!VEHICLES[vehicle] || !Array.isArray(vehicleEntry.categories)) {
      throw new Error(`The ECS category manifest is invalid for ${vehicle || 'an unknown vehicle'}.`);
    }
    const expectedPresentCategories = expectedCategories.filter((category, index) =>
      expectedCategoryCount(scope, vehicle, category, index) > 0);
    const manifestCategories = vehicleEntry.categories.map(entry => clean(entry?.name, 160));
    if (manifestCategories.length !== expectedPresentCategories.length
      || new Set(manifestCategories).size !== expectedPresentCategories.length
      || expectedPresentCategories.some(category => !manifestCategories.includes(category))) {
      throw new Error(`The ECS category manifest is incomplete for ${vehicle}.`);
    }
    for (const categoryEntry of vehicleEntry.categories) {
      const category = clean(categoryEntry?.name, 160);
      const expectedIndex = expectedCategories.indexOf(category);
      const categoryUrl = canonicalUrl(categoryEntry?.url, ECS_PRODUCT_HOST);
      if (expectedIndex < 0 || !categoryUrl
        || Number(categoryEntry?.count) !== expectedCategoryCount(scope, vehicle, category, expectedIndex)) {
        throw new Error(`The ECS category manifest conflicts with the captured scope for ${vehicle}.`);
      }
    }
  }
}

function fitmentFor(vehicle, scope) {
  const details = VEHICLES[vehicle];
  return {
    make: 'BMW', model: details.model, models: [details.model], trim: details.trim, generation: details.generation,
    chassis: [details.generation], yearFrom: null, yearTo: null, engines: ['S58'], drivetrains: [],
    confidence: 'possible', evidence: `ecs-vehicle-${scope.key}-category`,
    note: `Listed by ECS under this vehicle ${scope.label} category; confirm VIN, model year, engine, drivetrain and options before order.`,
    noteAr: scope.fitmentNoteAr
  };
}

function availabilityTextAr(value) {
  const source = clean(value, 300);
  if (/^in stock(?: at vendor)?$/i.test(source)) return 'متوفر لدى المورد';
  const businessDays = /^ships in (\d+) business days?$/i.exec(source);
  if (businessDays) return `يشحن المورد خلال ${businessDays[1]} أيام عمل`;
  const shipsOn = /^ships on (.+)$/i.exec(source);
  if (shipsOn) return `موعد شحن المورد المتوقع: ${shipsOn[1]}`;
  if (/back[ -]?ordered/i.test(source)) return 'طلب مؤجل لدى المورد';
  return source ? `حالة المورد: ${source}` : 'يلزم تأكيد حالة المورد';
}

function bestText(observations, key, maximum) {
  const value = observations.map(record => clean(record[key], maximum)).find(Boolean);
  return value || '';
}

function related(products, product) {
  return products.filter(candidate => candidate.slug !== product.slug).map(candidate => ({
    slug: candidate.slug,
    score: (candidate.category === product.category ? 4 : 0)
      + (candidate.brand === product.brand ? 2 : 0)
      + (candidate.fitments.some(fitment => product.fitments.some(item => item.generation === fitment.generation)) ? 1 : 0)
  })).filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug))
    .slice(0, 4).map(candidate => candidate.slug);
}

export function prepareGSeriesCatalogue(rawDocument, mediaDocument, {
  minimumProducts = 1,
  requireCompleteScope = true,
  scopeName = 'performance',
  scopeManifest = null
} = {}) {
  const scope = catalogueScope(scopeName, scopeManifest || rawDocument?.scopeManifest);
  if (!rawDocument || rawDocument.supplier !== 'ECS Tuning' || !Array.isArray(rawDocument.records)) {
    throw new Error('The ECS G-Series listing capture is invalid.');
  }
  if (!Number.isInteger(minimumProducts) || minimumProducts < 1) throw new Error('minimumProducts must be a positive integer.');
  const media = mediaMap(mediaDocument);
  const groups = new Map();
  const validatedRecords = rawDocument.records.map((record, index) => validateRecord(record, index, scope));
  if (requireCompleteScope) validateCaptureCompleteness(rawDocument, validatedRecords, scope);
  const quarantinedCategoryNames = new Set((scope.quarantinedCategories || []).map(category => category.name));
  const quarantinedEcsDigits = new Set(validatedRecords
    .filter(record => quarantinedCategoryNames.has(record.category))
    .map(record => record.ecsDigits));
  const customerFacingRecords = validatedRecords.filter(record => !quarantinedEcsDigits.has(record.ecsDigits));
  customerFacingRecords.forEach(record => {
    groups.set(record.ecsDigits, [...(groups.get(record.ecsDigits) || []), record]);
  });
  const products = [];
  for (const [ecsDigits, observations] of groups) {
    const urls = new Set(observations.map(record => record.productUrl));
    const mpns = new Set(observations.map(record => record.manufacturerPartNumber.toLocaleLowerCase('en-US')));
    if (urls.size !== 1 || mpns.size !== 1) throw new Error(`Conflicting supplier identity for ES#${ecsDigits}.`);
    observations.sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)
      || left.relevancePosition - right.relevancePosition);
    const current = observations[0];
    const preferredImageUrls = observations.flatMap(record => [record.imageUrl, record.imageFallbackUrl])
      .filter(url => url !== ECS_PLACEHOLDER_IMAGE);
    const sourceImage = preferredImageUrls.map(url => media.get(url)).find(Boolean);
    const image = sourceImage || media.get(ECS_PLACEHOLDER_IMAGE);
    if (!image) throw new Error(`Verified local media and the official ECS fallback are missing for ES#${ecsDigits}.`);
    const vehicles = [...new Set(observations.map(record => record.vehicle))];
    const categories = [...new Set(observations.map(record => record.category))];
    const category = categories[0];
    const checkedDate = current.observedAt.slice(0, 10);
    const slug = `es-${ecsDigits}`;
    const fitments = vehicles.map(vehicle => fitmentFor(vehicle, scope));
    const brand = bestText(observations, 'brand', 160) || 'Supplier brand not provided';
    const supplierDescription = bestText(observations, 'description', 5_000);
    const description = supplierDescription || 'ECS did not provide a catalogue description for this listing. Confirm product details before order.';
    const descriptionAr = supplierDescription
      ? `وصف المورد الأصلي: ${supplierDescription}`
      : 'لم توفر ECS وصفاً لهذا المنتج في الكتالوج. يرجى تأكيد تفاصيل المنتج قبل الطلب.';
    const usesPlaceholder = image.sourceUrl === ECS_PLACEHOLDER_IMAGE || !sourceImage;
    const observedPrices = new Set(observations.map(record => record.price));
    const priceConflict = observedPrices.size > 1;
    const startingPrice = /^starting\s+at\b/i.test(current.priceText);
    const zeroPrice = current.price <= 0;
    const variablePrice = startingPrice || zeroPrice || priceConflict;
    const filters = {
      supplier: ['ecs'], makes: ['BMW'], models: [...new Set(fitments.flatMap(item => item.models))],
      chassis: [...new Set(fitments.flatMap(item => item.chassis))], years: [], engines: ['S58'], drivetrains: [],
      brands: [slugify(brand)], categories: scope.parentCategorySlug
        ? [scope.parentCategorySlug, ...categories.map(item => scope.categorySlugs?.[item] || slugify(item))]
        : categories.map(slugify),
      subcategories: [], availability: ['confirmation-required'], fitment: ['possible']
    };
    products.push({
      catalogType: 'product', provider: 'ECS Tuning', providerSlug: 'ecs',
      dataOrigin: 'authorized-public-vehicle-category-review', catalogueStatus: 'reviewed-partial',
      quoteOnly: variablePrice, purchaseMode: variablePrice ? 'request-price' : 'fitment-confirmation-required',
      slug, publicKey: `ecs-${slug}`,
      title: current.title, titleAr: current.title,
      summary: description, summaryAr: descriptionAr,
      description, descriptionAr,
      detailedDescriptionAvailable: Boolean(supplierDescription),
      brand, brandSlug: slugify(brand),
      category, categoryAr: scope.categoryAr[category], categorySlug: scope.categorySlugs?.[category] || slugify(category),
      subcategory: null, subcategoryAr: null, subcategorySlug: null,
      sku: `ES#${ecsDigits}`, ecsPartNumber: `ES#${ecsDigits}`, mpn: current.manufacturerPartNumber,
      identifiers: { ecs: `ES#${ecsDigits}`, sku: `ES#${ecsDigits}`, mpn: current.manufacturerPartNumber },
      priceAmount: zeroPrice || priceConflict ? null : current.price, priceCurrency: 'USD',
      priceStartingAt: startingPrice && !zeroPrice && !priceConflict,
      priceConflict,
      priceType: zeroPrice || priceConflict ? 'confirmation-required'
        : startingPrice ? 'supplier-public-retail-starting-at' : 'supplier-public-retail',
      projxSellingPrice: null, priceIncludesShipping: false, priceVerifiedAt: checkedDate,
      priceNote: priceConflict
        ? `Different public ECS prices were observed for this product across the requested vehicle categories on ${checkedDate}; confirm the applicable option and current price before order.`
        : `ECS public USD price observed ${checkedDate}; shipping, customs and Kuwait delivery are excluded and final sale requires confirmation.`,
      priceNoteAr: `سعر ECS العام بالدولار الأمريكي كما ظهر بتاريخ ${checkedDate}؛ لا يشمل الشحن والجمارك والتوصيل في الكويت ويلزم التأكيد قبل البيع.`,
      status: 'Supplier status — confirmation required', statusAr: 'حالة المورد — يلزم التأكيد',
      checkedAt: checkedDate, stockObservedAt: checkedDate, staleAfterDays: 7, stockPolicy: 'manual-confirm',
      availabilityCode: 'check_availability', observedAvailability: current.availabilityText,
      observedAvailabilityAr: availabilityTextAr(current.availabilityText),
      availabilityNote: 'Availability confirmation required. The dated supplier observation is not a live stock promise.',
      availabilityNoteAr: 'يلزم تأكيد التوفر. ملاحظة المورد المؤرخة لا تمثل وعداً مباشراً بالمخزون.',
      originalUrl: current.productUrl, imageSourceUrl: image.sourceUrl,
      imageStatus: usesPlaceholder ? 'supplier-media-unavailable' : 'supplier-media-verified',
      images: [{
        src: image.src,
        width: image.width,
        height: image.height,
        alt: usesPlaceholder ? `Product image not supplied by ECS for ${current.title}` : current.imageAlt,
        altAr: usesPlaceholder ? `لم توفر ECS صورة للمنتج: ${current.title}` : current.title
      }],
      fitmentStatus: 'supplier-vehicle-category-confirm', fitmentConfidence: 'possible', fitments, filters,
      specifications: [], options: [], variants: [],
      selectionEvidence: 'ecs-vehicle-category-relevance',
      selectionRank: Math.min(...observations.map(record => record.relevancePosition)),
      selectionNote: `Listed in ECS vehicle ${scope.label} categories using the displayed Relevance order; ECS does not publish unit-sales ranking.`,
      selectionNoteAr: scope.selectionNoteAr,
      selectionSources: observations.map(record => ({
        vehicle: record.vehicle, category: record.category, sourceUrl: record.sourceUrl,
        relevancePosition: record.relevancePosition, observedAt: record.observedAt
      })),
      installation: { status: 'confirmation-required', note: 'Professional fitment review is required before order.' },
      shipping: {
        status: 'quote-required', origin: 'United States', observedSupplierMessage: current.shippingText || null,
        note: 'Shipping to Kuwait, customs and local delivery are confirmed separately before order.'
      },
      seo: { pageTitle: `${current.title} | Projx Racing`, metaDescription: description, path: `/parts/${slug}/` },
      relatedProductSlugs: []
    });
  }
  products.sort((left, right) => left.selectionRank - right.selectionRank || left.slug.localeCompare(right.slug));
  if (products.length < minimumProducts) throw new Error(`Only ${products.length} unique products were prepared; ${minimumProducts} are required.`);
  for (const product of products) product.relatedProductSlugs = related(products, product);
  return products;
}

export function prepareGSeriesPerformance(rawDocument, mediaDocument, options = {}) {
  return prepareGSeriesCatalogue(rawDocument, mediaDocument, { ...options, scopeName: 'performance' });
}

export function prepareGSeriesExterior(rawDocument, mediaDocument, options = {}) {
  return prepareGSeriesCatalogue(rawDocument, mediaDocument, { ...options, scopeName: 'exterior' });
}

export function prepareGSeriesInterior(rawDocument, mediaDocument, options = {}) {
  return prepareGSeriesCatalogue(rawDocument, mediaDocument, { ...options, scopeName: 'interior' });
}

export function prepareGSeriesDrivetrain(rawDocument, mediaDocument, options = {}) {
  return prepareGSeriesCatalogue(rawDocument, mediaDocument, { ...options, scopeName: 'drivetrain' });
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function verifyMediaIntegrity(document) {
  const indexed = mediaMap(document);
  for (const image of indexed.values()) {
    const absolute = path.resolve(REPO, image.src);
    if (!inside(REPO, absolute)) throw new Error('A media file resolves outside the repository.');
    let bytes;
    try {
      bytes = await readFile(absolute);
    } catch {
      throw new Error(`A verified media file is missing: ${image.src}`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== image.sha256) throw new Error(`A verified media file failed its SHA-256 check: ${image.src}`);
  }
}

async function writeAtomic(destination, value) {
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, destination);
}

async function main() {
  const input = option('--input');
  const mediaIndex = option('--media-index');
  const output = option('--output');
  const reportPath = option('--report');
  const scopeManifestPath = option('--scope-manifest');
  const minimumProducts = Number(option('--minimum-products') || 1);
  const scopeName = option('--scope') || 'performance';
  if (!input || !mediaIndex || !output) {
    throw new Error('Usage: prepare-g-series-performance.mjs --input <capture.json> --media-index <media.json> --output <module.js> [--scope performance|exterior|interior|drivetrain] [--scope-manifest <manifest.json>] [--report <report.json>] [--minimum-products <count>]');
  }
  if (!CATALOGUE_SCOPES[scopeName]) throw new Error(`Unknown ECS G-Series catalogue scope: ${scopeName}.`);
  const [rawDocument, mediaDocument, explicitScopeManifest] = await Promise.all([
    readFile(path.resolve(input), 'utf8').then(JSON.parse),
    readFile(path.resolve(mediaIndex), 'utf8').then(JSON.parse),
    scopeManifestPath ? readFile(path.resolve(scopeManifestPath), 'utf8').then(JSON.parse) : Promise.resolve(null)
  ]);
  const scopeManifest = explicitScopeManifest || rawDocument?.scopeManifest || null;
  const scope = catalogueScope(scopeName, scopeManifest);
  await verifyMediaIntegrity(mediaDocument);
  const products = prepareGSeriesCatalogue(rawDocument, mediaDocument, { minimumProducts, scopeName, scopeManifest });
  const quarantinedCategoryNames = new Set((scope.quarantinedCategories || []).map(category => category.name));
  const quarantinedEcsIdentities = [...new Set(rawDocument.records
    .filter(record => quarantinedCategoryNames.has(clean(record?.category, 160)))
    .map(record => clean(record?.ecsPartNumber, 40).replace(/^ES#/i, ''))
    .filter(value => /^\d{3,12}$/.test(value)))].sort((left, right) => Number(left) - Number(right));
  const absoluteOutput = path.resolve(output);
  const relativeOutput = path.relative(REPO, absoluteOutput);
  if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('The generated module must stay inside the repository.');
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  const quarantineExport = scopeName === 'drivetrain'
    ? `export const ECS_G_SERIES_DRIVETRAIN_QUARANTINED_ECS_IDENTITIES = Object.freeze(${JSON.stringify(quarantinedEcsIdentities, null, 2)});\n`
    : '';
  const moduleBody = `// Generated from a validated, dated ECS vehicle-category capture.\n${quarantineExport}export const ${scope.exportName} = Object.freeze(${JSON.stringify(products, null, 2)});\n`;
  await writeAtomic(absoluteOutput, moduleBody);
  const report = {
    schemaVersion: 1, supplier: 'ECS Tuning', generatedAt: observedAt(rawDocument.generatedAt),
    rawRecordCount: rawDocument.records.length, uniqueProductCount: products.length,
    duplicateObservationCount: rawDocument.records.length - products.length,
    imageCount: products.length,
    verifiedProductImageCount: products.filter(product => product.imageStatus === 'supplier-media-verified').length,
    placeholderImageCount: products.filter(product => product.imageStatus === 'supplier-media-unavailable').length,
    priceCount: products.filter(product => product.priceAmount !== null && Number.isFinite(product.priceAmount)).length,
    startingPriceCount: products.filter(product => product.priceStartingAt).length,
    requestPriceCount: products.filter(product => product.priceAmount === null).length,
    conflictingPriceCount: products.filter(product => product.priceConflict).length,
    missingDescriptionCount: products.filter(product => !product.detailedDescriptionAvailable).length,
    missingBrandCount: products.filter(product => product.brand === 'Supplier brand not provided').length,
    scope: scopeName,
    quarantinedPlacementCount: rawDocument.records
      .filter(record => quarantinedCategoryNames.has(clean(record?.category, 160))).length,
    quarantinedProductCount: quarantinedEcsIdentities.length,
    quarantinedEcsIdentities,
    vehicleCounts: Object.fromEntries(Object.keys(VEHICLES).map(vehicle => [vehicle,
      products.filter(product => product.selectionSources.some(source => source.vehicle === vehicle)).length]))
  };
  if (reportPath) {
    const absoluteReport = path.resolve(reportPath);
    const relativeReport = path.relative(REPO, absoluteReport);
    if (relativeReport.startsWith('..') || path.isAbsolute(relativeReport)) throw new Error('The report must stay inside the repository.');
    await mkdir(path.dirname(absoluteReport), { recursive: true });
    await writeAtomic(absoluteReport, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
