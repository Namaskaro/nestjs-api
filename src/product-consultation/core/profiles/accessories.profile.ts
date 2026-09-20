// START CHANGES — EXPANDED FASHION ACCESSORIES CATEGORY PROFILE

import { CategoryProfileSchema } from '@/src/product-consultation/core/consultation-core.schema';
import {
  GENERIC_ATTRIBUTES,
  capacityAttribute,
  careAttribute,
  colorAttribute,
  compositionAttribute,
  defineAttribute,
  dimensionsAttribute,
  fitAttribute,
  genderAttribute,
  materialAttribute,
  purposeAttribute,
  seasonAttribute,
  sizesAttribute,
  waterProtectionAttribute,
  weightAttribute,
} from './shared.attributes';

const closureAttribute = defineAttribute('closure', 'Тип застёжки');

const compartmentsAttribute = defineAttribute(
  'compartments',
  'Количество отделений',
  {
    kind: 'number',
  },
);

const frameMaterialAttribute = defineAttribute(
  'frameMaterial',
  'Материал оправы',
);

const lensMaterialAttribute = defineAttribute('lensMaterial', 'Материал линз');

const lensColorAttribute = defineAttribute('lensColor', 'Цвет линз');

const uvProtectionAttribute = defineAttribute(
  'uvProtection',
  'Защита от ультрафиолета',
  {
    kind: 'boolean',
  },
);

const polarizationAttribute = defineAttribute('polarization', 'Поляризация', {
  kind: 'boolean',
});

const movementTypeAttribute = defineAttribute('movementType', 'Тип механизма');

const strapMaterialAttribute = defineAttribute(
  'strapMaterial',
  'Материал ремешка',
);

const caseMaterialAttribute = defineAttribute(
  'caseMaterial',
  'Материал корпуса',
);

const caseDiameterAttribute = defineAttribute(
  'caseDiameter',
  'Диаметр корпуса',
  {
    kind: 'number',
    unit: 'mm',
  },
);

const insulationAttribute = defineAttribute('insulation', 'Утепление');

