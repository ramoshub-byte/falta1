# Integração com apps de marcador que já existem

*Análise de 21 de novembro de 2026.*

## Conclusão

Não há forma gratuita de ler automaticamente os resultados destas apps. Nas apps de relógio analisadas, nenhuma tem API pública ou webhooks. O que todas oferecem é **partilhar o resultado**: cartões de imagem para Instagram e WhatsApp, texto, ou um link ao vivo. São feitas para o jogador copiar o resultado à mão para outra app (algumas dizem-no explicitamente, a propósito da Playtomic).

O Apple Health também não serve: as apps só lá guardam o treino (batimentos, calorias), não o resultado, e uma PWA nem sequer consegue ler o Apple Health.

## Caminhos gratuitos

1. **A Falta 1 no menu "Partilhar" (só Android).** Uma PWA pode registar-se como destino de partilha (Web Share Target). O jogador partilha o resultado da app do relógio para a Falta 1, que preenche o resultado e envia-o para confirmação. O Safari no iPhone não suporta isto.
2. **Carregar uma captura de ecrã (iPhone e Android).** A Falta 1 lê o resultado da imagem com OCR (Tesseract.js corre no telemóvel e é grátis). Funciona com qualquer app de marcador.
3. **Parceria com um programador independente.** A Falta 1 disponibiliza um link do tipo `…/resultado?jogo=123&r=6-4,3-6,7-5`, e uma app de marcador acrescenta um botão "Enviar para a Falta 1". Bons candidatos:
   - **PadelPoint**: já está em português e espanhol, o que bate com a expansão para Espanha.
   - **PADEL'EM**: cobre Wear OS e Apple Watch.

## Plano

| Fase | O quê |
|---|---|
| POC | Resultado à mão + confirmação, e marcador ao vivo na PWA (feitos) |
| A seguir | Carregar captura de ecrã com OCR (opção 2) |
| Depois | Destino de partilha em Android (opção 1) |
| Com números para mostrar | Parceria com uma app de marcador (opção 3) |

Ver também: [marcador-no-relogio.md](marcador-no-relogio.md).
