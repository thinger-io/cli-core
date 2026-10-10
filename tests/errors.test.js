import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiError, inputError } from '../lib/errors.js';

describe('inputError', () => {
    it('tags the error with code "input_error"', () => {
        const err = inputError('bad arg');
        assert.equal(err.message, 'bad arg');
        assert.equal(err.code, 'input_error');
    });
});

describe('apiError', () => {
    it('maps 404 to not_found with the custom message', () => {
        const err = apiError({ response: { status: 404 } }, { notFound: 'Device not found: foo' });
        assert.equal(err.code, 'not_found');
        assert.equal(err.status, 404);
        assert.equal(err.message, 'Device not found: foo');
    });

    it('falls back to a generic 404 message when none is supplied', () => {
        const err = apiError({ response: { status: 404 } });
        assert.equal(err.code, 'not_found');
        assert.equal(err.message, 'Not found');
    });

    it('maps 401 and 403 to unauthorized', () => {
        const err401 = apiError({ response: { status: 401 } });
        const err403 = apiError({ response: { status: 403 } });
        assert.equal(err401.code, 'unauthorized');
        assert.equal(err403.code, 'unauthorized');
    });

    it('maps other HTTP statuses to server_error', () => {
        const err = apiError({ response: { status: 500, statusText: 'Internal' } });
        assert.equal(err.code, 'server_error');
        assert.equal(err.status, 500);
        assert.match(err.message, /500/);
    });

    it('maps a request-without-response error to network_error', () => {
        const err = apiError({ request: {} });
        assert.equal(err.code, 'network_error');
    });

    it('maps anything else to a generic "error" with the original message', () => {
        const err = apiError(new Error('boom'));
        assert.equal(err.code, 'error');
        assert.equal(err.message, 'boom');
    });
});

describe('apiError with a server message', () => {
    it('keeps the reason the server gave', () => {
        const err = apiError({
            response: {
                status: 501,
                statusText: 'Not Implemented',
                data: { error: { message: 'bucket backend not available' } },
            },
        });
        assert.equal(err.code, 'server_error');
        assert.equal(
            err.message,
            'Server error: 501 Not Implemented — bucket backend not available',
        );
    });
});

describe('apiError with a plain-text server message', () => {
    it('keeps a short text body, but not an HTML page', () => {
        const text = apiError({ response: { status: 400, data: '"cannot create more products"' } });
        assert.match(text.message, /— cannot create more products$/);
        const html = apiError({ response: { status: 502, data: '<html>Bad gateway</html>' } });
        assert.doesNotMatch(html.message, /—/);
    });
});
