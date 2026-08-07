import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate } from './workflow-render.logic';

describe('renderTemplate', () => {
  it('substitutes a flat field', () => {
    assert.equal(renderTemplate('Hello {{name}}', { name: 'Bob' }), 'Hello Bob');
  });

  it('substitutes a dot-path field', () => {
    assert.equal(renderTemplate('{{customer.name}}', { customer: { name: 'Acme' } }), 'Acme');
  });

  it('renders missing fields as empty string, never throws', () => {
    assert.equal(renderTemplate('{{missing}}', {}), '');
  });

  it('does not evaluate expressions — non-field patterns pass through unchanged', () => {
    assert.equal(renderTemplate('{{1+1}}', {}), '{{1+1}}');
  });
});
