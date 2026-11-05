# Voz: falar com o assistente e ouvir as respostas

## Como funciona

**Falar (entrada de voz)**

1. Você clica no botão do microfone.
2. Na primeira vez, o Windows mostra uma caixa do assistente pedindo permissão para enviar o áudio à Groq. Você pode recusar.
3. O microfone liga e aparece a barra "Gravando 0:07".
4. Você clica de novo no botão (agora um quadrado vermelho) para parar. O áudio é enviado à Groq, vira texto e aparece no campo de mensagem para você revisar. Se ativar "Enviar automaticamente", ele já vai direto para a conversa.

**Ouvir (saída de voz)**

- Em cada resposta do assistente há um botão de alto-falante: clique para ouvir e clique de novo para parar.
- Com a leitura automática ligada, a resposta começa a ser falada **na primeira frase completa**, sem esperar o fim.
- Em **Configurações → Voz** você pode ativar a leitura automática, escolher a voz e a velocidade e testar.
- Usa as vozes instaladas no Windows. Não usa internet e não custa nada.

## Modo conversa (sem clicar a cada frase)

O botão de ondas, ao lado do microfone, inicia uma **sessão de conversa por voz**:

1. Na primeira vez, o app pede a permissão de envio de áudio (a mesma da gravação por clique).
2. O app mede por um instante o ruído do ambiente ("Ajustando ao ruído do ambiente…"; fique em silêncio).
3. Quando você fala e faz uma **pausa** (1,2 s por padrão), a frase é transcrita e enviada.
4. O assistente responde **falando enquanto a resposta ainda chega** (a primeira frase começa assim que estiver completa).
5. Quando ele termina de falar, o app volta a ouvir.

Regras de segurança desta sessão:

- Só começa quando **você** clica. Não há palavra de ativação.
- O indicador mostra o estado o tempo todo (ouvindo, ouvindo você, transcrevendo, pensando, falando).
- **Uma voz por vez:** enquanto o assistente pensa e fala, o microfone fica silenciado, para ele não se ouvir. Não dá para interrompê-lo falando por cima.
- Termina sozinha após 90 segundos sem ninguém falar, após 20 minutos, ou se a janela for ocultada ou minimizada. Também termina em qualquer erro de chave ou de limite de uso, para não ficar tentando em loop.
- **Silêncio e ruído nunca saem do computador.** Só as frases detectadas são enviadas.
- Frases curtas demais, estalos e textos longos demais para o tempo de fala (típicos de invenção a partir de ruído) são descartados.
- Se a transcrição vier com **baixa confiança**, o assistente não responde ao conteúdo: ele diz "Não entendi bem. Pode repetir?" e você repete, sem gastar uma resposta da IA.

### Interromper o assistente falando por cima

Enquanto ele fala, o microfone fica atento (só para detectar a interrupção; nada é enviado ainda). Para evitar falsos alarmes, o app combina quatro proteções:

1. **Aprende o eco:** no primeiro segundo da fala do assistente, mede o quanto da voz dele entra no microfone (nos alto-falantes); sua voz precisa passar bem acima disso.
2. **Compara com a sua voz:** guarda o volume típico das suas frases anteriores, então vozes mais distantes (TV, outra pessoa) não bastam.
3. **Fala sustentada:** exige cerca de 0,6 s de voz forte com alto-falantes (0,45 s com fones), e não um estalo.
4. **Pausa antes de cortar:** ao detectar, a fala é só **pausada**. Se a transcrição mostrar que era ruído, ela continua de onde parou. Se era você, a fala para, a geração da resposta é cancelada e o que você disse é tratado como a próxima pergunta. Frases como "pare" ou "chega" só interrompem, sem gastar uma resposta da IA.

Na barra da conversa há uma chave rápida (**Alto-falantes / Fones / Sem interrupção**) e o botão **Interromper**, que corta a fala na hora. Em Configurações → Voz há as mesmas opções e o **tamanho das respostas no modo conversa** (curtas por padrão, com a oferta de detalhar).

Limites: com alto-falantes altos e o microfone perto deles, só falando bem forte (ou usando fones) a interrupção funciona. A pausa e a retomada da fala dependem do motor de voz do Windows e podem falhar em alguns casos.

Para continuar a conversa enquanto usa outro programa, **fixe o chat rápido com o alfinete**; sem ele, clicar fora oculta a janela e encerra a sessão.

