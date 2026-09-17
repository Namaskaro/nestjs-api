// import { trimMessages } from '@langchain/core/messages';
// import { countTokensApproximately } from 'langchain';

// export const requestRouterHistoryTrimmer = trimMessages({
//   maxTokens: 1_200,

//   strategy: 'last',

//   tokenCounter: (messages) => countTokensApproximately(messages, null),

//   startOn: 'human',

//   allowPartial: false,
// });

// export const domainAgentHistoryTrimmer = trimMessages({
//   maxTokens: 3_000,

//   strategy: 'last',

//   tokenCounter: (messages) => countTokensApproximately(messages, null),

//   startOn: 'human',

//   allowPartial: false,
// });

// export const handoffHistoryTrimmer = trimMessages({
//   maxTokens: 4_000,

//   strategy: 'last',

//   tokenCounter: (messages) => countTokensApproximately(messages, null),

//   startOn: 'human',

//   allowPartial: false,
// });

import { trimMessages } from '@langchain/core/messages';
import { countTokensApproximately } from 'langchain';

export const requestRouterHistoryTrimmer = trimMessages({
  maxTokens: 1_200,

  strategy: 'last',

  tokenCounter: (messages) => countTokensApproximately(messages, null),

  startOn: 'human',

  allowPartial: false,
});

// START CHANGES — DOMAIN AGENTS БОЛЬШЕ НЕ ЧИТАЮТ ОБЩУЮ CHAT HISTORY
//
// Удалён domainAgentHistoryTrimmer.
//
// Общую историю читает RequestRouter.
// Domain agents получают self-contained workerQuery.

// END CHANGES — DOMAIN AGENTS БОЛЬШЕ НЕ ЧИТАЮТ ОБЩУЮ CHAT HISTORY

export const handoffHistoryTrimmer = trimMessages({
  maxTokens: 4_000,

  strategy: 'last',

  tokenCounter: (messages) => countTokensApproximately(messages, null),

  startOn: 'human',

  allowPartial: false,
});
