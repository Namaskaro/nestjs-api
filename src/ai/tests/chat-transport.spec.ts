import { getChatTransport } from './chat-transport';

describe('explicit chat deployment transport profiles', () => {
  it.each(['FAST', 'STANDARD'] as const)(
    'keeps Yandex %s on its existing transport without OpenAI settings',
    (role) => {
      expect(getChatTransport('yandex', role, 'configured-yandex-uri')).toEqual(
        {
          useResponsesApi: false,
          temperature: 0,
          streamUsage: false,
        },
      );
    },
  );

  it.each(['FAST', 'STANDARD'] as const)(
    'selects transport from the model deployment independently of the %s role',
    (role) => {
      expect(getChatTransport('openai', role, 'gpt-6-luna')).toMatchObject({
        useResponsesApi: true,
        temperature: 0,
        modelKwargs: { reasoning: { effort: 'none' } },
      });
      const sol = getChatTransport('openai', role, 'gpt-6.1-sol');
      expect(sol).toMatchObject({
        useResponsesApi: true,
        modelKwargs: { reasoning: { effort: 'medium' } },
      });
      expect(sol).not.toHaveProperty('temperature');
    },
  );

  it.each(['gpt-6-luna', 'gpt-6.1-sol'] as const)(
    'supports custom deployment IDs with an explicit %s profile',
    (profile) => {
      expect(
        getChatTransport('openai', 'STANDARD', 'commerce-alias', profile),
      ).toEqual(getChatTransport('openai', 'STANDARD', profile));
    },
  );

  it.each([
    'gpt-6-luna-future',
    'gpt-6.1-sol-future',
    'gpt-7',
    'commerce-alias',
  ])('does not silently guess capabilities for %s', (model) => {
    expect(() => getChatTransport('openai', 'FAST', model)).toThrow(
      'OPENAI_FAST_TRANSPORT_PROFILE',
    );
  });

  it.each(['', 'responses', 'unknown', 42, {}])(
    'rejects an invalid explicit profile %p even for a known model',
    (profile) => {
      expect(() =>
        getChatTransport('openai', 'STANDARD', 'gpt-6.1-sol', profile),
      ).toThrow('OPENAI_STANDARD_TRANSPORT_PROFILE');
    },
  );

  it.each([
    ['gpt-6-luna', 'gpt-6.1-sol'],
    ['gpt-6.1-sol', 'gpt-6-luna'],
  ])('rejects a mismatched known model %s / profile %s', (model, profile) => {
    expect(() =>
      getChatTransport('openai', 'STANDARD', model, profile),
    ).toThrow('conflicts');
  });
});
