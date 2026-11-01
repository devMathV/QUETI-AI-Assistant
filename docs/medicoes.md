# Medições de desempenho

Máquina: Windows 11 · Intel Core i3-N305 · 8 GB RAM · sem GPU dedicada.
Versão medida: ______ (modo: dev / build)

## Como medir

1. **Pelo próprio app:** Aplicativo central → *Diagnóstico* → *Atualizar* (clique duas vezes e espere ~10 s entre as medições para a CPU ser representativa).
2. **Gerenciador de Tarefas:** aba *Detalhes*, filtre por `electron` (dev) ou pelo nome do executável (versão instalada) e some a coluna *Memória (conjunto de trabalho privado)*.

Meça sempre depois de 1 minuto parado, para ignorar o pico de inicialização.

## Resultados

| Cenário | RAM total (MB) | CPU média (%) | Observações |
|---|---|---|---|
| Só o botão flutuante (recém-aberto) | ~190 | | Medido em dev (Etapa 2), valor informado pelo usuário |
| Botão flutuante, ocioso por 5 min | | | |
| Chat rápido aberto | ~320 | | Medido em dev (Etapa 2), valor informado pelo usuário |
| Chat rápido + aplicativo central abertos | | | |
| Depois de fechar o chat rápido (5 min) | | | A janela compacta deve ser liberada |
| Gravando voz (chat rápido) | | | Etapa 4 |
| Lendo uma resposta em voz alta | ~350 | | Etapa 4 (informado pelo usuário) |
| Modo conversa: ouvindo | | | Etapa 4 |

## Meta (a definir após as primeiras medições)

Registrar aqui a meta realista de RAM e CPU em repouso e o que fazer se ela for ultrapassada (por exemplo, reavaliar Tauri).

## Observações

- Início do app: 900 MB logo ao abrir (provavelmente servidor de desenvolvimento), depois 430 MB e ~300 MB em repouso (informado pelo usuário). Repita com `npm run build` + `npm run preview`.
- Com o chat aberto, a memória variou de ~240 a ~340 MB (informado pelo usuário). A variação é normal no Chromium; acompanhe o piso ao longo do tempo para detectar vazamentos.
- As primeiras medições (Etapa 2) foram feitas em modo `dev`, que consome mais que a versão empacotada. Repita com `npm run build` + `npm run preview` e, na Etapa 7, com o instalador.
- Refaça as medições depois da Etapa 3: o banco SQLite é aberto na inicialização e deve acrescentar pouco; confirme.