Ajustes (Configurações → Voz): a **pausa** de fim de frase (aumente se ela cortar você, diminua se demorar) e, nas gravações por clique, o controle automático de volume do microfone. O modo conversa sempre o mantém desligado, porque ele amplifica ruídos baixos em silêncio.

**Cota:** cada frase conta no mínimo 10 segundos de áudio. O gargalo costuma ser o limite diário de tokens do modelo de texto, e não a transcrição; confira os limites da sua conta.

Como o detector de fala se baseia em volume (e não em um modelo de IA), ambientes com TV, música ou conversas ao fundo podem confundi-lo. Se isso acontecer com frequência, o próximo passo seria trocá-lo pelo Silero VAD.

## Privacidade

| O quê | Para onde vai |
|---|---|
| Áudio da sua voz | Groq (`api.groq.com`), só quando você grava e para transcrever. Não é salvo no seu computador. |
| Texto lido em voz alta | Fica no seu computador (vozes do Windows). Nada é enviado. |

- Não existe escuta contínua nem palavra de ativação. O microfone só liga pelo clique e é liberado ao parar.
- Durante a gravação o assistente mostra o tempo e o aviso de envio à Groq, e o Windows também mostra o ícone de microfone em uso.
- A gravação para sozinha em 2 minutos.
- Se a janela for ocultada ou minimizada durante a gravação, o microfone é desligado e o áudio é **descartado**.
- Você pode revogar a permissão de envio de áudio em **Configurações → Voz**.
- Não verifiquei a política de privacidade da Groq para o plano gratuito; leia-a antes de falar dados sensíveis.

## Limites de uso (Groq)

Valores de referência da documentação (outubro de 2026), iguais para os dois modelos de transcrição:

| Limite | Valor |
|---|---|
| Pedidos por minuto | 20 |
| Pedidos por dia | 2.000 |
| Segundos de áudio por hora | 7.200 |
| Segundos de áudio por dia | 28.800 |
| Tamanho do arquivo | 25 MB no plano gratuito (o assistente limita a gravação a 2 minutos, muito abaixo disso) |

**Atenção:** a página de limites descreve a tabela como os limites *base do plano Developer* e manda consultar a página de limites da sua conta para os valores exatos. Confira os seus em <https://console.groq.com/settings/limits>. Cada pedido conta **no mínimo 10 segundos** de áudio, mesmo que a frase seja curta.

Fontes: <https://console.groq.com/docs/rate-limits> e <https://console.groq.com/docs/speech-to-text>.

## Melhorando a precisão da transcrição

Em **Configurações → Precisão da transcrição**:

1. **Modelo.** O padrão é o `whisper-large-v3`, indicado pela Groq para quando erros importam (taxa de erro de palavras de 10,3%, contra 12% do `large-v3-turbo`). O turbo é mais rápido.
2. **Vocabulário.** Escreva nomes e termos que costumam ser trocados (por exemplo: `Electron, TypeScript, Sport`). O texto vai à Groq junto com o áudio e orienta a grafia.
3. **Contexto da conversa.** Com a opção ligada, as últimas frases da conversa e os nomes dos arquivos anexados vão junto com o vocabulário para orientar a grafia (ajuda a acertar palavras parecidas do assunto). Dá para desligar.
4. **Teste do microfone.** Mede volume e ruído por 8 segundos, só no seu computador. Diz se o volume está baixo, alto ou se há ruído demais. Um bom microfone ou headset costuma ajudar mais que qualquer ajuste de software.
5. **Comparar os modelos.** Grave uma frase e veja a transcrição de cada modelo lado a lado, com o tempo de cada um. Use frases reais suas.

Outras medidas já aplicadas:

- O áudio é gravado com redução de ruído, cancelamento de eco e, opcionalmente, controle de volume do sistema, em mono e com mais qualidade. O ganho automático vem desligado por padrão porque pode amplificar ruído baixo; ative-o em Configurações → Voz apenas se o microfone estiver muito baixo.
- **Sem fala, nada é enviado.** Durante a gravação o app mede o volume no seu computador. Se não houve fala (microfone mudo ou desligado, ou só ruído), ele avisa "Não ouvi nenhuma fala" e **não chama a Groq**. Isso evita o texto inventado que o Whisper produz em silêncio e poupa cota.
- **Filtro adicional na resposta.** Trechos que a transcrição marca como provável silêncio, fala duvidosa ou repetição são descartados, assim como algumas frases que o Whisper costuma inventar (por exemplo, "Legendas pela comunidade Amara.org").
- **Aviso de baixa confiança.** Quando a transcrição vem com pouca confiança, o app mostra "Confira o texto antes de enviar" e avisa o assistente.
- **O assistente só é alertado quando a mensagem veio de voz.** Nesse caso ele recebe a instrução de, se a frase não fizer sentido ou for ambígua, dizer o que entendeu e perguntar se era isso, em vez de responder ao conteúdo. Mensagens digitadas não recebem esse aviso.

