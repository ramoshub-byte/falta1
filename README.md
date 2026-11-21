# I Want to Play Padle — POC (piloto Chaves)

Diz à app que queres jogar, sozinho ou com o teu parceiro. Ela junta os 4 jogadores pelo nível, lado, horário e distância, e depois propõe o campo num mapa.

## Como experimentar

Abre `index.html` no browser (duplo clique). Sem configuração, a app corre em **modo demonstração**, com jogadores fictícios. O mapa precisa de internet.

Para o piloto real, com contas, convites e feedback partilhados, segue o [SETUP.md](SETUP.md): Supabase e depois GitHub Pages.

## O que está feito

- **Perfil:** nome, nível 0–7, lado preferido, horários da semana, localização no mapa e distância máxima
- **Jogar:** modo sozinho ou com parceiro, e até 3 jogos propostos com as equipas e o equilíbrio entre elas
- **Campo:** mapa com os 4 jogadores e os clubes, com os clubes ao alcance de todos ordenados por distância
- **Os meus jogos:** jogos propostos, com o link para reservar no Playtomic
- **Marcador no telemóvel:** um toque por ponto, com ponto de ouro ou vantagens, tie-break a 7 e super tie-break a 10 no 3.º set. Tem botão de anular, o ecrã fica aceso e o marcador sobrevive a um recarregar da página. Também dá para escrever o resultado à mão.
- **Confirmação do resultado:** uma equipa regista e a outra confirma ou contesta. Só os resultados confirmados contam.
- **Nível calculado pelos jogos (`js/rating.js`):** Elo adaptado a pares, mostrado na escala 0–7
  - o nível do perfil é a autoavaliação inicial; depois do primeiro resultado confirmado, o matchmaking passa a usar o nível calculado
  - K = 48 nos primeiros 10 jogos, 32 até 30 jogos e 16 depois; vitórias folgadas valem até 1,5×
  - cada **parelha** tem rating próprio; a **química** é a diferença entre o nível da parelha e a média dos dois
- **Ranking:** jogadores (com tendência dos últimos jogos e marca de "provisório" abaixo de 5 jogos) e parelhas com química
- **Feedback pós-jogo:** estrelas ao clube (limpeza, balneários, serviços), se o nível foi equilibrado, como correu, e perguntas sim/não sobre cada jogador (pontual, fair play, voltava a jogar)
  - os jogadores pouco fiáveis passam a ser emparelhados longe dos fiáveis; o número nunca é mostrado, só o selo "✓ fiável"
  - os clubes bem avaliados ganham o desempate de distância
  - "fácil demais" / "difícil demais" fica guardado mas já não mexe no nível (agora são os resultados que o fazem)
- **Modo demonstração:** 24 jogadores fictícios de Chaves e 48 resultados fictícios (set–nov 2026), para o ranking não começar vazio

## Estrutura

```
index.html            app (PWA)
css/styles.css
js/data.js            clubes de Chaves + jogadores de teste
js/matchmaking.js     motor de matchmaking
js/rating.js          nível (Elo para pares, rating de parelha, química)
js/scorer.js          marcador de padel (regras, anular, resultado escrito à mão)
js/app.js             ecrãs
js/backend.js         dados: modo demonstração (localStorage) ou Supabase
js/config.js          chaves do Supabase (vazio = demonstração)
supabase/schema.sql   tabelas, regras de segurança e funções
manifest.webmanifest  instalação no telemóvel
sw.js                 funcionamento offline
tests/                node tests/matchmaking.test.js · rating.test.js · scorer.test.js
```

## Fluxo de um jogo (modo Supabase)

1. Alguém pede jogo, escolhe o campo e propõe. Os outros 3 recebem o convite em "Os meus jogos", e quem propôs pode avisá-los por WhatsApp.
2. Cada um aceita ou recusa. Quando os 4 aceitam, o jogo fica **confirmado**. Se alguém recusar, fica **recusado** e procura-se outro jogo.
3. Um dos jogadores reserva o campo no Playtomic.
4. No dia do jogo, alguém abre o **marcador** (ou escreve o resultado). A outra equipa confirma ou contesta. Se contestar, qualquer equipa pode registar outra vez.
5. Com o resultado confirmado, o jogo passa a **jogado** e o nível dos 4 e das 2 parelhas atualiza.
6. Cada um dá o feedback (clube e jogadores).

## Limitações do POC

- As coordenadas dos clubes são aproximadas e têm de ser confirmadas.
- A reserva é feita fora da app, no Playtomic.
- Não há notificações push: os avisos vão por WhatsApp e cada um abre "Os meus jogos".
- O nível é calculado no telemóvel de cada um a partir dos resultados confirmados (iguais para todos). Com muitos jogadores, passa para o servidor.
- Ainda não há marcador no relógio (Apple Watch / Wear OS): fica para a fase 2.
