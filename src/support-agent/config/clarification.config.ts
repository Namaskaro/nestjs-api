import type { ClarificationOption } from '../schemas/clarification-response.schema';
import type { ClarificationTopic } from '../schemas/clarification-topic.schema';

interface ClarificationTopicConfig {
  label: string;
  questions: ClarificationOption[];
}

export const clarificationConfig = {
  delivery: {
    label: 'Доставка',

    questions: [
      {
        id: 'delivery_cost',
        label: 'Сколько стоит доставка?',
      },
      {
        id: 'delivery_terms',
        label: 'Какие сроки доставки?',
      },
      {
        id: 'delivery_change_address',
        label: 'Как изменить адрес доставки?',
      },
      {
        id: 'delivery_reschedule',
        label: 'Можно ли перенести доставку?',
      },
      {
        id: 'delivery_track_order',
        label: 'Где находится мой заказ?',
      },
    ],
  },

  product_search: {
    label: 'Товары и подбор',

    questions: [
      {
        id: 'product_search_help',
        label: 'Помогите подобрать товар',
      },
      {
        id: 'product_search_size',
        label: 'Как правильно подобрать размер?',
      },
      {
        id: 'product_search_availability',
        label: 'Как проверить наличие товара?',
      },
      {
        id: 'product_search_similar',
        label: 'Помогите найти похожий товар',
      },
      {
        id: 'product_search_season',
        label: 'Что подойдёт для определённого сезона?',
      },
    ],
  },

  orders: {
    label: 'Заказы',

    questions: [
      {
        id: 'order_status',
        label: 'Где находится мой заказ?',
      },
      {
        id: 'order_last',
        label: 'Какой статус у моего последнего заказа?',
      },
      {
        id: 'order_change',
        label: 'Можно ли изменить заказ?',
      },
      {
        id: 'order_cancel',
        label: 'Можно ли отменить заказ?',
      },
      {
        id: 'order_not_shipped',
        label: 'Почему заказ ещё не отправлен?',
      },
    ],
  },

  returns_claims: {
    label: 'Возвраты и претензии',

    questions: [
      {
        id: 'return_conditions',
        label: 'Какие условия возврата?',
      },
      {
        id: 'return_create',
        label: 'Как оформить возврат?',
      },
      {
        id: 'return_defect',
        label: 'Что делать, если товар пришёл с дефектом?',
      },
      {
        id: 'return_money',
        label: 'Когда вернутся деньги?',
      },
      {
        id: 'return_status',
        label: 'Как проверить статус возврата?',
      },
    ],
  },

  payment: {
    label: 'Оплата',

    questions: [
      {
        id: 'payment_methods',
        label: 'Какие способы оплаты доступны?',
      },
      {
        id: 'payment_failed',
        label: 'Что делать, если оплата не прошла?',
      },
      {
        id: 'payment_on_delivery',
        label: 'Можно ли оплатить заказ при получении?',
      },
      {
        id: 'payment_withdrawal',
        label: 'Когда спишутся деньги?',
      },
      {
        id: 'payment_receipt',
        label: 'Как получить чек?',
      },
    ],
  },
} satisfies Record<ClarificationTopic, ClarificationTopicConfig>;

/**
 * Порядок отображения кнопок с темами.
 */
const clarificationTopicOrder = [
  'delivery',
  'product_search',
  'orders',
  'returns_claims',
  'payment',
] as const satisfies readonly ClarificationTopic[];

/**
 * Кнопки первого уровня.
 */
export const clarificationTopicOptions: ClarificationOption[] =
  clarificationTopicOrder.map((topic) => ({
    id: topic,
    label: clarificationConfig[topic].label,
  }));