Limite honesto: um modelo de linguagem não detecta absurdos de forma garantida. O que protege de verdade é você ver o texto transcrito antes de enviar (comportamento padrão) e o aviso de baixa confiança.

Não há garantia de acerto perfeito: sotaque, ruído e frases curtas continuam sendo as maiores causas de erro.

## Problemas comuns

**"O microfone foi bloqueado"**
No Windows 11: **Configurações → Privacidade e segurança → Microfone**. Ative "Acesso ao microfone" e "Permitir que aplicativos para desktop acessem seu microfone".

**"Nenhum microfone encontrado" ou "em uso por outro programa"**
Conecte o microfone, ou feche o programa que o estiver usando (por exemplo, uma chamada de vídeo). Em **Configurações → Voz** dá para escolher outro microfone.

**A janela do chat fecha quando eu clico fora e a gravação some**
É o comportamento de segurança descrito acima. Para gravar enquanto trabalha em outro programa, clique no **alfinete** do chat rápido antes: a janela fica aberta por cima.

**"Nenhuma voz em português foi encontrada"**
Instale uma voz em português no Windows: **Configurações → Hora e idioma → Fala** (adicionar vozes). Depois reabra o assistente. Quais vozes aparecem depende do Windows e do navegador embutido; se a lista ficar vazia mesmo com voz instalada, me avise com o nome da voz.

**A voz fala devagar demais ou rápido demais**
Ajuste a velocidade em **Configurações → Voz**.

## Como testar

1. **Sem chave:** remova a chave da Groq e clique no microfone. Deve aparecer o aviso com o botão "Abrir configurações", e o microfone não liga.
2. **Permissão:** com a chave salva, clique no microfone. Aparece a caixa de permissão. Recuse: o microfone não liga. Clique de novo e aceite.
3. **Gravar:** fale uma frase, clique para parar. O texto deve aparecer no campo de mensagem.
4. **Silêncio:** com o microfone mudo ou desligado, grave e pare. Deve aparecer "Não ouvi nenhuma fala" e nada deve ser enviado.
5. **Cancelar:** grave e clique em "Cancelar": nada é enviado. Repita e cancele durante "Transcrevendo…".
6. **Janela oculta:** comece a gravar e clique fora do chat rápido (sem o alfinete). A gravação deve ser descartada e o ícone de microfone do Windows deve sumir.
7. **Ouvir:** clique no alto-falante de uma resposta; clique de novo para parar. Peça uma resposta com código: o código não deve ser lido linha por linha.
8. **Leitura automática:** ative em Configurações → Voz, envie uma pergunta e confira que a resposta é lida, só na janela em que você escreveu.
9. **Revogar:** revogue a permissão em Configurações → Voz; o próximo clique no microfone deve pedir permissão de novo.
10. **Precisão:** faça o teste do microfone e a comparação de modelos (Configurações → Precisão da transcrição) com 5 a 10 frases suas e anote qual modelo errou menos.
11. **Modo conversa:** inicie a conversa, fale uma pergunta e faça uma pausa. Deve transcrever, responder falando e voltar a ouvir. Fique em silêncio por 90 s e confira o encerramento. Teste também uma frase longa com pausas no meio (ajuste a pausa se ela te cortar).
12. **Ruído baixo:** em silêncio, com um ruído baixo de fundo, nada deve ser enviado nem aparecer como texto inventado.
13. **Interrupção:** com respostas longas (peça uma explicação), fale "espera, e se..." durante a fala. Deve pausar, confirmar e tratar sua frase. Teste também com TV ou alguém falando ao fundo: a fala não deve ser cortada.
14. **Consumo:** em **Diagnóstico**, meça a memória e a CPU durante a gravação e durante a fala, e anote em `docs/medicoes.md`.
