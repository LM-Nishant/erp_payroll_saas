import { describe, expect, it } from 'vitest';
import {
  extractVariables,
  renderTemplate,
  TemplateSyntaxError,
  validateTemplate,
} from './renderer';

describe('template renderer', () => {
  it('substitutes variables, escaping only in HTML mode unless triple-braced', () => {
    const vars = { name: '<b>Asha</b>', org: { name: 'ABBS' } };
    expect(renderTemplate('Hi {{name}} from {{ org.name }}', vars)).toBe(
      'Hi <b>Asha</b> from ABBS',
    );
    expect(renderTemplate('Hi {{name}}', vars, { html: true })).toBe('Hi &lt;b&gt;Asha&lt;/b&gt;');
    expect(renderTemplate('Hi {{{name}}}', vars, { html: true })).toBe('Hi <b>Asha</b>');
    expect(renderTemplate('[{{missing}}]', vars)).toBe('[]');
  });

  it('supports {{#if}} / {{else}} and lists variables', () => {
    const src = '{{#if paid}}Thanks {{name}}{{else}}Please pay {{amount}}{{/if}}';
    expect(renderTemplate(src, { paid: false, amount: 10 })).toBe('Please pay 10');
    expect(renderTemplate(src, { paid: true, name: 'A' })).toBe('Thanks A');
    expect(extractVariables(src).sort()).toEqual(['amount', 'name', 'paid']);
  });

  it('rejects malformed templates', () => {
    expect(() => validateTemplate('{{#if x}}open')).toThrow(TemplateSyntaxError);
    expect(() => validateTemplate('{{/if}}')).toThrow(TemplateSyntaxError);
  });
});