export const ACCESSORIES_PROFILE = CategoryProfileSchema.parse({
  id: 'ACCESSORIES',

  version: 1,

  attributes: [
    ...GENERIC_ATTRIBUTES,

    genderAttribute,
    colorAttribute,
    sizesAttribute,

    materialAttribute,
    compositionAttribute,

    fitAttribute,
    seasonAttribute,
    purposeAttribute,
    careAttribute,

    waterProtectionAttribute,

    /*
     * Сумки / рюкзаки.
     * Не являются default criteria всей категории.
     */
    dimensionsAttribute,
    capacityAttribute,
    weightAttribute,
    closureAttribute,
    compartmentsAttribute,

    /*
     * Очки.
     */
    frameMaterialAttribute,
    lensMaterialAttribute,
    lensColorAttribute,
    uvProtectionAttribute,
    polarizationAttribute,

    /*
     * Часы.
     */
    movementTypeAttribute,
    strapMaterialAttribute,
    caseMaterialAttribute,
    caseDiameterAttribute,

    /*
     * Шапки / шарфы / перчатки и другие сезонные аксессуары.
     */
    insulationAttribute,
  ],

  defaultCriteria: [
    'price',
    'subcategory',
    'material',
    'color',
    'purpose',
    'season',
  ],

  criticalAttributes: ['subcategory'],

  guidance: [
    {
      id: 'accessories.subcategory',

      when: 'Пользователь рассматривает аксессуар.',

      attributeIds: ['subcategory', 'purpose'],

      instruction:
        'ACCESSORIES является зонтичной категорией. ' +
        'Сначала учитывай конкретную подкатегорию. ' +
        'Не применяй характеристики сумок к очкам, ' +
        'характеристики часов к носкам или характеристики перчаток к кепкам.',
    },

    {
      id: 'accessories.style',

      when: 'Аксессуар выбирают как часть образа.',

      attributeIds: ['color', 'material', 'purpose'],

      instruction:
        'Связывай цвет, материал и назначение ' +
        'с задачей и предпочтениями пользователя. ' +
        'Стилевое соответствие является рекомендацией, ' +
        'а не проверяемым свойством товара.',
    },

    {
      id: 'accessories.material',

      when: 'Материал влияет на выбор.',

      attributeIds: ['material', 'composition', 'care'],

      instruction:
        'Опирайся на подтверждённый материал и состав. ' +
        'Не обещай износостойкость, комфорт, гипоаллергенность ' +
        'или срок службы только по названию материала.',
    },

    {
      id: 'accessories.wearable',

      when:
        'Выбираются носки, перчатки, шапка, кепка, панама, шарф ' +
        'или другой носимый аксессуар.',

      attributeIds: [
        'sizes',
        'fit',
        'material',
        'composition',
        'season',
        'insulation',
      ],

      instruction:
        'Учитывай размер, посадку, материал и сезонность только там, ' +
        'где они применимы к конкретной подкатегории. ' +
        'Не считай отсутствие размера ошибкой для товара, ' +
        'которому размер не нужен.',
    },

    {
      id: 'accessories.season',

      when: 'Аксессуар выбирают для определённого сезона или погоды.',

      attributeIds: ['season', 'material', 'insulation', 'waterProtection'],

      instruction:
        'Различай сезонность, утепление и водозащиту. ' +
        'Не выводи температурный диапазон ' +
        'или защиту от осадков только из материала.',
    },

    {
      id: 'accessories.eyewear',

      when: 'Подкатегория относится к солнцезащитным очкам.',

      attributeIds: [
        'frameMaterial',
        'lensMaterial',
        'lensColor',
        'uvProtection',
        'polarization',
      ],

      instruction:
        'Для очков различай внешний вид и функциональные свойства. ' +
        'Тёмный цвет линз сам по себе не доказывает UV-защиту. ' +
        'Поляризацию и защиту от ультрафиолета называй только ' +
        'при наличии подтверждённых данных.',
    },

    {
      id: 'accessories.watch',

      when: 'Подкатегория относится к часам.',

      attributeIds: [
        'movementType',
        'caseMaterial',
        'strapMaterial',
        'caseDiameter',
        'waterProtection',
      ],

      instruction:
        'Для часов учитывай механизм, материалы, размер корпуса ' +
        'и подтверждённую водозащиту. ' +
        'Не превращай наличие waterProtection ' +
        'в утверждение о пригодности для плавания или дайвинга ' +
        'без соответствующей спецификации.',
    },

    {
      id: 'accessories.bag',

      when: 'Подкатегория относится к сумке или рюкзаку.',

      attributeIds: [
        'dimensions',
        'capacity',
        'closure',
        'compartments',
        'weight',
        'material',
      ],

      instruction:
        'Для сумок и рюкзаков учитывай габариты, вместимость, ' +
        'организацию отделений и материал. ' +
        'Вес учитывай только когда он действительно важен для задачи пользователя. ' +
        'Общий объём не доказывает размер конкретного отделения.',
    },

    {
      id: 'accessories.care',

      when: 'Для пользователя важен уход за аксессуаром.',

      attributeIds: ['care', 'material', 'composition'],

      instruction:
        'Не придумывай режим ухода по материалу. ' +
        'Используй только подтверждённую инструкцию.',
    },

    {
      id: 'accessories.price',

      when: 'Пользователь сравнивает цену аксессуаров.',

      attributeIds: ['price', 'material', 'purpose'],

      instruction:
        'Более дорогой аксессуар или более известный бренд ' +
        'не означают автоматически более высокое качество. ' +
        'Связывай цену с подтверждёнными различиями.',
    },
  ],

  questions: [
    {
      id: 'accessories.subcategory',

      when:
        'Неясно, какой именно аксессуар нужен, ' +
        'и без этого нельзя выбрать релевантные характеристики.',

      attributeIds: ['subcategory'],

      question: 'Какой именно аксессуар вы ищете?',
    },

    {
      id: 'accessories.size',

      when:
        'Выбирается носимый аксессуар, ' +
        'для которого размер действительно влияет на выбор.',

      attributeIds: ['sizes'],

      question: 'Какой размер нужно учитывать?',
    },

    {
      id: 'accessories.season',

      when:
        'Шапку, перчатки, шарф или другой сезонный аксессуар ' +
        'выбирают для погоды, но сезон неизвестен.',

      attributeIds: ['season', 'insulation'],

      question: 'Для какого сезона вы выбираете аксессуар?',
    },

    {
      id: 'accessories.eyewear',

      when:
        'Выбираются солнцезащитные очки, ' +
        'и условия использования существенно меняют выбор.',

      attributeIds: ['uvProtection', 'polarization'],

      question:
        'Очки нужны в основном для города, вождения или активного отдыха?',
    },

    {
      id: 'accessories.watch',

      when:
        'Выбираются часы, а сценарий использования ' +
        'существенно влияет на характеристики.',

      attributeIds: ['movementType', 'waterProtection'],

      question:
        'Часы нужны в основном на каждый день, для спорта или для более формального образа?',
    },

    {
      id: 'accessories.bag',

      when:
        'Выбирается сумка или рюкзак, ' + 'а требуемая вместимость неизвестна.',

      attributeIds: ['dimensions', 'capacity'],

      question: 'Что вы обычно планируете носить в сумке?',
    },
  ],

  knowledgeRefs: [],
});

// END CHANGES — EXPANDED FASHION ACCESSORIES CATEGORY PROFILE
