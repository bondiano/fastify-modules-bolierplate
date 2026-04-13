/**
 * Custom ESLint rule: no-complex-inline-type
 *
 * Forbids inline TypeScript object-type literals that are too deeply nested
 * or have too many properties. Forces extraction into a named type/interface.
 *
 * Options (all optional):
 *   maxDepth        - max nesting depth for object types (default: 2)
 *   maxProperties   - max properties in a single object type literal (default: 4)
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow complex inline type literals -- extract them into a named type or interface',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxDepth: { type: 'integer', minimum: 1 },
          maxProperties: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooDeep:
        'Inline type literal is nested {{depth}} levels deep (max {{maxDepth}}). Extract into a named type or interface.',
      tooManyProperties:
        'Inline type literal has {{count}} properties (max {{maxProperties}}). Extract into a named type or interface.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const maxDepth = options.maxDepth ?? 2;
    const maxProperties = options.maxProperties ?? 4;

    const isTypeLiteral = (node) =>
      node.type === 'TSTypeLiteral' || node.type === 'TSInterfaceBody';

    const isTopLevelDeclaration = (node) => {
      let current = node.parent;
      while (current) {
        if (
          current.type === 'TSTypeAliasDeclaration' ||
          current.type === 'TSInterfaceDeclaration'
        ) {
          // Check if this type literal is the direct body of the declaration
          // (not nested inside another type literal within it)
          if (
            current.type === 'TSTypeAliasDeclaration' &&
            current.typeAnnotation === node
          ) {
            return true;
          }
          if (
            current.type === 'TSInterfaceDeclaration' &&
            current.body === node
          ) {
            return true;
          }
          return false;
        }
        current = current.parent;
      }
      return false;
    };

    const getNestingDepth = (node) => {
      let depth = 0;
      let current = node.parent;
      while (current) {
        if (isTypeLiteral(current)) {
          depth++;
        }
        current = current.parent;
      }
      return depth;
    };

    return {
      TSTypeLiteral(node) {
        if (isTopLevelDeclaration(node)) {
          return;
        }

        const depth = getNestingDepth(node) + 1;
        if (depth > maxDepth) {
          context.report({
            node,
            messageId: 'tooDeep',
            data: { depth: String(depth), maxDepth: String(maxDepth) },
          });
          return;
        }

        const count = node.members.length;
        if (count > maxProperties) {
          context.report({
            node,
            messageId: 'tooManyProperties',
            data: {
              count: String(count),
              maxProperties: String(maxProperties),
            },
          });
        }
      },
    };
  },
};

export default rule;
