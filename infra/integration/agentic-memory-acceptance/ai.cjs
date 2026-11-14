module.exports = function createAcceptanceAi(requireApp) {
  const { BaseChatModel } = requireApp('@langchain/core/language_models/chat_models');
  const { AIMessage } = requireApp('@langchain/core/messages');
  const { RunnableLambda } = requireApp('@langchain/core/runnables');
  const constraint = (attributeId, value, operator = 'eq') => ({ attributeId, value, operator, unit: null });
  const original = [constraint('brand', 'Aurora'), constraint('color', 'синий'), constraint('price', 6000, 'lte')];
  const updated = [constraint('brand', 'Nord'), constraint('color', 'зелёный'), constraint('price', 8000, 'lte')];
  const fresh = [constraint('price', 10000, 'lte')];
  const textOf = (messages) => {
    const message = Array.isArray(messages) ? messages.at(-1) : messages.toChatMessages().at(-1);
    return typeof message.content === 'string' ? message.content : '';
  };
  const planner = (context) => {
    const query = context.currentMessage;
    const lower = query.toLowerCase();
    let target = { kind: 'new' };
    let decision;
    if (/подробнее|перв(ый|ом)|выбираю/.test(lower)) {
      target = { kind: 'current', view: 'results' };
      decision = { action: 'DETAILS', selection: { kind: 'positions', positions: [1] } };
    } else if (/nord|обнови|поменяй/.test(lower)) {
      target = { kind: 'current', view: 'focus' };
      decision = { action: 'REFINE', searchPatch: { set: updated } };
    } else if (/продолж|прошл/.test(lower)) {
      target = { kind: 'current', view: 'focus' };
      decision = { action: 'SHOW_RESULTS' };
    } else if (/закончи|заверши/.test(lower)) {
      target = { kind: 'current', view: 'focus' };
      decision = { action: 'COMPLETE', terminalText: 'Подбор завершён.' };
    } else {
      const constraints = /aurora/.test(lower) ? original : /10000|10 000/.test(lower) ? fresh : [];
      decision = { action: 'SEARCH', search: { semanticIntent: 'кроссовки', category: 'SHOES', constraints } };
    }
    return { operations: [{ kind: 'consult', target, query, actions: [{ decision }] }] };
  };
  class AcceptanceChatModel extends BaseChatModel {
    _llmType() { return 'deterministic-local-acceptance'; }
    bindTools() { return this; }
    async _generate() {
      const text = 'Для ручной приёмки используйте сообщения из панели сценариев.';
      return { generations: [{ text, message: new AIMessage(text) }] };
    }
    withStructuredOutput(schema, options) {
      return RunnableLambda.from((messages) => {
        const input = textOf(messages);
        let result;
        switch (options.name) {
          case 'route_support_request': {
            const query = input.replace(/^\s*Текущий запрос:\s*/, '').trim();
            result = {
              workerQueries: { productAgent: query, orderAgent: null, customerHelpAgent: null },
              orderRequest: null, fallbackRoute: null, clarificationTopic: null, handoffRequest: null,
              reason: 'Локальный сценарий товарной консультации',
            };
            break;
          }
          case 'product_workspace_decision':
            result = planner(JSON.parse(input));
            break;
          case 'product_recommendation_response':
            result = { message: 'Первый товар из текущего списка подходит для проверки.', recommendedPosition: 1 };
            break;
          default:
            throw Error('No acceptance AI fixture for ' + options.name);
        }
        const parsed = schema.parse(result);
        return options.includeRaw ? { raw: new AIMessage(JSON.stringify(result)), parsed } : parsed;
      });
    }
  }
  const model = new AcceptanceChatModel({});
  const vector = [1, ...Array(767).fill(0)];
  return {
    original,
    vector,
    ai: {
      embeddingProvider: 'yandex',
      embeddingFailover: false,
      getChatModel: () => model,
      createQueryEmbedding: async () => vector,
      createDocumentEmbedding: async () => vector,
    },
  };
};
