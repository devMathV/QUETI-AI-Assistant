# Provedores de IA

Informações conferidas na documentação da Groq em **outubro de 2026**. Condições gratuitas mudam: confirme sempre nas páginas oficiais.

## Provedor atual: Groq

- Endpoint (formato compatível com OpenAI): `https://api.groq.com/openai/v1`
- Chave: <https://console.groq.com/keys> (começa com `gsk_`)
- Modelo padrão: `openai/gpt-oss-20b`

### Limites de referência (modelo padrão)

Fonte: <https://console.groq.com/docs/rate-limits>

| Limite | Valor |
|---|---|
| Pedidos por minuto | 30 |
| Pedidos por dia | 1.000 |
| Tokens por minuto | 8.000 |
| Tokens por dia | 200.000 |

**Atenção:** a página oficial descreve esta tabela como os limites base do plano Developer e remete à página de limites da conta para os valores exatos (<https://console.groq.com/settings/limits>). Os limites valem para a organização (não para cada chave) e valem todos ao mesmo tempo. Na prática, o **limite diário de tokens** costuma acabar antes do de pedidos. O assistente limita o histórico enviado (~6.000 caracteres) e o tamanho da resposta (1.024 tokens) para economizar cota.

### Modelos descontinuados

Os modelos `llama-3.1-8b-instant` e `llama-3.3-70b-versatile` foram descontinuados em 16/08/2026, inclusive no plano gratuito (<https://console.groq.com/docs/deprecations>). Por isso o padrão é `openai/gpt-oss-20b`. Se um modelo sumir, use **Configurações → Testar conexão** para ver os disponíveis.

### Dados enviados

A cada mensagem: instruções do sistema, histórico recente e a chave de API (no cabeçalho de autenticação). Não são enviados arquivos, capturas de tela nem memória. Leia a política de privacidade da Groq para saber como ela trata os dados no plano gratuito (não verificado neste documento).

## Como trocar de provedor

A lógica do assistente depende apenas da interface `AIProvider` (`src/main/providers/types.ts`). O adaptador `openai-compat.ts` atende qualquer serviço no formato OpenAI. Para adicionar outro, crie um adaptador (ou reutilize este com outra URL) e ajuste `src/main/providers/index.ts`. A URL do provedor é fixa no código de propósito, para que um texto malicioso não consiga redirecionar a chave de API.
