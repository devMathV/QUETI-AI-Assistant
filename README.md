# QUETI: Quick Utility for Everyday Tasks and Information

Assistente pessoal de IA para desktop, **gratuito nas funcionalidades essenciais**, feito para rodar bem em computadores modestos (8 GB de RAM, sem GPU dedicada).

> **Estado atual: Etapa 6 (permissões e ferramentas).** O QUETI conversa por texto e voz com uma IA pela **Groq** (plano gratuito, com chave de API sua), pesquisa na web, lê arquivos e alterações do Git que você anexa e, se você ligar as ferramentas, abre sites e aplicativos autorizados e cria, altera ou apaga arquivos com a sua confirmação. Histórico e memória ficam **só neste computador**. Sem chave ou sem armazenamento, o aplicativo abre normalmente e explica o que falta.

## O que já funciona

- **Ferramentas e permissões** (opcionais, desligadas por padrão): abrir sites e aplicativos autorizados, ler páginas e pastas autorizadas e criar, alterar ou apagar arquivos com confirmação. Veja [`docs/permissoes.md`](docs/permissoes.md).
- **Pesquisa na web** (Tavily, com fontes e links), **anexar arquivos** e **alterações do Git** (somente leitura), sempre por ação sua. Veja [`docs/pesquisa-e-arquivos.md`](docs/pesquisa-e-arquivos.md).
- **Voz**: fale clicando no microfone (liga só durante o clique, com indicador e limite de 2 minutos) e ouça as respostas com as vozes do Windows. O áudio só é enviado à Groq para transcrição depois da sua permissão. Há um **modo conversa** (o assistente ouve, espera sua pausa, responde falando e volta a ouvir, só quando você inicia a sessão) e ajustes para melhorar a precisão (modelo, vocabulário, teste de microfone e comparação de modelos). Veja [`docs/voz.md`](docs/voz.md).

- **Histórico**: as conversas ficam salvas (SQLite local); abra, continue ou apague qualquer uma. Dá para desativar o salvamento ou definir um prazo de retenção.
- **Memória pessoal**: escreva “Lembre-se de que ...” no chat ou use a tela Memória. Só o que você pedir é guardado, e apenas os itens relevantes são enviados à IA.
- **Privacidade e dados**: veja onde ficam os arquivos, exporte tudo em JSON (sem a chave de API) ou apague histórico, memória ou todos os dados, sempre com confirmação.

- **Conversa com IA** com resposta em tempo real (streaming), botão de **parar**, **nova conversa** e blocos de código com botão de copiar.
- **Chave de API** guardada criptografada pelo Windows; escolha do modelo e botão *Testar conexão* em Configurações.
- **Erros explicados**: sem chave, chave recusada, limite de uso atingido, sem internet, tempo esgotado e instabilidade do provedor.

- **Botão flutuante** discreto, meio escondido na borda da tela (esquerda ou direita). Passe o mouse ou clique para revelar; arraste na vertical para mudar a altura.
- Fechar uma janela **não** encerra o QUETI. Para sair de verdade, use *Sair* na bandeja ou *Encerrar o QUETI* no aplicativo.
- **Chat rápido**: abre ao lado do botão, por clique ou pelo atalho global `Ctrl + Shift + Espaço`. Fecha com `Esc` ou clicando fora; o alfinete mantém a janela aberta.
- **Aplicativo central**: janela normal (com ícone na barra de tarefas) com a mesma conversa sincronizada, configurações e diagnóstico de consumo.
- **Ícone na bandeja** do Windows: abrir aplicativo, chat rápido, mostrar/ocultar o botão, configurações e **Sair**.
- Fechar uma janela **não** encerra o assistente. Para sair de verdade, use *Sair* na bandeja ou *Encerrar o assistente* no aplicativo.

## O que ainda NÃO existe

Leitura de PDF, Word e Excel, execução de comandos no terminal, operações de escrita no Git, integração com o GitHub, captura de tela, instalador para Windows e a troca do atalho global pela interface. Veja o roadmap no repositório.

## Configurar a IA (gratuito)

1. Acesse <https://console.groq.com/keys> e entre com uma conta.
2. Clique em **Create API Key** e copie a chave (começa com `gsk_`).
3. No aplicativo: **Configurações → Inteligência artificial**, cole a chave e clique em **Salvar chave**.
4. Clique em **Testar conexão**.

Detalhes de limites, privacidade e provedores em [`docs/provedores.md`](docs/provedores.md).

## Pré-requisitos

- Windows 11
- [Node.js](https://nodejs.org) (testado com a versão 24) e Git

## Desenvolvimento

```powershell
npm install
npm run dev          # inicia com recarregamento automático
npm run typecheck    # verifica os tipos (TypeScript)
npm run build        # gera os arquivos em out/
npm run preview      # executa a versão compilada
npm test             # executa os testes unitários de lógica e segurança
```

## Estrutura

```
src/main      Processo principal: janelas, bandeja, atalho, IPC (único com acesso privilegiado)
src/preload   Ponte segura (contextBridge) entre interface e processo principal
src/renderer  Interfaces: float (botão), compact (chat rápido), main (aplicativo central)
src/shared    Tipos usados por todos
docs/         Medições de desempenho e notas
```

## Segurança (resumo)

Janelas com `contextIsolation`, `sandbox` e sem `nodeIntegration`; IPC com canais específicos e validação de origem e dados; permissões de sistema negadas por padrão (o microfone só é liberado com a sua autorização); ferramentas desligadas por padrão, com permissões por recurso e confirmação para criar, alterar ou apagar arquivos; navegação e janelas novas bloqueadas; CSP estrita no build de produção.

## Dados armazenados

Na pasta de dados do aplicativo (`%APPDATA%\assistente-pessoal`): `assistente.db` (conversas e memória, **sem criptografia**), `settings.json` (preferências) e `secrets.json` (chave de API **criptografada** pelo Windows). A rede é usada apenas para falar com a Groq quando você envia uma mensagem ou clica em *Testar conexão*. Detalhes e como testar o isolamento entre instalações em [`docs/dados.md`](docs/dados.md).

## Limitações conhecidas

- O botão flutuante aparece apenas no monitor principal.
- A janela do botão é transparente; o comportamento em escalas de tela fracionadas ainda precisa ser validado.
- O atalho global não pode ser alterado pela interface ainda.
- Ainda não há instalador (Etapa 7).
- A transcrição depende da internet e da cota gratuita da Groq. A leitura em voz alta depende de haver uma voz em português instalada no Windows.
- O banco de conversas e memória não é criptografado (só a chave de API é). Use BitLocker se o disco puder ser acessado por terceiros.
- A escolha dos itens de memória enviados à IA é uma heurística simples por palavras em comum e pode errar.
- Requer um Electron cujo Node inclua `node:sqlite` (Node 22+). Sem ele, o app funciona mas não salva nada.
- Os limites de uso da Groq mostrados no app são valores de referência da documentação; confira os da sua conta em console.groq.com/settings/limits. As cotas diárias são modestas (veja `docs/provedores.md`); conversas longas gastam a cota mais rápido.
- A chave criptografada pelo Windows protege o arquivo em disco, mas não impede que outros programas rodando como o mesmo usuário a leiam.
- As respostas mostram só um subconjunto de Markdown (código, negrito, títulos); tabelas e listas aparecem como texto.

## Licença

MIT. Veja `LICENSE`.
