import { describe, expect, it } from 'vitest';

import { createDevMemoryTransport } from './dev-memory.js';

describe('createDevMemoryTransport', () => {
  it('captures every send into the outbox with a synthesized message id', async () => {
    const transport = createDevMemoryTransport();
    const result = await transport.send(
      {
        to: 'a@b.com',
        from: 'noreply@app.example.com',
        subject: 'Hi',
        text: 'Hi',
        html: '<p>Hi</p>',
      },
      { idempotencyKey: 'test:1' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerMessageId).toMatch(/^dev-/);
    }
    expect(transport.outbox).toHaveLength(1);
    expect(transport.outbox[0]!.idempotencyKey).toBe('test:1');
  });

  it('reset() clears the outbox', async () => {
    const transport = createDevMemoryTransport();
    await transport.send(
      {
        to: 'a@b.com',
        from: 'noreply@app.example.com',
        subject: 'Hi',
        text: 'Hi',
        html: '<p>Hi</p>',
      },
      { idempotencyKey: 'test:2' },
    );
    transport.reset();
    expect(transport.outbox).toHaveLength(0);
  });

  it('always returns ok=true (transport never fails)', async () => {
    const transport = createDevMemoryTransport();
    const result = await transport.send(
      {
        to: 'a@b.com',
        from: 'noreply@app.example.com',
        subject: 'Test',
        text: '',
        html: '',
      },
      { idempotencyKey: 'test:3' },
    );
    expect(result.ok).toBe(true);
  });
});
