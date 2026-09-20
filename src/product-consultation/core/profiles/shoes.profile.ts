// START CHANGES — SHOES CATEGORY PROFILE

import { CategoryProfileSchema } from '../consultation-core/consultation-core.schema';
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

  version: 1,

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

  guidance: [
    {
      id: 'shoes.purpose',

      when: 'Обувь выбирают для спорта или специальной нагрузки.',

      attributeIds: ['purpose', 'sole'],

      instruction:
        'Спортивный стиль, имя спортсмена и ассоциации ' +
        'не подтверждают пригодность для тренировок. ' +
        'Используй заявленное назначение.',
    },

    {
      id: 'shoes.walking',

      when: 'Обувь нужна для ежедневной ходьбы.',

      attributeIds: ['weight', 'upperMaterial', 'lining', 'sole'],

      instruction:
        'Объясняй доступные различия веса и конструкции. ' +
        'Не обещай удобство, амортизацию или отсутствие усталости ' +
        'без подтверждающих данных.',
    },

    {
      id: 'shoes.fit',

      when: 'Пользователь выбирает размер.',

      attributeIds: ['sizes'],

      instruction:
        'Каталожный размер не гарантирует индивидуальную посадку. ' +
        'Не утверждай, что модель маломерит или подходит широкой стопе, ' +
        'без подтверждённых данных.',
    },

    {
      id: 'shoes.weather',

      when: 'Важны дождь, холод или сезон.',

      attributeIds: ['season', 'waterProtection', 'lining'],

      instruction:
        'Сезонность не равна температурному диапазону ' +
        'или водонепроницаемости. ' +
        'Отсутствие сведений о водозащите означает unknown.',
    },

    {
      id: 'shoes.material',

      when: 'Пользователь сравнивает материалы.',

      attributeIds: ['material', 'upperMaterial', 'composition'],

      instruction:
        'Различай основной материал, материал верха и состав. ' +
        'Не объявляй один материал универсально лучшим. ' +
        'Связывай отличие с задачей пользователя.',
    },

    {
      id: 'shoes.price',

      when: 'Есть бюджет или ценовой компромисс.',

      attributeIds: ['price'],

      instruction:
        'Предлагай более дорогой вариант только при наличии ' +
        'понятного подтверждённого преимущества, которое связано ' +
        'с задачей пользователя.',
    },
  ],

  questions: [
    {
      id: 'shoes.activity',

      when:
        'Неясно, нужна ли обувь для прогулок или тренировок, ' +
        'и это существенно меняет выбор.',

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

      when:
        'Дождливая погода существенна, ' +
        'но обязательность водозащиты неизвестна.',

      attributeIds: ['waterProtection'],

      question:
        'Водозащита обязательна или обувь в основном нужна для сухой погоды?',
    },
  ],

  knowledgeRefs: [],
});
