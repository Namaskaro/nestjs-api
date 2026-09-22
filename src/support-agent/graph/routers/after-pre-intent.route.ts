import { readProductContext } from '../../../product-consultation/application/context/product-context.schema';

import type { SupportAgentStateType } from '../support-agent.state';

function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[!?.,;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

const CUSTOMER_HELP_HINT_PATTERN =
  /(?:достав|оплат|возврат|обмен|скид|лояль|претенз|заказ|оператор)/iu;

const PRODUCT_CONTEXT_FOLLOWUP_PATTERNS = [
  /^(?:сравни|сравните)(?=$|[^\p{L}\p{N}_])/iu,

  /^(?:расскажи|расскажите|покажи|покажите|дай|дайте)(?=$|[^\p{L}\p{N}_]).{0,80}(?:^|[^\p{L}\p{N}_])(?:подробнее|детал)/iu,

  /^(?:расскажи|расскажите|покажи|покажите|дай|дайте)(?=$|[^\p{L}\p{N}_]).{0,80}(?:^|[^\p{L}\p{N}_])(?:перв(?:ый|ого|ому|ым|ом)|втор(?:ой|ого|ому|ым|ом)|трет(?:ий|ьего|ьему|ьим|ьем)|последн(?:ий|его|ему|им|ем)|этот|тот)(?=$|[^\p{L}\p{N}_])/iu,

  /^подробнее(?=$|[^\p{L}\p{N}_])/iu,

  /(?:^|[^\p{L}\p{N}_])(?:перв(?:ый|ого|ому|ым|ом)|втор(?:ой|ого|ому|ым|ом)|трет(?:ий|ьего|ьему|ьим|ьем)|последн(?:ий|его|ему|им|ем))(?=$|[^\p{L}\p{N}_]).{0,80}(?:^|[^\p{L}\p{N}_])(?:нрав|дорог|дешев|лучше|хуже|подроб|сравн|размер|цвет|цен)/iu,

  /(?:^|[^\p{L}\p{N}_])(?:этот|тот|его|её|этого|этой)(?=$|[^\p{L}\p{N}_]).{0,80}(?:^|[^\p{L}\p{N}_])(?:товар|костюм|модел|вариант|размер|цвет|цен|подроб)/iu,

  /^(?:бренд|размер|цвет|цена)(?=$|[^\p{L}\p{N}_])/iu,

  /^(?:покажи|покажите|давай|давайте)(?=$|[^\p{L}\p{N}_]).{0,50}(?:^|[^\p{L}\p{N}_])(?:друг(?:ой|ого|ие)|ещ[её])/iu,

  /^(?:а\s+)?(?:теперь\s+)?(?:только|без)\s+\S+/iu,

  /^(?:а\s+)?теперь\s+.+/iu,

  /^(?:бренд\s+)?(?:любой|любая|любое|не\s*важен|неважен)/iu,

  /^(?:из\s+оставшихся|выбери|выберите|посоветуй|посоветуйте|посоветуешь|посоветуете)(?=$|[^\p{L}\p{N}_])/iu,
];

const PRODUCT_COMPLETION_PATTERNS = [
  /(?:^|[^\p{L}\p{N}_])(?:беру|возьму|выбираю|выбрал|выбрала|остановлюсь)(?=$|[^\p{L}\p{N}_])/iu,

  /(?:спасибо[,!\s]*)?(?:это\s+вс[её]|на\s+этом\s+закон(?:чим|чу)|дальше\s+сам)/iu,

  /(?:^|[^\p{L}\p{N}_])(?:ничего\s+не\s+подходит|ничего\s+не\s+подошло|хватит|закончим\s+подбор|завершим\s+подбор)(?=$|[^\p{L}\p{N}_])/iu,
];

function shouldRouteDirectlyToProductAgent(
  state: SupportAgentStateType,
): boolean {
  if (!state.productContext) {
    return false;
  }

  const context = readProductContext(state.productContext);

  if (context.needs.length === 0) {
    return false;
  }

  const hasActiveConsultation =
    context.consultationSession?.status === 'ACTIVE';

  if (state.activeAgent !== 'productAgent' && !hasActiveConsultation) {
    return false;
  }

  const query = normalizeQuery(state.query);

  if (CUSTOMER_HELP_HINT_PATTERN.test(query)) {
    return false;
  }

  if (
    hasActiveConsultation &&
    PRODUCT_COMPLETION_PATTERNS.some((pattern) => pattern.test(query))
  ) {
    return true;
  }

  if (context.pendingClarification && query.length <= 40) {
    return true;
  }

  const hasProductReferences =
    context.referenceOrder.length > 0 ||
    context.displayOrder.length > 0 ||
    context.comparison.length > 0;

  if (
    hasProductReferences &&
    PRODUCT_CONTEXT_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(query))
  ) {
    return true;
  }

  if (
    PRODUCT_CONTEXT_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(query))
  ) {
    return true;
  }

  return false;
}

export function afterPreIntentRoute(state: SupportAgentStateType) {
  if (state.preIntentRoute === 'reject') {
    return 'reject';
  }

  if (state.preIntentRoute === 'requestRouterNode') {
    if (shouldRouteDirectlyToProductAgent(state)) {
      return 'productAgent';
    }

    return 'requestRouterNode';
  }

  if (state.preIntentRoute === 'clarificationTopic') {
    return 'clarificationTopic';
  }

  throw new Error('AfterPreIntentRoute: отсутствует допустимый маршрут');
}
