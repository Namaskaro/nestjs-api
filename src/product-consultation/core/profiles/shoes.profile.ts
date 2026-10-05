import { CategoryProfileSchema } from '@/src/product-consultation/core/consultation-core.schema';

import {
  GENERIC_ATTRIBUTES,
  colorAttribute,
  compositionAttribute,
  genderAttribute,
  liningAttribute,
  materialAttribute,
  purposeAttribute,
  seasonAttribute,
  sizesAttribute,
  soleAttribute,
  upperMaterialAttribute,
  waterProtectionAttribute,
  weightAttribute,
} from './shared.attributes';

export const SHOES_PROFILE = CategoryProfileSchema.parse({
  id: 'SHOES',

  version: 2,

  attributes: [
    ...GENERIC_ATTRIBUTES,

    genderAttribute,

    colorAttribute,

    sizesAttribute,

    materialAttribute,

    compositionAttribute,

    upperMaterialAttribute,

    seasonAttribute,

    purposeAttribute,

    soleAttribute,

    liningAttribute,

    weightAttribute,

    waterProtectionAttribute,
  ],

  defaultCriteria: [
    'price',
    'upperMaterial',
    'material',
    'season',
    'purpose',
    'sizes',
  ],

  criticalAttributes: ['sizes', 'purpose'],

  searchRelaxationAttributeIds: ['color', 'brand', 'price'],

  guidance: [
    {
      id: 'shoes.purpose',

      when: 'Обувь выбирают для спорта или специальной нагрузки.',

      attributeIds: ['purpose', 'sole'],

      instruction:
        'Спортивный стиль, название модели или ассоциации бренда сами по себе не подтверждают пригодность для конкретной нагрузки. Используй заявленное назначение, известные характеристики конструкции и подтверждённое описание товара.',
    },

    {
      id: 'shoes.walking',

      when: 'Обувь нужна для ежедневной или длительной ходьбы.',

      attributeIds: ['purpose', 'sole', 'upperMaterial', 'material'],

      instruction:
        'Для ходьбы используй подтверждённые характеристики и описание товара. Учитывай сведения об амортизации, конструкции подошвы, сцеплении, материалах, вентиляции, опоре и повседневном назначении, если они действительно следуют из данных товара. Допускай осторожные практические выводы из явно описанной конструкции, но не превращай их в гарантию индивидуального комфорта или отсутствия усталости.',
    },

    {
      id: 'shoes.fit',

      when: 'Пользователь выбирает размер.',

      attributeIds: ['sizes'],

      instruction:
        'Каталожный размер не гарантирует индивидуальную посадку. Количество доступных размеров само по себе не является преимуществом товара. Используй размеры как критерий рекомендации только когда известен размер пользователя и можно проверить его наличие у конкретного товара.',
    },

    {
      id: 'shoes.weather',

      when: 'Важны дождь, холод или сезон.',

      attributeIds: ['season', 'waterProtection', 'upperMaterial', 'material'],

      instruction:
        'Сезонность не равна точному температурному диапазону или водонепроницаемости. Используй подтверждённую водозащиту, материалы и сведения из описания. Не объявляй материал водонепроницаемым только по его названию.',
    },

    {
      id: 'shoes.material',

      when: 'Пользователь сравнивает материалы.',

      attributeIds: ['material', 'upperMaterial', 'composition'],

      instruction:
        'Различай основной материал, материал верха и состав. Не объявляй один материал универсально лучшим. Связывай свойства материала с задачей пользователя только при наличии понятного основания в данных или описании товара.',
    },

    {
      id: 'shoes.price',

      when: 'Есть бюджет или ценовой компромисс.',

      attributeIds: ['price'],

      instruction:
        'Цена сама по себе не определяет качество товара. Более дешёвый вариант является преимуществом только если цена или бюджет действительно важны пользователю. Более дорогой вариант предлагай только при наличии подтверждённого преимущества, связанного с задачей пользователя.',
    },
  ],

  questions: [
    {
      id: 'shoes.activity',

      when: 'Неясно, нужна ли обувь для прогулок или тренировок, и это существенно меняет уже запрошенную рекомендацию.',

      attributeIds: ['purpose'],

      question: 'Обувь нужна для повседневной ходьбы или для тренировок?',
    },

    {
      id: 'shoes.size',

      when: 'Размер необходим для следующего шага выбора.',

      attributeIds: ['sizes'],

      question: 'Какой размер вы обычно носите?',
    },

    {
      id: 'shoes.rain',

      when: 'Дождливая погода существенна, но обязательность водозащиты неизвестна.',

      attributeIds: ['waterProtection'],

      question:
        'Водозащита обязательна или обувь в основном нужна для сухой погоды?',
    },
  ],

  knowledgeRefs: [],
});
