import { CategoryProfileSchema } from '@/src/product-consultation/core/consultation-core.schema';

import { GENERIC_ATTRIBUTES } from './shared.attributes';

export const GENERIC_PROFILE = CategoryProfileSchema.parse({
  id: 'GENERIC',

  version: 1,

  attributes: GENERIC_ATTRIBUTES,

  /**
   * Availability здесь намеренно отсутствует.
   *
   * Product Consultation работает только
   * с товарами, которые backend уже признал
   * допустимыми для показа.
   */
  defaultCriteria: ['price', 'brand', 'type'],

  criticalAttributes: ['type'],

  guidance: [
    {
      id: 'generic.task',

      when: 'Класс товара или задача пользователя определены недостаточно точно.',

      attributeIds: ['type', 'subcategory'],

      instruction:
        'Уточняй класс товара только когда это действительно меняет выбор. ' +
        'Не выводи назначение товара только из его названия или ассоциаций.',
    },

    {
      id: 'generic.price',

      when: 'Цена или бюджет влияют на выбор пользователя.',

      attributeIds: ['price'],

      instruction:
        'Связывай цену с бюджетом пользователя и известными различиями ' +
        'между товарами. Более высокая цена сама по себе не означает ' +
        'более подходящий товар.',
    },
  ],

  questions: [
    {
      id: 'generic.product-class',

      when:
        'Категория неизвестна и выбор специализированного профиля ' +
        'существенно изменит консультацию.',

      attributeIds: ['type', 'subcategory'],

      question: 'Какой именно тип товара вы рассматриваете?',
    },
  ],

  knowledgeRefs: [],
});
