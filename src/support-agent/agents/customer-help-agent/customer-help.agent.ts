// import { AIMessage, SystemMessage } from '@langchain/core/messages';

// import {
//   createAgent,
//   dynamicSystemPromptMiddleware,
//   type AgentMiddleware,
// } from 'langchain';

// import { AiService } from '@/src/ai/ai.service';
// import { StoreKnowledgeService } from '@/src/store-knowledge/store-knowledge.service';

// import { requestOperatorHandoffTool } from '../shared/tools/request-operator-handoff.tool';
// import { createTransferToAgentTool } from '../shared/tools/transfer-to-agent.tool';

// import { customerHelpPrompt } from './prompts/customer-help.prompt';
// import { createSearchKnowledgeTool } from './tools/search-knowledge.tool';

// export function createCustomerHelpAgent(
//   aiService: AiService,
//   storeKnowledgeService: StoreKnowledgeService,
// ) {
//   const model = aiService.getChatModel('yandex');

//   const searchKnowledgeTool = createSearchKnowledgeTool(storeKnowledgeService);

//   const storeName = 'Store';

//   const customerHelpPromptMiddleware = dynamicSystemPromptMiddleware(
//     async (state) => {
//       const hasVisibleAssistantReply = state.messages.some((message) => {
//         if (!AIMessage.isInstance(message)) {
//           return false;
//         }

//         const hasText = message.text.trim().length > 0;

//         const hasToolCalls = (message.tool_calls?.length ?? 0) > 0;

//         return hasText && !hasToolCalls;
//       });

//       const greetingInstruction = hasVisibleAssistantReply
//         ? `
// Не здоровайся повторно.

// Продолжай разговор естественно,
// как будто диалог уже идёт.
// `
//         : `
// Это первый видимый ответ помощника
// в текущем разговоре.

// Начни ответ с короткого естественного приветствия.

// Например:

// "Здравствуйте!"
// или
// "Здравствуйте! Конечно, помогу."

// Не делай приветствие длинным
// и не превращай его в отдельный абзац-презентацию.
// `;

//       const messages = await customerHelpPrompt.formatMessages({
//         storeName,
//         greetingInstruction,
//       });

//       const systemMessage = messages[0];

//       if (!SystemMessage.isInstance(systemMessage)) {
//         throw new Error('CustomerHelpAgent: prompt не вернул SystemMessage');
//       }

//       return systemMessage;
//     },
//   );

//   const middleware: AgentMiddleware[] = [customerHelpPromptMiddleware];

//   return createAgent({
//     model,

//     tools: [
//       searchKnowledgeTool,

//       createTransferToAgentTool('customerHelpAgent'),

//       requestOperatorHandoffTool,
//     ],

//     middleware,
//   });
// }

// export type CustomerHelpAgent = ReturnType<typeof createCustomerHelpAgent>;

import { createAgent } from 'langchain';

import { AiService } from '@/src/ai/ai.service';

import { StoreKnowledgeService } from '@/src/store-knowledge/store-knowledge.service';

import { requestOperatorHandoffTool } from '../shared/tools/request-operator-handoff.tool';

import { createTransferToAgentTool } from '../shared/tools/transfer-to-agent.tool';

import { customerHelpPrompt } from './prompts/customer-help.prompt';

import { createSearchKnowledgeTool } from './tools/search-knowledge.tool';

export function createCustomerHelpAgent(
  aiService: AiService,
  storeKnowledgeService: StoreKnowledgeService,
) {
  const model = aiService.getChatModel('yandex');

  const searchKnowledgeTool = createSearchKnowledgeTool(storeKnowledgeService);

  // START CHANGES — УБРАНА HISTORY-DEPENDENT greeting middleware

  return createAgent({
    model,

    systemPrompt: customerHelpPrompt,

    tools: [
      searchKnowledgeTool,

      createTransferToAgentTool('customerHelpAgent'),

      requestOperatorHandoffTool,
    ],
  });

  // END CHANGES — УБРАНА HISTORY-DEPENDENT greeting middleware
}

export type CustomerHelpAgent = ReturnType<typeof createCustomerHelpAgent>;
