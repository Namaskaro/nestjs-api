import { describe, expect, it } from '@jest/globals';

import { normalizeProductWorkspaceModelPlan } from './product-workspace-model-plan';

describe('Product Workspace REFINE regression', () => {
  it('keeps valid REFINE when provider returns invalid legacy memoryObservations', () => {
    const result = normalizeProductWorkspaceModelPlan(
      {
        clarification: null,
        operations: [
          {
            decision: {
              action: 'REFINE',
              factAttributeIds: [],
              feedback: null,
              memoryObservations: [
                {
                  attributeId: 'usageScenario',
                  importance: 'high',
                  kind: 'criterion',
                  operation: 'remember',
                  operator: 'eq',
                  sourceText: 'которые подойдут для бега',
                  value: 'бег',
                },
                {
                  attributeId: 'color',
                  importance: 'normal',
                  kind: 'criterion',
                  operation: 'remember',
                  operator: 'eq',
                  sourceText: 'чёрные',
                  text: 'legacy provider field',
                  value: 'чёрный',
                },
              ],
              search: null,
              searchPatch: {
                category: 'SHOES',
                clear: [],
                semanticIntent: 'чёрные кроссовки для бега',
                set: [
                  {
                    attributeId: 'color',
                    operator: 'eq',
                    unit: null,
                    value: 'чёрный',
                  },
                ],
              },
              selection: null,
              terminalText: null,
              usageScenarioIds: ['running'],
            },
            view: 'focus',
          },
        ],
      },
      'чёрные, которые подойдут для бега',
    );

    expect(result.clarification).toBeNull();
    expect(result.operations).toHaveLength(1);

    const operation = result.operations[0];

    expect(operation.kind).toBe('consult');

    if (operation.kind !== 'consult') {
      throw new Error('Expected consult operation.');
    }

    expect(operation.target).toEqual({
      kind: 'current',
      view: 'focus',
    });

    expect(operation.query).toBe('чёрные, которые подойдут для бега');

    const decision = operation.actions[0].decision;

    expect(decision.proposal.action).toBe('REFINE');
    expect(decision.proposal.taskTransition).toBe('continue');
    expect(decision.proposal.memoryObservations).toEqual([]);

    expect(decision.proposal.searchPatch).toEqual({
      category: 'SHOES',
      clear: [],
      semanticIntent: 'чёрные кроссовки для бега',
      set: [
        {
          attributeId: 'color',
          operator: 'eq',
          unit: null,
          value: 'чёрный',
        },
      ],
    });

    expect(decision.usageScenarioIds).toEqual(['running']);
  });

  it('canonicalizes profile-owned hard constraints in one REFINE', () => {
    const result = normalizeProductWorkspaceModelPlan(
      {
        clarification: null,
        operations: [
          {
            kind: 'consult',
            target: {
              kind: 'current',
              view: 'focus',
            },
            query: 'черные 42 размера до 20000, которые подойдут для бега',
            actions: [
              {
                decision: {
                  action: 'REFINE',
                  search: null,
                  searchPatch: {
                    semanticIntent:
                      'чёрные кроссовки для бега, 42 размер, до 20000 рублей',
                    category: 'SHOES',
                    set: [
                      {
                        attributeId: 'color',
                        operator: 'eq',
                        value: 'чёрный',
                        unit: null,
                      },

                      /*
                       * Реальный bad output Yandex:
                       * eq + numeric member.
                       */
                      {
                        attributeId: 'sizes',
                        operator: 'eq',
                        value: 42,
                        unit: null,
                      },

                      /*
                       * Ещё один реальный bad output:
                       * natural-language currency попала в unit.
                       */
                      {
                        attributeId: 'price',
                        operator: 'lte',
                        value: 20000,
                        unit: 'рубль',
                      },
                    ],
                    clear: [],
                  },
                  selection: null,
                  feedback: null,
                  usageScenarioIds: ['running'],
                  factAttributeIds: [],
                  terminalText: null,
                },
                view: 'focus',
              },
            ],
          },
        ],
      },
      'черные 42 размера до 20000, которые подойдут для бега',
    );

    const operation = result.operations[0];

    expect(operation.kind).toBe('consult');

    if (operation.kind !== 'consult') {
      throw new Error('Expected consult operation.');
    }

    const decision = operation.actions[0].decision;

    expect(decision.proposal.action).toBe('REFINE');
    expect(decision.proposal.searchPatch?.clear).toEqual([]);

    expect(decision.proposal.searchPatch?.set).toEqual([
      {
        attributeId: 'color',
        operator: 'eq',
        value: 'чёрный',
        unit: null,
      },
      {
        attributeId: 'sizes',
        operator: 'contains',
        value: '42',
        unit: null,
      },
      {
        attributeId: 'price',
        operator: 'lte',
        value: 20000,
        unit: null,
      },
    ]);

    expect(decision.usageScenarioIds).toEqual(['running']);
  });

  it('does not guess between several valid numeric operators', () => {
    expect(() =>
      normalizeProductWorkspaceModelPlan(
        {
          clarification: null,
          operations: [
            {
              kind: 'consult',
              target: {
                kind: 'current',
                view: 'focus',
              },
              query: 'цена 20000',
              actions: [
                {
                  decision: {
                    action: 'REFINE',
                    search: null,
                    searchPatch: {
                      category: 'SHOES',
                      set: [
                        {
                          attributeId: 'price',
                          operator: 'contains',
                          value: 20000,
                          unit: null,
                        },
                      ],
                      clear: [],
                    },
                    selection: null,
                    feedback: null,
                    usageScenarioIds: [],
                    factAttributeIds: [],
                    terminalText: null,
                  },
                  view: 'focus',
                },
              ],
            },
          ],
        },
        'цена 20000',
      ),
    ).toThrow();
  });
});
