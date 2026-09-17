// START CHANGES — EXPANDED CLOTHES CATEGORY PROFILE

import { CategoryProfileSchema } from '../consultation-core/consultation-core.schema';
import {
  GENERIC_ATTRIBUTES,
  careAttribute,
  colorAttribute,
  compositionAttribute,
  defineAttribute,
  fitAttribute,
  genderAttribute,
  liningAttribute,
  materialAttribute,
  purposeAttribute,
  seasonAttribute,
  sizesAttribute,
  waterProtectionAttribute,
} from './shared.attributes';

const patternAttribute = defineAttribute('pattern', 'Рисунок / принт');

const garmentLengthAttribute = defineAttribute(
  'garmentLength',
  'Длина изделия',
);

const sleeveLengthAttribute = defineAttribute('sleeveLength', 'Длина рукава');

const closureAttribute = defineAttribute('closure', 'Тип застёжки');

const stretchAttribute = defineAttribute('stretch', 'Эластичность');

const insulationAttribute = defineAttribute('insulation', 'Утепление');

export const CLOTHES_PROFILE = CategoryProfileSchema.parse({
  id: 'CLOTHES',

  version: 1,

  attributes: [
    ...GENERIC_ATTRIBUTES,

    genderAttribute,
    colorAttribute,
    sizesAttribute,

    materialAttribute,
    compositionAttribute,

    fitAttribute,
    patternAttribute,

    seasonAttribute,
    purposeAttribute,

    garmentLengthAttribute,
    sleeveLengthAttribute,

    liningAttribute,
    insulationAttribute,

    closureAttribute,
    stretchAttribute,

    careAttribute,
    waterProtectionAttribute,
  ],

  defaultCriteria: [
    'price',
    'color',
    'sizes',
    'material',
    'composition',
    'fit',
    'season',
    'purpose',
  ],

  criticalAttributes: ['sizes'],

  guidance: [
    {
      id: 'clothes.occasion',

      when: 'Одежду выбирают для события, работы, повседневной носки или другой конкретной ситуации.',

      attributeIds: ['purpose', 'fit', 'color', 'material'],

      instruction:
        'Связывай фасон, цвет, материал и заявленное назначение ' +
        'с задачей пользователя. ' +
        'Уместность образа является консультационной рекомендацией, ' +
        'а не объективным ProductFact.',
    },

    {
      id: 'clothes.color',

      when: 'Цвет влияет на образ или пользователь сравнивает варианты по цвету.',

      attributeIds: ['color'],

      instruction:
        'Используй фактический цвет товара. ' +
        'Не превращай собственные стилевые предпочтения модели ' +
        'в требования пользователя. ' +
        'Если пользователь обозначил желаемую палитру, связывай рекомендацию с ней.',
    },

    {
      id: 'clothes.material',

      when: 'Пользователь выбирает материал или состав.',

      attributeIds: ['material', 'composition'],

      instruction:
        'Различай основной материал и точный состав. ' +
        'Не достраивай отсутствующие компоненты. ' +
        'Не обещай долговечность, воздухопроницаемость, ' +
        'гипоаллергенность или другие свойства только по названию материала.',
    },

    {
      id: 'clothes.fit',

      when: 'Для пользователя важны посадка, силуэт или свобода движения.',

      attributeIds: ['fit', 'sizes', 'stretch', 'garmentLength'],

      instruction:
        'Используй заявленный крой, размеры, длину и эластичность. ' +
        'Маркировка размера или oversize сама по себе ' +
        'не гарантирует индивидуальную посадку.',
    },

    {
      id: 'clothes.proportions',

      when: 'Сравниваются длина изделия, длина рукава или особенности силуэта.',

      attributeIds: ['garmentLength', 'sleeveLength', 'fit'],

      instruction:
        'Опирайся на реальные характеристики изделия. ' +
        'Не придумывай посадку на конкретном росте или телосложении ' +
        'без соответствующих данных.',
    },

    {
      id: 'clothes.season',

      when: 'Одежду выбирают для сезона, холода, ветра или дождя.',

      attributeIds: [
        'season',
        'material',
        'lining',
        'insulation',
        'waterProtection',
      ],

      instruction:
        'Различай сезонность, наличие подкладки, утепление ' +
        'и подтверждённую защиту от воды. ' +
        'Не выводи конкретный температурный диапазон ' +
        'только из материала или внешнего вида.',
    },

    {
      id: 'clothes.pattern',

      when: 'Рисунок или принт влияет на выбор пользователя.',

      attributeIds: ['pattern', 'color'],

      instruction:
        'Используй указанный рисунок и цвет как характеристики товара. ' +
        'Оценку того, подходит ли сочетание пользователю, ' +
        'связывай с его задачей и предпочтениями.',
    },

    {
      id: 'clothes.construction',

      when: 'Пользователь сравнивает конструктивные особенности одежды.',

      attributeIds: ['closure', 'lining', 'stretch'],

      instruction:
        'Описывай только подтверждённые конструктивные характеристики. ' +
        'Не делай вывод о комфорте или удобстве использования ' +
        'без достаточных данных.',
    },

    {
      id: 'clothes.care',

      when: 'Для пользователя важен уход за изделием.',

      attributeIds: ['care', 'composition', 'material'],

      instruction:
        'Режим стирки, глажки и сушки называй только ' +
        'при наличии соответствующей информации. ' +
        'Не выводи правила ухода исключительно из одного материала.',
    },

    {
      id: 'clothes.price',

      when: 'Пользователь сравнивает цену и характеристики.',

      attributeIds: ['price', 'material', 'composition', 'fit'],

      instruction:
        'Объясняй конкретные подтверждённые различия. ' +
        'Более высокая цена или известный бренд ' +
        'не означают автоматически более высокое качество.',
    },
  ],

  questions: [
    {
      id: 'clothes.occasion',

      when:
        'Неясно, для какой ситуации выбирается одежда, ' +
        'и это существенно влияет на рекомендацию.',

      attributeIds: ['purpose'],

      question:
        'Для какой ситуации вы выбираете вещь: на каждый день, для работы или для события?',
    },

    {
      id: 'clothes.size',

      when: 'Размер действительно нужен для следующего шага выбора.',

      attributeIds: ['sizes'],

      question: 'Какой размер нужно учитывать?',
    },

    {
      id: 'clothes.fit',

      when:
        'Посадка существенно меняет выбор, ' +
        'а предпочтение пользователя неизвестно.',

      attributeIds: ['fit'],

      question: 'Вам ближе свободная, обычная или более прилегающая посадка?',
    },

    {
      id: 'clothes.material',

      when:
        'Пользователь обозначил требования к материалам, ' +
        'но ограничение осталось неоднозначным.',

      attributeIds: ['material', 'composition'],

      question:
        'Есть ли материалы, которые вы предпочитаете или хотите исключить?',
    },

    {
      id: 'clothes.season',

      when:
        'Условия использования сильно зависят от сезона, ' +
        'но они не указаны.',

      attributeIds: ['season'],

      question: 'Для какого сезона вы выбираете эту вещь?',
    },
  ],

  knowledgeRefs: [],
});

// END CHANGES — EXPANDED CLOTHES CATEGORY PROFILE
