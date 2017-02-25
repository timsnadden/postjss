import R from 'ramda'

import prepareConfig from './prepare-config'
import parseTemplateString from './parse-template-string'

import Logger from './utils/logger'
import requireModule from './utils/require-module'
import getIndentNumber from './utils/get-indent-number'


export default ({ types: t }) => {
  let config
  let processCSSModule
  let requireCSSModule

  return {
    pre() {
      if (config) {
        return
      }

      config = prepareConfig(this.opts)
      processCSSModule = R.compose(config.processCSS, requireModule)

      requireCSSModule = (filename, value) => {
        let res = '() => {}'

        try {
          res = processCSSModule(filename, value)
        } catch (e) {
          if (config.throwError) {
            throw e
          } else {
            Logger.error(e.message, { filename })
          }
        }

        return res
      }
    },

    visitor: {
      ImportDefaultSpecifier(p, { file }) {
        const { value } = p.parentPath.node.source

        if (!config.extensionsRe.test(value)) {
          return
        }

        const filename = file.opts.filename

        p.parentPath.replaceWithSourceString(requireCSSModule(filename, value))

        p.parentPath.replaceWith(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier(p.node.local.name),
              t.toExpression(p.parentPath.node),
            ),
          ]))
      },

      CallExpression(p, { file }) {
        const { callee: { name: calleeName }, arguments: args } = p.node

        if (calleeName !== 'require' || !args.length || !t.isStringLiteral(args[0])) {
          return
        }

        const [{ value }] = args

        if (!config.extensionsRe.test(value)) {
          return
        }

        const filename = file.opts.filename

        p.replaceWithSourceString(requireCSSModule(filename, value))
      },

      TaggedTemplateExpression(p, { file }) {
        const { tag } = p.node

        if (tag.name !== config.namespace) {
          return
        }

        const filename = file.opts.filename

        const { quasis, expressions } = p.node.quasi
        const { code } = p.hub.file

        let res = '{}'

        const strings = quasis.map(quasi => quasi.value.cooked)

        try {
          res = parseTemplateString({
            strings,
            expressions,
            code,
            from: filename,
            processCSS: config.processCSS,
          })
        } catch (e) {
          if (config.throwError) {
            throw e
          } else {
            const sourceString = strings.join('')

            Logger.error(e.message, {
              filename,
              relative: {
                line: /^\s*\n/.test(sourceString)
                  ? p.node.loc.start.line - 1
                  : p.node.loc.start.line,
                column: getIndentNumber(sourceString),
              },
            })
          }
        }

        p.replaceWithSourceString(res)
      },
    },
  }
}
