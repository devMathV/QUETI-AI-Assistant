# Seus dados: onde ficam, o que é enviado e como testar

## 1. Onde ficam os dados

Tudo fica em uma pasta no seu computador, separada por usuário do Windows. Normalmente é:

```
C:\Users\SEU_USUARIO\AppData\Roaming\assistente-pessoal
```

Para ver o caminho exato no seu computador: abra o aplicativo → **Privacidade e dados** → seção **Onde ficam seus dados**.

Dentro dessa pasta existem 3 arquivos:

| Arquivo | O que guarda | Está protegido? |
|---|---|---|
| `assistente.db` | Conversas e memória | **Não** (arquivo comum) |
| `settings.json` | Preferências (lado do botão, modelo de IA, etc.) | Não |
| `secrets.json` | Sua chave de API da Groq | **Sim** (criptografada pelo Windows) |

Não existe servidor do projeto, sincronização na nuvem nem coleta de dados. Cada instalação guarda só os próprios dados.

## 2. O que é salvo

- **Conversas:** as mensagens suas e do assistente, se "Salvar o histórico" estiver ligado em **Privacidade e dados**. A conversa só é criada no disco quando você envia a primeira mensagem.
- **Não são salvos:** a saudação inicial e os avisos ou erros do aplicativo.
- **Memória:** somente o que você pedir. No chat, escreva por exemplo "Lembre-se de que prefiro respostas curtas", ou use a tela **Memória**. Nada é guardado sozinho.
- **Ao apagar:** o conteúdo é sobrescrito e o arquivo é compactado, para não sobrar texto antigo dentro dele.

## 3. O que é enviado à Groq (a IA)

A cada mensagem que você envia, vão para a Groq:

1. Instruções do sistema (texto fixo do aplicativo).
2. Suas mensagens recentes (cerca de 6.000 caracteres).
3. Itens da memória **relevantes** à sua pergunta (até 5), mais os marcados como "Usar sempre".
4. Sua chave de API (para autenticar o pedido).

**Voz:** quando você usa o microfone, o áudio gravado é enviado à Groq para transcrição (somente depois de você permitir, e só enquanto grava). O áudio não é salvo no seu computador. Detalhes em [`voz.md`](voz.md). A leitura em voz alta usa as vozes do Windows e não envia nada para fora.

**Nunca são enviados:** a memória inteira, o histórico antigo, arquivos ou a tela.

Quando algum item da memória é usado, o chat avisa: "Memória usada nesta resposta: N itens". Para desligar o envio da memória: **Privacidade e dados** → desmarque "Usar a memória nas respostas".

A escolha dos itens relevantes é feita no seu computador, comparando palavras em comum. É simples e pode errar: pode incluir um item sem relação ou deixar um de fora.

## 4. Limitações

- O banco `assistente.db` **não é criptografado**. Quem tiver acesso à sua conta do Windows ou ao disco consegue ler as conversas. Se isso importa para você, ative o BitLocker (ou a "criptografia de dispositivo") do Windows.
- Outros programas que rodam na sua conta do Windows podem ler esses arquivos.
- Backups do Windows ou da nuvem (por exemplo, OneDrive) podem copiar essa pasta.

## 5. Teste: duas instalações não compartilham dados

**Objetivo:** provar que dados de uma pasta não aparecem em outra.

**Como funciona:** por padrão o aplicativo usa a pasta da seção 1. Para o teste, você manda o aplicativo usar pastas diferentes (`A` e `B`) por meio de uma variável chamada `ASSISTENTE_DATA_DIR`. Ela só vale dentro da janela do terminal em que você a definiu.

Os comandos abaixo são para o **Prompt de Comando (CMD)**. No final há a versão para PowerShell.

**Antes de começar**

- Feche o assistente se ele estiver aberto (ícone da bandeja → **Sair**).
- Abra o **Prompt de Comando (CMD)** e vá até a pasta do projeto. O `/d` faz o CMD trocar de unidade (por exemplo, de `C:` para `D:`) se for preciso. As aspas não são obrigatórias para este nome de pasta, mas não atrapalham:

```bat
cd /d "C:\Projetos\assistente-ia"
```

### Passo 1: crie dados na pasta A

```bat
set "ASSISTENTE_DATA_DIR=C:\temp\assistente-A"
npm run dev
```

No aplicativo:

1. Clique na bolinha e envie: `Lembre-se de que meu time é o Sport`
2. Envie também: `Olá`
3. Encerre: clique com o botão direito no ícone da bandeja → **Sair**.

O terminal deve voltar ao prompt. Se não voltar, pressione `Ctrl + C`; se o CMD perguntar "Deseja finalizar o arquivo em lotes (S/N)?", digite `S` e pressione Enter.

### Passo 2: abra a pasta B

```bat
set "ASSISTENTE_DATA_DIR=C:\temp\assistente-B"
npm run dev
```

No aplicativo, clique com o botão direito no ícone da bandeja → **Abrir aplicativo**:

- A página **Memória** deve estar **vazia**.
- A página **Histórico** deve estar **vazia**.
- Em **Configurações**, a chave de API deve aparecer como **não salva**.

Isso é o esperado: a pasta B nunca viu os dados da A. Encerre pela bandeja → **Sair**.

### Passo 3: volte para a pasta A

```bat
set "ASSISTENTE_DATA_DIR=C:\temp\assistente-A"
npm run dev
```

Em **Memória** deve estar o item "meu time é o Sport", e em **Histórico** a conversa com "Olá". Encerre pela bandeja → **Sair**.

### Passo 4: limpeza

```bat
set ASSISTENTE_DATA_DIR=
```

Isso faz o aplicativo voltar a usar a pasta normal (seção 1). Se quiser, apague as pastas `C:\temp\assistente-A` e `C:\temp\assistente-B`.

### Resultado esperado

| Passo | Pasta | O que você vê |
|---|---|---|
| 1 | A | Você cria a memória e a conversa |
| 2 | B | Tudo vazio |
| 3 | A | Memória e conversa de volta |

Se no passo 2 aparecer algo da pasta A, há um defeito de isolamento. Me avise.

**Dica sobre o CMD:** escreva o comando `set` exatamente como acima, com as aspas em volta de `ASSISTENTE_DATA_DIR=...`. Elas não fazem parte do caminho; servem para evitar espaços perdidos no final. Para conferir se a variável está definida, digite `echo %ASSISTENTE_DATA_DIR%`: deve aparecer o caminho da pasta. Depois da limpeza (passo 4), esse comando mostra `%ASSISTENTE_DATA_DIR%` literalmente, que é o sinal de que ela foi removida.

**Observação:** durante o teste, o aplicativo mostra o caminho em uso em **Privacidade e dados**. Use isso para conferir que está mesmo na pasta `A` ou `B`.

## Versão para PowerShell

Se preferir o PowerShell, os comandos equivalentes são:

```powershell
cd "C:\Projetos\assistente-ia"                       # ir para a pasta do projeto
$env:ASSISTENTE_DATA_DIR = "C:\temp\assistente-A"    # definir a pasta (use ...-B no passo 2)
npm run dev
Remove-Item Env:ASSISTENTE_DATA_DIR                   # limpeza (passo 4)
```
