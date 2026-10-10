import type { OrderRequest } from '../schemas/order-request.schema';
import type { ClarificationOption } from '../schemas/clarification-response.schema';
import type { ClarificationTopic } from '../schemas/clarification-topic.schema';

type KnowledgeResolution = {
  kind: 'knowledge';
  knowledgeKey: string;
};

type ProductInputResolution = {
  kind: 'product_input';
};

type ProductAgentResolution = {
  kind: 'product_agent';
};

type OrderAgentResolution = {
  kind: 'order_agent';
  orderRequest: OrderRequest;
};

export type ClarificationResolution =
  | KnowledgeResolution
  | ProductInputResolution
  | ProductAgentResolution
  | OrderAgentResolution;

export type ClarificationQuestion = ClarificationOption & {
  resolution: ClarificationResolution;
};

interface ClarificationTopicConfig {
  label: string;
  questions: ClarificationQuestion[];
}

export const clarificationConfig = {
  delivery: {
    label: 'Доставка',
    questions: [
      {
        id: 'delivery_moscow_courier',
        label: 'Курьерская доставка по Москве и МО',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'shipping_moscow_courier',
        },
      },
      {
        id: 'delivery_russia_cdek',
        label: 'Доставка СДЭК по России',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'shipping_russia_cdek',
        },
      },
      {
        id: 'delivery_russia_post',
        label: 'Доставка Почтой России',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'shipping_russia_post',
        },
      },
      {
        id: 'delivery_belarus',
        label: 'Доставка в Беларусь',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'shipping_belarus_cdek',
        },
      },
      {
        id: 'delivery_kazakhstan',
        label: 'Доставка в Казахстан',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'shipping_kazakhstan_cdek',
        },
      },
    ],
  },

  product_search: {
    label: 'Товары и подбор',
    questions: [
      {
        id: 'product_search_help',
        label: 'Помогите подобрать товар',
        resolution: {
          kind: 'product_input',
        },
      },
      {
        id: 'product_search_similar',
        label: 'Помогите найти похожий товар',
        resolution: {
          kind: 'product_agent',
        },
      },
      {
        id: 'product_search_size',
        label: 'Как правильно подобрать размер?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'products_size_table',
        },
      },
      {
        id: 'product_search_restock',
        label: 'Будет ли товар или размер снова в наличии?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'products_restock',
        },
      },
      {
        id: 'product_search_reservation',
        label: 'Можно ли зарезервировать товар?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'products_reservation',
        },
      },
    ],
  },

  orders: {
    label: 'Заказы',
    questions: [
      {
        id: 'order_status',
        label: 'Где находится мой заказ?',
        resolution: {
          kind: 'order_agent',
          orderRequest: {
            action: 'RELEVANT',
            orderId: null,
          },
        },
      },
      {
        id: 'order_not_shipped',
        label: 'Когда заказ отправят?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'orders_processing_and_shipping',
        },
      },
      {
        id: 'order_tracking',
        label: 'Как отследить отправленный заказ?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'orders_tracking',
        },
      },
      {
        id: 'order_cancel',
        label: 'Отменить заказ',
        resolution: {
          kind: 'order_agent',
          orderRequest: {
            action: 'CANCEL',
            orderId: null,
          },
        },
      },
    ],
  },

  returns_claims: {
    label: 'Возвраты и претензии',
    questions: [
      {
        id: 'return_create',
        label: 'Как вернуть товар?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'returns_how_to_return_item',
        },
      },
      {
        id: 'return_conditions',
        label: 'Какие условия возврата?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'returns_item_condition',
        },
      },
      {
        id: 'return_money',
        label: 'Когда и как вернут деньги?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'returns_refund_method_and_timing',
        },
      },
      {
        id: 'return_defect',
        label: 'Что делать, если товар пришёл с браком?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'claims_defective_product',
        },
      },
      {
        id: 'return_non_returnable',
        label: 'Какие товары нельзя вернуть?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'returns_non_returnable_items',
        },
      },
    ],
  },

  payment: {
    label: 'Оплата',
    questions: [
      {
        id: 'payment_moscow',
        label: 'Способы оплаты в Москве',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'payment_methods_moscow',
        },
      },
      {
        id: 'payment_russia',
        label: 'Способы оплаты по России',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'payment_methods_russia',
        },
      },
      {
        id: 'payment_on_delivery',
        label: 'Можно ли оплатить при получении?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'payment_cash_on_delivery_available',
        },
      },
      {
        id: 'payment_card',
        label: 'Как оплатить картой на сайте?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'payment_card_checkout',
        },
      },
      {
        id: 'payment_belarus_kazakhstan',
        label: 'Оплата в Беларусь и Казахстан',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'payment_methods_belarus_kazakhstan',
        },
      },
    ],
  },

  discounts: {
    label: 'Скидки и промокоды',
    questions: [
      {
        id: 'discount_get',
        label: 'Как получить скидку?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'discounts_get_discount',
        },
      },
      {
        id: 'promo_where',
        label: 'Куда вводить промокод?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'discounts_promo_code_where',
        },
      },
      {
        id: 'promo_not_working',
        label: 'Почему промокод не работает?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'discounts_promo_code_not_working',
        },
      },
      {
        id: 'discount_combine',
        label: 'Можно ли совместить скидки и промокоды?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'discounts_multiple_discounts',
        },
      },
      {
        id: 'discount_birthday',
        label: 'Скидка ко дню рождения',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'discounts_birthday',
        },
      },
    ],
  },

  loyalty: {
    label: 'Программа лояльности',
    questions: [
      {
        id: 'loyalty_overview',
        label: 'Как работает программа лояльности?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'loyalty_program_overview',
        },
      },
      {
        id: 'loyalty_join',
        label: 'Как вступить в программу?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'loyalty_how_to_join',
        },
      },
      {
        id: 'loyalty_discount',
        label: 'Какая персональная скидка?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'loyalty_discount_levels',
        },
      },
      {
        id: 'loyalty_accumulation',
        label: 'Как узнать сумму накоплений?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'loyalty_check_accumulation',
        },
      },
      {
        id: 'loyalty_virtual_card',
        label: 'Как получить виртуальную карту?',
        resolution: {
          kind: 'knowledge',
          knowledgeKey: 'loyalty_virtual_card',
        },
      },
    ],
  },
} satisfies Record<ClarificationTopic, ClarificationTopicConfig>;

export const clarificationTopicOrder = [
  'delivery',
  'product_search',
  'orders',
  'returns_claims',
  'payment',
  'discounts',
  'loyalty',
] as const satisfies readonly ClarificationTopic[];

export function getKnowledgeKeys(
  questions: readonly ClarificationQuestion[],
): string[] {
  return questions.flatMap((question) =>
    question.resolution.kind === 'knowledge'
      ? [question.resolution.knowledgeKey]
      : [],
  );
}

export function filterAvailableClarificationQuestions(
  questions: readonly ClarificationQuestion[],
  activeKnowledgeKeys: ReadonlySet<string>,
): ClarificationQuestion[] {
  return questions.filter((question) => {
    if (question.resolution.kind !== 'knowledge') {
      return true;
    }

    return activeKnowledgeKeys.has(question.resolution.knowledgeKey);
  });
}

export function findClarificationQuestion(questionId: string): {
  topic: ClarificationTopic;
  question: ClarificationQuestion;
} | null {
  for (const topic of clarificationTopicOrder) {
    const question = clarificationConfig[topic].questions.find(
      (candidate) => candidate.id === questionId,
    );

    if (question) {
      return {
        topic,
        question,
      };
    }
  }

  return null;
}
