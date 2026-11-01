import { Fragment, useState, type ReactNode } from 'react'

// Renderização segura de um subconjunto mínimo de Markdown:
// blocos de código (```), **negrito**, `código` e títulos (#).
// Tudo vira elementos React (nunca HTML bruto), então texto vindo do modelo
// ou de terceiros não consegue injetar código na interface.

function Inline({ text }: { text: string }): ReactNode {
  const tokens = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
  return (
    <>
      {tokens.map((t, i) => {
        if (t.length > 4 && t.startsWith('**') && t.endsWith('**')) return <strong key={i}>{t.slice(2, -2)}</strong>
        if (t.length > 2 && t.startsWith('`') && t.endsWith('`')) {
          return (
            <code key={i} className="inline-code">
              {t.slice(1, -1)}
            </code>
          )
        }
        return t
      })}
    </>
  )
}

function TextBlock({ text }: { text: string }) {
  const lines = text.replace(/^\n+|\n+$/g, '').split('\n')
  return (
    <span className="txt">
      {lines.map((line, i) => {
        const heading = /^#{1,6}\s+(.*)$/.exec(line)
        return (
          <Fragment key={i}>
            {i > 0 && '\n'}
            {heading ? (
              <strong>
                <Inline text={heading[1]} />
              </strong>
            ) : (
              <Inline text={line} />
            )}
          </Fragment>
        )
      })}
    </span>
  )
}

function CodeBlock({ raw }: { raw: string }) {
  const [copied, setCopied] = useState(false)
  // A primeira linha pode ser o nome da linguagem (ex.: "ts").
  const m = /^([\w+#.-]{0,20})\n/.exec(raw)
  const lang = m ? m[1] : ''
  const code = (m ? raw.slice(m[0].length) : raw).replace(/\n$/, '')

  function copy() {
    window.api.clipboard.copy(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="codeblock">
      <div className="codeblock__bar">
        <span>{lang || 'código'}</span>
        <button type="button" className="codeblock__copy" onClick={copy}>
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export default function MessageBody({ text }: { text: string }) {
  // Partes ímpares estão entre ``` ``` (código); durante o streaming, uma cerca
  // ainda aberta aparece como bloco de código em construção.
  const parts = text.split('```')
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <CodeBlock key={i} raw={part} /> : part.trim() === '' ? null : <TextBlock key={i} text={part} />
      )}
    </>
  )
}
