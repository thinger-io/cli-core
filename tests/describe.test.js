import { test } from 'node:test';
import './setup.js';
import assert from 'node:assert/strict';
import { shareSchemas } from '../lib/mcp/tools-resource.js';

const entry = {
    type: 'object',
    description: 'x'.repeat(500),
    properties: { enabled: { type: 'boolean' } },
};

test('shareSchemas writes a repeated schema once and moves actions after it', () => {
    const out = shareSchemas({
        type: 'product_profile_api',
        actions: {
            replace_all: {
                run: 'resource_call',
                body: { schema: { type: 'object', additionalProperties: entry } },
            },
        },
        create: { schema: entry },
        update: { schema: entry, examples: { a: {} } },
        schema_source: 'server',
    });
    assert.deepEqual(out.create, { schema: entry });
    assert.equal(out.update.schema, '(same as the create schema)');
    assert.deepEqual(out.update.examples, { a: {} });
    assert.equal(
        out.actions.replace_all.body.schema.additionalProperties,
        '(same as the create schema)',
    );
    assert.deepEqual(Object.keys(out), ['type', 'create', 'update', 'actions', 'schema_source']);
});

test('shareSchemas keeps small repeated schemas as they are', () => {
    const small = { type: 'object' };
    const out = shareSchemas({ create: { schema: small }, update: { schema: small } });
    assert.deepEqual(out.update.schema, small);
});
