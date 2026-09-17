import type { SupportAgentStateType } from '../support-agent.state';

function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[!?.,;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

// ===== START CHANGE — DETERMINISTIC PRODUCT FOLLOW-UP ROUTING =====

const CUSTOMER_HELP_HINT_PATTERN =
  /(?:достав|оплат|возврат|обмен|скид|лояль|претенз|заказ|оператор)/iu;

const PRODUCT_CONTEXT_FOLLOWUP_PATTERNS = [
  /^(?:сравни|сравните)\b/iu,

  /^(?:расскажи|расскажите|покажи|покажите|дай|дайте)\b.{0,60}\b(?:подробнее|детал)/iu,

  /^подробнее\b/iu,

  /\b(?:перв(?:ый|ого|ому|ым|ом)|втор(?:ой|ого|ому|ым|ом)|трет(?:ий|ьего|ьему|ьим|ьем)|последн(?:ий|его|ему|им|ем))\b.{0,80}\b(?:нрав|дорог|дешев|лучше|хуже|подроб|сравн)/iu,

  /^(?:бренд|размер|цвет|цена)\b/iu,

  /^(?:покажи|покажите|давай|давайте)\b.{0,50}\b(?:друг(?:ой|ого|ие)|ещ[её])/iu,

  /^(?:а\s+)?(?:теперь\s+)?(?:только|без)\s+\S+/iu,

  /^(?:а\s+)?теперь\s+.+/iu,

  /^(?:бренд\s+)?(?:любой|любая|любое|не\s*важен|неважен)/iu,

  /^(?:из\s+оставшихся|выбери|выберите|посоветуй|посоветуйте)\b/iu,
];

function shouldRouteDirectlyToProductAgent(
  state: SupportAgentStateType,
): boolean {
  if (state.activeAgent !== 'productAgent') {
    return false;
  }

  const context = state.productContext;

  if (!context || context.needs.length === 0) {
    return false;
  }

  const query = normalizeQuery(state.query);

  /*
   * Если текущая реплика затрагивает другой домен магазина,
   * обязательно оставляем RequestRouter.
   *
   * Например:
   *
   * "Сравни первые два и расскажи про доставку"
   *
   * должен пройти через Router и стать multi-intent.
   */
  if (CUSTOMER_HELP_HINT_PATTERN.test(query)) {
    return false;
  }

  /*
   * ProductAgent уже задал адресное уточнение.
   *
   * Короткий ответ вроде:
   *
   * "42"
   * "Nike"
   * "Да"
   * "Нет"
   * "не важно"
   *
   * должен возвращаться непосредственно в ProductAgent.
   */
  if (context.pendingClarification && query.length <= 40) {
    return true;
  }

  /*
   * Ссылки на уже показанную выдачу имеют смысл
   * только внутри сохранённого ProductContext.
   *
   * RequestRouter здесь ничего полезного не добавляет.
   */
  if (
    context.displayOrder.length > 0 &&
    PRODUCT_CONTEXT_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(query))
  ) {
    return true;
  }

  /*
   * Изменение существующего товарного need также
   * может не иметь текущих карточек.
   *
   * Например после zero-result:
   *
   * "бренд любой"
   * "покажи другого бренда"
   * "а теперь Adidas"
   */
  if (
    PRODUCT_CONTEXT_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(query))
  ) {
    return true;
  }

  return false;
}

// ===== END CHANGE — DETERMINISTIC PRODUCT FOLLOW-UP ROUTING =====

export function afterPreIntentRoute(state: SupportAgentStateType) {
  if (state.preIntentRoute === 'reject') {
    return 'reject';
  }

  if (state.preIntentRoute === 'requestRouterNode') {
    // ===== START CHANGE — BYPASS ROUTER FOR OBVIOUS PRODUCT FOLLOW-UP =====

    if (shouldRouteDirectlyToProductAgent(state)) {
      return 'productAgent';
    }

    // ===== END CHANGE — BYPASS ROUTER FOR OBVIOUS PRODUCT FOLLOW-UP =====

    return 'requestRouterNode';
  }

  if (state.preIntentRoute === 'clarificationTopic') {
    return 'clarificationTopic';
  }

  throw new Error('AfterPreIntentRoute: отсутствует допустимый маршрут');
}
