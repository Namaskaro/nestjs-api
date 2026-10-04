import { describe, expect, it } from '@jest/globals';

import { SupportAgentContextSchema } from '../support-agent-context.schema';

describe('SupportAgentContextSchema', () => {
  it('accepts authenticated userId', () => {
    const result = SupportAgentContextSchema.parse({
      userId: 'user-123',
    });

    expect(result).toEqual({
      userId: 'user-123',
    });
  });

  it('trims userId', () => {
    const result = SupportAgentContextSchema.parse({
      userId: '  user-123  ',
    });

    expect(result.userId).toBe('user-123');
  });

  it('rejects missing userId', () => {
    const result = SupportAgentContextSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects empty userId', () => {
    const result = SupportAgentContextSchema.safeParse({
      userId: '   ',
    });

    expect(result.success).toBe(false);
  });
});
