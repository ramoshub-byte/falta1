# Marcador no relógio: custos e alternativas

*Análise de 21 de novembro de 2026. Os valores são estimativas aproximadas.*

## Resumo

Para o POC, não compensa fazer já uma app de relógio. O custo é alto para uma app que hoje é uma PWA, já há muitas apps que fazem isto bem, e o objetivo do piloto (≈20 inscritos e 5 jogos reais num mês) não depende do relógio.

**Decisão:** resultado escrito à mão com confirmação dos adversários e marcador ao vivo na PWA, já feitos (ver [marcador-ao-vivo.md](marcador-ao-vivo.md)). O relógio fica para quando houver utilizadores a pedi-lo.

## Quanto custaria

Uma PWA não corre em relógios: é preciso código nativo à parte.

| Componente | Encomendado (freelancer PT, ~30–60 €/h) | Feito por nós com IA |
|---|---|---|
| App Apple Watch + app iPhone mínima (login e envio do resultado) | ~6.000–15.000 € | 4–8 semanas |
| App Wear OS (Android) | ~4.000–10.000 € | 3–6 semanas |
| As duas | ~10.000–25.000 € | — |
| Manutenção anual (novas versões do watchOS/Wear OS) | ~15–20 % do custo inicial | tempo |

Custos fixos:
- Apple Developer: 99 USD por ano
- Google Play: 25 USD, uma vez
- Material de teste, se não houver: um Mac (obrigatório para o Apple Watch), um Apple Watch e um relógio Wear OS. Conta com ~1.000 € ou mais.

## Porque não agora

- **O mercado já está cheio.** Só na App Store há mais de uma dúzia de apps de marcador de padel para relógio. Algumas são grátis, outras têm subscrição para as estatísticas, e algumas suportam também Wear OS: Padel Watch, Padel Pointer, PADEL'EM, PadelTick, PadelPoint, Pelota, entre outras.
- **O ranking precisa de validação de qualquer forma.** Um resultado marcado no relógio de um só jogador não chega para o ranking da época. A confirmação pelos adversários é o que dá valor à Falta 1, não o marcador.

## Alternativas, da mais barata para a mais cara

1. **Resultado no fim do jogo, na PWA (custo zero).** Um jogador regista e a outra equipa confirma ou contesta. ✅ Feito.
2. **Marcador ao vivo na PWA.** Botões grandes, anular, regras do padel, quem serve, trocas de lado, horizontal e ao vivo no ecrã do clube. ✅ Feito.
3. **Comando Bluetooth barato (~5–15 €)** preso à raquete ou ao pulso. O Web Bluetooth funciona no Chrome em Android mas não no Safari do iPhone. Serve para experimentar, mas não para depender disso.
4. **Ecrãs dos clubes** com o marcador do campo em direto. ✅ Feito (`ecra.html`).
5. **App de relógio, só com tração.** Começar por uma plataforma, conforme o que os jogadores do piloto usam mais. Basta uma versão mínima que marca pontos e envia o resultado para a confirmação.

Ver também: [integracao-apps-de-marcador.md](integracao-apps-de-marcador.md).
